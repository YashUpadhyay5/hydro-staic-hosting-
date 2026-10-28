import { useState, useEffect, useRef } from "react";
import { downloadInvoiceFile } from "../utils/constants";
import { cropImageFromElement } from "../utils/ocrCropper";

function DocumentPreview({
  document,
  verificationTime = 0,
  timerActive = false,
  documents = [],
  onSelect,
  activeFieldInfo = null,
  onRegionSelected,
}) {
  const [zoom, setZoom] = useState(1.0);
  const [imgError, setImgError] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Selection Box Dragging State in Relative Percentage Units [0..1]
  const [isDragging, setIsDragging] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);

  const imgRef = useRef(null);
  const wrapperRef = useRef(null);

  // Reset zoom, page, error, and selection on document change
  useEffect(() => {
    setZoom(1.0);
    setImgError(false);
    setPageIndex(0);
    setTotalPages(1);
    setSelectionBox(null);
    setIsDragging(false);
  }, [document]);

  if (!document) {
    return (
      <div className="empty-state">
        <p>No document selected</p>
      </div>
    );
  }

  const filename = document.filename || "";
  const isUploading = document.document_id === "temp-uploading";

  const token = localStorage.getItem("token") || localStorage.getItem("adminToken") || "";
  const docId = document.document_id || document.id || "";
  const apiBaseUrl = (import.meta.env && import.meta.env.VITE_API_URL)
    ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/v1/invoice`
    : `/api/v1/invoice`;

  // Always use preview-image endpoint for pixel-accurate rendering across all documents (PDF & images)
  const previewUrl = isUploading || !docId ? "" : `${apiBaseUrl}/documents/${docId}/preview-image?page=${pageIndex}&token=${token}`;
  const fileUrl = isUploading || !docId ? "" : `${apiBaseUrl}/documents/${docId}/file?token=${token}`;

  const zoomIn = () => setZoom((z) => Math.min(z + 0.15, 3.0));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.15, 0.4));
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

  // -------------------------------------------------------------
  // Pixel-Perfect Relative Coordinate Event Handlers
  // Works uniformly on ALL invoices (PDFs rendered as images + raster images)
  // -------------------------------------------------------------
  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // only left click
    const img = imgRef.current;
    if (!img) return;

    const rect = img.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      return;
    }

    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setIsDragging(true);
    setSelectionStart({ relX, relY });
    setSelectionBox({
      startRelX: relX,
      startRelY: relY,
      curRelX: relX,
      curRelY: relY,
    });
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseMove = (e) => {
      const img = imgRef.current;
      if (!img || !selectionStart) return;

      const rect = img.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      setSelectionBox({
        startRelX: selectionStart.relX,
        startRelY: selectionStart.relY,
        curRelX: relX,
        curRelY: relY,
      });
    };

    const handleWindowMouseUp = (e) => {
      setIsDragging(false);
      const img = imgRef.current;
      if (!selectionStart || !img) return;

      const rect = img.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      const minX = Math.min(selectionStart.relX, relX);
      const maxX = Math.max(selectionStart.relX, relX);
      const minY = Math.min(selectionStart.relY, relY);
      const maxY = Math.max(selectionStart.relY, relY);

      const widthPct = (maxX - minX) * 100;
      const heightPct = (maxY - minY) * 100;

      // Process if selection is at least 0.2% of width and height
      if (widthPct > 0.2 && heightPct > 0.2 && onRegionSelected) {
        const boundsPct = {
          xPct: minX * 100,
          yPct: minY * 100,
          widthPct: widthPct,
          heightPct: heightPct,
        };

        const cropBase64 = cropImageFromElement(img, boundsPct);

        onRegionSelected({
          boundsPct,
          cropBase64,
          pageIndex,
          clientCoords: {
            x: e.clientX,
            y: e.clientY,
          },
        });
      }
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDragging, selectionStart, pageIndex, onRegionSelected]);

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
        <span className="preview-title" style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: "600", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45%" }}>
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
          {activeFieldInfo && (
            <span
              className="selection-hint-pill"
              title="Drag on the invoice below to select and verify info for this field"
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "100px",
                backgroundColor: "rgba(59, 130, 246, 0.12)",
                color: "#2563eb",
                border: "1px solid rgba(59, 130, 246, 0.25)",
                fontWeight: "600",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                maxWidth: "140px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              ✂️ {activeFieldInfo.label}
            </span>
          )}

          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "2px", marginRight: "2px" }}>
              <button
                className="btn btn-secondary"
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                disabled={pageIndex === 0}
                title="Previous Page"
                style={{ padding: "4px 6px", fontSize: "11px", height: "28px" }}
              >
                ◀
              </button>
              <span style={{ fontSize: "11px", fontWeight: "600", padding: "0 4px", whiteSpace: "nowrap" }}>
                {pageIndex + 1}/{totalPages}
              </span>
              <button
                className="btn btn-secondary"
                onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                disabled={pageIndex >= totalPages - 1}
                title="Next Page"
                style={{ padding: "4px 6px", fontSize: "11px", height: "28px" }}
              >
                ▶
              </button>
            </div>
          )}

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
            {downloading ? "⏳..." : "📥 Download"}
          </button>
        </div>
      </div>

      <div
        className="document-viewer-container"
        style={{ cursor: "crosshair", position: "relative", overflow: "auto", flex: 1 }}
      >
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
        ) : imgError ? (
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
                Document Preview Not Available
              </p>
              <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.6 }}>
                The original invoice file could not be rendered.
                <br />
                {document.status === "Failed"
                  ? "Re-upload the invoice to process it again."
                  : "Extraction data in the editor is still accessible."}
              </p>
            </div>
          </div>
        ) : (
          <div
            ref={wrapperRef}
            className="image-preview-wrapper"
            onMouseDown={handleMouseDown}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              position: "relative",
              display: "inline-block",
              userSelect: "none",
              cursor: "crosshair"
            }}
          >
            <img
              ref={imgRef}
              src={previewUrl}
              alt="Invoice Document Preview"
              className="image-preview"
              crossOrigin="anonymous"
              draggable={false}
              onError={() => setImgError(true)}
              style={{ userSelect: "none", display: "block", maxWidth: "100%", pointerEvents: "auto" }}
            />

            {/* Selection Drag Box Overlay in Exact Percentage Units */}
            {selectionBox && (
              <div
                className="selection-drag-box"
                style={{
                  position: "absolute",
                  left: `${Math.min(selectionBox.startRelX, selectionBox.curRelX) * 100}%`,
                  top: `${Math.min(selectionBox.startRelY, selectionBox.curRelY) * 100}%`,
                  width: `${Math.abs(selectionBox.curRelX - selectionBox.startRelX) * 100}%`,
                  height: `${Math.abs(selectionBox.curRelY - selectionBox.startRelY) * 100}%`,
                  border: "2px dashed #2563eb",
                  backgroundColor: "rgba(37, 99, 235, 0.25)",
                  pointerEvents: "none",
                  zIndex: 25,
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.9)",
                  borderRadius: "2px"
                }}
              />
            )}
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
