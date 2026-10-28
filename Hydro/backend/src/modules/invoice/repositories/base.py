from typing import Generic, TypeVar, Type, Optional, List
from sqlalchemy.orm import Session
from database import Base

T = TypeVar("T", bound=Base)

class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T]):
        self.model = model

    def get_by_id(self, db: Session, id: any) -> Optional[T]:
        return db.query(self.model).filter(
            self.model.id == id,
            self.model.is_deleted == False
        ).first()

    def get_all(self, db: Session, skip: int = 0, limit: int = 100) -> List[T]:
        return db.query(self.model).filter(
            self.model.is_deleted == False
        ).offset(skip).limit(limit).all()

    def create(self, db: Session, obj: T) -> T:
        db.add(obj)
        db.flush()  # Flushes changes to generate ID within a transaction
        return obj

    def update(self, db: Session, obj: T) -> T:
        db.add(obj)
        db.flush()
        return obj

    def soft_delete(self, db: Session, obj: T, deleted_by: Optional[str] = None) -> T:
        from datetime import datetime
        obj.is_deleted = True
        obj.deleted_at = datetime.utcnow()
        obj.deleted_by = deleted_by
        db.add(obj)
        db.flush()
        return obj
