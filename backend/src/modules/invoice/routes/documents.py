from fastapi import APIRouter, HTTPException, Depends, Response
from sqlalchemy.orm import Session

from database import get_db
from services.queue_service import QueueService

router = APIRouter()


@router.get("/debug_config")
def debug_config():
    from config import Config
    import os
    return {
        "Config.OCR_API_URL": Config.OCR_API_URL,
        "Config.RUNPOD_ENDPOINT_ID": getattr(Config, "RUNPOD_ENDPOINT_ID", None),
        "Config.RUNPOD_API_KEY": Config.RUNPOD_API_KEY,
        "cwd": os.getcwd(),
        "config_file_path": os.path.abspath(Config.__file__) if hasattr(Config, "__file__") else "Unknown",
        "env_path": os.path.abspath(os.path.join(os.path.dirname(Config.__file__), ".env")) if hasattr(Config, "__file__") else "Unknown"
    }


def _ensure_normalized_bank(ext, file_bytes=None):
    if not isinstance(ext, dict):
        return
    try:
        from services.ocr_service import OCRService
        root_ctx = {**ext}
        bank = ext.get("bank_details") or {}
        if file_bytes and (not bank.get("bank_name") or not bank.get("account_number") or not bank.get("ifsc_code")):
            try:
                import fitz
                doc = fitz.open(stream=file_bytes, filetype="pdf")
                pdf_text = "\n".join([page.get_text() for page in doc])
                doc.close()
                if pdf_text:
                    root_ctx["raw_pdf_text"] = pdf_text
            except Exception:
                pass
        ext["bank_details"] = OCRService._normalize_bank_dict(bank, root_ctx)
    except Exception as e:
        bank = ext.get("bank_details")
        if not isinstance(bank, dict):
            return
        ifsc_val = bank.get("ifsc_code") or bank.get("ifsc") or bank.get("ifscCode") or bank.get("bank_ifsc") or bank.get("ifs_code") or bank.get("rtgs_ifsc")
        if ifsc_val:
            cleaned = str(ifsc_val).strip().replace(" ", "").upper()
            if len(cleaned) == 11 and cleaned[:4].isalpha() and cleaned[4] in ('O', 'o', 'Q', 'q'):
                cleaned = cleaned[:4] + '0' + cleaned[5:]
            bank["ifsc_code"] = cleaned
            bank["ifsc"] = cleaned
        acc_val = bank.get("account_number") or bank.get("account_no") or bank.get("acc_no") or bank.get("account")
        if acc_val:
            bank["account_number"] = str(acc_val).strip()
            bank["account_no"] = str(acc_val).strip()
        bank_name = bank.get("bank_name") or bank.get("bank")
        if bank_name:
            bank["bank_name"] = str(bank_name).strip()


def normalize_document_response(document):
    if not document:
        return document
    try:
        from workers.queue_worker import auto_correct_tax_summary
        file_bytes = document.get("file_content")
        if document.get("ocr_result") and isinstance(document["ocr_result"], dict):
            document["ocr_result"] = auto_correct_tax_summary(document["ocr_result"])
            if isinstance(document["ocr_result"], dict):
                _ensure_normalized_bank(document["ocr_result"].get("extraction"), file_bytes)
        if document.get("final_extraction") and isinstance(document["final_extraction"], dict):
            temp_ocr = {"extraction": document["final_extraction"]}
            normalized_ocr = auto_correct_tax_summary(temp_ocr)
            if isinstance(normalized_ocr, dict):
                document["final_extraction"] = normalized_ocr.get("extraction")
            _ensure_normalized_bank(document["final_extraction"], file_bytes)
    except Exception as e:
        print(f"Failed to dynamically normalize document response: {e}")
    return document


@router.get("/documents")
def get_documents(db: Session = Depends(get_db)):
    return QueueService.get_all_documents(db)


@router.get("/documents/{document_id}")
def get_document(document_id: str, db: Session = Depends(get_db)):
    document = QueueService.get_document(
        db,
        document_id
    )

    if not document:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    return normalize_document_response(document)


@router.post("/documents/{document_id}/retry")
def retry_document(document_id: str, db: Session = Depends(get_db)):
    """Re-queue a Failed document for OCR processing."""
    import os
    from models.queue_document import QueueDocument
    from sqlalchemy.orm import undefer

    doc = db.query(QueueDocument).options(
        undefer(QueueDocument.file_content)
    ).filter(
        QueueDocument.document_id == document_id
    ).first()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.status not in ("FAILED", "PENDING_VALIDATION", "PROCESSING", "LocalPending"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry a document with status '{doc.status}'."
        )

    # Verify we have something to process (file_content in DB or physical file on disk)
    has_content = bool(doc.file_content)
    has_file = bool(doc.file_path and os.path.exists(doc.file_path))

    if not has_content and not has_file:
        raise HTTPException(
            status_code=422,
            detail="Cannot retry: original file is no longer available (neither in DB nor on disk)."
        )

    # Reset status to LocalPending so the queue worker picks it up immediately
    doc.status = "LocalPending"
    doc.error = None
    doc.ocr_result = None
    db.commit()

    return {
        "success": True,
        "document_id": document_id,
        "message": "Document re-queued for OCR processing."
    }



