import os
import sys

sys.path.append(os.path.join(os.getcwd(), "backend"))
from database import SessionLocal
from models.queue_document import QueueDocument

db = SessionLocal()
try:
    docs = db.query(QueueDocument).all()
    for d in docs:
        print(f"ID: {d.document_id} | Name: {d.filename}")
        print(f"  Template ID: {d.template_id}")
        if d.template_config:
            for sec in d.template_config:
                print(f"    Section: {sec.get('id')} | Enabled: {sec.get('enabled')}")
        else:
            print("  Template Config is None")
        print("-" * 50)
finally:
    db.close()
