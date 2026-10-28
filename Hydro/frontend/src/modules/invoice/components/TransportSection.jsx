import ConfidenceIndicator from "./ConfidenceIndicator";

function TransportSection({ data, onChange }) {
  const handleChange = (field, value) => {
    onChange({
      ...data,
      [field]: value,
    });
  };

  return (
    <div className="ocr-section">
      <div className="ocr-section-header">Transport Details</div>
      <div className="ocr-section-content">
        <div className="inputs-grid">
          <div className="form-group">
            <label className="form-label">
              Destination
              <ConfidenceIndicator value={data.destination} fieldName="destination" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.destination || ""}
              onChange={(e) => handleChange("destination", e.target.value)}
              placeholder="e.g. Amritsar, Punjab"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              GR Number
              <ConfidenceIndicator value={data.gr_no} fieldName="gr_no" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.gr_no || ""}
              onChange={(e) => handleChange("gr_no", e.target.value)}
              placeholder="Goods Receipt Number"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Vehicle Number
              <ConfidenceIndicator value={data.vehicle_number} fieldName="vehicle_number" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.vehicle_number || ""}
              onChange={(e) => handleChange("vehicle_number", e.target.value)}
              placeholder="e.g. PB-02-XY-1234"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Weight
              <ConfidenceIndicator value={data.weight} fieldName="weight" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.weight || ""}
              onChange={(e) => handleChange("weight", e.target.value)}
              placeholder="e.g. 15.4 Tonnes"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Transport Mode
              <ConfidenceIndicator value={data.mode_of_transport} fieldName="mode_of_transport" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.mode_of_transport || ""}
              onChange={(e) => handleChange("mode_of_transport", e.target.value)}
              placeholder="e.g. Road / Rail"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default TransportSection;
