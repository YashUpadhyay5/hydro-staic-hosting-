import json
import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from models.extractions import RawAIExtraction, UserVerifiedExtraction
from repositories.training_repository import TrainingDataRepository

logger = logging.getLogger("invoice-ocr-platform")

class DatasetBuilderService:
    def __init__(self):
        self.verified_repo = TrainingDataRepository()

    def build_instruction_tuning_dataset(
        self,
        db: Session,
        output_filepath: str,
        status: str = "approved",
        reviewer_name: Optional[str] = None
    ) -> int:
        """
        Queries approved training records, matches them with original OCR text,
        and saves them as a Qwen/Llama instruction-tuning JSONL dataset.
        """
        try:
            query = db.query(UserVerifiedExtraction, RawAIExtraction).join(
                RawAIExtraction,
                UserVerifiedExtraction.document_id == RawAIExtraction.document_id
            ).filter(
                UserVerifiedExtraction.training_status == status,
                UserVerifiedExtraction.is_deleted == False,
                RawAIExtraction.is_deleted == False
            )

            if reviewer_name:
                query = query.filter(UserVerifiedExtraction.verified_by == reviewer_name)

            records = query.all()
            exported_count = 0

            # Ensure parent directories exist
            os_dir = os.path.dirname(output_filepath)
            if os_dir:
                os.makedirs(os_dir, exist_ok=True)

            with open(output_filepath, "w", encoding="utf-8") as f:
                for verified, raw in records:
                    # Construct instruction dataset sample
                    sample = {
                        "instruction": "Extract invoice information into JSON.",
                        "input": raw.raw_ocr_text or "",
                        "output": json.dumps(verified.verified_data, ensure_ascii=False)
                    }
                    
                    f.write(json.dumps(sample, ensure_ascii=False) + "\n")
                    
                    # Update training status to exported
                    verified.training_status = "exported"
                    self.verified_repo.update(db, verified)
                    exported_count += 1

            db.commit()
            logger.info(f"[ML PLATFORM] Exported {exported_count} training records to {output_filepath}")
            return exported_count
        except Exception as e:
            db.rollback()
            logger.error(f"[ML PLATFORM] Failed to build fine-tuning dataset: {str(e)}")
            raise e
            
import os