@router.post("/documents/{document_id}/time")
def update_document_time(document_id: str, payload: dict, db: Session = Depends(get_db)):
    from models.queue_document import QueueDocument

    doc = db.query(QueueDocument).filter(
        QueueDocument.document_id == document_id
    ).first()

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    verification_time = payload.get("verification_time", 0)
    doc.verification_time = verification_time
    db.commit()

    return {
        "success": True,
        "verification_time": verification_time
    }


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, db: Session = Depends(get_db)):
    import os
    from config import Config
    from models.queue_document import QueueDocument
    from models.inventory import ProjectInventoryDocs

    doc = db.query(QueueDocument).filter(
        QueueDocument.document_id == document_id
    ).first()

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    # Delete physical file from disk
    if doc.file_path and os.path.exists(doc.file_path):
        try:
            os.remove(doc.file_path)
        except Exception as e:
            print(f"Error removing file {doc.file_path}: {e}")

    # Delete corresponding inventory records
    db.query(ProjectInventoryDocs).filter(
        (ProjectInventoryDocs.group_id == document_id) |
        (ProjectInventoryDocs.file_paths == doc.file_path)
    ).delete()

    # Delete queue record
    db.delete(doc)
    db.commit()

    return {
        "success": True,
        "message": "Document and its inventory records deleted successfully"
    }


@router.delete("/documents")
def delete_all_documents(db: Session = Depends(get_db)):
    import os
    import shutil
    from config import Config
    from models.queue_document import QueueDocument
    from models.inventory import ProjectInventoryDocs

    # Clear tables
    db.query(QueueDocument).delete()
    db.query(ProjectInventoryDocs).delete()
    db.commit()

    # Clear uploaded files, OCR results, and exports
    for directory in [Config.UPLOAD_DIR, Config.OCR_DIR, Config.EXPORT_DIR]:
        if os.path.exists(directory):
            for filename in os.listdir(directory):
                file_path = os.path.join(directory, filename)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
                except Exception as e:
                    print(f"Failed to delete file {file_path}: {e}")

    return {
        "success": True,
        "message": "All documents, OCR cache, and inventory records cleared successfully"
    }


