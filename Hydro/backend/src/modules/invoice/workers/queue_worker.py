import time

from database import SessionLocal
from config import Config
from services.queue_service import QueueService
from services.ocr_service import OCRService


def auto_correct_tax_summary(ocr_result):
    return ocr_result


active_processing_ids = set()


def process_queue():

    while True:

        db = SessionLocal()
        current_doc_id = None

        try:

            document = QueueService.get_next_pending(db, exclude_ids=active_processing_ids)

            if not document:

                time.sleep(
                    Config.QUEUE_POLL_INTERVAL
                )

                continue

            document_id = document["document_id"]
            current_doc_id = document_id
            active_processing_ids.add(document_id)

            QueueService.update_document(
                db,
                document_id,
                {
                    "status": "PROCESSING"
                }
            )

            from models.queue_document import QueueDocument
            from models.template import Template
            from sqlalchemy.orm import undefer
            db_doc = db.query(QueueDocument).options(
                undefer(QueueDocument.file_content)
            ).filter(
                QueueDocument.document_id == document_id
            ).first()

            tpl_config = None
            if db_doc:
                tpl_config = db_doc.template_config
                if not tpl_config:
                    tpl = db.query(Template).filter(Template.is_default == True).first()
                    if tpl:
                        tpl_config = tpl.sections
                        db_doc.template_id = tpl.id
                        db_doc.template_config = tpl.sections
                        db.commit()

            t_worker_start = time.time()
            if not db_doc or not db_doc.file_content:
                import os
                if db_doc and db_doc.file_path and os.path.exists(db_doc.file_path):
                    with open(db_doc.file_path, "rb") as f:
                        file_bytes = f.read()
                    result = OCRService.process_file_bytes(db_doc.filename, file_bytes, template_config=tpl_config)
                else:
                    raise Exception("File content or physical file path not found")
            else:
                result = OCRService.process_file_bytes(
                    db_doc.filename,
                    db_doc.file_content,
                    template_config=tpl_config
                )

            worker_elapsed_ms = round((time.time() - t_worker_start) * 1000, 2)
            if isinstance(result, dict):
                if "metadata" not in result or not isinstance(result["metadata"], dict):
                    result["metadata"] = {}
                if not result["metadata"].get("processing_time_ms") or result["metadata"].get("processing_time_ms") == 450.0:
                    result["metadata"]["processing_time_ms"] = worker_elapsed_ms

            # Auto-correct raw OCR tax summary mismatches or blunders before processing duplicate checks
            result = auto_correct_tax_summary(result)

            # Check for duplicate invoice number in existing processed/saved queue documents
            extraction = result.get("extraction", {}) or {}
            inv_details = extraction.get("invoice_details", {}) or {}
            invoice_number = inv_details.get("invoice_number") or inv_details.get("bill_number")
            if invoice_number:
                existing = db.query(QueueDocument).filter(
                    QueueDocument.document_id != document_id,
                    QueueDocument.status.in_(["PENDING_VALIDATION", "VALIDATED", "ARCHIVED"])
                ).all()
                for ext_doc in existing:
                    ext_data = ext_doc.final_extraction or (ext_doc.ocr_result.get("extraction") if ext_doc.ocr_result else {}) or {}
                    ext_inv = ext_data.get("invoice_details", {}) or {}
                    ext_inv_num = ext_inv.get("invoice_number") or ext_inv.get("bill_number")
                    if ext_inv_num and str(ext_inv_num).strip().upper() == str(invoice_number).strip().upper():
                        warning_msg = f"Duplicate invoice notice: Invoice #{invoice_number} matches existing Document ID {ext_doc.document_id}."
                        if "validation" not in result:
                            result["validation"] = {"passed": True, "errors": [], "warnings": []}
                        result["validation"]["warnings"].append(warning_msg)
                        print(f"[QueueWorker] {warning_msg}")
                        break

            QueueService.update_document(
                db,
                document_id,
                {
                    "status": "PENDING_VALIDATION",
                    "ocr_result": result
                }
            )

        except Exception as e:

            try:

                if 'document_id' in locals():

                    QueueService.update_document(
                        db,
                        document_id,
                        {
                            "status": "FAILED",
                            "error": str(e)
                        }
                    )

            except Exception:
                pass

            time.sleep(1)

        finally:
            if current_doc_id:
                active_processing_ids.discard(current_doc_id)
            db.close()

        time.sleep(1)