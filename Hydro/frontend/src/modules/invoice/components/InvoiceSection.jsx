import ConfidenceIndicator from "./ConfidenceIndicator";

function InvoiceSection({ data, onChange }) {
  const handleChange = (field, value) => {
    onChange({
      ...data,
      [field]: value,
    });
  };

  return (
    <div className="ocr-section">
      <div className="ocr-section-header">Invoice Details</div>
      <div className="ocr-section-content">
        <div className="inputs-grid">
          <div className="form-group">
            <label className="form-label">
              Invoice Number
              <ConfidenceIndicator value={data.invoice_number} fieldName="invoice_number" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.invoice_number || ""}
              onChange={(e) => handleChange("invoice_number", e.target.value)}
              placeholder="e.g. 32"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Invoice Date
              <ConfidenceIndicator value={data.invoice_date} fieldName="invoice_date" />
            </label>
            <input
              type="date"
              className="form-input"
              value={data.invoice_date || ""}
              onChange={(e) => handleChange("invoice_date", e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              PO Number
              <ConfidenceIndicator value={data.po_number} fieldName="po_number" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.po_number || ""}
              onChange={(e) => handleChange("po_number", e.target.value)}
              placeholder="Purchase Order Number"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Payment Terms
              <ConfidenceIndicator value={data.payment_terms} fieldName="payment_terms" />
            </label>
            <input
              type="text"
              className="form-input"
              value={data.payment_terms || ""}
              onChange={(e) => handleChange("payment_terms", e.target.value)}
              placeholder="e.g. Net 30, Due on Receipt"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default InvoiceSection;
