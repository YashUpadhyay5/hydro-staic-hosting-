from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from models.extractions import RawAIExtraction
from repositories.base import BaseRepository

class ExtractionRepository(BaseRepository[RawAIExtraction]):
    def __init__(self):
        super().__init__(RawAIExtraction)

    def get_latest_for_document(self, db: Session, document_id: str) -> Optional[RawAIExtraction]:
        return db.query(RawAIExtraction).filter(
            RawAIExtraction.document_id == document_id,
            RawAIExtraction.is_deleted == False
        ).order_by(desc(RawAIExtraction.version)).first()

    def get_next_version(self, db: Session, document_id: str) -> int:
        latest = self.get_latest_for_document(db, document_id)
        return (latest.version + 1) if latest else 1

    def get_history_for_document(self, db: Session, document_id: str) -> List[RawAIExtraction]:
        return db.query(RawAIExtraction).filter(
            RawAIExtraction.document_id == document_id,
            RawAIExtraction.is_deleted == False
        ).order_by(desc(RawAIExtraction.version)).all()
