from fastapi import (
    APIRouter,
    Depends,
    HTTPException
)

from fastapi.responses import (
    FileResponse
)

from sqlalchemy.orm import Session

from database import get_db

from services.excel_service import (
    ExcelService
)

from services.pdf_service import (
    PDFService
)

from services.queue_service import (
    QueueService
)

from typing import Optional

router = APIRouter()


@router.get("/export/excel")
def export_excel(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    startDate: Optional[str] = None,
    endDate: Optional[str] = None,
    document_id: Optional[str] = None,
    saved_only: Optional[bool] = True,
    db: Session = Depends(get_db)
):
    effective_start = start_date or startDate
    effective_end = end_date or endDate

    file_path = (
        ExcelService.generate_inventory_excel(
            db,
            start_date=effective_start,
            end_date=effective_end,
            document_id=document_id,
            saved_only=saved_only
        )
    )

    filename = "inventory_saved_invoices.xlsx"
    if document_id:
        filename = f"invoice_{document_id}.xlsx"
    elif effective_start and effective_end:
        filename = f"invoices_{effective_start}_to_{effective_end}.xlsx"
    elif effective_start:
        filename = f"invoices_from_{effective_start}.xlsx"
    elif effective_end:
        filename = f"invoices_up_to_{effective_end}.xlsx"

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@router.get("/export/excel/{document_id}")
def export_excel_by_id(
    document_id: str,
    saved_only: Optional[bool] = False,
    db: Session = Depends(get_db)
):
    file_path = ExcelService.generate_inventory_excel(
        db,
        document_id=document_id,
        saved_only=saved_only
    )
    filename = f"invoice_{document_id}.xlsx"
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@router.get(
    "/export/summary/{document_id}"
)
def export_summary(
    document_id: str,
    db: Session = Depends(get_db)
):

    document = QueueService.get_document(
        db,
        document_id
    )

    if not document:

        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    file_path = (
        PDFService.generate_summary_pdf(
            document
        )
    )

    return FileResponse(
        path=file_path,
        filename=f"{document_id}.pdf",
        media_type="application/pdf"
    )