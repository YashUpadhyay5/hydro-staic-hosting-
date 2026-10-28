import sys
import os
import time

from database import SessionLocal
from models.queue_document import QueueDocument
from workers.queue_worker import process_queue

print("Starting queue worker synchronously...")
# We will run a modified worker loop that stops when there are no more PROCESSING or LocalPending documents
db = SessionLocal()

# Reset any stuck PROCESSING documents back to LocalPending first
stuck_docs = db.query(QueueDocument).filter(QueueDocument.status == "PROCESSING").all()
for d in stuck_docs:
    d.status = "LocalPending"
    db.add(d)
db.commit()
print(f"Reset {len(stuck_docs)} stuck PROCESSING documents back to LocalPending.")
db.close()

# Start the worker logic
try:
    process_queue()
except KeyboardInterrupt:
    print("Stopped by user.")
