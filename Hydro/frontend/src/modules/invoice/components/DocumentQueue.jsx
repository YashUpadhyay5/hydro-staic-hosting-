import { useState } from "react";

function DocumentQueue({ documents = [], selectedDocument, onSelect, verificationTime = 0, timerActive = false }) {
  const [searchQuery, setSearchQuery] = useState("");

  const getBadgeStyle = (status = "") => {
    switch (status.toUpperCase()) {
      case "PROCESSING":
        return { backgroundColor: "#dbeafe", color: "#1d4ed8" };
      case "PENDING_VALIDATION":
        return { backgroundColor: "#ffedd5", color: "#c2410c" };
      case "VALIDATED":
        return { backgroundColor: "#d1fae5", color: "#065f46" };
      case "FAILED":
        return { backgroundColor: "#fee2e2", color: "#991b1b" };
      case "ARCHIVED":
        return { backgroundColor: "#e2e8f0", color: "#475569" };
      default:
        return { backgroundColor: "#ffedd5", color: "#c2410c" };
    }
  };

  const formatTime = (isoString) => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return isoString;
    }
  };

  // Filter documents by filename
  const filteredDocuments = documents.filter((doc) =>
    (doc.filename || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="queue-panel" style={{ alignItems: "stretch" }}>
      <div className="queue-header-section" style={{ display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0, width: "160px", justifyContent: "center" }}>
        <h3 style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-secondary)", margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Documents Queue
        </h3>
        
        {/* Search Input Field */}
        <div className="search-wrapper" style={{ position: "relative" }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search invoice..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ 
              width: "100%", 
              padding: "4px 8px 4px 24px", 
              fontSize: "11px", 
              borderRadius: "4px",
              background: "var(--bg-app)",
              border: "1px solid var(--border-color)",
              color: "var(--text-primary)",
              height: "26px",
              boxSizing: "border-box"
            }}
          />
          <svg 
            width="10" 
            height="10" 
            fill="none" 
            stroke="var(--text-secondary)" 
            strokeWidth="2.5" 
            viewBox="0 0 24 24" 
            style={{ position: "absolute", left: "8px", top: "8px" }}
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery("")}
              title="Clear Search"
              style={{
                position: "absolute",
                right: "6px",
                top: "5px",
                border: "none",
                background: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "12px",
                padding: "0"
              }}
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {filteredDocuments.length === 0 ? (
        <div style={{ color: "var(--text-secondary)", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 20px", flex: 1 }}>
          {documents.length === 0 ? "No documents uploaded yet." : "No invoices match your search."}
        </div>
      ) : (
        <div className="queue-list">
          {filteredDocuments.map((doc) => {
            const isActive = selectedDocument && selectedDocument.document_id === doc.document_id;
            const displayTime = (isActive && timerActive) ? verificationTime : (doc.verification_time || 0);
            return (
              <div
                key={doc.document_id}
                className={`queue-item ${isActive ? "active" : ""}`}
                onClick={() => onSelect(doc)}
              >
                <div className="queue-item-name" title={doc.filename}>
                  {doc.filename}
                </div>
                <div className="queue-item-footer" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="queue-item-time" style={{ marginRight: "auto" }}>{formatTime(doc.created_at)}</span>
                  {displayTime > 0 && (
                    <span className="queue-item-timer" style={{ fontSize: "11px", color: isActive ? "#d97706" : "var(--text-secondary)", background: isActive ? "rgba(245, 158, 11, 0.1)" : "var(--bg-card-highlight)", border: isActive ? "1px solid rgba(245, 158, 11, 0.3)" : "1px solid var(--border-color)", padding: "1px 6px", borderRadius: "10px", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                      ⏱️ {displayTime}s
                    </span>
                  )}
                  <span className="badge" style={getBadgeStyle(doc.status)}>{doc.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default DocumentQueue;
