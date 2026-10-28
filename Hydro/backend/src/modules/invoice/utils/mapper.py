from datetime import datetime

def safe_str(val, default=""):
    if val is None:
        return default
    if isinstance(val, (list, tuple, set)):
        items = [str(x).strip() for x in val if x is not None and str(x).strip() and str(x).strip().lower() not in ("none", "null", "undefined")]
        return ", ".join(items) if items else default
    if isinstance(val, dict):
        items = [f"{k}: {v}" for k, v in val.items() if v is not None and str(v).strip().lower() not in ("none", "null", "undefined")]
        return ", ".join(items) if items else default
    s = str(val).strip()
    if s.lower() in ("null", "none", "undefined", "nan"):
        return default
    return s

def safe_float(val, default=0.0):
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    val_str = str(val).strip().lower()
    if val_str in ("", "null", "none", "nan", "undefined", "n/a", "-"):
        return default
    clean_str = val_str.replace(",", "").replace(" ", "").replace("₹", "").replace("$", "")
    try:
        return float(clean_str)
    except (ValueError, TypeError):
        return default

def safe_int(val, default=0):
    try:
        return int(safe_float(val, default))
    except (ValueError, TypeError):
        return default


class InventoryMapper:

    @staticmethod
    def extract_pan_from_gstin(gstin):
        if not gstin:
            return ""
        gstin = safe_str(gstin)
        if len(gstin) >= 12:
            return gstin[2:12]
        return ""

    @staticmethod
    def parse_date(date_string):
        if not date_string:
            return None
        date_str = safe_str(date_string)
        if not date_str:
            return None
        formats = [
            "%d/%m/%Y",
            "%d-%m-%Y",
            "%Y-%m-%d"
        ]
        for fmt in formats:
            try:
                return datetime.strptime(
                    date_str,
                    fmt
                ).date()
            except Exception:
                continue
        return None

    @staticmethod
    def get_tax_percent(item):
        igst_rate = safe_float(item.get("igst_rate", 0))
        cgst_rate = safe_float(item.get("cgst_rate", 0))
        sgst_rate = safe_float(item.get("sgst_rate", 0))
        return max(igst_rate, cgst_rate + sgst_rate)

    @staticmethod
    def get_taxable_amount(item):
        taxable_amount = item.get("taxable_amount")
        if taxable_amount not in [None, "", "null", "None"]:
            return safe_float(taxable_amount)
        qty = safe_float(item.get("quantity", 0))
        rate = safe_float(item.get("unit_price", 0))
        return qty * rate

    @staticmethod
    def get_tax_amount(item):
        igst_amount = safe_float(item.get("igst_amount", 0))
        cgst_amount = safe_float(item.get("cgst_amount", 0))
        sgst_amount = safe_float(item.get("sgst_amount", 0))
        total_tax = igst_amount + cgst_amount + sgst_amount
        if total_tax > 0:
            return total_tax
        taxable = InventoryMapper.get_taxable_amount(item)
        tax_percent = InventoryMapper.get_tax_percent(item)
        return (taxable * tax_percent) / 100

    @staticmethod
    def get_grand_total(item):
        total_amount = item.get("total_amount")
        if total_amount not in [None, "", "null", "None"]:
            return safe_float(total_amount)
        taxable = InventoryMapper.get_taxable_amount(item)
        tax_amount = InventoryMapper.get_tax_amount(item)
        return taxable + tax_amount

    @staticmethod
    def map_invoice_to_rows(
        project_data: dict,
        extraction: dict,
        ocr_result: dict = None,
        file_path: str = ""
    ):
        rows = []

        vendor = extraction.get("vendor_details", {}) or {}
        invoice = extraction.get("invoice_details", {}) or {}
        consumer = extraction.get("consumer_details", {}) or {}
        consignee = extraction.get("consignee_details", {}) or {}
        transport = extraction.get("transport_details", {}) or {}
        tax_summary = extraction.get("tax_summary", {}) or {}

        vendor_name = safe_str(vendor.get("name", ""))
        vendor_pan = safe_str(vendor.get("pan", ""))
        if not vendor_pan:
            vendor_pan = safe_str(InventoryMapper.extract_pan_from_gstin(vendor.get("gstin")))

        bill_number = safe_str(invoice.get("invoice_number", ""))
        bill_date = InventoryMapper.parse_date(invoice.get("invoice_date"))
        reference_no = safe_str(invoice.get("po_number", ""))
        payment_terms = safe_str(invoice.get("payment_terms", ""))

        # New metadata extraction
        ocr_res = ocr_result or {}
        ocr_metadata = ocr_res.get("metadata", {}) or {}

        bank = extraction.get("bank_details", {}) or {}
        bank_name = safe_str(bank.get("bank_name", bank.get("name", "")))
        bank_branch = safe_str(bank.get("bank_branch", bank.get("branch", "")))
        account_number = safe_str(bank.get("account_number", bank.get("account_no", "")))
        ifsc_code = safe_str(bank.get("ifsc_code", bank.get("ifsc", "")))

        notes = extraction.get("notes", []) or ocr_res.get("notes", []) or []

        # Validation checks
        validation_errors = []
        if not bill_number:
            validation_errors.append("Missing Invoice Number")
        if not bill_date:
            validation_errors.append("Missing Invoice Date")
        if not vendor_name:
            validation_errors.append("Missing Vendor Name")
        if not safe_str(consumer.get("name")):
            validation_errors.append("Missing Consumer Name")
        
        items = extraction.get("items", []) or []
        if not items:
            validation_errors.append("No line items")
            # Create a single summary line item if no individual items present
            items = [{
                "description": "Invoice Summary",
                "quantity": 1,
                "unit_price": safe_float(tax_summary.get("subtotal") or tax_summary.get("taxable_amount") or tax_summary.get("grand_total")),
                "total_amount": safe_float(tax_summary.get("grand_total"))
            }]

        validation_passed = 1 if len(validation_errors) == 0 else 0

        for item in items:
            tax_percent = InventoryMapper.get_tax_percent(item)
            rate_per_unit = safe_float(item.get("unit_price", 0.0))
            qty = safe_str(item.get("quantity", ""))

            rows.append({
                "msid": safe_int(project_data.get("msid", 0)),
                "group_id": safe_str(project_data.get("group_id", "")),
                "scheme_name": safe_str(project_data.get("scheme_name", "All Scheme")),
                "doc_name": safe_str(item.get("description_of_goods", "") or item.get("description", "") or "Item"),
                "specification": safe_str(item.get("description", "")),
                "hsn_code": safe_str(item.get("hsn_code", "")),
                "req_qty": safe_str(project_data.get("req_qty", "")),
                "uom": safe_str(item.get("unit", "")),
                "make": safe_str(item.get("make", "")),
                "vendor_name": vendor_name,
                "vendor_pan": vendor_pan,
                "paid_to": "Company",
                "tax_percent": safe_float(tax_percent),
                "rate_per_unit": rate_per_unit,
                "bill_date": bill_date,
                "bill_number": bill_number,
                "kyc_type": "GST No.",
                "reference_no": reference_no,
                "qty": qty,
                "location": safe_str(project_data.get("location", "")),
                "file_paths": safe_str(file_path),
                "last_tx_date": datetime.utcnow().date(),
                "status": "In Stock",
                "forwarded_to_expenses": 0,
                "added_by": safe_str(project_data.get("added_by", "")),
                "verification_time": safe_int(project_data.get("verification_time", 0)),
                
                # Vendor Details
                "vendor_gstin": safe_str(vendor.get("gstin", "")),
                "vendor_address": safe_str(vendor.get("address", "")),
                "vendor_phone": safe_str(vendor.get("phone", "")),
                "vendor_email": safe_str(vendor.get("email", "")),
                "vendor_state": safe_str(vendor.get("state", "")),

                # Consumer Details
                "consumer_name": safe_str(consumer.get("name", "")),
                "consumer_gstin": safe_str(consumer.get("gstin", "")),
                "consumer_address": safe_str(consumer.get("address", "")),
                "consumer_state": safe_str(consumer.get("state", "")),
                
                # Consignee Details
                "consignee_name": safe_str(consignee.get("name", "")),
                "consignee_address": safe_str(consignee.get("address", "")),
                "consignee_state": safe_str(consignee.get("state", "")),
                
                # Invoice Details
                "invoice_number": bill_number,
                "invoice_date": bill_date,
                "place_of_supply": safe_str(invoice.get("place_of_supply", "")),

                # Transport Details
                "transport_mode": safe_str(transport.get("mode_of_transport", "")),
                "destination": safe_str(transport.get("destination", "")),
                "vehicle_number": safe_str(transport.get("vehicle_number", "")),
                
                # Tax Summary
                "subtotal": safe_float(tax_summary.get("taxable_amount") or tax_summary.get("subtotal")),
                "cgst": safe_float(tax_summary.get("cgst") or tax_summary.get("cgst_amount")),
                "sgst": safe_float(tax_summary.get("sgst") or tax_summary.get("sgst_amount")),
                "igst": safe_float(tax_summary.get("igst") or tax_summary.get("igst_amount")),
                "cess": safe_float(tax_summary.get("cess") or tax_summary.get("cess_amount")),
                "round_off": safe_float(tax_summary.get("round_off") or tax_summary.get("round_off_amount")),
                "grand_total": safe_float(tax_summary.get("grand_total") or tax_summary.get("calculated_grand_total")),

                # Bank Details
                "bank_name": bank_name,
                "bank_branch": bank_branch,
                "account_number": account_number,
                "ifsc_code": ifsc_code,

                # Payment Terms
                "payment_terms": payment_terms,

                # Items & Notes arrays
                "items_json": items,
                "notes_json": notes,

                # Validation reports
                "validation_passed": validation_passed,
                "validation_errors": validation_errors,
                "validation_warnings": ocr_res.get("validation_warnings", []),

                # AI Inference Metadata
                "confidence_score": safe_float(ocr_res.get("confidence") or ocr_res.get("confidence_score")),
                "processing_time_ms": safe_float(ocr_metadata.get("processing_time_ms")),
                "inference_time_ms": safe_float(ocr_metadata.get("inference_time_ms")),
                "model_name": safe_str(ocr_metadata.get("model_name", "")),
                "lora_loaded": 1 if ocr_metadata.get("lora_loaded") else 0,

                "image_width": safe_int(ocr_metadata.get("image_width")),
                "image_height": safe_int(ocr_metadata.get("image_height")),
                "tokens_generated": safe_int(ocr_metadata.get("tokens_generated")),
                "additional_charges": safe_float(project_data.get("additional_charges"))
            })

        return rows