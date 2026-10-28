import logging
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from models.extractions import RawAIExtraction, UserVerifiedExtraction
from repositories.extraction_repository import ExtractionRepository
from repositories.training_repository import TrainingDataRepository

logger = logging.getLogger("invoice-ocr-platform")

class ExtractionSyncService:
    def __init__(self):
        self.raw_repo = ExtractionRepository()
        self.verified_repo = TrainingDataRepository()

    def sync_raw_prediction(
        self,
        db: Session,
        document_id: str,
        extraction_data: Dict[str, Any],
        raw_ocr_text: Optional[str] = None,
        ocr_blocks: Optional[Dict[str, Any]] = None,
        confidence_score: Optional[float] = None,
        inference_time_ms: int = 0,
        user_info: Optional[Dict[str, Any]] = None
    ) -> RawAIExtraction:
        """
        Saves a new raw model prediction record inside a transaction.
        If a prediction already exists, increments the version counter.
        """
        try:
            next_version = self.raw_repo.get_next_version(db, document_id)
            creator = user_info.get("username") if user_info else "system"
            
            raw_record = RawAIExtraction(
                document_id=document_id,
                version=next_version,
                extraction_data=extraction_data,
                raw_ocr_text=raw_ocr_text,
                ocr_blocks=ocr_blocks,
                confidence_score=confidence_score,
                inference_time_ms=inference_time_ms,
                created_by=creator,
                updated_by=creator
            )
            
            self.raw_repo.create(db, raw_record)
            db.commit()
            
            logger.info(
                f"[DATABASE] Raw AI prediction saved. Document: {document_id}, "
                f"Version: {next_version}, Model: {raw_record.model_name}"
            )
            return raw_record
        except Exception as e:
            db.rollback()
            logger.error(f"[DATABASE] Failed to sync raw AI prediction for doc {document_id}: {str(e)}")
            raise e

    def sync_user_verification(
        self,
        db: Session,
        document_id: str,
        verified_data: Dict[str, Any],
        user_info: Dict[str, Any],
        correction_reason: Optional[str] = None,
        review_notes: Optional[str] = None
    ) -> UserVerifiedExtraction:
        """
        Transactionally computes AI performance metrics and saves a new human verification record.
        """
        try:
            # 1. Fetch latest raw AI extraction for accuracy comparison
            latest_ai = self.raw_repo.get_latest_for_document(db, document_id)
            ai_data = latest_ai.extraction_data if latest_ai else {}

            # 2. Compute comparison metrics
            metrics = self._calculate_accuracy_metrics(ai_data, verified_data)

            # 3. Create the verified record
            next_version = self.verified_repo.get_next_version(db, document_id)
            username = user_info.get("username", "admin")
            role = user_info.get("role", "Reviewer")

            verified_record = UserVerifiedExtraction(
                document_id=document_id,
                version=next_version,
                verified_data=verified_data,
                verified_by=username,
                reviewer_role=role,
                review_status="approved",
                training_status="pending",
                correction_reason=correction_reason,
                review_notes=review_notes,
                was_corrected=metrics["was_corrected"],
                number_of_fields_changed=metrics["fields_changed_count"],
                changed_fields=metrics["changed_fields"],
                edit_distance_score=metrics["edit_distance"],
                field_accuracy=metrics["accuracy"],
                overall_accuracy=metrics["accuracy"],
                created_by=username,
                updated_by=username
            )

            self.verified_repo.create(db, verified_record)
            db.commit()

            logger.info(
                f"[DATABASE] User verification saved. Document: {document_id}, "
                f"Version: {next_version}, Corrected fields: {metrics['fields_changed_count']}, "
                f"Field Accuracy: {metrics['accuracy']}%"
            )
            return verified_record
        except Exception as e:
            db.rollback()
            logger.error(f"[DATABASE] Failed to sync user verification for doc {document_id}: {str(e)}")
            raise e

    def _calculate_accuracy_metrics(
        self,
        ai_data: Dict[str, Any],
        verified_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Helper method to compare AI predictions with human corrections.
        """
        changed_fields = {}
        fields_changed_count = 0
        total_fields = 0
        matched_fields = 0

        # Helper to flatten dict for simple key comparison
        def flatten_dict(d, parent_key='', sep='.'):
            items = []
            for k, v in d.items():
                new_key = f"{parent_key}{sep}{k}" if parent_key else k
                if isinstance(v, dict):
                    items.extend(flatten_dict(v, new_key, sep=sep).items())
                elif isinstance(v, list):
                    # For lists (like items), store string representations or handle indices
                    for idx, item in enumerate(v):
                        if isinstance(item, dict):
                            items.extend(flatten_dict(item, f"{new_key}[{idx}]", sep=sep).items())
                        else:
                            items.append((f"{new_key}[{idx}]", str(item)))
                else:
                    items.append((new_key, str(v) if v is not None else ""))
            return dict(items)

        ai_flat = flatten_dict(ai_data)
        user_flat = flatten_dict(verified_data)

        # Union of all keys present in either AI or verified outputs
        all_keys = set(ai_flat.keys()).union(set(user_flat.keys()))

        for k in all_keys:
            ai_val = ai_flat.get(k, "").strip()
            user_val = user_flat.get(k, "").strip()

            if ai_val or user_val:  # Skip completely empty columns
                total_fields += 1
                if ai_val != user_val:
                    fields_changed_count += 1
                    changed_fields[k] = {
                        "predicted": ai_val,
                        "corrected": user_val
                    }
                else:
                    matched_fields += 1

        accuracy = 100.0
        if total_fields > 0:
            accuracy = round((matched_fields / total_fields) * 100.0, 2)

        # Basic character-level similarity score (Edit Distance proxy ratio)
        import difflib
        ai_str = str(ai_data)
        user_str = str(verified_data)
        edit_distance = round(difflib.SequenceMatcher(None, ai_str, user_str).ratio(), 4)

        return {
            "was_corrected": fields_changed_count > 0,
            "fields_changed_count": fields_changed_count,
            "changed_fields": changed_fields,
            "edit_distance": edit_distance,
            "accuracy": accuracy
        }
