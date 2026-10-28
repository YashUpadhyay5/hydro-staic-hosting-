from pydantic import BaseModel
from typing import Optional, Dict, Any


class DocumentResponse(BaseModel):

    document_id: str

    filename: str

    status: str

    saved: bool

    created_at: str

    ocr_result: Optional[Dict[str, Any]] = None