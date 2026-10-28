from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from models.queue_document import QueueDocument
from datetime import datetime
import json


class QueueService:

    @staticmethod
    def map_status(status: str) -> str:
        if not status:
            return "PENDING_VALIDATION"
        s = status.strip()
        if s in ["Processed", "LocalProcessed"]:
            return "PENDING_VALIDATION"
        elif s == "Saved":
            return "ARCHIVED"
        elif s in ["Processing", "LocalPending", "Pending", "UPLOADING"]:
            return "PROCESSING"
        elif s == "Failed":
            return "FAILED"
        return s.upper()

    @staticmethod
    def create_document_record(
        db: Session,
        document_id: str,
        filename: str,
        file_path: str,
        file_content: bytes = None,
        template_id: str = None,
        template_config: dict = None
    ):

        db_doc = QueueDocument(
            document_id=document_id,
            filename=filename,
            file_path=file_path,
            file_content=file_content,
            status="LocalPending",
            saved=False,
            ocr_result=None,
            final_extraction=None,
            template_id=template_id,
            template_config=template_config,
            error=None,
            verification_time=0
        )

        db.add(db_doc)
        db.commit()
        db.refresh(db_doc)

        return {
            "document_id": db_doc.document_id,
            "filename": db_doc.filename,
            "file_path": db_doc.file_path,
            "status": QueueService.map_status(db_doc.status),
            "saved": db_doc.saved,
            "ocr_result": db_doc.ocr_result,
            "final_extraction": db_doc.final_extraction,
            "template_id": db_doc.template_id,
            "template_config": db_doc.template_config,
            "error": db_doc.error,
            "verification_time": db_doc.verification_time,
            "created_at": db_doc.created_at.isoformat() if db_doc.created_at else datetime.utcnow().isoformat()
        }

    @staticmethod
    def get_document(
        db: Session,
        document_id: str
    ):

        db_doc = db.query(QueueDocument).filter(
            QueueDocument.document_id == document_id
        ).first()

        if not db_doc:
            return None

        # Sync check: If inventory records exist, mark as Saved. If they were deleted, remove from queue.
        from models.inventory import ProjectInventoryDocs
        exists = db.query(ProjectInventoryDocs).filter(
            ProjectInventoryDocs.group_id == db_doc.document_id
        ).first()

        if exists:
            if not db_doc.saved or db_doc.status != "Saved":
                db_doc.saved = True
                db_doc.status = "Saved"
                db.commit()
                db.refresh(db_doc)

            # Ensure saved bank details from inventory are merged into extraction
            if exists.bank_name or exists.account_number or exists.ifsc_code or exists.bank_branch:
                inv_bank = {
                    "bank_name": exists.bank_name or "",
                    "branch": exists.bank_branch or "",
                    "account_number": exists.account_number or "",
                    "account_no": exists.account_number or "",
                    "ifsc_code": exists.ifsc_code or "",
                    "ifsc": exists.ifsc_code or ""
                }
                if db_doc.final_extraction and isinstance(db_doc.final_extraction, dict):
                    fb = db_doc.final_extraction.get("bank_details") or {}
                    for bk, bv in inv_bank.items():
                        if bv and not fb.get(bk):
                            fb[bk] = bv
                    db_doc.final_extraction["bank_details"] = fb
                if db_doc.ocr_result and isinstance(db_doc.ocr_result, dict):
                    ext = db_doc.ocr_result.get("extraction")
                    if isinstance(ext, dict):
                        ob = ext.get("bank_details") or {}
                        for bk, bv in inv_bank.items():
                            if bv and not ob.get(bk):
                                ob[bk] = bv


        return {
            "document_id": db_doc.document_id,
            "filename": db_doc.filename,
            "file_path": db_doc.file_path,
            "status": QueueService.map_status(db_doc.status),
            "saved": db_doc.saved,
            "ocr_result": db_doc.ocr_result,
            "final_extraction": db_doc.final_extraction,
            "template_id": db_doc.template_id,
            "template_config": db_doc.template_config,
            "error": db_doc.error,
            "verification_time": db_doc.verification_time,
            "created_at": db_doc.created_at.isoformat() if db_doc.created_at else datetime.utcnow().isoformat()
        }

    @staticmethod
    def update_document(
        db: Session,
        document_id: str,
        data: dict
    ):

        db_doc = db.query(QueueDocument).filter(
            QueueDocument.document_id == document_id
        ).first()

        if not db_doc:
            return None

        for key, value in data.items():
            setattr(db_doc, key, value)
            if key in ["ocr_result", "final_extraction"]:
                flag_modified(db_doc, key)

        # Delegate to ExtractionSyncService for ML training pairs synchronization
        from services.extraction_sync_service import ExtractionSyncService
        sync_service = ExtractionSyncService()

        if "ocr_result" in data and data["ocr_result"]:
            ocr_ext = data["ocr_result"].get("extraction")
            if ocr_ext:
                raw_text = data["ocr_result"].get("raw_text") or data["ocr_result"].get("text", "")
                ocr_blocks = data["ocr_result"].get("blocks")
                confidence = data["ocr_result"].get("confidence_score")
                inf_time = data["ocr_result"].get("inference_time_ms", 0)
                
                sync_service.sync_raw_prediction(
                    db=db,
                    document_id=document_id,
                    extraction_data=ocr_ext,
                    raw_ocr_text=raw_text,
                    ocr_blocks=ocr_blocks,
                    confidence_score=confidence,
                    inference_time_ms=inf_time
                )

        if "final_extraction" in data and data["final_extraction"]:
            sync_service.sync_user_verification(
                db=db,
                document_id=document_id,
                verified_data=data["final_extraction"],
                user_info={"username": data.get("added_by") or "admin", "role": "Reviewer"}
            )

        # Automatically format filename as "Vendor Name - Invoice Number"
        extraction = data.get("final_extraction") or (data.get("ocr_result", {}).get("extraction") if isinstance(data.get("ocr_result"), dict) else None)
        if not extraction:
            extraction = db_doc.final_extraction or (db_doc.ocr_result.get("extraction") if isinstance(db_doc.ocr_result, dict) else None)

        if isinstance(extraction, str):
            try:
                extraction = json.loads(extraction)
            except Exception:
                extraction = None

        if extraction and isinstance(extraction, dict):
            vendor = extraction.get("vendor_details", {}) or {}
            invoice = extraction.get("invoice_details", {}) or {}
            raw_v_name = vendor.get("name")
            raw_inv_num = invoice.get("invoice_number")
            vendor_name = str(raw_v_name).strip() if raw_v_name and str(raw_v_name).strip().lower() != "none" else ""
            invoice_number = str(raw_inv_num).strip() if raw_inv_num and str(raw_inv_num).strip().lower() != "none" else ""

            new_filename = ""
            if vendor_name and invoice_number:
                new_filename = f"{vendor_name} - {invoice_number}"
            elif vendor_name:
                new_filename = vendor_name
            elif invoice_number:
                new_filename = f"Invoice #{invoice_number}"

            if new_filename and db_doc.filename != new_filename:
                db_doc.filename = new_filename

        db.commit()
        db.refresh(db_doc)

        return {
            "document_id": db_doc.document_id,
            "filename": db_doc.filename,
            "file_path": db_doc.file_path,
            "status": QueueService.map_status(db_doc.status),
            "saved": db_doc.saved,
            "ocr_result": db_doc.ocr_result,
            "final_extraction": db_doc.final_extraction,
            "template_id": db_doc.template_id,
            "template_config": db_doc.template_config,
            "error": db_doc.error,
            "verification_time": db_doc.verification_time,
            "created_at": db_doc.created_at.isoformat() if db_doc.created_at else datetime.utcnow().isoformat()
        }

    @staticmethod
    def get_all_documents(
        db: Session
    ):
        # Sync check on all documents before returning list
        docs = db.query(QueueDocument).all()
        from models.inventory import ProjectInventoryDocs
        
        # Optimize N+1 queries: fetch all existing group_ids in a single query
        existing_group_ids = {
            r[0] for r in db.query(ProjectInventoryDocs.group_id).filter(
                ProjectInventoryDocs.group_id.isnot(None)
            ).all()
        }
        
        # Update status for existing saved docs without deleting any documents
        modified = False
        for doc in docs:
            exists = doc.document_id in existing_group_ids
            if exists:
                if not doc.saved or doc.status != "Saved":
                    doc.saved = True
                    doc.status = "Saved"
                    modified = True

        if modified:
            db.commit()

        # Re-query docs in ascending order to return correct state
        docs = db.query(QueueDocument).order_by(
            QueueDocument.created_at.asc()
        ).all()

        result = []
        for doc in docs:
            grand_total = 0.0
            processing_time_ms = 0.0

            # Extract grand_total from final_extraction or ocr_result safely
            extraction = doc.final_extraction
            if isinstance(extraction, str):
                if extraction.strip() in ['null', 'None', '', 'undefined']:
                    extraction = None
                else:
                    try:
                        extraction = json.loads(extraction)
                    except Exception:
                        extraction = None

            if not extraction and doc.ocr_result:
                ocr = doc.ocr_result
                if isinstance(ocr, str):
                    try:
                        ocr = json.loads(ocr)
                    except Exception:
                        ocr = None
                if isinstance(ocr, dict):
                    extraction = ocr.get("extraction")
                    if isinstance(extraction, str):
                        try:
                            extraction = json.loads(extraction)
                        except Exception:
                            extraction = None

            if extraction and isinstance(extraction, dict):
                ts = extraction.get("tax_summary", {}) or {}
                val = ts.get("grand_total") or ts.get("calculated_grand_total") or 0.0
                if isinstance(val, str):
                    val = val.replace(",", "").replace("₹", "").strip()
                try:
                    grand_total = float(val)
                except ValueError:
                    grand_total = 0.0

            # Extract processing_time_ms from ocr_result metadata safely
            ocr = doc.ocr_result
            if isinstance(ocr, str):
                try:
                    ocr = json.loads(ocr)
                except Exception:
                    ocr = None
            if ocr and isinstance(ocr, dict):
                metadata = ocr.get("metadata", {}) or {}
                pt_val = metadata.get("processing_time_ms") or ocr.get("executionTime") or ocr.get("inference_time_ms") or 0.0
                if isinstance(pt_val, str):
                    pt_val = pt_val.replace(",", "").strip()
                try:
                    processing_time_ms = float(pt_val)
                except ValueError:
                    processing_time_ms = 0.0

            result.append({
                "document_id": doc.document_id,
                "filename": doc.filename,
                "file_path": doc.file_path,
                "status": QueueService.map_status(doc.status),
                "saved": doc.saved,
                "template_id": doc.template_id,
                "template_config": doc.template_config,
                "verification_time": doc.verification_time,
                "grand_total": grand_total,
                "processing_time_ms": processing_time_ms,
                "created_at": doc.created_at.isoformat() if doc.created_at else datetime.utcnow().isoformat()
            })

        return result

    @staticmethod
    def get_next_pending(
        db: Session,
        exclude_ids: set = None
    ):
        query = db.query(QueueDocument)
        if exclude_ids:
            query = query.filter(QueueDocument.document_id.notin_(list(exclude_ids)))

        # 1. First look for brand new pending uploads
        db_doc = query.filter(
            QueueDocument.status.in_(["LocalPending", "Pending", "UPLOADING"])
        ).order_by(
            QueueDocument.created_at.asc()
        ).first()

        # 2. If none, automatically recover any orphaned "Processing" jobs
        if not db_doc:
            db_doc = query.filter(
                QueueDocument.status.in_(["Processing", "PROCESSING"])
            ).order_by(
                QueueDocument.created_at.asc()
            ).first()

        if not db_doc:
            return None

        return {
            "document_id": db_doc.document_id,
            "filename": db_doc.filename,
            "file_path": db_doc.file_path,
            "status": QueueService.map_status(db_doc.status),
            "saved": db_doc.saved,
            "ocr_result": db_doc.ocr_result,
            "final_extraction": db_doc.final_extraction,
            "template_id": db_doc.template_id,
            "template_config": db_doc.template_config,
            "error": db_doc.error,
            "verification_time": db_doc.verification_time,
            "created_at": db_doc.created_at.isoformat() if db_doc.created_at else datetime.utcnow().isoformat()
        }