def generate_summary_svg(doc_data: dict) -> str:
    extraction = doc_data.get("final_extraction") or (doc_data.get("ocr_result", {}).get("extraction") if doc_data.get("ocr_result") else {}) or {}
    vendor = extraction.get("vendor_details", {}) or {}
    invoice = extraction.get("invoice_details", {}) or {}
    items = extraction.get("items", []) or []
    ts = extraction.get("tax_summary", {}) or {}
    
    vendor_name = vendor.get("name") or "Unknown Vendor"
    inv_num = invoice.get("invoice_number") or "N/A"
    inv_date = invoice.get("invoice_date") or "N/A"
    grand_total = ts.get("grand_total") or ts.get("calculated_grand_total") or 0.0
    
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="100%" height="100%">
      <rect width="100%" height="100%" fill="#f8fafc"/>
      <!-- Header -->
      <rect width="100%" height="90" fill="#4f46e5"/>
      <text x="30" y="55" font-family="system-ui, sans-serif" font-size="24" font-weight="bold" fill="#ffffff">INVOICE PREVIEW</text>
      <text x="570" y="55" font-family="system-ui, sans-serif" font-size="14" text-anchor="end" fill="#e0e7ff">Database Reconstructed</text>
      
      <!-- Invoice Meta -->
      <rect x="30" y="120" width="540" height="90" rx="6" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>
      <text x="50" y="150" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#64748b">VENDOR</text>
      <text x="50" y="172" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#1e293b">{vendor_name}</text>
      
      <text x="320" y="150" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#64748b">INVOICE NO.</text>
      <text x="320" y="172" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#1e293b">#{inv_num}</text>
      
      <text x="460" y="150" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#64748b">DATE</text>
      <text x="460" y="172" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#1e293b">{inv_date}</text>
      
      <!-- Items Header -->
      <text x="30" y="255" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#1e293b">Line Items</text>
      <line x1="30" y1="265" x2="570" y2="265" stroke="#cbd5e1" stroke-width="1.5"/>
    """
    
    # Render items
    y = 295
    for idx, item in enumerate(items[:8]): # limit to 8 items
        desc = item.get("description") or "N/A"
        qty = item.get("quantity") or 0.0
        rate = item.get("unit_price") or 0.0
        total = item.get("total_amount") or (qty * rate)
        
        try:
            qty_val = float(qty)
            rate_val = float(rate)
            total_val = float(total)
        except:
            qty_val = 0.0
            rate_val = 0.0
            total_val = 0.0
            
        svg += f"""
          <text x="30" y="{y}" font-family="system-ui, sans-serif" font-size="12" fill="#1e293b">{desc[:35]}</text>
          <text x="350" y="{y}" font-family="system-ui, sans-serif" font-size="12" fill="#64748b" text-anchor="end">{qty_val} x ₹{rate_val:.2f}</text>
          <text x="570" y="{y}" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="#1e293b" text-anchor="end">₹{total_val:.2f}</text>
        """
        y += 35
        
    if len(items) > 8:
        svg += f"""
          <text x="30" y="{y}" font-family="system-ui, sans-serif" font-size="11" font-style="italic" fill="#94a3b8">...and {len(items) - 8} more item(s)</text>
        """
        y += 35
        
    try:
        gt_val = float(grand_total)
    except:
        gt_val = 0.0
        
    # Totals
    svg += f"""
      <line x1="30" y1="{y-15}" x2="570" y2="{y-15}" stroke="#cbd5e1" stroke-width="1.5"/>
      <text x="30" y="{y+15}" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#1e293b">Total Amount</text>
      <text x="570" y="{y+15}" font-family="system-ui, sans-serif" font-size="18" font-weight="bold" fill="#4f46e5" text-anchor="end">₹{gt_val:,.2f}</text>
      
      <!-- Footer Note -->
      <rect x="30" y="720" width="540" height="50" rx="4" fill="#f1f5f9"/>
      <text x="300" y="748" font-family="system-ui, sans-serif" font-size="11" fill="#64748b" text-anchor="middle">Original image deleted. Reconstructed from database verification records.</text>
    </svg>
    """
    return svg


@router.get("/documents/{document_id}/file")
def get_document_file(document_id: str, download: bool = False, db: Session = Depends(get_db)):
    import os
    import mimetypes
    from models.queue_document import QueueDocument
    from sqlalchemy.orm import undefer

    doc = db.query(QueueDocument).options(
        undefer(QueueDocument.file_content)
    ).filter(
        QueueDocument.document_id == document_id
    ).first()

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    # Determine extension / pdf status
    filename_str = doc.file_path or doc.filename or ""
    is_pdf = filename_str.lower().endswith(".pdf")

    if not doc.file_content:
        # Fallback to physical file if it exists on disk
        if doc.file_path and os.path.exists(doc.file_path):
            try:
                with open(doc.file_path, "rb") as f:
                    content = f.read()
                mime_type, _ = mimetypes.guess_type(doc.file_path or doc.filename)
                if not mime_type:
                    mime_type = "application/pdf" if is_pdf else "image/jpeg"
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to read file from disk: {e}"
                )
        else:
            # Reconstruct document dict from doc object
            doc_dict = {
                "document_id": doc.document_id,
                "filename": doc.filename,
                "file_path": doc.file_path,
                "status": doc.status,
                "ocr_result": doc.ocr_result,
                "final_extraction": doc.final_extraction
            }
            
            if is_pdf:
                # Generate summary PDF
                from services.pdf_service import PDFService
                try:
                    pdf_path = PDFService.generate_summary_pdf(doc_dict)
                    with open(pdf_path, "rb") as f:
                        content = f.read()
                    mime_type = "application/pdf"
                    
                    # Clean up temporary PDF file after reading
                    if os.path.exists(pdf_path):
                        try:
                            os.remove(pdf_path)
                        except:
                            pass
                except Exception as e:
                    print(f"Error generating fallback PDF: {e}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to generate fallback document PDF: {e}"
                    )
            else:
                # Generate summary SVG
                content = generate_summary_svg(doc_dict).encode("utf-8")
                mime_type = "image/svg+xml"
    else:
        content = doc.file_content
        mime_type, _ = mimetypes.guess_type(doc.file_path or doc.filename)
        if not mime_type:
            mime_type = "application/pdf" if is_pdf else "image/jpeg"

    # Prepare clean download filename
    dl_filename = doc.filename or "invoice"
    if is_pdf and not dl_filename.lower().endswith(".pdf"):
        dl_filename += ".pdf"
    elif mime_type == "image/svg+xml" and not dl_filename.lower().endswith(".svg"):
        dl_filename += ".svg"
    elif not is_pdf and mime_type != "image/svg+xml" and not any(dl_filename.lower().endswith(ext) for ext in [".png", ".jpg", ".jpeg"]):
        dl_filename += ".jpg"

    disposition = "attachment" if download else "inline"
    headers = {
        "Content-Disposition": f'{disposition}; filename="{dl_filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition"
    }

    return Response(content=content, media_type=mime_type, headers=headers)