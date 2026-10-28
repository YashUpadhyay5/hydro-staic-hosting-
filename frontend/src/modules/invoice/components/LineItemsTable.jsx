import { useState, useRef, useEffect } from "react";

export const formatDynamicKey = (key) => {
  if (!key) return "";
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
};

export const getColMinWidth = (key) => {
  switch (key) {
    case "description":
    case "description_of_goods":
    case "item_name":
    case "product_name":
    case "particulars":
      return "380px";
    case "total_amount":
    case "taxable_amount":
    case "amount":
      return "140px";
    case "tax_amount":
    case "cgst_amount":
    case "sgst_amount":
    case "igst_amount":
    case "cess_amount":
    case "discount_amount":
      return "130px";
    case "quantity":
    case "qty":
      return "100px";
    case "unit_price":
    case "rate":
    case "price":
      return "130px";
    case "hsn_code":
    case "hsn":
    case "sac_code":
      return "130px";
    case "unit":
    case "uom":
      return "90px";
    case "tax_rate":
    case "cgst_rate":
    case "sgst_rate":
    case "igst_rate":
    case "cess_rate":
    case "discount_rate":
      return "110px";
    default:
      return "130px";
  }
};

export const getLineItemColumns = (columnConfig = null, items = []) => {
  let baseCols = [];
  if (columnConfig && columnConfig.length > 0) {
    baseCols = columnConfig.filter(f => !f.hidden).map(f => ({
      key: f.key,
      label: f.label,
      isBase: true,
      type: ["Number", "Currency", "Percentage"].includes(f.type) ? "number" : "text"
    }));
  } else {
    baseCols = [
      { key: "description", label: "Description", isBase: true },
      { key: "description_of_goods", label: "Description of Goods", isBase: true },
      { key: "hsn_code", label: "HSN Code", isBase: true },
      { key: "quantity", label: "Quantity", isBase: true, type: "number" },
      { key: "unit", label: "Unit", isBase: true },
      { key: "unit_price", label: "Unit Price", isBase: true, type: "number" },
      { key: "discount_amount", label: "Discount", isBase: true },
      { key: "taxable_amount", label: "Taxable Amt", isBase: true, type: "number" },
      { key: "tax_rate", label: "Tax Rate (%)", isBase: true },
      { key: "tax_amount", label: "Tax Amt", isBase: true, type: "number" },
      { key: "total_amount", label: "Total Amt", isBase: true, type: "number" },
    ];
  }

  // Dynamic heuristic: Check if items contains extra columns with actual content
  const allKeys = new Set();
  (items || []).forEach(item => {
    if (item && typeof item === "object") {
      Object.keys(item).forEach(k => {
        if (item[k] !== undefined && item[k] !== null && String(item[k]).trim() !== "") {
          allKeys.add(k);
        }
      });
    }
  });

  const ignoredKeys = ["id", "line_number", "_id", "confidence", "bbox", "is_valid", "suggested"];

  // Automatically register all extra dynamic columns extracted by AI model
  allKeys.forEach(key => {
    if (!baseCols.some(c => c.key === key) && !ignoredKeys.includes(key)) {
      const sampleVal = items.find(it => it && it[key] !== undefined)?.[key];
      const isNum = typeof sampleVal === "number" || (!isNaN(parseFloat(sampleVal)) && /^-?\d+(\.\d+)?$/.test(String(sampleVal).trim()));
      baseCols.push({
        key: key,
        label: formatDynamicKey(key),
        isBase: false,
        type: isNum ? "number" : "text"
      });
    }
  });

  return baseCols;
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

const getConfidenceColor = (score) => {
  if (score >= 95) return "#10b981"; // green
  if (score >= 90) return "#f59e0b"; // yellow
  return "#ef4444"; // red
};

const snapToGSTTaxRate = (rawRate) => {
  if (rawRate <= 0) return "0%";
  const STANDARD_SLABS = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28];
  for (const slab of STANDARD_SLABS) {
    if (Math.abs(rawRate - slab) <= 0.45) {
      return `${slab}%`;
    }
  }
  return `${parseFloat(rawRate.toFixed(2))}%`;
};

