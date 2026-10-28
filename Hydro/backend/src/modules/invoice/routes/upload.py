from fastapi import (
    APIRouter,
    UploadFile,
    File,
    Form,
    HTTPException,
    Depends
)

from typing import List, Optional
import os
import uuid

from sqlalchemy.orm import Session

from database import get_db
from config import Config
from services.queue_service import QueueService
from models.template import Template

router = APIRouter()

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg"
}


@router.post("/upload")
async def upload_documents(
    files: Optional[List[UploadFile]] = File(None),
    file: Optional[UploadFile] = File(None),
    template_id: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    # Find matching template configuration
    tpl = None
    if template_id:
        tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        tpl = db.query(Template).filter(Template.is_default == True).first()

    tpl_id = tpl.id if tpl else None
    tpl_config = tpl.sections if tpl else None

    uploaded_documents = []
    all_files = []
    seen_filenames = set()
    
    if files:
        for f in files:
            if f.filename and f.filename not in seen_filenames:
                all_files.append(f)
                seen_filenames.add(f.filename)
                
    if file and file.filename and file.filename not in seen_filenames:
        all_files.append(file)
        seen_filenames.add(file.filename)

    for file in all_files:

        extension = os.path.splitext(
            file.filename
        )[1].lower()

        if extension not in ALLOWED_EXTENSIONS:

            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {file.filename}"
            )

        document_id = str(uuid.uuid4())

        stored_filename = (
            f"{document_id}{extension}"
        )

        file_path = os.path.join(
            Config.UPLOAD_DIR,
            stored_filename
        )

        file_bytes = await file.read()

        with open(
            file_path,
            "wb"
        ) as buffer:

            buffer.write(file_bytes)

        document = QueueService.create_document_record(
            db=db,
            document_id=document_id,
            filename=file.filename,
            file_path=file_path,
            file_content=file_bytes,
            template_id=tpl_id,
            template_config=tpl_config
        )

        uploaded_documents.append(
            document
        )

    return {
        "success": True,
        "message": f"{len(uploaded_documents)} file(s) uploaded successfully",
        "documents": uploaded_documents
    }