import { useState, useEffect, useRef } from "react";
import { normalizeText, isTextMatching } from "../utils/ocrCropper";

export default function VerificationDiffPopup({
  isOpen,
  position,
  currentValue = "",
  detectedValue = "",
  activeFieldInfo = {},
  onApply,
  onCancel,
  isLoading = false,
}) {
  const [editedValue, setEditedValue] = useState(detectedValue);
  const inputRef = useRef(null);
  const popupRef = useRef(null);

  useEffect(() => {
    setEditedValue(detectedValue);
  }, [detectedValue]);

  const isMatch = isTextMatching(currentValue, editedValue);

  // Focus the input if there is a diff
  useEffect(() => {
    if (isOpen && !isMatch && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen, isMatch]);

  // Global keyboard listener for Enter & Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onApply(editedValue);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, editedValue, onApply, onCancel]);

  if (!isOpen) return null;

  const fieldLabel = activeFieldInfo.label || "Active Field";
  const sectionName = activeFieldInfo.sectionName || "Form";

  // Calculate smart position to keep popup within viewport
  const popupStyle = {
    position: "fixed",
    top: position?.y ? Math.min(window.innerHeight - 320, Math.max(80, position.y)) : "50%",
    left: position?.x ? Math.min(window.innerWidth - 380, Math.max(20, position.x)) : "50%",
    transform: position ? "none" : "translate(-50%, -50%)",
    zIndex: 9999,
  };

  return (
    <div
      ref={popupRef}
      className={`diff-popup-container ${isMatch ? "diff-popup-match" : "diff-popup-mismatch"}`}
      style={popupStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="diff-popup-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {isLoading ? (
            <div className="diff-spinner" />
          ) : isMatch ? (
            <span className="diff-icon-badge match">✓</span>
          ) : (
            <span className="diff-icon-badge mismatch">⚠️</span>
          )}
          <div>
            <div className="diff-title">
              {isLoading
                ? "Reading Image Area..."
                : isMatch
                ? "Exact Match — No Changes"
                : "Difference Detected"}
            </div>
            <div className="diff-subtitle">
              {sectionName} › <strong style={{ color: "var(--text-primary)" }}>{fieldLabel}</strong>
            </div>
          </div>
        </div>
        <button
          className="diff-close-btn"
          onClick={onCancel}
          title="Dismiss (Esc)"
        >
          ×
        </button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="diff-popup-loading">
          <p>Extracting text from selected region...</p>
        </div>
      ) : isMatch ? (
        <div className="diff-popup-body">
          <div className="diff-match-message">
            The text in the selected image area exactly matches the current field value:
          </div>
          <div className="diff-match-value">
            "{currentValue || <em style={{ opacity: 0.6 }}>(Empty)</em>}"
          </div>
        </div>
      ) : (
        <div className="diff-popup-body">
          {/* Current vs Detected comparison */}
          <div className="diff-field-comparison">
            <div className="diff-row">
              <span className="diff-label">Current:</span>
              <span className="diff-val-old">
                {currentValue ? (
                  <del>{currentValue}</del>
                ) : (
                  <em style={{ color: "#9ca3af" }}>(Empty)</em>
                )}
              </span>
            </div>
            <div className="diff-row">
              <span className="diff-label">Image Text:</span>
              <div style={{ flex: 1 }}>
                <input
                  ref={inputRef}
                  type="text"
                  className="diff-input-new"
                  value={editedValue}
                  onChange={(e) => setEditedValue(e.target.value)}
                  placeholder="Extracted text"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="diff-popup-footer">
        <button
          className="btn btn-secondary diff-btn-cancel"
          onClick={onCancel}
          title="Keep current value without applying (Esc)"
        >
          Keep Current <kbd className="diff-kbd">Esc</kbd>
        </button>
        <button
          className={`btn ${isMatch ? "btn-success" : "btn-primary"} diff-btn-apply`}
          onClick={() => onApply(editedValue)}
          disabled={isLoading}
          title="Apply value and move to next field (Enter)"
        >
          {isMatch ? "Confirm & Next" : "Apply Changes"}{" "}
          <kbd className="diff-kbd">↵ Enter</kbd>
        </button>
      </div>
    </div>
  );
}
