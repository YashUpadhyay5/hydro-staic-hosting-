import { useState, useEffect, useMemo, useRef } from "react";
import LineItemsTable, { getLineItemColumns } from "./LineItemsTable";
import TotalAmountSummary from "./TotalAmountSummary";

const DEFAULT_SECTIONS = [
  {
    id: "invoice_details",
    name: "Invoice Details",
    icon: "📋",
    enabled: true,
    fields: [
      { key: "invoice_number", label: "Invoice Number", type: "Text", required: true },
      { key: "invoice_date", label: "Invoice Date", type: "Date", required: true },
      { key: "po_number", label: "PO Number", type: "Text" },
      { key: "place_of_supply", label: "Place of Supply", type: "Text" }
    ]
  },
  {
    id: "vendor_details",
    name: "Vendor Details",
    icon: "🏪",
    enabled: true,
    fields: [
      { key: "name", label: "Vendor Name", type: "Text", required: true },
      { key: "gstin", label: "GSTIN", type: "GSTIN" },
      { key: "pan", label: "PAN", type: "PAN" },
      { key: "address", label: "Address", type: "Address" },
      { key: "city", label: "City", type: "Text" },
      { key: "state", label: "State", type: "Text" }
    ]
  },
  {
    id: "consumer_details",
    name: "Consumer Details",
    icon: "👤",
    enabled: true,
    fields: [
      { key: "name", label: "Consumer Name", type: "Text", required: true },
      { key: "gstin", label: "GSTIN", type: "GSTIN" },
      { key: "address", label: "Address", type: "Address" }
    ]
  },
  {
    id: "transport_details",
    name: "Transport Details",
    icon: "🚚",
    enabled: true,
    fields: [
      { key: "mode_of_transport", label: "Transport Mode", type: "Text" },
      { key: "vehicle_number", label: "Vehicle Number", type: "Text" },
      { key: "destination", label: "Destination", type: "Text" }
    ]
  },
  {
    id: "bank_details",
    name: "Bank Details",
    icon: "🏦",
    enabled: true,
    fields: [
      { key: "bank_name", label: "Bank Name", type: "Text" },
      { key: "account_number", label: "Account Number", type: "Text" },
      { key: "ifsc_code", label: "IFSC", type: "IFSC" },
      { key: "branch", label: "Branch", type: "Text" }
    ]
  },
  {
    id: "item_details",
    name: "Line Items",
    icon: "📦",
    enabled: true,
    fields: [
      { key: "description", label: "Description", type: "Text" },
      { key: "description_of_goods", label: "Description of Goods", type: "Text" },
      { key: "hsn_code", label: "HSN Code", type: "Text" },
      { key: "quantity", label: "Quantity", type: "Number" },
      { key: "unit", label: "Unit", type: "Text" },
      { key: "unit_price", label: "Unit Price", type: "Currency" },
      { key: "discount_amount", label: "Discount", type: "Text" },
      { key: "taxable_amount", label: "Taxable Amt", type: "Currency" },
      { key: "tax_rate", label: "Tax Rate", type: "Percentage" },
      { key: "tax_amount", label: "Tax Amt", type: "Currency" },
      { key: "total_amount", label: "Total Amt", type: "Currency" }
    ]
  },
  {
    id: "tax_summary",
    name: "Tax Summary",
    icon: "💰",
    enabled: true,
    fields: [
      { key: "subtotal", label: "Subtotal", type: "Currency" },
      { key: "taxable_amount", label: "Taxable Amount", type: "Currency" },
      { key: "cgst", label: "CGST", type: "Currency" },
      { key: "sgst", label: "SGST", type: "Currency" },
      { key: "igst", label: "IGST", type: "Currency" },
      { key: "cess", label: "Cess", type: "Currency" },
      { key: "round_off", label: "Round Off", type: "Currency" },
      { key: "grand_total", label: "Grand Total", type: "Currency" }
    ]
  }
];

const ALLOWED_ORDER = [
  "invoice_details",
  "vendor_details",
  "consumer_details",
  "transport_details",
  "bank_details",
  "item_details",
  "items",
  "tax_summary",
  "tax_details"
];

