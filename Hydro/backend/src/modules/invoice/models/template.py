from sqlalchemy import (
    Column,
    String,
    Text,
    Boolean,
    TIMESTAMP,
    JSON,
    text
)
from database import Base

class Template(Base):
    __tablename__ = "templates"

    id = Column(
        String(100),
        primary_key=True
    )
    name = Column(
        String(255),
        nullable=False,
        unique=True
    )
    description = Column(
        Text,
        nullable=True
    )
    is_default = Column(
        Boolean,
        default=False
    )
    sections = Column(
        JSON,
        nullable=False
    )
    created_at = Column(
        TIMESTAMP,
        server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at = Column(
        TIMESTAMP,
        server_default=text("CURRENT_TIMESTAMP"),
        server_onupdate=text("CURRENT_TIMESTAMP")
    )
