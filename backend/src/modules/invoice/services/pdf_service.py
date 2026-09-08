import os
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from config import Config


class PDFService:

    @staticmethod
    def generate_summary_pdf(
        document
    ):
        output_file = os.path.join(
            Config.SUMMARY_DIR,
            f"summary_{document['document_id']}.pdf"
        )

        # Setup page layout with 0.5-inch margins
        pdf = SimpleDocTemplate(
            output_file,
            pagesize=letter,
            rightMargin=36,
            leftMargin=36,
            topMargin=36,
            bottomMargin=36
        )

        styles = getSampleStyleSheet()
        
        # Define premium typography styles
        title_style = ParagraphStyle(
            'HeaderTitle',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=16,
            textColor=colors.HexColor("#7c3aed")
        )
        
        section_style = ParagraphStyle(
            'SectionTitle',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=12,
            textColor=colors.HexColor("#334155"),
            spaceAfter=6
        )

        meta_label_style = ParagraphStyle(
            'MetaLabel',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=9,
            textColor=colors.HexColor("#475569")
        )

        meta_val_style = ParagraphStyle(
            'MetaVal',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=9,
            textColor=colors.HexColor("#0f172a")
        )

        table_header_style = ParagraphStyle(
            'TableHeader',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=8,
            textColor=colors.HexColor("#7c3aed")
        )

        table_cell_style = ParagraphStyle(
            'TableCell',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=8,
            textColor=colors.HexColor("#1e293b")
        )

        elements = []

        # Retrieve the most up-to-date data (prefer final_extraction if saved)
        extraction = document.get("final_extraction") or document.get("ocr_result", {}).get("extraction", {})
        
        vendor = extraction.get("vendor_details", {}) or {}
        consignee = extraction.get("consignee_details", {}) or {}
        consumer = extraction.get("consumer_details", {}) or {}
        invoice = extraction.get("invoice_details", {}) or {}
        items = extraction.get("items", []) or extraction.get("item_details", []) or []
        tax_summary = extraction.get("tax_summary", {}) or {}

        # 1. Document Title Banner
        status = "SAVED & VERIFIED" if document.get("saved") else "DRAFT REPORT"
        status_color = "#10b981" if document.get("saved") else "#f59e0b"
        
        title_data = [
            [
                Paragraph("INVOICE SUMMARY SHEET", title_style),
                Paragraph(f"<font color='{status_color}'><b>STATUS: {status}</b></font>", ParagraphStyle('StatusStyle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=10, alignment=2))
            ]
        ]
        title_table = Table(title_data, colWidths=[300, 240])
        title_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ]))
        elements.append(title_table)

        # Simple divider line
        divider = Table([[""]], colWidths=[540], rowHeights=[2])
        divider.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#7c3aed")),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0),
        ]))
        elements.append(divider)
        elements.append(Spacer(1, 16))

        # 2. Metadata Columns (Vendor & Invoice details)
        vendor_info = [
            [Paragraph("VENDOR DETAILS", section_style)],
            [Paragraph("Name:", meta_label_style), Paragraph(vendor.get('name', 'N/A'), meta_val_style)],
            [Paragraph("GSTIN:", meta_label_style), Paragraph(vendor.get('gstin', 'N/A'), meta_val_style)],
            [Paragraph("PAN:", meta_label_style), Paragraph(vendor.get('pan', 'N/A'), meta_val_style)],
            [Paragraph("Address:", meta_label_style), Paragraph(vendor.get('address', 'N/A'), meta_val_style)]
        ]
        vendor_table = Table(vendor_info, colWidths=[60, 200])
        vendor_table.setStyle(TableStyle([
            ('SPAN', (0,0), (1,0)),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ]))

        invoice_info = [
            [Paragraph("INVOICE DETAILS", section_style)],
            [Paragraph("Invoice No:", meta_label_style), Paragraph(invoice.get('invoice_number', 'N/A'), meta_val_style)],
            [Paragraph("Date:", meta_label_style), Paragraph(invoice.get('invoice_date', 'N/A'), meta_val_style)],
            [Paragraph("Supply Place:", meta_label_style), Paragraph(invoice.get('place_of_supply', 'N/A'), meta_val_style)],
            [Paragraph("PO Number:", meta_label_style), Paragraph(invoice.get('po_number', 'N/A') or 'N/A', meta_val_style)]
        ]
        invoice_table = Table(invoice_info, colWidths=[80, 180])
        invoice_table.setStyle(TableStyle([
            ('SPAN', (0,0), (1,0)),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ]))

        meta_grid = Table([[vendor_table, invoice_table]], colWidths=[270, 270])
        meta_grid.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ]))
        elements.append(meta_grid)
        elements.append(Spacer(1, 14))

        # 3. Consignee / Consumer Details
        consignee_info = [
            [Paragraph("CONSIGNEE DETAILS (SHIPPED TO)", section_style)],
            [Paragraph("Name:", meta_label_style), Paragraph(consignee.get('name', 'N/A'), meta_val_style)],
            [Paragraph("GSTIN:", meta_label_style), Paragraph(consignee.get('gstin', 'N/A'), meta_val_style)],
            [Paragraph("Address:", meta_label_style), Paragraph(consignee.get('address', 'N/A'), meta_val_style)]
        ]
        consignee_table = Table(consignee_info, colWidths=[60, 200])
        consignee_table.setStyle(TableStyle([
            ('SPAN', (0,0), (1,0)),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ]))

        consumer_info = [
            [Paragraph("CONSUMER DETAILS (BILLED TO)", section_style)],
            [Paragraph("Name:", meta_label_style), Paragraph(consumer.get('name', 'N/A'), meta_val_style)],
            [Paragraph("GSTIN:", meta_label_style), Paragraph(consumer.get('gstin', 'N/A'), meta_val_style)],
            [Paragraph("Address:", meta_label_style), Paragraph(consumer.get('address', 'N/A'), meta_val_style)]
        ]
        consumer_table = Table(consumer_info, colWidths=[60, 200])
        consumer_table.setStyle(TableStyle([
            ('SPAN', (0,0), (1,0)),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ]))

        consignee_grid = Table([[consignee_table, consumer_table]], colWidths=[270, 270])
        consignee_grid.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ]))
        elements.append(consignee_grid)
        elements.append(Spacer(1, 12))

        # 3.5 Bank Details
        bank = extraction.get("bank_details", {}) or extraction.get("vendor_details", {}).get("bank_details", {}) or {}
        bank_name = bank.get("bank_name") or bank.get("bank") or "N/A"
        account_no = bank.get("account_number") or bank.get("account_no") or bank.get("acc_no") or "N/A"
        ifsc = bank.get("ifsc_code") or bank.get("ifsc") or "N/A"
        branch = bank.get("branch") or bank.get("branch_name") or "N/A"

        bank_info = [
            [Paragraph("SUPPLIER BANK DETAILS", section_style), Paragraph("", section_style)],
            [Paragraph("Bank Name:", meta_label_style), Paragraph(bank_name, meta_val_style)],
            [Paragraph("Account No:", meta_label_style), Paragraph(account_no, meta_val_style)],
            [Paragraph("IFSC Code:", meta_label_style), Paragraph(ifsc, meta_val_style)],
            [Paragraph("Branch:", meta_label_style), Paragraph(branch, meta_val_style)]
        ]
        bank_table = Table(bank_info, colWidths=[100, 440])
        bank_table.setStyle(TableStyle([
            ('SPAN', (0,0), (1,0)),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
            ('TOPPADDING', (0,0), (-1,-1), 3),
        ]))
        elements.append(bank_table)
        elements.append(Spacer(1, 14))

        # 4. Line Items Table
        elements.append(Paragraph("LINE ITEMS", section_style))
        
        # Table Headers
        items_headers = [
            Paragraph("S.N.", table_header_style),
            Paragraph("Goods Description", table_header_style),
            Paragraph("HSN", table_header_style),
            Paragraph("Qty", table_header_style),
            Paragraph("Unit", table_header_style),
            Paragraph("Rate", table_header_style),
            Paragraph("Taxable Amt", table_header_style),
            Paragraph("Tax Rate", table_header_style),
            Paragraph("Total Amt", table_header_style)
        ]
        items_data = [items_headers]

        # Table Rows
        for i, item in enumerate(items):
            desc = item.get("description_of_goods") or item.get("description") or "N/A"
            items_data.append([
                Paragraph(str(i + 1), table_cell_style),
                Paragraph(desc, table_cell_style),
                Paragraph(str(item.get("hsn_code", "") or "N/A"), table_cell_style),
                Paragraph(str(item.get("quantity", "") or "N/A"), table_cell_style),
                Paragraph(str(item.get("unit", "") or "N/A"), table_cell_style),
                Paragraph(str(item.get("unit_price", "") or "N/A"), table_cell_style),
                Paragraph(str(item.get("taxable_amount", "") or "N/A"), table_cell_style),
                Paragraph(str(item.get("tax_rate", "") or "N/A"), table_cell_style),
                Paragraph(str(item.get("total_amount", "") or "N/A"), table_cell_style),
            ])

        # Render items table with clean grid styling
        # Total printable width is 540 (Letter width 612 - 72 side margins)
        items_table = Table(items_data, colWidths=[25, 145, 45, 35, 35, 45, 65, 50, 95])
        items_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#f5f3ff")),
            ('ALIGN', (0,0), (-1,-1), 'LEFT'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('TOPPADDING', (0,0), (-1,-1), 6),
        ]))
        elements.append(items_table)
        elements.append(Spacer(1, 16))

        # 5. Summary / Totals block (right-aligned)
        taxable_val = tax_summary.get("taxable_amount") or extraction.get("subtotal") or "0.00"
        cgst_val = tax_summary.get("cgst") or "0.00"
        sgst_val = tax_summary.get("sgst") or "0.00"
        igst_val = tax_summary.get("igst") or "0.00"
        round_off = tax_summary.get("round_off") or "0.00"
        grand_total = tax_summary.get("grand_total") or "0.00"

        totals_data = [
            [Paragraph("Taxable Amount:", meta_label_style), Paragraph(f"INR {taxable_val}", meta_val_style)],
            [Paragraph("CGST:", meta_label_style), Paragraph(f"INR {cgst_val}", meta_val_style)],
            [Paragraph("SGST:", meta_label_style), Paragraph(f"INR {sgst_val}", meta_val_style)],
            [Paragraph("IGST:", meta_label_style), Paragraph(f"INR {igst_val}", meta_val_style)],
            [Paragraph("Round Off:", meta_label_style), Paragraph(f"INR {round_off}", meta_val_style)],
            [Paragraph("GRAND TOTAL:", ParagraphStyle('GtLabel', parent=meta_label_style, fontSize=11, textColor=colors.HexColor("#7c3aed"))),
             Paragraph(f"INR {grand_total}", ParagraphStyle('GtVal', parent=meta_val_style, fontSize=11, fontName='Helvetica-Bold', textColor=colors.HexColor("#7c3aed")))]
        ]
        
        totals_table = Table(totals_data, colWidths=[120, 100])
        totals_table.setStyle(TableStyle([
            ('ALIGN', (0,0), (-1,-1), 'RIGHT'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('LINEBELOW', (0,-1), (-1,-1), 1.5, colors.HexColor("#7c3aed")),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('TOPPADDING', (0,0), (-1,-1), 4),
        ]))

        # Align totals block to the right using a parent layout table
        summary_alignment_table = Table([[ "", totals_table ]], colWidths=[320, 220])
        summary_alignment_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ]))
        elements.append(summary_alignment_table)

        pdf.build(
            elements
        )

        return output_file