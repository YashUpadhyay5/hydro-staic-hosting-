from sqlalchemy import (
    Column,
    String,
    Text,
    Boolean,
    Integer,
    TIMESTAMP,
    JSON,
    LargeBinary,
    text
)
from sqlalchemy.orm import deferred
from database import Base


class QueueDocument(Base):

    __tablename__ = "documents"

    document_id = Column(
        String(100),
        primary_key=True
    )

    filename = Column(
        String(255),
        nullable=False
    )

    file_path = Column(
        Text,
        nullable=False
    )

    file_content = deferred(Column(
        LargeBinary,
        nullable=True
    ))

    status = Column(
        String(50),
        default="Pending"
    )

    saved = Column(
        Boolean,
        default=False
    )

    ocr_result = Column(
        JSON,
        nullable=True
    )

    final_extraction = Column(
        JSON,
        nullable=True
    )

    template_id = Column(
        String(100),
        nullable=True
    )

    template_config = Column(
        JSON,
        nullable=True
    )

    error = Column(
        Text,
        nullable=True
    )

    verification_time = Column(
        Integer,
        default=0
    )

    created_at = Column(
        TIMESTAMP,
        server_default=text(
            "CURRENT_TIMESTAMP"
        )
    )
