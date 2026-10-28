from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from models.extractions import UserVerifiedExtraction
from repositories.base import BaseRepository

class TrainingDataRepository(BaseRepository[UserVerifiedExtraction]):
    def __init__(self):
        super().__init__(UserVerifiedExtraction)

    def get_latest_for_document(self, db: Session, document_id: str) -> Optional[UserVerifiedExtraction]:
        return db.query(UserVerifiedExtraction).filter(
            UserVerifiedExtraction.document_id == document_id,
            UserVerifiedExtraction.is_deleted == False
        ).order_by(desc(UserVerifiedExtraction.version)).first()

    def get_next_version(self, db: Session, document_id: str) -> int:
        latest = self.get_latest_for_document(db, document_id)
        return (latest.version + 1) if latest else 1

    def get_history_for_document(self, db: Session, document_id: str) -> List[UserVerifiedExtraction]:
        return db.query(UserVerifiedExtraction).filter(
            UserVerifiedExtraction.document_id == document_id,
            UserVerifiedExtraction.is_deleted == False
        ).order_by(desc(UserVerifiedExtraction.version)).all()

    def get_exportable_records(self, db: Session, status: str = "approved") -> List[UserVerifiedExtraction]:
        return db.query(UserVerifiedExtraction).filter(
            UserVerifiedExtraction.training_status == status,
            UserVerifiedExtraction.is_deleted == False
        ).all()
