from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Date,
    TIMESTAMP,
    DECIMAL,
    JSON,
    text
)

from database import Base


class ProjectInventoryDocs(Base):

    __tablename__ = "project_inventory_docs_v2"

    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True
    )

    msid = Column(
        Integer,
        nullable=False
    )

    group_id = Column(
        String(100),
        nullable=True
    )

    scheme_name = Column(
        String(255),
        default="All Scheme"
    )

    doc_name = Column(
        String(255),
        nullable=False
    )

    specification = Column(
        Text,
        nullable=True
    )

    hsn_code = Column(
        String(50),
        nullable=True
    )

    req_qty = Column(
        String(100),
        nullable=True
    )

    uom = Column(
        String(50),
        nullable=True
    )

    make = Column(
        String(100),
        nullable=True
    )

    vendor_name = Column(
        String(255),
        nullable=True
    )

    vendor_pan = Column(
        String(50),
        nullable=True
    )

    paid_to = Column(
        String(255),
        default="Company"
    )

    tax_percent = Column(
        DECIMAL(5, 2),
        default=0.00
    )

    rate_per_unit = Column(
        DECIMAL(15, 4),
        default=0.0000
    )

    bill_date = Column(
        Date,
        nullable=True
    )

    bill_number = Column(
        String(100),
        nullable=True
    )

    kyc_type = Column(
        String(50),
        default="GST No."
    )

    reference_no = Column(
        String(100),
        nullable=True
    )

    qty = Column(
        String(100),
        nullable=True
    )

    location = Column(
        String(100),
        nullable=True
    )

    file_paths = Column(
        Text,
        nullable=True
    )

    last_tx_date = Column(
        Date,
        nullable=True
    )

    status = Column(
        String(50),
        default="In Stock"
    )

    forwarded_to_expenses = Column(
        Integer,
        default=0
    )

    added_by = Column(
        String(100),
        nullable=True
    )

    verification_time = Column(
        Integer,
        nullable=True,
        default=0
    )

    # Vendor Details
    vendor_gstin = Column(
        String(50),
        nullable=True
    )
    vendor_address = Column(
        Text,
        nullable=True
    )
    vendor_phone = Column(
        String(30),
        nullable=True
    )
    vendor_email = Column(
        String(255),
        nullable=True
    )
    vendor_state = Column(
        String(100),
        nullable=True
    )

    # Consumer Details
    consumer_name = Column(
        String(255),
        nullable=True
    )
    consumer_gstin = Column(
        String(50),
        nullable=True
    )
    consumer_address = Column(
        Text,
        nullable=True
    )
    consumer_state = Column(
        String(100),
        nullable=True
    )

    # Consignee Details
    consignee_name = Column(
        String(255),
        nullable=True
    )
    consignee_address = Column(
        Text,
        nullable=True
    )
    consignee_state = Column(
        String(100),
        nullable=True
    )

    # Invoice Details
    invoice_number = Column(
        String(100),
        nullable=True
    )
    invoice_date = Column(
        Date,
        nullable=True
    )
    place_of_supply = Column(
        String(100),
        nullable=True
    )

    # Transport Details
    transport_mode = Column(
        String(50),
        nullable=True
    )
    destination = Column(
        String(100),
        nullable=True
    )
    vehicle_number = Column(
        String(50),
        nullable=True
    )

    # Tax Summary
    subtotal = Column(
        DECIMAL(15, 2),
        default=0.00
    )
    cgst = Column(
        DECIMAL(15, 2),
        default=0.00
    )
    sgst = Column(
        DECIMAL(15, 2),
        default=0.00
    )
    igst = Column(
        DECIMAL(15, 2),
        default=0.00
    )
    cess = Column(
        DECIMAL(15, 2),
        default=0.00
    )
    round_off = Column(
        DECIMAL(15, 2),
        default=0.00
    )
    grand_total = Column(
        DECIMAL(15, 2),
        default=0.00
    )

    # Bank Details
    bank_name = Column(
        String(255),
        nullable=True
    )
    bank_branch = Column(
        String(255),
        nullable=True
    )
    account_number = Column(
        String(100),
        nullable=True
    )
    ifsc_code = Column(
        String(50),
        nullable=True
    )

    # Payment Terms
    payment_terms = Column(
        Text,
        nullable=True
    )

    # OCR Extracted Items & Notes
    items_json = Column(
        JSON,
        nullable=True
    )
    notes_json = Column(
        JSON,
        nullable=True
    )

    # Validation
    validation_passed = Column(
        Integer,
        default=1
    )
    validation_errors = Column(
        JSON,
        nullable=True
    )
    validation_warnings = Column(
        JSON,
        nullable=True
    )

    # AI Metadata
    confidence_score = Column(
        DECIMAL(5, 2),
        nullable=True
    )
    processing_time_ms = Column(
        DECIMAL(15, 2),
        nullable=True
    )
    inference_time_ms = Column(
        DECIMAL(15, 2),
        nullable=True
    )
    model_name = Column(
        String(100),
        nullable=True
    )
    lora_loaded = Column(
        Integer,
        nullable=True
    )

    image_width = Column(
        Integer,
        nullable=True
    )
    image_height = Column(
        Integer,
        nullable=True
    )
    tokens_generated = Column(
        Integer,
        nullable=True
    )

    additional_charges = Column(
        DECIMAL(15, 2),
        default=0.00
    )

    created_at = Column(
        TIMESTAMP,
        server_default=text(
            "CURRENT_TIMESTAMP"
        )
    )

    updated_at = Column(
        TIMESTAMP,
        server_default=text(
            "CURRENT_TIMESTAMP"
        ),
        server_onupdate=text(
            "CURRENT_TIMESTAMP"
        )
    )