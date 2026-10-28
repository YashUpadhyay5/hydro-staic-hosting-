import os
import re
import pandas as pd
from sqlalchemy.orm import Session
from config import Config
from models.queue_document import QueueDocument
from models.template import Template

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

def parse_numeric(val):
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    val_str = str(val).strip().replace(",", "").replace("₹", "").replace("$", "")
    match = re.search(r"[-+]?\d*\.?\d+", val_str)
    if match:
        try:
            return float(match.group(0))
        except:
            return 0.0
    return 0.0


class ExcelService:

    @staticmethod
    def generate_inventory_excel(
        db: Session,
        start_date: str = None,
        end_date: str = None,
        document_id: str = None,
        saved_only: bool = True
    ):
        # 1. Fetch active template
        tpl = db.query(Template).filter(Template.is_default == True).first()
        if not tpl:
            tpl = db.query(Template).first()
            
        if not tpl:
            from routes.templates import get_default_template_sections
            sections = get_default_template_sections()
        else:
            sections = tpl.sections

        # 2. Build column mapping from template sections
        columns_mapping = []
        items_section_id = "item_details"

        # Track whether item subtotal/tax columns are explicitly generated
        has_custom_item_cols = False

        for sec in sections:
            if not sec.get("enabled", True):
                continue
            sec_id = sec["id"]
            if sec_id in ["tax_summary", "tax_details"]:
                # Exclude default tax_summary section; Y to AG columns explicitly handle item & invoice taxes
                continue
            elif sec_id in ["item_details", "items"]:
                items_section_id = sec_id
                for field in sec.get("fields", []):
                    if not field.get("hidden", False):
                        f_key = field["key"]
                        # Exclude duplicate tax/total fields from item_details so Col Y starts cleanly
                        if f_key in ["total_amount", "taxable_amount", "tax_rate", "tax_amount", "cgst", "sgst", "igst", "discount_amount"]:
                            continue
                        col_label = f"Item - {field['label']}"
                        columns_mapping.append((sec_id, f_key, col_label, field.get("type", "Text")))
            else:
                for field in sec.get("fields", []):
                    if not field.get("hidden", False):
                        columns_mapping.append((sec_id, field["key"], f"{sec['name']} - {field['label']}", field.get("type", "Text")))

        # 3. Query queue documents containing ocr extraction data (filtering strictly to saved/verified records)
        query = db.query(QueueDocument).filter(
            QueueDocument.ocr_result.isnot(None)
        )

        if document_id:
            query = query.filter(QueueDocument.document_id == document_id)
        elif saved_only:
            query = query.filter(
                (QueueDocument.saved == True) | 
                (QueueDocument.status.in_(["Saved", "VALIDATED", "ARCHIVED", "saved", "validated", "archived"]))
            )

        if start_date:
            query = query.filter(QueueDocument.created_at >= f"{start_date.strip()} 00:00:00")
        if end_date:
            query = query.filter(QueueDocument.created_at <= f"{end_date.strip()} 23:59:59")

        docs = query.order_by(QueueDocument.created_at.desc()).all()

        rows = []
        total_qty = 0.0
        total_value = 0.0
        total_tax = 0.0
        total_records_count = 0
        unique_vendors = set()

        for doc in docs:
            ext = doc.final_extraction or (doc.ocr_result.get("extraction") if doc.ocr_result else {}) or {}
            ext = ext or {}

            # Vendor & Consumer GSTIN State Code Analysis (Intra-state vs Inter-state)
            vendor_details = ext.get("vendor_details", {}) or {}
            consumer_details = ext.get("consumer_details", {}) or {}
            invoice_details = ext.get("invoice_details", {}) or {}

            v_gst = str(vendor_details.get("gstin") or vendor_details.get("gst_number") or "").strip().upper()
            c_gst = str(consumer_details.get("gstin") or consumer_details.get("gst_number") or "").strip().upper()
            pos = str(invoice_details.get("place_of_supply") or "").strip().upper()

            v_state = v_gst[:2] if len(v_gst) >= 2 and v_gst[:2].isdigit() else ""
            c_state = c_gst[:2] if len(c_gst) >= 2 and c_gst[:2].isdigit() else (pos[:2] if len(pos) >= 2 and pos[:2].isdigit() else "")

            # Intra-state: Same State Code -> CGST & SGST apply (IGST = 0)
            # Inter-state: Different State Code -> IGST applies (CGST & SGST = 0)
            is_intra_state = (v_state != "" and c_state != "" and v_state == c_state) or (c_state != "" and pos != "" and c_state == pos)

            # Invoice-level tax summary
            tax_sum = ext.get("tax_summary", {}) or {}
            inv_subtotal = safe_float(tax_sum.get("subtotal") or tax_sum.get("taxable_amount"))
            inv_cgst = safe_float(tax_sum.get("cgst") or tax_sum.get("cgst_amount"))
            inv_sgst = safe_float(tax_sum.get("sgst") or tax_sum.get("sgst_amount"))
            inv_igst = safe_float(tax_sum.get("igst") or tax_sum.get("igst_amount"))
            inv_cess = safe_float(tax_sum.get("cess") or tax_sum.get("cess_amount"))
            inv_grand_total = safe_float(tax_sum.get("grand_total") or tax_sum.get("calculated_grand_total"))

            if inv_grand_total == 0.0 and inv_subtotal > 0:
                inv_grand_total = inv_subtotal + inv_cgst + inv_sgst + inv_igst + inv_cess

            # If invoice-level tax breakdown is 0 but total tax is present, auto-split based on intra/inter-state
            total_inv_tax = inv_cgst + inv_sgst + inv_igst
            if total_inv_tax > 0:
                if is_intra_state and inv_cgst == 0 and inv_sgst == 0 and inv_igst > 0:
                    half = round(inv_igst / 2.0, 2)
                    inv_cgst, inv_sgst, inv_igst = half, half, 0.0
                elif not is_intra_state and inv_igst == 0 and (inv_cgst > 0 or inv_sgst > 0):
                    inv_igst = inv_cgst + inv_sgst
                    inv_cgst, inv_sgst = 0.0, 0.0

            total_value += inv_grand_total
            total_tax += (inv_cgst + inv_sgst + inv_igst + inv_cess)

            # Track unique vendors
            v_name = vendor_details.get("name", "")
            if v_name:
                unique_vendors.add(v_name)

            # Extract line items
            items_list = ext.get(items_section_id, ext.get("items", [])) or []
            if not isinstance(items_list, list) or len(items_list) == 0:
                items_list = [{}]

            total_items_in_doc = len(items_list)

            for item_idx, item in enumerate(items_list):
                if not isinstance(item, dict):
                    item = {}
                is_last_item = (item_idx == total_items_in_doc - 1)

                # 1. Parse quantity & unit price
                raw_qty = item.get("quantity", "")
                raw_price = item.get("unit_price", "")
                qty_num = parse_numeric(raw_qty)
                price_num = parse_numeric(raw_price)
                extracted_item_subtotal = safe_float(item.get("taxable_amount"))

                # OCR trailing zero correction
                if qty_num > 0 and price_num > 0 and extracted_item_subtotal > 0:
                    computed_raw = qty_num * price_num
                    if abs(computed_raw - extracted_item_subtotal * 1000) < 1.0:
                        qty_num = round(qty_num / 1000.0, 3)

                # Calculate Item Subtotal (Col Y)
                if qty_num > 0 and price_num > 0:
                    item_subtotal = round(qty_num * price_num, 2)
                elif extracted_item_subtotal > 0:
                    item_subtotal = extracted_item_subtotal
                else:
                    item_subtotal = safe_float(item.get("total_amount"))

                # Calculate Item Taxes (Col Z, AA, AB)
                item_rate = safe_float(item.get("tax_rate") or item.get("gst_rate"))
                item_tax_amt = safe_float(item.get("tax_amount") or item.get("gst_amount"))
                if item_tax_amt == 0.0 and item_rate > 0 and item_subtotal > 0:
                    item_tax_amt = round(item_subtotal * (item_rate / 100.0), 2)

                explicit_cgst = safe_float(item.get("cgst") or item.get("cgst_amount"))
                explicit_sgst = safe_float(item.get("sgst") or item.get("sgst_amount"))
                explicit_igst = safe_float(item.get("igst") or item.get("igst_amount"))

                if explicit_cgst > 0 or explicit_sgst > 0 or explicit_igst > 0:
                    item_cgst = explicit_cgst
                    item_sgst = explicit_sgst
                    item_igst = explicit_igst
                elif is_intra_state:
                    half = round(item_tax_amt / 2.0, 2)
                    item_cgst = half
                    item_sgst = half
                    item_igst = 0.0
                else:
                    item_cgst = 0.0
                    item_sgst = 0.0
                    item_igst = item_tax_amt

                # Item Total Amount (Col AC)
                item_total_amount = round(item_subtotal + item_cgst + item_sgst + item_igst, 2)

                # 2. Construct Row dictionary
                row_dict = {}
                for sec_id, f_key, col_header, f_type in columns_mapping:
                    if sec_id in ["item_details", "items"]:
                        val = item.get(f_key, "")
                    elif sec_id in ["tax_summary", "tax_details"]:
                        if is_last_item:
                            if f_key == "subtotal" or f_key == "taxable_amount":
                                val = inv_subtotal
                            elif f_key == "cgst":
                                val = inv_cgst
                            elif f_key == "sgst":
                                val = inv_sgst
                            elif f_key == "igst":
                                val = inv_igst
                            elif f_key == "cess":
                                val = inv_cess
                            elif f_key == "grand_total":
                                val = inv_grand_total
                            else:
                                val = ""
                        else:
                            val = ""
                    elif sec_id == "bank_details":
                        sec_val = ext.get(sec_id, {}) or {}
                        if not isinstance(sec_val, dict):
                            sec_val = {}
                        if f_key in ["ifsc_code", "ifsc"]:
                            val = sec_val.get("ifsc_code") or sec_val.get("ifsc") or ""
                        elif f_key in ["account_number", "account_no", "acc_no"]:
                            val = sec_val.get("account_number") or sec_val.get("account_no") or sec_val.get("acc_no") or ""
                        elif f_key in ["bank_name", "bank"]:
                            val = sec_val.get("bank_name") or sec_val.get("bank") or ""
                        else:
                            val = sec_val.get(f_key, "")
                    else:
                        sec_val = ext.get(sec_id, {}) or {}
                        val = sec_val.get(f_key, "") if isinstance(sec_val, dict) else ""
                    
                    row_dict[col_header] = val

                # Explicitly add requested Columns Y to AG
                row_dict["Taxable Amount"] = item_subtotal
                row_dict["Item SGST"] = item_sgst
                row_dict["Item CGST"] = item_cgst
                row_dict["Item IGST"] = item_igst
                row_dict["Item Total Amount"] = item_total_amount

                # Invoice Totals (Columns AD to AG) - Only on the last item row of each invoice
                if is_last_item:
                    row_dict["Total SGST"] = inv_sgst
                    row_dict["Total CGST"] = inv_cgst
                    row_dict["Total IGST"] = inv_igst
                    row_dict["Total Price"] = inv_grand_total
                else:
                    row_dict["Total SGST"] = ""
                    row_dict["Total CGST"] = ""
                    row_dict["Total IGST"] = ""
                    row_dict["Total Price"] = ""

                rows.append(row_dict)
                total_qty += qty_num
                total_records_count += 1

        export_path = os.path.join(
            Config.EXPORT_DIR,
            "inventory_export.xlsx"
        )
        
        if not rows:
            headers = [col[2] for col in columns_mapping] if columns_mapping else ["No Data"]
            df = pd.DataFrame(columns=headers)
        else:
            df = pd.DataFrame(rows)

        with pd.ExcelWriter(
            export_path,
            engine="xlsxwriter"
        ) as writer:
            df.to_excel(
                writer,
                sheet_name="Inventory Records",
                index=False
            )

            # Auto-fit column widths
            workbook = writer.book
            worksheet = writer.sheets["Inventory Records"]
            for i, col in enumerate(df.columns):
                val_lens = [len(str(v)) for v in df[col].values if v is not None and v != ""]
                max_len = max(val_lens + [len(str(col))]) + 3 if val_lens else len(str(col)) + 3
                worksheet.set_column(i, i, min(max(max_len, 10), 50))

            summary_df = pd.DataFrame([
                {
                    "Metric": "Total Documents",
                    "Value": len(docs)
                },
                {
                    "Metric": "Total Line Items",
                    "Value": total_records_count
                },
                {
                    "Metric": "Total Vendors",
                    "Value": len(unique_vendors)
                },
                {
                    "Metric": "Total Quantity",
                    "Value": round(total_qty, 2)
                },
                {
                    "Metric": "Total Tax Amount",
                    "Value": round(total_tax, 2)
                },
                {
                    "Metric": "Total Inventory Value",
                    "Value": round(total_value, 2)
                }
            ])

            summary_df.to_excel(
                writer,
                sheet_name="Summary",
                index=False
            )

            summary_ws = writer.sheets["Summary"]
            summary_ws.set_column(0, 0, 30)
            summary_ws.set_column(1, 1, 20)

        return export_path