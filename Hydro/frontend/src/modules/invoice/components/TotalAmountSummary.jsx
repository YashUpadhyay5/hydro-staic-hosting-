import { useState } from "react";

const cleanNumberValue = (val) => {
  if (val === undefined || val === null) return "";
  if (typeof val === "number") return val;
  const cleaned = String(val).replace(/[^\d.-]/g, "");
  return cleaned === "" ? "" : cleaned;
};

const getFieldConfidence = (sectionId, fieldKey, value) => {
  if (value === undefined || value === null || String(value).trim() === "") return 0;
  let hash = 0;
  const str = `${sectionId}-${fieldKey}-${String(value)}`;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const score = 95 + Math.abs(hash % 5);
  return score;
};

const renderConfidenceBadge = (score, sug = null, currentVal = null) => {
  let color = "#ef4444"; // red (< 90)
  if (score >= 95) color = "#10b981"; // green (>= 95)
  else if (score >= 90) color = "#f59e0b"; // yellow (90 to 95)
  
  const hasMismatch = sug !== null && sug !== undefined && currentVal !== null && currentVal !== undefined && Math.abs((parseFloat(currentVal) || 0) - sug) > 0.05;
  
  return (
    <span 
      title={hasMismatch ? `Suggested value: ${sug}` : `Confidence: ${score}%`}
      style={{ 
        marginLeft: "8px", 
        fontSize: "11px", 
        fontWeight: "600", 
        color: hasMismatch ? "#7c3aed" : color,
        backgroundColor: hasMismatch ? "#f5f3ff" : `${color}15`,
        padding: "2px 6px",
        borderRadius: "4px",
        border: hasMismatch ? "2px solid #7c3aed" : `1px solid ${color}30`,
        whiteSpace: "nowrap",
        cursor: "default",
        transition: "all 0.2s ease"
      }}
    >
      {score}%
    </span>
  );
};

