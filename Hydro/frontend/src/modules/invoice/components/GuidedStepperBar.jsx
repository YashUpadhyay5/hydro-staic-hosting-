export default function GuidedStepperBar({
  totalFields = 1,
  activeStep = 1,
  activeFieldInfo = {},
  verifiedCount = 0,
  onPrev,
  onNext,
  onSkip,
  onSave,
  isGuidedActive = true,
  onToggleGuided,
}) {
  const progressPct = totalFields > 0 ? Math.round((verifiedCount / totalFields) * 100) : 0;
  const currentBoxNum = activeFieldInfo.boxNumber || activeStep;
  const fieldLabel = activeFieldInfo.label || "Invoice Number";
  const sectionName = activeFieldInfo.sectionName || "Invoice Details";
  const isFinalStep = activeStep >= totalFields;

  return (
    <div className="guided-stepper-bar">
      <div className="stepper-left-content">
        <div className="stepper-badge-row">
          <span className="stepper-mode-pill">
            🎯 Guided Validation
          </span>
          <span className="stepper-step-count">
            Step <strong>{currentBoxNum}</strong> of <strong>{totalFields}</strong>
          </span>
          <span className="stepper-verified-count">
            ✓ {verifiedCount}/{totalFields} Verified ({progressPct}%)
          </span>
        </div>
        <div className="stepper-active-target">
          <span className="stepper-section-tag">{sectionName}</span>
          <span className="stepper-separator">›</span>
          <span className="stepper-field-name">{fieldLabel}</span>
          <span className="stepper-hint-tag">Drag on image or press ↵ to verify</span>
        </div>
      </div>

      {/* Progress Track */}
      <div className="stepper-progress-track">
        <div
          className="stepper-progress-fill"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Stepper Controls */}
      <div className="stepper-controls">
        <button
          className="btn btn-secondary stepper-nav-btn"
          onClick={onPrev}
          disabled={activeStep <= 1}
          title="Previous Field (Shift+Tab)"
        >
          ‹ Prev
        </button>
        <button
          className="btn btn-secondary stepper-nav-btn"
          onClick={onSkip}
          title="Skip to next field (Tab / ↓)"
        >
          {isFinalStep ? "Reset Step" : "Skip"}
        </button>
        {isFinalStep ? (
          <button
            className="btn btn-primary stepper-nav-btn btn-success"
            onClick={onSave || onNext}
            title="All fields validated! Save and update database (Enter)"
            style={{
              backgroundColor: "#10b981",
              borderColor: "#059669",
              color: "#ffffff",
              fontWeight: "700"
            }}
          >
            💾 Update Database ↵
          </button>
        ) : (
          <button
            className="btn btn-primary stepper-nav-btn"
            onClick={onNext}
            title="Next Field (Tab)"
          >
            Next ›
          </button>
        )}
      </div>
    </div>
  );
}
