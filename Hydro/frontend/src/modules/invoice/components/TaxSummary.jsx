const cleanNumberValue = (val) => {
  if (val === undefined || val === null) return "";
  if (typeof val === "number") return val;
  const cleaned = String(val).replace(/[^\d.-]/g, "");
  return cleaned === "" ? "" : cleaned;
};

function TaxSummary({ data = {}, onChange }) {
  const handleChange = (field, value) => {
    onChange({
      ...data,
      [field]: value === "" ? "" : parseFloat(value) || 0,
    });
  };

  return (
    <div className="summary-card">
      <h4>Tax Summary</h4>
      <div className="summary-fields">
        <div className="summary-row">
          <label>Subtotal</label>
          <div className="summary-input-wrapper">
            <span>₹</span>
            <input
              type="number"
              className="summary-input"
              value={cleanNumberValue(data.subtotal)}
              onChange={(e) => handleChange("subtotal", e.target.value)}
            />
          </div>
        </div>

        <div className="summary-row">
          <label>Taxable Amount</label>
          <div className="summary-input-wrapper">
            <span>₹</span>
            <input
              type="number"
              className="summary-input"
              value={cleanNumberValue(data.taxable_amount)}
              onChange={(e) => handleChange("taxable_amount", e.target.value)}
            />
          </div>
        </div>

        <div className="summary-row">
          <label>CGST</label>
          <div className="summary-input-wrapper">
            <span>₹</span>
            <input
              type="number"
              className="summary-input"
              value={cleanNumberValue(data.cgst)}
              onChange={(e) => handleChange("cgst", e.target.value)}
            />
          </div>
        </div>

        <div className="summary-row">
          <label>SGST</label>
          <div className="summary-input-wrapper">
            <span>₹</span>
            <input
              type="number"
              className="summary-input"
              value={cleanNumberValue(data.sgst)}
              onChange={(e) => handleChange("sgst", e.target.value)}
            />
          </div>
        </div>

        <div className="summary-row">
          <label>IGST</label>
          <div className="summary-input-wrapper">
            <span>₹</span>
            <input
              type="number"
              className="summary-input"
              value={cleanNumberValue(data.igst)}
              onChange={(e) => handleChange("igst", e.target.value)}
            />
          </div>
        </div>

        <div className="summary-row">
          <label>CESS</label>
          <div className="summary-input-wrapper">
            <span>₹</span>
            <input
              type="number"
              className="summary-input"
              value={cleanNumberValue(data.cess)}
              onChange={(e) => handleChange("cess", e.target.value)}
            />
          </div>
        </div>

        <div className="summary-row">
          <label>Round Off</label>
          <div className="summary-input-wrapper">
            <span>₹</span>
            <input
              type="number"
              className="summary-input"
              value={cleanNumberValue(data.round_off)}
              onChange={(e) => handleChange("round_off", e.target.value)}
            />
          </div>
        </div>

        <div className="summary-row highlight">
          <label>Total Tax</label>
          <div className="summary-value-display">
            ₹ {(data.total_tax || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TaxSummary;
