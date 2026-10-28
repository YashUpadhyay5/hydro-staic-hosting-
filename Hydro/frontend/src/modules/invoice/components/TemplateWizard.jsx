import { useState, useEffect } from "react";
import API from "../services/api";

const FIELD_TYPES = [
  "Text", "Long Text", "Number", "Currency", "Percentage", "Date", "DateTime", "Time",
  "Email", "Phone", "GSTIN", "PAN", "IFSC", "MICR", "SWIFT", "Dropdown", "Multi Select",
  "Checkbox", "Radio", "Address", "URL", "QR Code", "Barcode", "Image", "Signature",
  "JSON", "Object", "Dynamic Table", "File Upload"
];

export default function TemplateWizard({ isOpen, files, onClose, onProcess, showToast }) {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [activeTab, setActiveTab] = useState("wizard"); // wizard, manage
  const [wizardStep, setWizardStep] = useState(1); // 1: Sections, 2: Fields Configuration
  const [expandedSection, setExpandedSection] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [searchFieldQuery, setSearchFieldQuery] = useState("");
  const [templateSearchQuery, setTemplateSearchQuery] = useState("");

  // New Custom Section Builder state
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionDesc, setNewSectionDesc] = useState("");

  // New Field Form States
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldType, setNewFieldType] = useState("Text");

  // New Item Table Column state
  const [newColLabel, setNewColLabel] = useState("");
  const [newColKey, setNewColKey] = useState("");
  const [newColType, setNewColType] = useState("Text");

  const loadTemplates = async () => {
    try {
      const res = await API.get("/templates");
      const list = Array.isArray(res.data) 
        ? res.data 
        : (res.data?.templates || res.data?.data || []);
      setTemplates(list);
      const def = list.find(t => t.is_default) || list[0];
      if (def) {
        setSelectedTemplate(JSON.parse(JSON.stringify(def)));
      }
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectTemplate = (tpl) => {
    setSelectedTemplate(JSON.parse(JSON.stringify(tpl)));
  };

  const handleToggleSection = (sectionId) => {
    if (!selectedTemplate) return;
    const updated = { ...selectedTemplate };
    updated.sections = updated.sections.map(s => {
      if (s.id === sectionId) return { ...s, enabled: !s.enabled };
      return s;
    });
    setSelectedTemplate(updated);
  };

  const handleFieldChange = (sectionId, fieldKey, key, value) => {
    const updated = { ...selectedTemplate };
    updated.sections = updated.sections.map(s => {
      if (s.id === sectionId) {
        return {
          ...s,
          fields: s.fields.map(f => {
            if (f.key === fieldKey) return { ...f, [key]: value };
            return f;
          })
        };
      }
      return s;
    });
    setSelectedTemplate(updated);
    if (editingField && editingField.sectionId === sectionId && editingField.field.key === fieldKey) {
      setEditingField({
        ...editingField,
        field: { ...editingField.field, [key]: value }
      });
    }
  };

  const handleAddField = (sectionId) => {
    if (!newFieldName.trim() || !newFieldKey.trim()) {
      showToast("Field name and internal key are required.", "error");
      return;
    }
    const updated = { ...selectedTemplate };
    const newField = {
      key: newFieldKey.trim(),
      label: newFieldName.trim(),
      type: newFieldType,
      required: false,
      editable: true,
      read_only: false,
      hidden: false,
      searchable: true,
      filterable: true,
      sortable: true,
      exportable: true,
      api_visible: true,
      dashboard_visible: true,
      confidence_threshold: 70,
      default_value: "",
      validation_rule: "",
      placeholder: `Enter ${newFieldName}`,
      tooltip: "",
      display_order: 10,
      ai_prompt: `Extract the ${newFieldName} value.`
    };
    updated.sections = updated.sections.map(s => {
      if (s.id === sectionId) {
        return { ...s, fields: [...s.fields, newField] };
      }
      return s;
    });
    setSelectedTemplate(updated);
    setNewFieldName("");
    setNewFieldKey("");
    showToast("✓ Custom field added to layout.");
  };

  const handleRemoveField = (sectionId, fieldKey) => {
    const updated = { ...selectedTemplate };
    updated.sections = updated.sections.map(s => {
      if (s.id === sectionId) {
        return { ...s, fields: s.fields.filter(f => f.key !== fieldKey) };
      }
      return s;
    });
    setSelectedTemplate(updated);
    if (editingField && editingField.field.key === fieldKey) {
      setEditingField(null);
    }
  };

  const handleAddCustomSection = () => {
    if (!newSectionName.trim()) return;
    const updated = { ...selectedTemplate };
    const secId = "custom_" + Date.now();
    const newSec = {
      id: secId,
      name: newSectionName,
      icon: "⚙️",
      description: newSectionDesc || "Custom configured section",
      enabled: true,
      fields: []
    };
    updated.sections = [...updated.sections, newSec];
    setSelectedTemplate(updated);
    setNewSectionName("");
    setNewSectionDesc("");
    showToast("✓ Custom section added successfully.");
  };

  const handleSaveTemplate = async () => {
    try {
      const res = await API.post("/templates", selectedTemplate);
      showToast("✓ Template layout saved successfully.");
      await loadTemplates();
      const updated = res.data;
      setSelectedTemplate(JSON.parse(JSON.stringify(updated)));
    } catch {
      showToast("Failed to save template layout.", "error");
    }
  };

  const handleCloneTemplate = async (tplId) => {
    try {
      await API.post(`/templates/${tplId}/clone`);
      showToast("✓ Template cloned successfully.");
      loadTemplates();
    } catch {
      showToast("Failed to clone template.", "error");
    }
  };

  const handleSetDefault = async (tplId) => {
    try {
      await API.post(`/templates/${tplId}/default`);
      showToast("✓ Default template updated.");
      loadTemplates();
    } catch {
      showToast("Failed to set default template.", "error");
    }
  };

  const handleDeleteTemplate = async (tplId) => {
    if (!window.confirm("Permanently delete this template configuration?")) return;
    try {
      await API.delete(`/templates/${tplId}`);
      showToast("✓ Template configuration deleted.");
      loadTemplates();
    } catch (e) {
      const msg = e.response?.data?.detail || "Delete failed.";
      showToast(msg, "error");
    }
  };

  const handleReorderField = (sectionId, index, direction) => {
    const updated = { ...selectedTemplate };
    updated.sections = updated.sections.map(s => {
      if (s.id === sectionId) {
        const fields = [...s.fields];
        if (direction === "up" && index > 0) {
          const temp = fields[index];
          fields[index] = fields[index - 1];
          fields[index - 1] = temp;
        } else if (direction === "down" && index < fields.length - 1) {
          const temp = fields[index];
          fields[index] = fields[index + 1];
          fields[index + 1] = temp;
        }
        return { ...s, fields };
      }
      return s;
    });
    setSelectedTemplate(updated);
  };

  const filteredTemplates = templates.filter(t => 
    t.name.toLowerCase().includes(templateSearchQuery.toLowerCase()) ||
    t.description.toLowerCase().includes(templateSearchQuery.toLowerCase())
  );

  return (
    <div className="wizard-overlay">
      <style>{`
        .wizard-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(15, 23, 42, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          padding: 24px;
        }
        .wizard-modal {
          background: #ffffff;
          color: #1f2937;
          width: 95%;
          max-width: 1200px;
          height: 85vh;
          border-radius: 12px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid #e5e7eb;
          font-family: var(--sans);
          animation: wizard-pop 0.2s ease-out;
        }
        @keyframes wizard-pop {
          from { transform: scale(0.98); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        [data-theme='dark'] .wizard-modal {
          background: #16171d;
          color: #f3f4f6;
          border-color: #2e303a;
        }
        .wizard-scroll::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .wizard-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .wizard-scroll::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 3px;
        }
        [data-theme='dark'] .wizard-scroll::-webkit-scrollbar-thumb {
          background: #4b5563;
        }
        .wizard-scroll::-webkit-scrollbar-thumb:hover {
          background: #aa3bff;
        }
        .section-card {
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #374151;
          border-radius: 8px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.15s ease-in-out;
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        [data-theme='dark'] .section-card {
          border-color: #2e303a;
          background: #1f2028;
          color: #e5e7eb;
        }
        .section-card:hover {
          border-color: #aa3bff;
          background: #f9fafb;
        }
        [data-theme='dark'] .section-card:hover {
          background: #232530;
        }
        .section-card.active {
          border-color: #aa3bff;
          border-width: 2px;
          background: rgba(170, 59, 255, 0.05);
          padding: 15px; /* Offset border width */
        }
        [data-theme='dark'] .section-card.active {
          border-color: #c084fc;
          background: rgba(192, 132, 252, 0.08);
        }
        .btn-wizard-tab {
          padding: 14px 20px;
          border: none;
          background: transparent;
          color: #4b5563;
          border-bottom: 2px solid transparent;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        [data-theme='dark'] .btn-wizard-tab {
          color: #9ca3af;
        }
        .btn-wizard-tab:hover {
          color: #aa3bff;
        }
        [data-theme='dark'] .btn-wizard-tab:hover {
          color: #c084fc;
        }
        .btn-wizard-tab.active {
          color: #aa3bff;
          border-bottom-color: #aa3bff;
        }
        [data-theme='dark'] .btn-wizard-tab.active {
          color: #c084fc;
          border-bottom-color: #c084fc;
        }
        .collapsible-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          color: var(--text-h);
        }
        [data-theme='dark'] .collapsible-header {
          background: #1f2028;
          border-color: #2e303a;
        }
      `}</style>
      <div className="wizard-modal">
        {/* Header */}
        <div className="wizard-header" style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--bg)"
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "20px", color: "var(--text-h)" }}>Configure OCR Extraction</h2>
            <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--text)" }}>
              Step {wizardStep} of 2 — Choose template layout properties and validation rule schemas.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: "6px 12px", borderRadius: "6px" }}>×</button>
        </div>

        {/* Tab Selector */}
        <div style={{ display: "flex", padding: "0 24px", borderBottom: "1px solid var(--border)", gap: "20px" }}>
          <button
            onClick={() => { setActiveTab("wizard"); setWizardStep(1); }}
            className={`btn-wizard-tab ${activeTab === "wizard" ? "active" : ""}`}
          >
            Extraction Wizard
          </button>
          <button
            onClick={() => setActiveTab("manage")}
            className={`btn-wizard-tab ${activeTab === "manage" ? "active" : ""}`}
          >
            Template Manager
          </button>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
          {activeTab === "wizard" ? (
            <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
              {/* Wizard Left Section */}
              <div className="wizard-scroll" style={{ flex: 1, padding: "24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px", borderRight: "1px solid var(--border)" }}>
                {/* Step 1: Configure OCR Extraction (Sections Selection) */}
                {wizardStep === 1 && (
                  <>
                    <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: "200px" }}>
                        <label style={{ fontSize: "12px", fontWeight: "600", display: "block", marginBottom: "4px" }}>Search Template:</label>
                        <input
                          type="text"
                          placeholder="Search templates..."
                          value={templateSearchQuery}
                          onChange={(e) => setTemplateSearchQuery(e.target.value)}
                          style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "12px", fontWeight: "600", display: "block", marginBottom: "4px" }}>Active Layout:</label>
                        <select
                          style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", minWidth: "220px" }}
                          value={selectedTemplate?.id || ""}
                          onChange={(e) => {
                            const t = templates.find(tpl => tpl.id === e.target.value);
                            if (t) handleSelectTemplate(t);
                          }}
                        >
                          {filteredTemplates.map(t => (
                            <option key={t.id} value={t.id}>{t.name} {t.is_default ? "(Default)" : ""}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                      gap: "16px"
                    }}>
                      {selectedTemplate?.sections.map(sec => {
                        const isEnabled = sec.enabled;
                        return (
                          <div
                            key={sec.id}
                            onClick={() => handleToggleSection(sec.id)}
                            className={`section-card ${isEnabled ? "active" : ""}`}
                          >
                            <span style={{ fontSize: "24px" }}>{sec.icon || "⚙️"}</span>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontWeight: "700", fontSize: "14px", color: "var(--text-h)" }}>{sec.name}</span>
                              <span style={{ fontSize: "11px", color: "var(--text)", lineHeight: "1.3" }}>{sec.description}</span>
                              <span style={{ fontSize: "10px", color: "var(--accent)", fontWeight: "600", marginTop: "4px" }}>{sec.fields.length} Fields</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => {}}
                              style={{ marginLeft: "auto", pointerEvents: "none" }}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* Custom Section Builder */}
                    <div style={{ marginTop: "24px", border: "1px dashed var(--border)", borderRadius: "8px", padding: "16px" }}>
                      <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: "700" }}>🔨 Add Custom Section</h4>
                      <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
                        <input
                          type="text"
                          placeholder="Section Name (e.g. Warranty Details)"
                          value={newSectionName}
                          onChange={(e) => setNewSectionName(e.target.value)}
                          style={{ flex: 1, padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "13px" }}
                        />
                        <input
                          type="text"
                          placeholder="Description"
                          value={newSectionDesc}
                          onChange={(e) => setNewSectionDesc(e.target.value)}
                          style={{ flex: 1, padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "13px" }}
                        />
                      </div>
                      <button
                        className="btn btn-secondary"
                        onClick={handleAddCustomSection}
                        style={{ fontSize: "12px", padding: "6px 12px" }}
                      >
                        + Add Custom Section
                      </button>
                    </div>
                  </>
                )}

                {/* Step 2: Configure Fields ( collapsible field designer panel ) */}
                {wizardStep === 2 && selectedTemplate && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>Configure Fields by Section</h3>
                      <input
                        type="text"
                        placeholder="🔍 Search fields..."
                        value={searchFieldQuery}
                        onChange={(e) => setSearchFieldQuery(e.target.value)}
                        style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "12px", width: "200px" }}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {selectedTemplate.sections
                        .filter(s => s.enabled)
                        .map(sec => {
                          const isExpanded = expandedSection === sec.id;
                          const filteredFields = sec.fields.filter(f => 
                            f.label.toLowerCase().includes(searchFieldQuery.toLowerCase()) ||
                            f.key.toLowerCase().includes(searchFieldQuery.toLowerCase())
                          );

                          return (
                            <div key={sec.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                              <div
                                onClick={() => setExpandedSection(isExpanded ? null : sec.id)}
                                className="collapsible-header"
                              >
                                <span>{sec.icon || "⚙️"} {sec.name} ({sec.fields.length} configured fields)</span>
                                <span>{isExpanded ? "▲" : "▼"}</span>
                              </div>

                              {isExpanded && (
                                <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "16px", background: "var(--bg)" }}>
                                  {/* Add field Form */}
                                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", paddingBottom: "16px", borderBottom: "1px solid var(--border)", marginBottom: "16px" }}>
                                    <div style={{ flex: 1 }}>
                                      <label style={{ fontSize: "11px", fontWeight: "600", display: "block", marginBottom: "2px" }}>Field Name:</label>
                                      <input type="text" value={newFieldName} onChange={e => setNewFieldName(e.target.value)} placeholder="e.g. Sales Region" style={{ width: "100%", padding: "6px 10px", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <label style={{ fontSize: "11px", fontWeight: "600", display: "block", marginBottom: "2px" }}>Internal Key:</label>
                                      <input type="text" value={newFieldKey} onChange={e => setNewFieldKey(e.target.value)} placeholder="e.g. sales_region" style={{ width: "100%", padding: "6px 10px", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }} />
                                    </div>
                                    <div>
                                      <label style={{ fontSize: "11px", fontWeight: "600", display: "block", marginBottom: "2px" }}>Type:</label>
                                      <select value={newFieldType} onChange={e => setNewFieldType(e.target.value)} style={{ padding: "6px 10px", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}>
                                        {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                    </div>
                                    <button onClick={() => handleAddField(sec.id)} className="btn btn-primary" style={{ padding: "6px 12px", fontSize: "12px" }}>+ Add Field</button>
                                  </div>

                                  {/* Fields table */}
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                    <thead>
                                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                        <th style={{ padding: "6px", textAlign: "left" }}>Display Label</th>
                                        <th style={{ padding: "6px", textAlign: "left" }}>Type</th>
                                        <th style={{ padding: "6px", textAlign: "center" }}>Required</th>
                                        <th style={{ padding: "6px", textAlign: "center" }}>Hidden</th>
                                        <th style={{ padding: "6px", textAlign: "right" }}>Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {filteredFields.map((f, index) => (
                                        <tr key={f.key} style={{ borderBottom: "1px solid var(--border)" }}>
                                          <td style={{ padding: "6px" }}>
                                            <input
                                              type="text"
                                              value={f.label}
                                              onChange={(e) => handleFieldChange(sec.id, f.key, "label", e.target.value)}
                                              style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px", fontSize: "12px", width: "90%", background: "var(--bg)", color: "var(--text)" }}
                                            />
                                          </td>
                                          <td style={{ padding: "6px" }}>
                                            <select
                                              value={f.type}
                                              onChange={(e) => handleFieldChange(sec.id, f.key, "type", e.target.value)}
                                              style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px", fontSize: "11px", background: "var(--bg)", color: "var(--text)" }}
                                            >
                                              {FIELD_TYPES.map(t => (
                                                <option key={t} value={t}>{t}</option>
                                              ))}
                                            </select>
                                          </td>
                                          <td style={{ padding: "6px", textAlign: "center" }}>
                                            <input
                                              type="checkbox"
                                              checked={f.required}
                                              onChange={(e) => handleFieldChange(sec.id, f.key, "required", e.target.checked)}
                                            />
                                          </td>
                                          <td style={{ padding: "6px", textAlign: "center" }}>
                                            <input
                                              type="checkbox"
                                              checked={f.hidden}
                                              onChange={(e) => handleFieldChange(sec.id, f.key, "hidden", e.target.checked)}
                                            />
                                          </td>
                                          <td style={{ padding: "6px", textAlign: "right" }}>
                                            <div style={{ display: "inline-flex", gap: "4px" }}>
                                              <button onClick={() => handleReorderField(sec.id, index, "up")} style={{ padding: "2px 4px", fontSize: "10px", cursor: "pointer" }}>▲</button>
                                              <button onClick={() => handleReorderField(sec.id, index, "down")} style={{ padding: "2px 4px", fontSize: "10px", cursor: "pointer" }}>▼</button>
                                              <button
                                                onClick={() => setEditingField({ sectionId: sec.id, field: f })}
                                                style={{ padding: "2px 6px", fontSize: "10px", color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: "4px", background: "transparent", cursor: "pointer" }}
                                              >
                                                Configure
                                              </button>
                                              <button
                                                onClick={() => handleRemoveField(sec.id, f.key)}
                                                style={{ padding: "2px 6px", fontSize: "10px", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: "4px", background: "transparent", cursor: "pointer" }}
                                              >
                                                Delete
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* Wizard Right Preview / Config Details Section */}
              <div className="wizard-scroll" style={{ width: "38%", padding: "24px", background: "var(--code-bg)", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" }}>
                {editingField ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "700" }}>⚙️ Field Properties</h4>
                      <button className="btn btn-secondary" onClick={() => setEditingField(null)} style={{ fontSize: "10px", padding: "2px 6px" }}>Close</button>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px", fontSize: "12px" }}>
                      <div>
                        <label style={{ fontWeight: "600", display: "block", marginBottom: "4px" }}>Display Label:</label>
                        <input
                          type="text"
                          value={editingField.field.label}
                          onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "label", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--bg)", color: "var(--text)" }}
                        />
                      </div>
                      <div>
                        <label style={{ fontWeight: "600", display: "block", marginBottom: "4px" }}>Internal Key (JSON key):</label>
                        <input
                          type="text"
                          value={editingField.field.key}
                          onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "key", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--bg)", color: "var(--text)" }}
                        />
                      </div>
                      <div>
                        <label style={{ fontWeight: "600", display: "block", marginBottom: "4px" }}>AI Prompt / Extraction Instruction:</label>
                        <textarea
                          rows="3"
                          value={editingField.field.ai_prompt}
                          onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "ai_prompt", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--bg)", color: "var(--text)", fontFamily: "sans-serif" }}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={{ fontWeight: "600", display: "block", marginBottom: "4px" }}>Field Type:</label>
                          <select
                            value={editingField.field.type}
                            onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "type", e.target.value)}
                            style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--bg)", color: "var(--text)" }}
                          >
                            {FIELD_TYPES.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontWeight: "600", display: "block", marginBottom: "4px" }}>Confidence Threshold (%):</label>
                          <input
                            type="number"
                            value={editingField.field.confidence_threshold}
                            onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "confidence_threshold", parseInt(e.target.value) || 70)}
                            style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--bg)", color: "var(--text)" }}
                          />
                        </div>
                      </div>
                      <div>
                        <label style={{ fontWeight: "600", display: "block", marginBottom: "4px" }}>Validation Regex Rule:</label>
                        <input
                          type="text"
                          value={editingField.field.validation_rule || ""}
                          placeholder="e.g. ^[0-9]{2}[A-Z]{5}..."
                          onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "validation_rule", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--bg)", color: "var(--text)" }}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "4px" }}>
                        <label><input type="checkbox" checked={editingField.field.required} onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "required", e.target.checked)} /> Required</label>
                        <label><input type="checkbox" checked={editingField.field.editable} onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "editable", e.target.checked)} /> Editable</label>
                        <label><input type="checkbox" checked={editingField.field.hidden} onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "hidden", e.target.checked)} /> Hidden</label>
                        <label><input type="checkbox" checked={editingField.field.searchable} onChange={(e) => handleFieldChange(editingField.sectionId, editingField.field.key, "searchable", e.target.checked)} /> Searchable</label>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h4 style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: "700" }}>🖥️ Dynamic Form Preview</h4>
                    <p style={{ fontSize: "11px", color: "var(--text)", marginBottom: "16px" }}>This displays a live representation of the dynamic validation screen.</p>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)" }}>
                      {selectedTemplate?.sections
                        .filter(s => s.enabled)
                        .map(sec => (
                          <div key={sec.id} style={{ border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden", fontSize: "11px" }}>
                            <div style={{ background: "var(--accent-bg)", padding: "6px 10px", fontWeight: "600", color: "var(--text-h)" }}>
                              {sec.icon} {sec.name}
                            </div>
                            <div style={{ padding: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                              {sec.fields.filter(f => !f.hidden).map(f => (
                                <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                  <span style={{ fontWeight: "600", color: "var(--text-h)" }}>{f.label}{f.required && <span style={{ color: "#b91c1c" }}> *</span>}</span>
                                  <input
                                    type="text"
                                    placeholder={f.placeholder || f.label}
                                    disabled={f.read_only}
                                    style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px", fontSize: "10px", background: "var(--bg)", color: "var(--text)" }}
                                  />
                                </div>
                              ))}
                              {sec.fields.filter(f => !f.hidden).length === 0 && (
                                <span style={{ color: "var(--text)", gridColumn: "span 2", fontStyle: "italic" }}>No visible fields configured.</span>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Template Management tab */
            <div style={{ flex: 1, padding: "24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>Manage Extraction Templates</h3>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    const name = window.prompt("Enter new template name:");
                    if (!name) return;
                    const baseSections = selectedTemplate ? selectedTemplate.sections : (templates[0] ? templates[0].sections : []);
                    try {
                      await API.post("/templates", {
                        name,
                        description: "Custom template configured from dashboard.",
                        sections: JSON.parse(JSON.stringify(baseSections))
                      });
                      showToast("✓ Template created.");
                      loadTemplates();
                    } catch {
                      showToast("Failed to create template.", "error");
                    }
                  }}
                  style={{ padding: "6px 12px", fontSize: "13px" }}
                >
                  + Create New Template
                </button>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--border)" }}>
                      <th style={{ padding: "10px" }}>Template Name</th>
                      <th style={{ padding: "10px" }}>Description</th>
                      <th style={{ padding: "10px" }}>Default</th>
                      <th style={{ padding: "10px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map(tpl => (
                      <tr key={tpl.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "12px 10px", fontWeight: "600", color: "var(--text-h)" }}>{tpl.name}</td>
                        <td style={{ padding: "12px 10px", color: "var(--text)" }}>{tpl.description}</td>
                        <td style={{ padding: "12px 10px" }}>
                          {tpl.is_default ? (
                            <span style={{ background: "var(--accent-bg)", color: "var(--accent)", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "600" }}>Default</span>
                          ) : (
                            <button
                              onClick={() => handleSetDefault(tpl.id)}
                              style={{ padding: "2px 6px", fontSize: "11px", border: "1px solid var(--border)", borderRadius: "4px", background: "transparent", cursor: "pointer", color: "var(--text)" }}
                            >
                              Set Default
                            </button>
                          )}
                        </td>
                        <td style={{ padding: "12px 10px", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "8px" }}>
                            <button
                              onClick={() => { handleSelectTemplate(tpl); setActiveTab("wizard"); setWizardStep(1); }}
                              style={{ padding: "4px 8px", fontSize: "11px", border: "1px solid var(--accent)", color: "var(--accent)", background: "transparent", borderRadius: "4px", cursor: "pointer" }}
                            >
                              Edit Layout
                            </button>
                            <button
                              onClick={() => handleCloneTemplate(tpl.id)}
                              style={{ padding: "4px 8px", fontSize: "11px", border: "1px solid var(--border)", color: "var(--text)", background: "transparent", borderRadius: "4px", cursor: "pointer" }}
                            >
                              Clone
                            </button>
                            <button
                              onClick={() => handleDeleteTemplate(tpl.id)}
                              disabled={tpl.is_default}
                              style={{ padding: "4px 8px", fontSize: "11px", border: "1px solid #fecaca", color: "#b91c1c", background: "transparent", borderRadius: "4px", cursor: "pointer", opacity: tpl.is_default ? 0.5 : 1 }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer / Action Bar */}
        <div className="wizard-footer" style={{
          padding: "16px 24px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--bg)"
        }}>
          {activeTab === "wizard" ? (
            <>
              {wizardStep === 1 ? (
                <>
                  <span style={{ fontSize: "12px", color: "var(--text)" }}>Step 1: Select sections to extract</span>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-secondary" onClick={() => setWizardStep(2)}>Configure Fields →</button>
                    <button
                      className="btn btn-primary"
                      onClick={async () => {
                        if (selectedTemplate) {
                          await handleSaveTemplate();
                          onProcess(selectedTemplate.id);
                        }
                      }}
                    >
                      🚀 Run OCR Extraction
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button className="btn btn-secondary" onClick={() => setWizardStep(1)}>← Back</button>
                    <button className="btn btn-secondary" onClick={handleSaveTemplate}>Save Template Layout</button>
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button
                      className="btn btn-primary"
                      onClick={async () => {
                        if (selectedTemplate) {
                          await handleSaveTemplate();
                          onProcess(selectedTemplate.id);
                        }
                      }}
                    >
                      🚀 Run OCR Extraction
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <span>Template Settings Management</span>
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
