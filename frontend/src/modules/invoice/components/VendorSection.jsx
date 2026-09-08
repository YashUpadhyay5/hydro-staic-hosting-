import ConfidenceIndicator from "./ConfidenceIndicator";

function VendorSection({ data, onChange }) {
  const handleChange = (field, value) => {
    onChange({
      ...data,
      [field]: value,
    });
  };

  return (
    <div className="ocr-section">
      <div className="ocr-section-header">Vendor Details</div>
      <div className="ocr-section-content">
        <div className="inputs-grid">
          <div className="form-group full-width">
            <label className="form-label">
              Vendor Name
              <ConfidenceIndicator value={data.name} fieldName="name" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.name || ""}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="e.g. Sukh Building Material"
            />
          </div>

          <div className="form-group">
            <label className="form-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span>GSTIN</span>
                {data.gstin && String(data.gstin).trim().length > 0 && String(data.gstin).trim().length !== 15 && (
                  <span style={{ fontSize: "11px", color: "#d97706", backgroundColor: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(245, 158, 11, 0.35)", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
                    ⚠️ {String(data.gstin).trim().length}/15
                  </span>
                )}
                {data.gstin && String(data.gstin).trim().length === 15 && (
                  <span style={{ fontSize: "11px", color: "#059669", backgroundColor: "rgba(16, 185, 129, 0.12)", border: "1px solid rgba(16, 185, 129, 0.35)", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
                    ✓ 15/15
                  </span>
                )}
              </span>
              <ConfidenceIndicator value={data.gstin} fieldName="gstin" />
            </label>
            <input
              type="text"
              className="form-input"
              style={data.gstin && String(data.gstin).trim().length > 0 && String(data.gstin).trim().length !== 15 ? {
                borderColor: "#f59e0b",
                backgroundColor: "rgba(245, 158, 11, 0.04)",
                boxShadow: "0 0 0 2px rgba(245, 158, 11, 0.2)"
              } : data.gstin && String(data.gstin).trim().length === 15 ? {
                borderColor: "#10b981"
              } : {}}
              value={data.gstin || ""}
              onChange={(e) => handleChange("gstin", e.target.value.toUpperCase())}
              placeholder="15-digit GSTIN (e.g. 09AAFCG9846E1Z9)"
            />
            {data.gstin && String(data.gstin).trim().length > 0 && String(data.gstin).trim().length !== 15 && (
              <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#d97706", marginTop: "4px", fontWeight: "600" }}>
                <span>⚠️ GST number must be exactly 15 characters (currently {String(data.gstin).trim().length} chars)</span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              PAN
              <ConfidenceIndicator value={data.pan} fieldName="pan" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.pan || ""}
              onChange={(e) => handleChange("pan", e.target.value)}
              placeholder="10-digit PAN"
            />
          </div>

          <div className="form-group full-width">
            <label className="form-label">
              Address
              <ConfidenceIndicator value={data.address} fieldName="address" />
            </label>
            <textarea
              className="form-input"
              rows="2"
              style={{ resize: "vertical", fontFamily: "inherit" }}
              value={data.address || ""}
              onChange={(e) => handleChange("address", e.target.value)}
              placeholder="Street, locality, city"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              State
              <ConfidenceIndicator value={data.state} fieldName="state" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.state || ""}
              onChange={(e) => handleChange("state", e.target.value)}
              placeholder="State name"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default VendorSection;
