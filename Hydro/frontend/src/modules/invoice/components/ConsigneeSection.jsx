import ConfidenceIndicator from "./ConfidenceIndicator";

function ConsigneeSection({ data, onChange }) {
  const handleChange = (field, value) => {
    onChange({
      ...data,
      [field]: value,
    });
  };

  return (
    <div className="ocr-section">
      <div className="ocr-section-header">Consignee Details</div>
      <div className="ocr-section-content">
        <div className="inputs-grid">
          <div className="form-group full-width">
            <label className="form-label">
              Consignee Name
              <ConfidenceIndicator value={data.name} fieldName="name" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.name || ""}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="e.g. HydroMaterials Private Limited"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              GSTIN
              <ConfidenceIndicator value={data.gstin} fieldName="gstin" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.gstin || ""}
              onChange={(e) => handleChange("gstin", e.target.value)}
              placeholder="15-digit GSTIN"
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
        </div>
      </div>
    </div>
  );
}

export default ConsigneeSection;
