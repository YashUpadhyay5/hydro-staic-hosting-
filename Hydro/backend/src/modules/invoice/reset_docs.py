import sys
import os

sys.path.append(os.path.join(os.getcwd(), "backend"))

from database import SessionLocal
from models.queue_document import QueueDocument

db = SessionLocal()
docs = db.query(QueueDocument).all()
count = 0
for d in docs:
    is_empty = False
    if not d.ocr_result:
        is_empty = True
    else:
        ext = d.ocr_result.get("extraction") or {}
        inv = ext.get("invoice_details") or {}
        if not inv.get("invoice_number"):
            is_empty = True
            
    if is_empty:
        d.status = "LocalPending"
        d.ocr_result = None
        d.final_extraction = None
        db.add(d)
        count += 1
db.commit()
print(f"Successfully reset {count} documents.")
