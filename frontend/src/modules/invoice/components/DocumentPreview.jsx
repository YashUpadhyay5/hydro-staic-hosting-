import { useState, useEffect } from "react";
import { downloadInvoiceFile } from "../utils/constants";

function DocumentPreview({ document, verificationTime = 0, timerActive = false, documents = [], onSelect }) {
  const [zoom, setZoom] = useState(1.0);
  const [imgError, setImgError] = useState(false);

  // Reset zoom and imgError on document change
  useEffect(() => {
    setZoom(1.0);
    setImgError(false);
  }, [document]);

  if (!document) {
    return (
      <div className="empty-state">
        <p>No document selected</p>
      </div>
    );
  }

  const filename = document.filename || "";
  const filePath = document.file_path || "";
  const isUploading = document.document_id === "temp-uploading";
  const isPdf = !isUploading && (filename.toLowerCase().endsWith(".pdf") || filePath.toLowerCase().endsWith(".pdf"));

  const token = localStorage.getItem("token") || localStorage.getItem("adminToken") || "";
  const docId = document.document_id || document.id || "";
  const apiBaseUrl = (import.meta.env && import.meta.env.VITE_API_URL)
    ? import.meta.env.VITE_API_URL.replace(/\/$/, '')
    : `http://${window.location.hostname}:8000/api`;
  const fileUrl = isUploading || !docId ? "" : `${apiBaseUrl}/documents/${docId}/file?token=${token}`;

  const zoomIn = () => setZoom((z) => Math.min(z + 0.1, 2.5));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.5));
  const zoomFit = () => setZoom(1.0);

  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!document || isUploading) return;
    setDownloading(true);
    try {
      await downloadInvoiceFile(document, filename);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="document-preview-block" style={{ width: "40%" }}>
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.3; }
          100% { opacity: 1; }
        }
      `}</style>
      <div className="preview-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
        <span className="preview-title" style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: "600", fontSize: "13px" }}>
          {(() => {
            const extraction = document.final_extraction || document.ocr_result?.extraction || document.extracted_data;
            const vendorName = extraction?.vendor_details?.name;
            const invoiceNumber = extraction?.invoice_details?.invoice_number;
            if (vendorName && invoiceNumber) {
              return `${vendorName} — #${invoiceNumber}`;
            } else if (vendorName) {
              return vendorName;
            } else if (invoiceNumber) {
              return `Invoice #${invoiceNumber}`;
            }
            return `Invoice Preview: ${filename}`;
          })()}
        </span>

        {/* Toolbar Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button className="btn btn-secondary" onClick={zoomOut} title="Zoom Out" style={{ padding: "4px 8px", fontSize: "12px", height: "28px" }}>
            🔍−
          </button>
          <button className="btn btn-secondary" onClick={zoomFit} title="Reset Zoom" style={{ padding: "4px 8px", fontSize: "11px", fontWeight: "700", height: "28px" }}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="btn btn-secondary" onClick={zoomIn} title="Zoom In" style={{ padding: "4px 8px", fontSize: "12px", height: "28px" }}>
            🔍+
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={handleDownload} 
            disabled={downloading || !fileUrl}
            title="Download Original File" 
            style={{ padding: "4px 10px", fontSize: "11px", fontWeight: "600", height: "28px", display: "flex", alignItems: "center", gap: "4px" }}
          >
            {downloading ? "⏳ Downloading..." : "📥 Download"}
          </button>
        </div>
      </div>

      <div className="document-viewer-container">
        {isUploading ? (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            gap: "16px",
            color: "var(--text-secondary)",
            background: "var(--bg-card-highlight)",
            borderRadius: "8px",
            padding: "32px 24px",
            textAlign: "center",
          }}>
            <div style={{
              border: "3px solid rgba(255,255,255,0.1)",
              borderTop: "3px solid var(--primary-glow)",
              borderRadius: "50%",
              width: "36px",
              height: "36px",
              animation: "spin 1s linear infinite"
            }} />
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
            <div>
              <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "14px", color: "var(--text-primary)" }}>
                Uploading Document...
              </p>
              <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.6 }}>
                Processing invoice OCR data. Please wait...
              </p>
            </div>
          </div>
        ) : isPdf ? (
          <iframe
            src={`${fileUrl}#view=FitH&zoom=${Math.round(zoom * 100)}`}
            title="PDF Document Viewer"
            className="pdf-preview"
          />
        ) : imgError ? (
          /* Friendly placeholder when the image cannot be loaded */
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            gap: "16px",
            color: "var(--text-secondary)",
            background: "var(--bg-card-highlight)",
            borderRadius: "8px",
            padding: "32px 24px",
            textAlign: "center",
          }}>
            <svg width="60" height="60" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.35 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <div>
              <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "14px", color: "var(--text-primary)" }}>
                Image preview not available
              </p>
              <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.6 }}>
                The original file is no longer stored on this server.
                <br />
                {document.status === "Failed"
                  ? "Re-upload the invoice to process it again."
                  : "OCR data below is still available."}
              </p>
            </div>
          </div>
        ) : (
          <div
            className="image-preview-wrapper"
            style={{ transform: `scale(${zoom})` }}
          >
            <img
              src={fileUrl}
              alt="Invoice Document Preview"
              className="image-preview"
              onError={() => setImgError(true)}
            />
          </div>
        )}
      </div>

      {(() => {
        const pendingDocs = documents.filter(d => d.status === "PENDING_VALIDATION");
        const currentIndex = pendingDocs.findIndex(d => d.document_id === document.document_id);
        const totalPending = pendingDocs.length;

        if (currentIndex === -1 || totalPending === 0) return null;

        return (
          <div className="preview-pagination-footer" style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            borderTop: "1px solid var(--border-color)",
            background: "var(--bg-panel)",
            boxSizing: "border-box"
          }}>
            <button
              className="btn btn-secondary"
              disabled={currentIndex === 0}
              onClick={() => onSelect(pendingDocs[currentIndex - 1])}
              style={{
                fontSize: "11px",
                fontWeight: "700",
                padding: "6px 12px",
                cursor: currentIndex === 0 ? "not-allowed" : "pointer"
              }}
            >
              ◀ PREVIOUS
            </button>
            <span style={{ fontWeight: "700", fontSize: "13px", color: "var(--text-primary)" }}>
              {currentIndex + 1} / {totalPending}
            </span>
            <button
              className="btn btn-secondary"
              disabled={currentIndex === totalPending - 1}
              onClick={() => onSelect(pendingDocs[currentIndex + 1])}
              style={{
                fontSize: "11px",
                fontWeight: "700",
                padding: "6px 12px",
                cursor: currentIndex === totalPending - 1 ? "not-allowed" : "pointer"
              }}
            >
              NEXT ▶
            </button>
          </div>
        );
      })()}
    </div>
  );
}

export default DocumentPreview;