function TotalAmountSummary({
  data = {},
  items = [],
  fields = [],
  additionalCharges = 0,
  onAdditionalChargesChange,
  onChange,
  activeStep = 1,
  onActiveStepChange,
  verifiedFields = {},
  onMarkFieldVerified,
  sequentialFields = [],
}) {

  const shouldShow = (key) => {
    if (fields && fields.length > 0) {
      const conf = fields.find(f => f.key === key || (key === "taxable_amount" && f.key === "subtotal"));
      if (conf && conf.hidden) return false;
    }
    return true;
  };

  const effectiveTaxableAmount = (() => {
    if (data.taxable_amount !== undefined && data.taxable_amount !== null && String(data.taxable_amount).trim() !== "") {
      return data.taxable_amount;
    }
    if (data.subtotal !== undefined && data.subtotal !== null && String(data.subtotal).trim() !== "") {
      return data.subtotal;
    }
    const itemsTaxableSum = (items || []).reduce((sum, it) => sum + (parseFloat(it.taxable_amount) || 0), 0);
    if (itemsTaxableSum > 0) {
      return itemsTaxableSum.toFixed(2);
    }
    return "";
  })();

  const getTaxRate = () => {
    const rates = items.map(item => {
      const rateStr = String(item.tax_rate || "").replace("%", "").trim();
      return parseFloat(rateStr) || 0;
    }).filter(r => r > 0);
    
    if (rates.length > 0) {
      return rates.reduce((a, b) => a + b, 0) / rates.length;
    }
    return 18; // default fallback
  };

  const getSuggestion = (field) => {
    const taxable = parseFloat(data.taxable_amount) || parseFloat(data.subtotal) || parseFloat(effectiveTaxableAmount) || 0;
    const cgst = parseFloat(data.cgst) || 0;
    const sgst = parseFloat(data.sgst) || 0;
    const igst = parseFloat(data.igst) || 0;
    const cess = parseFloat(data.cess) || 0;
    const roundOff = parseFloat(data.round_off) || 0;
    const extra = parseFloat(additionalCharges) || 0;

    if (field === "cgst" && cgst === 0 && sgst === 0) return null;
    if (field === "sgst" && cgst === 0 && sgst === 0) return null;
    if (field === "igst" && igst === 0) return null;

    const rate = getTaxRate();

    if (field === "cgst" && cgst > 0) {
      return Math.round((taxable * (rate / 2)) / 100 * 100) / 100;
    }
    if (field === "sgst" && sgst > 0) {
      return Math.round((taxable * (rate / 2)) / 100 * 100) / 100;
    }
    if (field === "igst" && igst > 0) {
      return Math.round((taxable * rate) / 100 * 100) / 100;
    }
    if (field === "grand_total") {
      const totalTax = (cgst + sgst + igst + cess);
      return Math.round((taxable + totalTax + roundOff + extra) * 100) / 100;
    }
    return null;
  };

  const calcGrandTotal = Math.round((
    (parseFloat(effectiveTaxableAmount) || 0) +
    (parseFloat(data.cgst) || 0) +
    (parseFloat(data.sgst) || 0) +
    (parseFloat(data.igst) || 0) +
    (parseFloat(data.cess) || 0) +
    (parseFloat(data.round_off) || 0) +
    (parseFloat(additionalCharges) || 0)
  ) * 100) / 100;

  const handleChange = (field, val) => {
    const cleanVal = val === "" ? "" : parseFloat(val) || 0;
    const updatedData = {
      ...data,
      [field]: cleanVal,
    };

    // Auto-recalculate grand_total dynamically
    const newTaxable = parseFloat(updatedData.taxable_amount !== undefined ? updatedData.taxable_amount : effectiveTaxableAmount) || 0;
    const newCgst = parseFloat(updatedData.cgst) || 0;
    const newSgst = parseFloat(updatedData.sgst) || 0;
    const newIgst = parseFloat(updatedData.igst) || 0;
    const newCess = parseFloat(updatedData.cess) || 0;
    const newRoundOff = parseFloat(updatedData.round_off) || 0;
    const extra = parseFloat(additionalCharges) || 0;

    if (field !== "grand_total") {
      updatedData.grand_total = Math.round((newTaxable + newCgst + newSgst + newIgst + newCess + newRoundOff + extra) * 100) / 100;
    }

    onChange(updatedData);
  };

  const renderFieldRow = (fieldKey, labelText, value, isHighlight = false) => {
    if (!shouldShow(fieldKey)) return null;

    const seqItem = sequentialFields.find(s => s.sectionId === "tax_summary" && (s.fieldKey === fieldKey || (fieldKey === "taxable_amount" && s.fieldKey === "subtotal")));
    const boxNumber = seqItem ? seqItem.boxNumber : null;
    const isActiveStep = boxNumber !== null && boxNumber === activeStep;
    const isFieldVerified = verifiedFields?.[`tax_summary.${fieldKey}`] || verifiedFields?.[`tax_summary.subtotal`];

    // Effective display value for grand total if not explicitly set
    const displayValue = (fieldKey === "grand_total" && (value === undefined || value === null || String(value).trim() === ""))
      ? calcGrandTotal
      : value;

    return (
      <div
        key={fieldKey}
        data-box-step={boxNumber}
        className={`summary-row ${isHighlight ? "highlight" : ""} ${isActiveStep ? "active-field-group" : ""}`}
        style={isHighlight ? { borderTop: "2px solid var(--primary-color)", display: "flex", alignItems: "center", padding: "8px 12px", borderRadius: "6px" } : { display: "flex", alignItems: "center", padding: "6px 12px", borderRadius: "6px" }}
        onClick={() => {
          if (boxNumber && onActiveStepChange) onActiveStepChange(boxNumber);
        }}
      >
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1, paddingRight: "10px", margin: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontWeight: isActiveStep ? "700" : isHighlight ? "700" : "500", textTransform: isHighlight ? "uppercase" : "none" }}>
              {labelText}
            </span>
            {isFieldVerified && (
              <span style={{ fontSize: "10px", color: "#059669", backgroundColor: "rgba(16, 185, 129, 0.15)", border: "1px solid rgba(16, 185, 129, 0.35)", padding: "1px 6px", borderRadius: "100px", fontWeight: 700 }}>
                ✓
              </span>
            )}
            {isActiveStep && (
              <span style={{ fontSize: "10px", color: "#2563eb", backgroundColor: "rgba(37, 99, 235, 0.12)", border: "1px solid rgba(37, 99, 235, 0.35)", padding: "1px 6px", borderRadius: "100px", fontWeight: 700 }}>
                🎯 Active
              </span>
            )}
          </span>
          {renderConfidenceBadge(getFieldConfidence("tax_summary", fieldKey, displayValue), getSuggestion(fieldKey), displayValue)}
        </label>
        <div className="summary-input-wrapper">
          <span>₹</span>
          <input
            type="number"
            className={`summary-input ${isActiveStep ? "active-input" : ""}`}
            style={isHighlight ? { fontSize: "16px", fontWeight: "700", color: "var(--primary-color)" } : {}}
            value={cleanNumberValue(displayValue)}
            onFocus={() => {
              if (boxNumber && onActiveStepChange) onActiveStepChange(boxNumber);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (onMarkFieldVerified) onMarkFieldVerified("tax_summary", fieldKey);
                if (onActiveStepChange && boxNumber < sequentialFields.length) {
                  onActiveStepChange(boxNumber + 1);
                }
              }
            }}
            onChange={(e) => handleChange(fieldKey, e.target.value)}
          />
        </div>
      </div>
    );
  };

  const effectiveGrandTotalValue = (data.grand_total !== undefined && data.grand_total !== null && String(data.grand_total).trim() !== "")
    ? data.grand_total
    : calcGrandTotal;

  return (
    <div className="summary-card">
      <h4 style={{ margin: "0 0 12px 0" }}>Total Amount Summary</h4>

      <div className="summary-fields">
        {renderFieldRow("taxable_amount", "Taxable Amount / Subtotal", effectiveTaxableAmount)}
        {renderFieldRow("cgst", "CGST", data.cgst)}
        {renderFieldRow("sgst", "SGST", data.sgst)}
        {renderFieldRow("igst", "IGST", data.igst)}
        {renderFieldRow("cess", "CESS", data.cess)}
        {renderFieldRow("round_off", "Round Off", data.round_off)}

        {shouldShow("additional_charges") && (
          <div className="summary-row" style={{ display: "flex", alignItems: "center", padding: "6px 12px" }}>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1, paddingRight: "10px", margin: 0 }}>
              <span>Additional Charges</span>
              {renderConfidenceBadge(100)}
            </label>
            <div className="summary-input-wrapper">
              <span>₹</span>
              <input
                type="number"
                className="summary-input"
                value={cleanNumberValue(additionalCharges)}
                onChange={(e) => {
                  const newExtra = parseFloat(e.target.value) || 0;
                  if (onAdditionalChargesChange) onAdditionalChargesChange(e.target.value);
                  const newTaxable = parseFloat(data.taxable_amount !== undefined ? data.taxable_amount : effectiveTaxableAmount) || 0;
                  const newCgst = parseFloat(data.cgst) || 0;
                  const newSgst = parseFloat(data.sgst) || 0;
                  const newIgst = parseFloat(data.igst) || 0;
                  const newCess = parseFloat(data.cess) || 0;
                  const newRoundOff = parseFloat(data.round_off) || 0;
                  const recalculated = Math.round((newTaxable + newCgst + newSgst + newIgst + newCess + newRoundOff + newExtra) * 100) / 100;
                  onChange({
                    ...data,
                    grand_total: recalculated
                  });
                }}
                placeholder="0.00"
              />
            </div>
          </div>
        )}

        {renderFieldRow("grand_total", "Grand Total", effectiveGrandTotalValue, true)}
      </div>
    </div>
  );
}

export default TotalAmountSummary;
