from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import uuid
from typing import List, Dict, Any

from database import get_db
from models.template import Template

router = APIRouter(prefix="/templates", tags=["Templates"])

def get_default_template_sections() -> List[Dict[str, Any]]:
    return [
        {
            "id": "invoice_details",
            "name": "Invoice Details",
            "icon": "invoice",
            "description": "Basic invoice information",
            "enabled": True,
            "fields": [
                {
                    "key": "invoice_number",
                    "label": "Invoice Number",
                    "type": "Text",
                    "required": True,
                    "editable": True,
                    "read_only": False,
                    "hidden": False,
                    "searchable": True,
                    "filterable": True,
                    "sortable": True,
                    "exportable": True,
                    "api_visible": True,
                    "dashboard_visible": True,
                    "confidence_threshold": 70,
                    "default_value": "",
                    "validation_rule": "",
                    "placeholder": "INV-12345",
                    "tooltip": "The unique number identifying the invoice",
                    "display_order": 1,
                    "ai_prompt": "Extract the invoice number or bill number."
                },
                {
                    "key": "invoice_date",
                    "label": "Invoice Date",
                    "type": "Date",
                    "required": True,
                    "editable": True,
                    "read_only": False,
                    "hidden": False,
                    "searchable": True,
                    "filterable": True,
                    "sortable": True,
                    "exportable": True,
                    "api_visible": True,
                    "dashboard_visible": True,
                    "confidence_threshold": 70,
                    "default_value": "",
                    "validation_rule": "",
                    "placeholder": "YYYY-MM-DD",
                    "tooltip": "The date the invoice was issued",
                    "display_order": 2,
                    "ai_prompt": "Extract the invoice issue date."
                },
                {
                    "key": "po_number",
                    "label": "PO Number",
                    "type": "Text",
                    "required": False,
                    "editable": True,
                    "read_only": False,
                    "hidden": False,
                    "searchable": True,
                    "filterable": True,
                    "sortable": True,
                    "exportable": True,
                    "api_visible": True,
                    "dashboard_visible": True,
                    "confidence_threshold": 60,
                    "default_value": "",
                    "validation_rule": "",
                    "placeholder": "PO-99123",
                    "tooltip": "Purchase Order number",
                    "display_order": 3,
                    "ai_prompt": "Extract the purchase order (PO) number if present."
                },
                {
                    "key": "place_of_supply",
                    "label": "Place of Supply",
                    "type": "Text",
                    "required": False,
                    "editable": True,
                    "read_only": False,
                    "hidden": False,
                    "searchable": True,
                    "filterable": True,
                    "sortable": True,
                    "exportable": True,
                    "api_visible": True,
                    "dashboard_visible": True,
                    "confidence_threshold": 60,
                    "default_value": "",
                    "validation_rule": "",
                    "placeholder": "Delhi",
                    "tooltip": "State or region of supply",
                    "display_order": 4,
                    "ai_prompt": "Extract the place of supply state name."
                }
            ]
        },
        {
            "id": "vendor_details",
            "name": "Vendor Details",
            "icon": "vendor",
            "description": "Supplier information",
            "enabled": True,
            "fields": [
                {"key": "name", "label": "Vendor Name", "type": "Text", "required": True, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": "", "validation_rule": "", "placeholder": "Sukh Building Material", "tooltip": "Legal vendor name", "display_order": 1, "ai_prompt": "Extract the legal name of the vendor/supplier."},
                {"key": "gstin", "label": "GSTIN", "type": "GSTIN", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": "", "validation_rule": "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$", "placeholder": "03ADVPT8973B1ZZ", "tooltip": "Vendor GST Identification Number", "display_order": 2, "ai_prompt": "Extract the GSTIN of the supplier issuing the document."},
                {"key": "pan", "label": "PAN", "type": "PAN", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": "", "validation_rule": "^[A-Z]{5}[0-9]{4}[A-Z]{1}$", "placeholder": "ADVPT8973B", "tooltip": "Vendor Permanent Account Number", "display_order": 3, "ai_prompt": "Extract the PAN number of the vendor (often derived from GSTIN)."},
                {"key": "address", "label": "Address", "type": "Address", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 60, "default_value": "", "validation_rule": "", "placeholder": "Lohian Khas, Jalandhar", "tooltip": "Supplier registered address", "display_order": 4, "ai_prompt": "Extract the full address of the vendor."},
                {"key": "city", "label": "City", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 70, "default_value": "", "validation_rule": "", "placeholder": "Jalandhar", "tooltip": "City where vendor is located", "display_order": 5, "ai_prompt": "Extract the city of the vendor."},
                {"key": "state", "label": "State", "type": "Dropdown", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 75, "default_value": "", "validation_rule": "", "placeholder": "Punjab", "tooltip": "State of vendor", "display_order": 6, "ai_prompt": "Extract the state of the vendor."}
            ]
        },
        {
            "id": "consumer_details",
            "name": "Consumer Details",
            "icon": "consumer",
            "description": "Buyer / Customer information",
            "enabled": True,
            "fields": [
                {"key": "name", "label": "Consumer Name", "type": "Text", "required": True, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": "", "validation_rule": "", "placeholder": "HYDROMATERIALS PRIVATE LIMITED", "tooltip": "Buyer legal name", "display_order": 1, "ai_prompt": "Extract the legal name of the buyer/customer."},
                {"key": "gstin", "label": "GSTIN", "type": "GSTIN", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": "", "validation_rule": "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$", "placeholder": "03AAECH3185L1ZI", "tooltip": "Buyer GST Identification Number", "display_order": 2, "ai_prompt": "Extract the GSTIN of the consumer/buyer."},
                {"key": "address", "label": "Address", "type": "Address", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 60, "default_value": "", "validation_rule": "", "placeholder": "Kharasa No-26, Punjab", "tooltip": "Buyer billing/shipping address", "display_order": 3, "ai_prompt": "Extract the full address of the buyer."}
            ]
        },
        {
            "id": "transport_details",
            "name": "Transport Details",
            "icon": "transport",
            "description": "Shipment information",
            "enabled": True,
            "fields": [
                {"key": "mode_of_transport", "label": "Transport Mode", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": True, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 60, "default_value": "", "validation_rule": "", "placeholder": "Road", "tooltip": "Transport mode", "display_order": 1, "ai_prompt": "Extract transport mode (e.g. road/rail/air)."},
                {"key": "vehicle_number", "label": "Vehicle Number", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 70, "default_value": "", "validation_rule": "", "placeholder": "PB-08-AB-1234", "tooltip": "Shipment vehicle license number", "display_order": 2, "ai_prompt": "Extract transporter vehicle number."},
                {"key": "destination", "label": "Destination", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 65, "default_value": "", "validation_rule": "", "placeholder": "Jalandhar", "tooltip": "Delivery destination location", "display_order": 3, "ai_prompt": "Extract shipment destination location."}
            ]
        },
        {
            "id": "bank_details",
            "name": "Bank Details",
            "icon": "bank",
            "description": "Payment account details",
            "enabled": True,
            "fields": [
                {"key": "bank_name", "label": "Bank Name", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 70, "default_value": "", "validation_rule": "", "placeholder": "State Bank of India", "tooltip": "Name of the supplier's bank", "display_order": 1, "ai_prompt": "Extract the bank name from the banking section."},
                {"key": "account_number", "label": "Account Number", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": "", "validation_rule": "", "placeholder": "123456789012", "tooltip": "Supplier bank account number", "display_order": 2, "ai_prompt": "Extract the bank account number."},
                {"key": "ifsc_code", "label": "IFSC", "type": "IFSC", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": "", "validation_rule": "^[A-Z]{4}0[A-Z0-9]{6}$", "placeholder": "SBIN0001234", "tooltip": "Bank branch IFSC code", "display_order": 3, "ai_prompt": "Extract the IFSC code printed in the bank details section."}
            ]
        },
        {
            "id": "item_details",
            "name": "Item Details",
            "icon": "items",
            "description": "Products and line items",
            "enabled": True,
            "fields": [
                {"key": "description", "label": "Description", "type": "Text", "required": True, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 75, "default_value": "", "validation_rule": "", "placeholder": "Item description", "tooltip": "Item name or description", "display_order": 1, "ai_prompt": "Extract line item description or name."},
                {"key": "description_of_goods", "label": "Description of Goods", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 70, "default_value": "", "validation_rule": "", "placeholder": "Goods classification", "tooltip": "Classification / category of goods", "display_order": 2, "ai_prompt": "Extract description of goods or classification."},
                {"key": "hsn_code", "label": "HSN/SAC", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": True, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 70, "default_value": "", "validation_rule": "", "placeholder": "7318", "tooltip": "HSN or SAC code", "display_order": 3, "ai_prompt": "Extract HSN/SAC code of the line item."},
                {"key": "quantity", "label": "Quantity", "type": "Number", "required": True, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": 0.0, "validation_rule": "", "placeholder": "10", "tooltip": "Quantity purchased", "display_order": 4, "ai_prompt": "Extract quantity for this line item."},
                {"key": "unit", "label": "Unit", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": True, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 70, "default_value": "", "validation_rule": "", "placeholder": "Kgs / Pcs", "tooltip": "Unit of measurement", "display_order": 5, "ai_prompt": "Extract unit of measurement (UOM) for this line item."},
                {"key": "unit_price", "label": "Unit Price", "type": "Currency", "required": True, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": 0.0, "validation_rule": "", "placeholder": "85.00", "tooltip": "Price per unit", "display_order": 6, "ai_prompt": "Extract unit price for this line item."},
                {"key": "discount_amount", "label": "Discount", "type": "Text", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 70, "default_value": "0", "validation_rule": "", "placeholder": "0.00%", "tooltip": "Discount amount or percentage", "display_order": 7, "ai_prompt": "Extract discount amount or discount percentage."},
                {"key": "taxable_amount", "label": "Taxable Amount", "type": "Currency", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": 0.0, "validation_rule": "", "placeholder": "255.00", "tooltip": "Taxable value", "display_order": 8, "ai_prompt": "Extract taxable amount."},
                {"key": "tax_rate", "label": "Tax Rate", "type": "Percentage", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": True, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 75, "default_value": "18%", "validation_rule": "", "placeholder": "18%", "tooltip": "GST tax rate percentage", "display_order": 9, "ai_prompt": "Extract tax rate percentage."},
                {"key": "tax_amount", "label": "Tax Amount", "type": "Currency", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": 0.0, "validation_rule": "", "placeholder": "45.90", "tooltip": "Total tax amount for item", "display_order": 10, "ai_prompt": "Extract tax amount for line item."},
                {"key": "total_amount", "label": "Total Amount", "type": "Currency", "required": True, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 85, "default_value": 0.0, "validation_rule": "", "placeholder": "952.86", "tooltip": "Total item amount", "display_order": 11, "ai_prompt": "Extract total amount for this line item."}
            ]
        },
        {
            "id": "tax_summary",
            "name": "Tax Details",
            "icon": "tax",
            "description": "GST, CGST, SGST, IGST",
            "enabled": True,
            "fields": [
                {"key": "subtotal", "label": "Subtotal", "type": "Currency", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": 0.0, "validation_rule": "", "placeholder": "10000.00", "tooltip": "Subtotal before tax", "display_order": 1, "ai_prompt": "Extract total taxable amount or subtotal."},
                {"key": "cgst", "label": "CGST", "type": "Currency", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": 0.0, "validation_rule": "", "placeholder": "900.00", "tooltip": "Central GST amount", "display_order": 2, "ai_prompt": "Extract CGST total amount."},
                {"key": "sgst", "label": "SGST", "type": "Currency", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": 0.0, "validation_rule": "", "placeholder": "900.00", "tooltip": "State GST amount", "display_order": 3, "ai_prompt": "Extract SGST total amount."},
                {"key": "igst", "label": "IGST", "type": "Currency", "required": False, "editable": True, "read_only": False, "hidden": False, "searchable": False, "filterable": False, "sortable": False, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 80, "default_value": 0.0, "validation_rule": "", "placeholder": "0.00", "tooltip": "Integrated GST amount", "display_order": 4, "ai_prompt": "Extract IGST total amount."},
                {"key": "grand_total", "label": "Grand Total", "type": "Currency", "required": True, "editable": True, "read_only": False, "hidden": False, "searchable": True, "filterable": False, "sortable": True, "exportable": True, "api_visible": True, "dashboard_visible": True, "confidence_threshold": 90, "default_value": 0.0, "validation_rule": "", "placeholder": "11800.00", "tooltip": "Invoice Grand Total", "display_order": 5, "ai_prompt": "Extract grand total amount of invoice."}
            ]
        }
    ]

def seed_default_template_if_needed(db: Session):
    default_tpl = db.query(Template).filter(Template.is_default == True).first()
    if not default_tpl:
        # Create default template
        default_tpl = Template(
            id="default-template-id",
            name="Standard Invoice Template",
            description="Default schema configuration for building materials and general invoices.",
            is_default=True,
            sections=get_default_template_sections()
        )
        try:
            db.add(default_tpl)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error seeding default template: {e}")

@router.get("")
def get_templates(db: Session = Depends(get_db)):
    seed_default_template_if_needed(db)
    return db.query(Template).order_by(Template.created_at.desc()).all()

@router.get("/{template_id}")
def get_template(template_id: str, db: Session = Depends(get_db)):
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template

@router.post("")
def create_or_update_template(payload: Dict[str, Any], db: Session = Depends(get_db)):
    template_id = payload.get("id")
    name = payload.get("name")
    description = payload.get("description", "")
    sections = payload.get("sections", [])
    is_default = payload.get("is_default", False)

    if not name:
        raise HTTPException(status_code=400, detail="Template Name is required")

    # If setting default, unset other defaults
    if is_default:
        db.query(Template).update({Template.is_default: False})

    if template_id:
        template = db.query(Template).filter(Template.id == template_id).first()
        if not template:
            raise HTTPException(status_code=404, detail="Template to update not found")
        template.name = name
        template.description = description
        template.sections = sections
        template.is_default = is_default
    else:
        template = Template(
            id=str(uuid.uuid4()),
            name=name,
            description=description,
            sections=sections,
            is_default=is_default
        )
        db.add(template)

    db.commit()
    db.refresh(template)
    return template

@router.post("/{template_id}/clone")
def clone_template(template_id: str, db: Session = Depends(get_db)):
    source = db.query(Template).filter(Template.id == template_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source template not found")

    cloned_name = f"Copy of {source.name}"
    # Verify uniqueness of clone name
    existing_count = db.query(Template).filter(Template.name.like(f"{cloned_name}%")).count()
    if existing_count > 0:
        cloned_name = f"{cloned_name} ({existing_count + 1})"

    new_tpl = Template(
        id=str(uuid.uuid4()),
        name=cloned_name,
        description=source.description,
        is_default=False,
        sections=source.sections
    )
    db.add(new_tpl)
    db.commit()
    db.refresh(new_tpl)
    return new_tpl

@router.post("/{template_id}/default")
def set_default_template(template_id: str, db: Session = Depends(get_db)):
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    db.query(Template).update({Template.is_default: False})
    template.is_default = True
    db.commit()
    return {"success": True, "message": f"Template '{template.name}' set as default."}

@router.delete("/{template_id}")
def delete_template(template_id: str, db: Session = Depends(get_db)):
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    if template.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete the default template. Set another template as default first.")

    db.delete(template)
    db.commit()
    return {"success": True, "message": "Template deleted successfully."}
