from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import (
    Column,
    String,
    Integer,
    ForeignKey,
    JSON,
    Text,
    Boolean,
    TIMESTAMP,
    Float,
    Index
)
from sqlalchemy.orm import Mapped, mapped_column
from database import Base
from models.mixins import AuditMixin, SoftDeleteMixin


class RawAIExtraction(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "raw_ai_extractions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(
        String(100),
        ForeignKey("documents.document_id", ondelete="CASCADE"),
        nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    
    # Model details
    model_name: Mapped[str] = mapped_column(String(100), default="Qwen2.5-VL-7B-Instruct")
    model_version: Mapped[str] = mapped_column(String(50), default="2.5")
    prompt_version: Mapped[str] = mapped_column(String(50), default="v1.0")
    
    # Extractions & Complete OCR payloads
    extraction_data: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    raw_ocr_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ocr_blocks: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    
    # Performance & Inference metadata
    temperature: Mapped[float] = mapped_column(Float, default=0.0)
    top_p: Mapped[float] = mapped_column(Float, default=0.9)
    max_tokens: Mapped[int] = mapped_column(Integer, default=2048)
    confidence_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    inference_time_ms: Mapped[int] = mapped_column(Integer, default=0)
    processing_pipeline_version: Mapped[str] = mapped_column(String(50), default="1.0.0")

    # Composite indexes for massive datasets optimization
    __table_args__ = (
        Index("idx_raw_ai_doc_ver", "document_id", "version"),
        Index("idx_raw_ai_model", "model_name", "model_version"),
        Index("idx_raw_ai_created", "created_at"),
    )


class UserVerifiedExtraction(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "user_verified_extractions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(
        String(100),
        ForeignKey("documents.document_id", ondelete="CASCADE"),
        nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    
    # Human Review Metadata
    verified_data: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    verified_by: Mapped[str] = mapped_column(String(100), default="admin")
    reviewer_role: Mapped[str] = mapped_column(String(50), default="Reviewer")
    review_status: Mapped[str] = mapped_column(String(30), default="approved") # approved, rejected, pending
    training_status: Mapped[str] = mapped_column(String(30), default="pending") # pending, approved, rejected, exported, trained
    
    correction_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Accuracy Metric Trackers
    was_corrected: Mapped[bool] = mapped_column(Boolean, default=False)
    number_of_fields_changed: Mapped[int] = mapped_column(Integer, default=0)
    changed_fields: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    edit_distance_score: Mapped[float] = mapped_column(Float, default=0.0)
    field_accuracy: Mapped[float] = mapped_column(Float, default=100.0)
    overall_accuracy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Performance indices
    __table_args__ = (
        Index("idx_user_ver_doc_ver", "document_id", "version"),
        Index("idx_user_ver_status", "training_status"),
        Index("idx_user_ver_reviewer", "verified_by"),
        Index("idx_user_ver_created", "created_at"),
    )
