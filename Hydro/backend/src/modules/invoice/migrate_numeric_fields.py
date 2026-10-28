import os
import sys
import re

sys.path.append(os.path.join(os.getcwd(), "backend"))

from database import SessionLocal
from models.queue_document import QueueDocument
from services.ocr_service import OCRService

db = SessionLocal()
try:
    docs = db.query(QueueDocument).all()
    updated = 0
    for d in docs:
        if not d.ocr_result:
            continue
            
        print(f"Cleaning Document ID: {d.document_id} | Name: {d.filename}")
        
        # Read the file content
        file_bytes = d.file_content
        if not file_bytes and d.file_path and os.path.exists(d.file_path):
            with open(d.file_path, "rb") as f:
                file_bytes = f.read()
                
        if not file_bytes:
            print("  Warning: No PDF content found to extract text.")
            
        # Clean current ocr_result
        ocr = d.ocr_result
        if "extraction" in ocr:
            ext = ocr["extraction"]
            
            # Post-process with fitz to strip commas and extract missing fields
            ocr["extraction"] = OCRService.post_process_with_pdf_text(ext, file_bytes or b"")
            
            # Force set final_extraction to None so it gets regenerated dynamically
            d.final_extraction = None
            d.ocr_result = ocr
            db.add(d)
            updated += 1
            
    db.commit()
    print(f"\nSUCCESS! Cleaned and updated {updated} documents.")
except Exception as e:
    db.rollback()
    print(f"Migration failed: {e}")
finally:
    db.close()