function ExtractionEditor({
  document: doc,
  extraction,
  onExtractionChange,
  
  // DB integration fields
  dbFields,
  onDbFieldsChange,

  // Guided validation workflow props
  activeStep = 1,
  onActiveStepChange,
  verifiedFields = {},
  onMarkFieldVerified,
  onFieldsListGenerated,
  onSave,
}) {
  const [activeTab, setActiveTab] = useState("extraction");
  const activeInputRef = useRef(null);

  const rawSections = (doc?.template_config && doc.template_config.length > 0)
    ? doc.template_config
    : DEFAULT_SECTIONS;

  const sections = useMemo(() => {
    return rawSections
      .filter(sec => sec && sec.id !== "metadata" && sec.id !== "notes")
      .sort((a, b) => {
        const idxA = ALLOWED_ORDER.indexOf(a.id);
        const idxB = ALLOWED_ORDER.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0;
      });
  }, [rawSections]);

  // Compute a sequential flattened list of all fields across all sections (including each Line Item row/cell and Tax Summary)
  const sequentialFields = useMemo(() => {
    let list = [];
    let boxCounter = 1;

    sections.filter(s => s.enabled).forEach(sec => {
      // 1. Line Items Table: generate sequential boxes for each row and ALL columns
      if (sec.id === "item_details" || sec.id === "items") {
        const rawItems = extraction?.items || extraction?.item_details || [];
        const items = rawItems.length > 0 ? rawItems : [{}];
        const lineCols = getLineItemColumns(sec.fields, items);

        items.forEach((item, rowIndex) => {
          lineCols.forEach(col => {
            list.push({
              boxNumber: boxCounter++,
              sectionId: sec.id,
              sectionName: `Line Items (Row #${rowIndex + 1})`,
              fieldKey: col.key,
              label: `${col.label} [Row #${rowIndex + 1}]`,
              type: col.type === "number" ? "Number" : "Text",
              required: col.key === "description" || col.key === "quantity" || col.key === "total_amount",
              rowIndex: rowIndex,
              isItemField: true,
              placeholder: col.label,
              readOnly: false
            });
          });
        });
        return;
      }

      // 2. Standard and Tax Summary fields
      (sec.fields || []).filter(f => !f.hidden).forEach(f => {
        list.push({
          boxNumber: boxCounter++,
          sectionId: sec.id,
          sectionName: sec.name,
          fieldKey: f.key,
          label: f.label,
          type: f.type,
          required: !!f.required,
          placeholder: f.placeholder,
          readOnly: !!f.read_only
        });
      });
    });

    return list;
  }, [sections, extraction?.items, extraction?.item_details]);

  // Notify parent of sequential fields list
  useEffect(() => {
    if (onFieldsListGenerated && sequentialFields.length > 0) {
      onFieldsListGenerated(sequentialFields);
    }
  }, [sequentialFields, onFieldsListGenerated]);

  // Auto-scroll active box into view smoothly when activeStep changes
  useEffect(() => {
    if (activeStep && activeTab === "extraction" && doc && extraction) {
      const el = document.querySelector(`[data-box-step="${activeStep}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const input = el.querySelector("input, textarea");
        if (input && document.activeElement !== input) {
          input.focus({ preventScroll: true });
        }
      }
    }
  }, [activeStep, activeTab, doc, extraction]);

  // Early return check ONLY AFTER all hooks are called
  if (!doc || !extraction) {
    return (
      <div className="empty-state">
        <p>Select a processed document to verify and edit OCR fields.</p>
      </div>
    );
  }

  const handleSectionChange = (section, sectionData) => {
    onExtractionChange({
      ...extraction,
      [section]: sectionData,
    });
  };

  const handleDbFieldChange = (field, value) => {
    onDbFieldsChange({
      ...dbFields,
      [field]: value
    });
  };

  return (
    <div className="editor-panel">
      <div className="editor-tabs-bar">
        <button
          className={`tab-btn ${activeTab === "extraction" ? "active" : ""}`}
          onClick={() => setActiveTab("extraction")}
        >
          Extraction
        </button>
        <button
          className={`tab-btn ${activeTab === "preview" ? "active" : ""}`}
          onClick={() => setActiveTab("preview")}
        >
          Preview
        </button>
      </div>

      <div className="editor-scroll-container">
        {activeTab === "extraction" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Validation Warnings Banner for Missing Critical Fields */}
            {(() => {
              const vGstin = String(extraction.vendor_details?.gstin || "").trim();
              const cGstin = String(extraction.consumer_details?.gstin || "").trim();
              const bAcc = String(extraction.bank_details?.account_number || extraction.bank_details?.account_no || "").trim();
              const bIfsc = String(extraction.bank_details?.ifsc_code || extraction.bank_details?.ifsc || "").trim();
              const isVendorGstinMissing = !vGstin;
              const isConsumerGstinMissing = !cGstin;
              const isBankMissing = !bAcc && !bIfsc;

              if (isVendorGstinMissing || isConsumerGstinMissing || isBankMissing) {
                return (
                  <div style={{
                    backgroundColor: "rgba(245, 158, 11, 0.08)",
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "700", color: "#d97706", fontSize: "13px" }}>
                      <span>⚠️ Validation Warnings (Missing Details)</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "12px", color: "#b45309", display: "flex", flexDirection: "column", gap: "3px" }}>
                      {isVendorGstinMissing && (
                        <li>Vendor GSTIN is not present on this document.</li>
                      )}
                      {isConsumerGstinMissing && (
                        <li>Company / Consumer GSTIN is not present on this document.</li>
                      )}
                      {isBankMissing && (
                        <li>Bank details (Account Number / IFSC) are not present on this document.</li>
                      )}
                    </ul>
                  </div>
                );
              }
              return null;
            })()}

            {sections
              .filter(sec => sec.enabled)
              .map(sec => {
                  if (sec.id === "item_details" || sec.id === "items") {
                    return (
                      <div key={sec.id}>
                        <div className="ocr-section-header" style={{ marginBottom: "10px" }}>
                          {sec.name}
                        </div>
                        <LineItemsTable
                          items={extraction.items || extraction.item_details || []}
                          originalItems={doc.ocr_result?.extraction?.items || doc.ocr_result?.extraction?.item_details || []}
                          columnConfig={sec.fields}
                          onChange={(items) => {
                            onExtractionChange({
                              ...extraction,
                              items: items,
                              item_details: items,
                              [sec.id]: items
                            });
                          }}
                          activeStep={activeStep}
                          onActiveStepChange={onActiveStepChange}
                          verifiedFields={verifiedFields}
                          onMarkFieldVerified={onMarkFieldVerified}
                          sequentialFields={sequentialFields}
                          onSave={onSave}
                        />
                      </div>
                    );
                  }

                  if (sec.id === "tax_summary" || sec.id === "tax_details") {
                    return (
                      <div key={sec.id} className="summary-cards-container">
                        <TotalAmountSummary
                          data={extraction.tax_summary || extraction.tax_details || {}}
                          items={extraction.items || extraction.item_details || []}
                          fields={sec.fields}
                          additionalCharges={dbFields?.additional_charges || 0}
                          onAdditionalChargesChange={(val) => handleDbFieldChange("additional_charges", val)}
                          onChange={(data) => handleSectionChange(sec.id, data)}
                          activeStep={activeStep}
                          onActiveStepChange={onActiveStepChange}
                          verifiedFields={verifiedFields}
                          onMarkFieldVerified={onMarkFieldVerified}
                          sequentialFields={sequentialFields}
                        />
                      </div>
                    );
                  }

                  // Standard dynamic card section (like Invoice Details, Vendor Details, Consumer Details, Transport, Bank Details)
                  return (
                    <div key={sec.id} className="ocr-section">
                      <div className="ocr-section-header">
                        {sec.name}
                      </div>
                      <div className="ocr-section-content">
                        <div className="inputs-grid">
                          {sec.fields.filter(f => !f.hidden).map(field => {
                            const isIfsc = ["ifsc_code", "ifsc", "ifscCode", "bank_ifsc"].includes(field.key) || field.type === "IFSC";
                            const rawVal = (() => {
                              if (sec.id === "bank_details") {
                                const b = extraction.bank_details || extraction.vendor_details?.bank_details || {};
                                const topBankName = extraction.bank_name || extraction.vendor_details?.bank_name;
                                const topAccountNo = extraction.account_number || extraction.account_no || extraction.vendor_details?.account_number;
                                const topIfsc = extraction.ifsc_code || extraction.ifsc || extraction.vendor_details?.ifsc_code;

                                if (isIfsc) {
                                  return b.ifsc_code || b.ifsc || b.ifscCode || b.bank_ifsc || topIfsc || field.default_value || "";
                                }
                                if (["account_number", "account_no", "acc_no", "account", "bank_account"].includes(field.key)) {
                                  return b.account_number || b.account_no || b.acc_no || b.account || b.bank_account || topAccountNo || field.default_value || "";
                                }
                                if (["bank_name", "bank", "name_of_bank", "bank_details"].includes(field.key)) {
                                  return b.bank_name || b.bank || b.name_of_bank || topBankName || field.default_value || "";
                                }
                                if (["branch", "branch_name", "branch_address"].includes(field.key)) {
                                  return b.branch || b.branch_name || b.branch_address || field.default_value || "";
                                }
                                if (["account_name", "account_holder", "beneficiary_name"].includes(field.key)) {
                                  return b.account_name || b.account_holder || b.beneficiary_name || field.default_value || "";
                                }
                                return b[field.key] || field.default_value || "";
                              }
                              return extraction[sec.id]?.[field.key] ?? field.default_value ?? "";
                            })();
                            const strVal = String(rawVal ?? "").trim();
                            
                            // Check if this is a GSTIN / GST Number field
                            const isGstin = (() => {
                              const k = String(field.key || '').toLowerCase();
                              const t = String(field.type || '').toUpperCase();
                              const l = String(field.label || '').toLowerCase();
                              if (k.includes('cgst') || k.includes('sgst') || k.includes('igst') || k.includes('gst_rate') || k.includes('gst_amount')) return false;
                              return k === 'gstin' || t === 'GSTIN' || l.includes('gstin') || l.includes('gst number') || l.includes('gst no');
                            })();

                            const isGstinInvalid = isGstin && strVal.length > 0 && strVal.length !== 15;
                            const isGstinValid = isGstin && strVal.length === 15;
                            const isGstinEmpty = isGstin && strVal.length === 0;
                            const isBankDetailsEmpty = sec.id === "bank_details" && strVal.length === 0;
                            const isFullWidth = field.type === "Long Text" || field.type === "Address" || Boolean(field.full_width || field.fullWidth);

                            // Find sequential box info
                            const seqItem = sequentialFields.find(s => s.sectionId === sec.id && s.fieldKey === field.key);
                            const boxNumber = seqItem ? seqItem.boxNumber : null;
                            const isActiveStep = boxNumber !== null && boxNumber === activeStep;
                            const isFieldVerified = verifiedFields?.[`${sec.id}.${field.key}`];

                            return (
                              <div
                                key={field.key}
                                data-box-step={boxNumber}
                                className={`form-group ${isFullWidth ? "full-width" : ""} ${isActiveStep ? "active-field-group" : ""} ${isFieldVerified ? "verified-field-group" : ""}`}
                                onClick={() => {
                                  if (boxNumber && onActiveStepChange) {
                                    onActiveStepChange(boxNumber);
                                  }
                                }}
                              >
                                <label className="form-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                    <span style={{ fontWeight: isActiveStep ? "700" : "500" }}>
                                      {field.label}
                                      {field.required && <span style={{ color: "#b91c1c" }}> *</span>}
                                    </span>
                                    {isFieldVerified && !isGstinEmpty && !isBankDetailsEmpty && (
                                      <span
                                        className="verified-check-pill"
                                        title="Field Verified"
                                        style={{
                                          fontSize: "10px",
                                          color: "#059669",
                                          backgroundColor: "rgba(16, 185, 129, 0.15)",
                                          border: "1px solid rgba(16, 185, 129, 0.35)",
                                          padding: "1px 6px",
                                          borderRadius: "100px",
                                          fontWeight: 700,
                                        }}
                                      >
                                        ✓ Verified
                                      </span>
                                    )}
                                    {isActiveStep && (
                                      <span
                                        className="active-step-indicator-pill"
                                        style={{
                                          fontSize: "10px",
                                          color: "#2563eb",
                                          backgroundColor: "rgba(37, 99, 235, 0.12)",
                                          border: "1px solid rgba(37, 99, 235, 0.35)",
                                          padding: "1px 6px",
                                          borderRadius: "100px",
                                          fontWeight: 700,
                                        }}
                                      >
                                        🎯 Active
                                      </span>
                                    )}
                                    {isGstinInvalid && (
                                      <span style={{ fontSize: "11px", color: "#d97706", backgroundColor: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(245, 158, 11, 0.35)", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
                                        ⚠️ {strVal.length}/15
                                      </span>
                                    )}
                                    {isGstinValid && (
                                      <span style={{ fontSize: "11px", color: "#059669", backgroundColor: "rgba(16, 185, 129, 0.12)", border: "1px solid rgba(16, 185, 129, 0.35)", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
                                        ✓ 15/15
                                      </span>
                                    )}
                                    {isGstinEmpty && (
                                      <span style={{ fontSize: "11px", color: "#d97706", backgroundColor: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(245, 158, 11, 0.35)", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
                                        ⚠️ Missing / Not Present
                                      </span>
                                    )}
                                    {!isGstin && isBankDetailsEmpty && (
                                      <span style={{ fontSize: "11px", color: "#d97706", backgroundColor: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(245, 158, 11, 0.35)", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
                                        ⚠️ Missing / Not Present
                                      </span>
                                    )}
                                  </span>
                                </label>

                                {field.type === "Long Text" || field.type === "Address" ? (
                                  <textarea
                                    className={`form-input ${isActiveStep ? "active-input" : ""}`}
                                    rows="2"
                                    style={{ resize: "vertical", fontFamily: "inherit" }}
                                    value={rawVal}
                                    disabled={field.read_only}
                                    onFocus={() => {
                                      if (boxNumber && onActiveStepChange) onActiveStepChange(boxNumber);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        if (onMarkFieldVerified) onMarkFieldVerified(sec.id, field.key);
                                        if (onActiveStepChange && boxNumber < sequentialFields.length) {
                                          onActiveStepChange(boxNumber + 1);
                                        }
                                      }
                                    }}
                                    onChange={(e) => {
                                      const secData = extraction[sec.id] || {};
                                      handleSectionChange(sec.id, { ...secData, [field.key]: e.target.value });
                                    }}
                                    placeholder={field.placeholder || `Enter ${field.label}`}
                                  />
                                ) : field.type === "Checkbox" ? (
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "6px 0" }}>
                                    <input
                                      type="checkbox"
                                      checked={!!extraction[sec.id]?.[field.key]}
                                      disabled={field.read_only}
                                      onChange={(e) => {
                                        const secData = extraction[sec.id] || {};
                                        handleSectionChange(sec.id, { ...secData, [field.key]: e.target.checked });
                                      }}
                                    />
                                    {field.label}
                                  </label>
                                ) : (
                                  <input
                                    type={["Number", "Currency", "Percentage"].includes(field.type) ? "number" : "text"}
                                    className={`form-input ${isActiveStep ? "active-input" : ""}`}
                                    style={isGstinInvalid ? {
                                      borderColor: "#f59e0b",
                                      backgroundColor: "rgba(245, 158, 11, 0.04)",
                                      boxShadow: "0 0 0 2px rgba(245, 158, 11, 0.2)"
                                    } : isGstinValid ? {
                                      borderColor: "#10b981"
                                    } : {}}
                                    value={rawVal}
                                    disabled={field.read_only}
                                    onFocus={() => {
                                      if (boxNumber && onActiveStepChange) onActiveStepChange(boxNumber);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        if (onMarkFieldVerified) onMarkFieldVerified(sec.id, field.key);
                                        if (onActiveStepChange && boxNumber < sequentialFields.length) {
                                          onActiveStepChange(boxNumber + 1);
                                        }
                                      }
                                    }}
                                    onChange={(e) => {
                                      let val = e.target.value;
                                      if (isGstin || isIfsc) {
                                        val = val.toUpperCase();
                                      }
                                      const secData = extraction[sec.id] || {};
                                      const updatedSec = { ...secData, [field.key]: val };
                                      if (isIfsc) {
                                        updatedSec.ifsc_code = val;
                                        updatedSec.ifsc = val;
                                      } else if (["account_number", "account_no", "acc_no", "account"].includes(field.key)) {
                                        updatedSec.account_number = val;
                                        updatedSec.account_no = val;
                                      } else if (["bank_name", "bank"].includes(field.key)) {
                                        updatedSec.bank_name = val;
                                        updatedSec.bank = val;
                                      } else if (["branch", "branch_name"].includes(field.key)) {
                                        updatedSec.branch = val;
                                        updatedSec.branch_name = val;
                                      }
                                      handleSectionChange(sec.id, updatedSec);
                                    }}
                                    placeholder={field.placeholder || (isGstin ? "15-digit GSTIN (e.g. 09AAFCG9846E1Z9)" : isIfsc ? "11-digit IFSC (e.g. HDFC0000263)" : `Enter ${field.label}`)}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        ) : (
          <div className="code-viewer-container">
            <pre>
              <code>{JSON.stringify(extraction, null, 4)}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default ExtractionEditor;
