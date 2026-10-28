from fastapi import (
    APIRouter,
    Depends,
    HTTPException
)

from sqlalchemy.orm import Session

from database import get_db

from services.inventory_service import (
    InventoryService
)

from services.queue_service import (
    QueueService
)

router = APIRouter()


@router.post("/inventory/save")
def save_inventory(
    payload: dict,
    db: Session = Depends(get_db)
):

    document_id = payload.get(
        "document_id"
    )

    if not document_id:

        raise HTTPException(
            status_code=400,
            detail="document_id is required"
        )

    document = QueueService.get_document(
        db,
        document_id
    )

    if not document:

        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    extraction = payload.get(
        "extraction"
    )

    if not extraction:

        raise HTTPException(
            status_code=400,
            detail="Corrected extraction data is required"
        )

    # Filter out disabled sections from extraction based on active template layout
    if document and document.get("template_config"):
        for sec in document.get("template_config", []):
            if not sec.get("enabled", True):
                sec_id = sec["id"]
                if sec_id in extraction:
                    extraction[sec_id] = {} if sec_id != "items" else []

    # Enrich extraction dict with db integration fields to preserve them on reload and print
    extraction["msid"] = payload.get("msid")
    extraction["scheme_name"] = payload.get("scheme_name", "All Scheme")
    extraction["req_qty"] = payload.get("req_qty", "")
    extraction["location"] = payload.get("location", "")
    extraction["added_by"] = payload.get("added_by", "")
    extraction["additional_charges"] = payload.get("additional_charges", 0.0)

    project_data = {

        "msid":
            payload.get("msid"),

        "scheme_name":
            payload.get(
                "scheme_name",
                "All Scheme"
            ),

        "req_qty":
            payload.get(
                "req_qty",
                ""
            ),

        "location":
            payload.get(
                "location",
                ""
            ),

        "added_by":
            payload.get(
                "added_by",
                ""
            ),

        "verification_time":
            payload.get(
                "verification_time",
                0
            ),

        "additional_charges":
            payload.get(
                "additional_charges",
                0.0
            ),

        "document_id":
            document_id
    }

    result = InventoryService.save_inventory(
        db=db,
        project_data=project_data,
        extraction=extraction,
        ocr_result=document.get("ocr_result", {}) or {},
        file_path=document.get(
            "file_path",
            ""
        )
    )

    QueueService.update_document(
        db,
        document_id,
        {
            "status": "ARCHIVED",
            "saved": True,
            "final_extraction": extraction,
            "verification_time": payload.get("verification_time", 0)
        }
    )

    return result