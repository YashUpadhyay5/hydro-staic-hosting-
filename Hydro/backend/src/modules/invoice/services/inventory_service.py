import uuid

from sqlalchemy.orm import Session

from models.inventory import (
    ProjectInventoryDocs
)

from utils.mapper import (
    InventoryMapper
)


class InventoryService:

    @staticmethod
    def save_inventory(
        db: Session,
        project_data: dict,
        extraction: dict,
        ocr_result: dict = None,
        file_path: str = ""
    ):

        group_id = project_data.get("document_id") or str(uuid.uuid4())

        project_data["group_id"] = group_id

        # Delete existing records under this group_id or file_path to update the inventory at same place
        if file_path:
            db.query(ProjectInventoryDocs).filter(
                (ProjectInventoryDocs.group_id == group_id) |
                (ProjectInventoryDocs.file_paths == file_path)
            ).delete()
        else:
            db.query(ProjectInventoryDocs).filter(
                ProjectInventoryDocs.group_id == group_id
            ).delete()

        rows = InventoryMapper.map_invoice_to_rows(
            project_data=project_data,
            extraction=extraction,
            ocr_result=ocr_result or {},
            file_path=file_path
        )

        inserted_records = []

        for row in rows:

            record = ProjectInventoryDocs(**row)

            db.add(record)

            inserted_records.append(record)

        db.commit()

        return {
            "success": True,
            "group_id": group_id,
            "records_saved": len(
                inserted_records
            )
        }