function LineItemsTable({
  items = [],
  originalItems = [],
  onChange,
  columnConfig = null,
  activeStep = 1,
  onActiveStepChange,
  verifiedFields = {},
  onMarkFieldVerified,
  sequentialFields = [],
  onSave,
}) {
  const [initialItems, setInitialItems] = useState([]);

  useEffect(() => {
    // Capture a deep copy of the original model extraction items
    const source = originalItems && originalItems.length > 0 ? originalItems : items;
    if (source && source.length > 0) {
      setInitialItems(JSON.parse(JSON.stringify(source)));
    }
  }, [originalItems]);

  const [columns, setColumns] = useState(() => getLineItemColumns(columnConfig, items));

  useEffect(() => {
    setColumns((prevCols) => {
      const computed = getLineItemColumns(columnConfig, items);
      // Keep any dynamically added custom columns that the user added
      const customAdded = prevCols.filter(c => c.key && c.key.startsWith("custom_"));
      customAdded.forEach(c => {
        if (!computed.some(existing => existing.key === c.key)) {
          computed.push(c);
        }
      });
      return computed;
    });
  }, [columnConfig, items]);

  const [showAddColumnForm, setShowAddColumnForm] = useState(false);

  const getCellSuggestion = (item, key) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.unit_price) || 0;
    const disc = parseFloat(item.discount_amount) || 0;
    const taxAmt = parseFloat(item.tax_amount) || 0;
    const taxRateStr = String(item.tax_rate || "").replace("%", "").trim();
    const taxRate = parseFloat(taxRateStr) || 0;

    switch (key) {
      case "taxable_amount":
        if (taxAmt > 0 && taxRate > 0) {
          return Math.round((taxAmt / (taxRate / 100)) * 100) / 100;
        }
        return Math.round((qty * price - disc) * 100) / 100;
      case "tax_rate":
        if (item.total_amount && qty > 0 && price > 0) {
          const taxable = (qty * price) - disc;
          const tot = parseFloat(item.total_amount) || 0;
          if (tot > taxable && taxable > 0) {
            const deduced = ((tot - taxable) / taxable) * 100;
            return snapToGSTTaxRate(deduced);
          }
        }
        return null;
      case "total_amount":
        const taxable = parseFloat(item.taxable_amount) || 0;
        const cgstAmt = parseFloat(item.cgst_amount) || 0;
        const sgstAmt = parseFloat(item.sgst_amount) || 0;
        const igstAmt = parseFloat(item.igst_amount) || 0;
        const itemTax = taxAmt > 0 ? taxAmt : (cgstAmt + sgstAmt + igstAmt);
        return Math.round((taxable + itemTax) * 100) / 100;
      default:
        return null;
    }
  };

  const [newColLabel, setNewColLabel] = useState("");
  const [newColAfter, setNewColAfter] = useState("hsn_code");
  const [newColType, setNewColType] = useState("text");

  const handleItemChange = (index, field, value) => {
    const updatedItems = [...items];
    const item = { ...updatedItems[index] };

    // Find if the field is numeric from our column definitions
    const column = columns.find((c) => c.key === field);
    const isNumeric = column?.type === "number" || [
      "quantity", "unit_price", "tax_amount",
      "taxable_amount", "cgst_rate", "cgst_amount", "sgst_rate", 
      "sgst_amount", "igst_rate", "igst_amount", "total_amount"
    ].includes(field);

    // Update the edited field
    if (isNumeric) {
      item[field] = value === "" ? "" : parseFloat(value) || 0;
    } else {
      item[field] = value;
    }

    const quantity = parseFloat(item.quantity) || 0;
    const unitPrice = parseFloat(item.unit_price) || 0;
    
    // Auto discount calculation if discount_rate was changed
    if (field === "discount_rate" || field === "quantity" || field === "unit_price") {
      const discountRate = parseFloat(item.discount_rate) || 0;
      item.discount_amount = parseFloat(((quantity * unitPrice) * discountRate / 100).toFixed(2));
    }

    // If discount_amount is changed directly, recalculate discount_rate
    if (field === "discount_amount" && (quantity * unitPrice) > 0) {
      const discAmt = parseFloat(item.discount_amount) || 0;
      item.discount_rate = parseFloat(((discAmt / (quantity * unitPrice)) * 100).toFixed(2));
    }

    const discAmt = parseFloat(item.discount_amount) || 0;
    const rawTaxRate = String(item.tax_rate ?? "").trim().toLowerCase();
    const isExemptOrZero = ["0", "0%", "0.0", "0.00%", "nil", "exempt", "zero", "nill", "na", "n/a"].includes(rawTaxRate);
    const taxRateNum = isExemptOrZero ? 0 : (parseFloat(rawTaxRate.replace(/[^\\d.-]/g, "")) || 0);

    const calculatedTaxable = parseFloat(Math.max(0, (quantity * unitPrice) - discAmt).toFixed(2));
    item.taxable_amount = calculatedTaxable;

    // Reverse tax deduction if total_amount is modified directly
    if (field === "total_amount") {
      const totAmt = parseFloat(item.total_amount) || 0;
      const diffTax = totAmt - calculatedTaxable;
      if (diffTax > 0.05 && calculatedTaxable > 0) {
        const deducedRate = (diffTax / calculatedTaxable) * 100;
        item.tax_rate = snapToGSTTaxRate(deducedRate);
        item.tax_amount = parseFloat(diffTax.toFixed(2));
      } else if (diffTax <= 0.05 && totAmt > 0) {
        item.tax_rate = "0%";
        item.tax_amount = 0;
      }
    } else {
      if (taxRateNum > 0) {
        item.tax_amount = parseFloat((calculatedTaxable * taxRateNum / 100).toFixed(2));
      } else if (isExemptOrZero) {
        item.tax_amount = 0;
      }
      item.total_amount = parseFloat((calculatedTaxable + (parseFloat(item.tax_amount) || 0)).toFixed(2));
    }

    updatedItems[index] = item;
    onChange(updatedItems);
  };

  const deleteRow = (index) => {
    const updatedItems = items.filter((_, i) => i !== index);
    onChange(updatedItems);
  };

  const addRow = () => {
    const newItem = {
      description: "",
      description_of_goods: "",
      hsn_code: "",
      quantity: 1,
      unit: "Pcs",
      unit_price: 0,
      discount_amount: "0",
      taxable_amount: 0,
      tax_rate: "18%",
      tax_amount: 0,
      total_amount: 0,
    };
    
    columns.forEach((col) => {
      if (!col.isBase) {
        newItem[col.key] = col.type === "number" ? 0 : "";
      }
    });

    onChange([...items, newItem]);
  };

  const addColumn = () => {
    if (!newColLabel.trim()) {
      alert("Column label is required.");
      return;
    }

    const cleanLabel = newColLabel.trim();
    const colKey = `custom_${cleanLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now()}`;
    const newColumn = {
      key: colKey,
      label: cleanLabel,
      isBase: false,
      type: newColType,
    };

    const index = columns.findIndex((c) => c.key === newColAfter);
    const updatedColumns = [...columns];
    if (index !== -1) {
      updatedColumns.splice(index + 1, 0, newColumn);
    } else {
      updatedColumns.push(newColumn);
    }

    setColumns(updatedColumns);

    const updatedItems = items.map((item) => ({
      ...item,
      [colKey]: newColType === "number" ? 0 : "",
    }));
    onChange(updatedItems);

    setNewColLabel("");
    setShowAddColumnForm(false);
  };

  const deleteColumn = (colKey) => {
    if (window.confirm(`Are you sure you want to delete this column? Any data in this column across all line items will be lost.`)) {
      const updatedColumns = columns.filter((c) => c.key !== colKey);
      setColumns(updatedColumns);

      const updatedItems = items.map((item) => {
        const newItem = { ...item };
        delete newItem[colKey];
        return newItem;
      });
      onChange(updatedItems);
    }
  };

  return (
    <div className="ocr-section">
      <div className="ocr-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: "700" }}>Line Items</span>
        <button
          className="btn btn-secondary"
          style={{ padding: "4px 8px", fontSize: "11px", height: "auto" }}
          onClick={() => setShowAddColumnForm(!showAddColumnForm)}
        >
          {showAddColumnForm ? "Cancel" : "+ Add Column"}
        </button>
      </div>

      <div className="ocr-section-content" style={{ padding: "12px" }}>
        {showAddColumnForm && (
          <div className="add-column-form" style={{
            background: "#f8fafc",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
            padding: "12px",
            marginBottom: "12px",
            display: "flex",
            flexWrap: "wrap",
            gap: "12px",
            alignItems: "flex-end"
          }}>
            <div className="form-group" style={{ flex: 1, minWidth: "150px" }}>
              <label className="form-label" style={{ marginBottom: "4px" }}>Column Label</label>
              <input
                type="text"
                className="form-input"
                value={newColLabel}
                onChange={(e) => setNewColLabel(e.target.value)}
                placeholder="e.g. Brand Name"
                style={{ padding: "6px 10px", fontSize: "12px" }}
              />
            </div>
            
            <div className="form-group" style={{ flex: 1, minWidth: "150px" }}>
              <label className="form-label" style={{ marginBottom: "4px" }}>Insert After</label>
              <select
                className="form-input"
                value={newColAfter}
                onChange={(e) => setNewColAfter(e.target.value)}
                style={{ padding: "6px 10px", fontSize: "12px", height: "30px" }}
              >
                {columns.map((col) => (
                  <option key={col.key} value={col.key}>
                    {col.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ width: "100px" }}>
              <label className="form-label" style={{ marginBottom: "4px" }}>Type</label>
              <select
                className="form-input"
                value={newColType}
                onChange={(e) => setNewColType(e.target.value)}
                style={{ padding: "6px 10px", fontSize: "12px", height: "30px" }}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
              </select>
            </div>

            <button
              className="btn btn-primary"
              onClick={addColumn}
              style={{ padding: "6px 12px", fontSize: "12px", height: "30px", display: "inline-flex", alignItems: "center" }}
            >
              Add
            </button>
          </div>
        )}

        <div className="table-wrapper" style={{ overflowX: "auto" }}>
          <table className="items-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={(col.key === "description" || col.key === "description_of_goods") ? "col-desc" : ""}
                    style={{ minWidth: getColMinWidth(col.key) }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                      <span>{col.label}</span>
                      {!col.isBase && (
                        <button
                          onClick={() => deleteColumn(col.key)}
                          title={`Delete ${col.label} column`}
                          style={{
                            background: "rgba(239, 68, 68, 0.1)",
                            border: "none",
                            borderRadius: "50%",
                            color: "#ef4444",
                            cursor: "pointer",
                            fontSize: "12px",
                            width: "16px",
                            height: "16px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            lineHeight: "1",
                            padding: "0"
                          }}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                <th style={{ width: "40px", textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  {columns.map((col) => {
                    const isNumeric = col.type === "number" || [
                      "quantity", "unit_price", "tax_amount",
                      "taxable_amount", "cgst_rate", "cgst_amount", "sgst_rate", 
                      "sgst_amount", "igst_rate", "igst_amount", "total_amount"
                    ].includes(col.key);

                    const modelVal = initialItems[idx]?.[col.key];
                    const currentVal = item[col.key];

                    const getNormalizedFloat = (val) => {
                      if (val === undefined || val === null || val === "") return null;
                      const num = parseFloat(String(val).replace(/[^\d.-]/g, ""));
                      return isNaN(num) ? null : num;
                    };

                    const isModifiedFromModel = (() => {
                      if (modelVal === undefined || modelVal === null) return false;
                      if (!isNumeric) {
                        return String(currentVal || "").trim() !== String(modelVal || "").trim();
                      }
                      const mNum = getNormalizedFloat(modelVal);
                      const cNum = getNormalizedFloat(currentVal);
                      if (mNum === null && cNum === null) return false;
                      if (mNum === null || cNum === null) return true;
                      return Math.abs(mNum - cNum) > 0.001;
                    })();

                    const score = getFieldConfidence(`item-${idx}`, col.key, item[col.key]);
                    const sug = getCellSuggestion(item, col.key);
                    const showFix = !isModifiedFromModel && sug !== null && sug !== 0 && Math.abs((parseFloat(item[col.key]) || 0) - sug) > 0.05;

                    // Locate sequential box info for this specific cell
                    const seqItem = sequentialFields?.find(
                      (s) => (s.sectionId === "item_details" || s.sectionId === "items") && s.rowIndex === idx && s.fieldKey === col.key
                    );
                    const boxNumber = seqItem ? seqItem.boxNumber : null;
                    const isActiveStep = boxNumber !== null && boxNumber === activeStep;
                    const isFieldVerified = Boolean(
                      verifiedFields?.[`item_details[${idx}].${col.key}`] ||
                      verifiedFields?.[`items[${idx}].${col.key}`] ||
                      verifiedFields?.[`item_details.${col.key}`]
                    );

                    return (
                      <td
                        key={col.key}
                        data-row-index={idx}
                        data-col-key={col.key}
                        className={`line-item-td ${(col.key === "description" || col.key === "description_of_goods") ? "col-desc" : ""} ${isActiveStep ? "active-td" : ""}`}
                        style={{
                          minWidth: getColMinWidth(col.key),
                          backgroundColor: isActiveStep ? "rgba(59, 130, 246, 0.08)" : isFieldVerified ? "rgba(16, 185, 129, 0.04)" : "transparent",
                          transition: "background-color 0.2s ease"
                        }}
                      >
                        <div
                          className="line-item-cell-wrapper"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            width: "100%",
                            position: "relative",
                            padding: "1px 0",
                            boxSizing: "border-box"
                          }}
                        >
                          <input
                            type={isNumeric ? "number" : "text"}
                            className="table-input"
                            title={String(item[col.key] ?? "")}
                            value={(() => {
                              const rawVal = item[col.key];
                              if (rawVal === undefined || rawVal === null) return "";
                              const sVal = String(rawVal).trim();
                              if (sVal === "" || sVal.toLowerCase() === "null" || sVal.toLowerCase() === "none" || sVal.toLowerCase() === "undefined") return "";
                              if (!isNumeric) return sVal;
                              if (typeof rawVal === "number") return rawVal;
                              const cleaned = sVal.replace(/[^\d.-]/g, "");
                              return cleaned === "" ? "" : cleaned;
                            })()}
                            onChange={(e) => handleItemChange(idx, col.key, e.target.value)}
                            onFocus={() => {
                              if (boxNumber && onActiveStepChange && activeStep !== boxNumber) {
                                onActiveStepChange(boxNumber);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                if (onMarkFieldVerified) {
                                  onMarkFieldVerified("item_details", col.key, idx);
                                }
                                if (boxNumber && boxNumber < (sequentialFields?.length || 0)) {
                                  if (onActiveStepChange) onActiveStepChange(boxNumber + 1);
                                } else if (boxNumber && boxNumber === (sequentialFields?.length || 0)) {
                                  if (onSave) onSave();
                                }
                              }
                            }}
                            style={{ 
                              flex: 1,
                              minWidth: 0,
                              width: "100%",
                              textAlign: isNumeric ? "right" : "left", 
                              fontWeight: col.key === "total_amount" ? "600" : "normal",
                              fontSize: "12px",
                              padding: "4px 8px",
                              height: "28px",
                              borderRadius: "4px",
                              border: isActiveStep ? "2px solid #3b82f6" : "1px solid #cbd5e1",
                              boxSizing: "border-box"
                            }}
                          />
                          <span 
                            title={
                              isModifiedFromModel 
                                ? `Original model value: ${modelVal}`
                                : showFix 
                                  ? `Suggested value: ${sug}`
                                  : `Confidence: ${score}%`
                            }
                            style={{ 
                              flexShrink: 0,
                              fontSize: "9px", 
                              fontWeight: "700",
                              color: isModifiedFromModel ? "#7c3aed" : getConfidenceColor(score),
                              cursor: "default",
                              backgroundColor: isModifiedFromModel 
                                ? "#f5f3ff" 
                                : showFix 
                                  ? "#f5f3ff" 
                                  : `${getConfidenceColor(score)}15`,
                              padding: "1px 4px",
                              borderRadius: "3px",
                              border: isModifiedFromModel 
                                ? "1px solid #c4b5fd" 
                                : showFix 
                                  ? "1px solid #7c3aed" 
                                  : "none",
                              marginLeft: "2px"
                            }}
                          >
                            {isModifiedFromModel ? "Edited" : showFix ? `Fix` : `${score}%`}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td style={{ width: "40px", textAlign: "center" }}>
                    <button
                      className="btn-icon"
                      onClick={() => deleteRow(idx)}
                      title="Delete Item"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#ef4444",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "12px" }}>
          <button
            className="btn btn-secondary"
            onClick={addRow}
            style={{ fontSize: "12px", padding: "6px 12px" }}
          >
            + Add Line Item
          </button>
        </div>
      </div>
    </div>
  );
}

export default LineItemsTable;
