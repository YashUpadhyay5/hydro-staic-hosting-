import { downloadInvoiceFile } from "../utils/constants";

function ActionButtons({
  onSave,
  onDownloadExcel,
  onPrint,
  onRetry,
  onDelete,
  selectedDocument,
  isSaving,
  isRetrying,
  isProcessed,
  isFailed,
  isSaved = false,
  verificationTime = 0,
  timerActive = false,
}) {
  return (
    <div className="action-bar-wrapper" style={{ justifyContent: "flex-end" }}>

      {/* Retry button — only visible for Failed documents */}
      {isFailed && (
        <button
          className="btn btn-secondary"
          onClick={onRetry}
          disabled={isRetrying}
          title="Re-queue this document for OCR processing"
          style={{
            color: "#b91c1c",
            borderColor: "rgba(185,28,28,0.35)",
            background: "rgba(185,28,28,0.07)",
          }}
        >
          {isRetrying ? (
            <>
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }}></circle>
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Retrying…
            </>
          ) : (
            <>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 .49-3.5"></path>
              </svg>
              Retry OCR
            </>
          )}
        </button>
      )}

      <button
        className="btn btn-secondary"
        onClick={onPrint}
        disabled={!selectedDocument}
        title="Print/Download Invoice PDF Summary"
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <polyline points="6 9 6 2 18 2 18 9"></polyline>
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
          <rect x="6" y="14" width="12" height="8"></rect>
        </svg>
        Print Summary
      </button>

      {selectedDocument && (
        <button
          className="btn btn-secondary"
          onClick={() => downloadInvoiceFile(selectedDocument)}
          title="Download original invoice document directly to your device"
          style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download Invoice
        </button>
      )}

      <button
        className="btn btn-secondary"
        onClick={onDownloadExcel}
        title="Download Excel Report"
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Download Excel
      </button>

      {/* Delete Invoice Button */}
      {selectedDocument && (
        <button
          className="btn btn-secondary"
          onClick={() => onDelete(selectedDocument.document_id)}
          title="Delete Invoice and all its data"
          style={{
            color: "#b91c1c",
            borderColor: "rgba(185,28,28,0.35)",
            background: "rgba(185,28,28,0.07)",
          }}
        >
          Delete Invoice
        </button>
      )}

      <button
        className="btn btn-primary"
        onClick={onSave}
        disabled={isSaving || !isProcessed}
        title={isSaved ? "Update verified data in the database" : "Save extracted data to the database"}
      >
        {isSaving ? (
          <>
            <svg className="animate-spin" width="14" height="14" fill="none" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }}></circle>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Saving...
          </>
        ) : (
          <>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            {isSaved ? "Update Database" : "Save To Database"}
          </>
        )}
      </button>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0% { transform: scale(0.9); opacity: 0.6; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

export default ActionButtons;
