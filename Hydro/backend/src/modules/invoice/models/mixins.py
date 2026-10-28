from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, TIMESTAMP, func
from sqlalchemy.orm import Mapped, mapped_column

class AuditMixin:
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True
    )
    source_application: Mapped[Optional[str]] = mapped_column(
        String(100),
        default="invoice-ocr-platform",
        server_default="invoice-ocr-platform"
    )

class SoftDeleteMixin:
    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default="false",
        index=True
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True
    )
    deleted_by: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True
    )
