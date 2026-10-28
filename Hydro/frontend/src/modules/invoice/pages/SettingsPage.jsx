import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import API from "../services/api";
import TemplateWizard from "../components/TemplateWizard";

export default function SettingsPage() {
  const { documents, loadDocuments, showToast } = useOutletContext();
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [apiUrl, setApiUrl] = useState(`http://${window.location.hostname}:8000`);
  const [pollInterval, setPollInterval] = useState(5);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [exportFormat, setExportFormat] = useState("excel");
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleClearAll = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      return;
    }
    setClearing(true);
    try {
      await API.delete("/documents");
      showToast("✓ All documents and inventory records cleared.");
      loadDocuments();
      setClearConfirm(false);
    } catch {
      showToast("Failed to clear data.", "error");
    } finally {
      setClearing(false);
    }
  };

  const total = documents.length;
  const archived = documents.filter(d => d.status === "ARCHIVED").length;
  const failed = documents.filter(d => d.status === "FAILED").length;
  const pending = documents.filter(d => d.status === "PENDING_VALIDATION").length;

  return (
    <div className="page-settings">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure your OCR Portal preferences and data</p>
        </div>
      </div>

      <div className="settings-layout">
        {/* Left Column */}
        <div className="settings-main">
          {/* API Configuration */}
          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-icon" style={{ background: "#4f46e510", color: "#4f46e5" }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
                </svg>
              </div>
              <div>
                <h3>API Configuration</h3>
                <p>Backend connection settings</p>
              </div>
            </div>
            <div className="settings-fields">
              <div className="settings-field">
                <label>Backend API URL</label>
                <input type="text" value={apiUrl} onChange={e => setApiUrl(e.target.value)} className="settings-input" />
                <span className="settings-hint">The base URL of your FastAPI backend server</span>
              </div>
              <div className="settings-field">
                <label>Poll Interval (seconds)</label>
                <input type="number" min="2" max="60" value={pollInterval} onChange={e => setPollInterval(parseInt(e.target.value))} className="settings-input" style={{ maxWidth: "120px" }} />
                <span className="settings-hint">How often the dashboard polls for document updates</span>
              </div>
              <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => showToast("Settings saved (reload to apply).")}>
                Save API Settings
              </button>
            </div>
          </div>

          {/* Workflow Preferences */}
          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-icon" style={{ background: "#10b98110", color: "#10b981" }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
              </div>
              <div>
                <h3>Workflow Preferences</h3>
                <p>Customize validation behavior</p>
              </div>
            </div>
            <div className="settings-fields">
              <div className="settings-toggle-row">
                <div>
                  <strong>Auto-advance after save</strong>
                  <p>Automatically move to the next pending invoice after saving</p>
                </div>
                <button
                  className={`toggle-btn ${autoAdvance ? "on" : "off"}`}
                  onClick={() => setAutoAdvance(v => !v)}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="settings-toggle-row">
                <div>
                  <strong>Verification timer</strong>
                  <p>Track time spent verifying each invoice</p>
                </div>
                <button
                  className={`toggle-btn ${timerEnabled ? "on" : "off"}`}
                  onClick={() => setTimerEnabled(v => !v)}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="settings-field">
                <label>Default Export Format</label>
                <select className="settings-input" value={exportFormat} onChange={e => setExportFormat(e.target.value)} style={{ maxWidth: "200px" }}>
                  <option value="excel">Excel (.xlsx)</option>
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF Report</option>
                </select>
              </div>
            </div>
          </div>

          {/* Template Configuration */}
          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-icon" style={{ background: "#8b5cf610", color: "#8b5cf6" }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div>
                <h3>Extraction Templates</h3>
                <p>Manage extraction sections, prompts, and field rules</p>
              </div>
            </div>
            <div className="settings-fields">
              <span className="settings-hint">Create, edit, clone or version dynamic templates for document parsing.</span>
              <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => setWizardOpen(true)}>
                Manage Templates
              </button>
            </div>
          </div>

          {/* Data Management */}
          <div className="settings-card danger-zone">
            <div className="settings-card-header">
              <div className="settings-card-icon" style={{ background: "#ef444410", color: "#ef4444" }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </div>
              <div>
                <h3>Danger Zone</h3>
                <p>Irreversible data operations</p>
              </div>
            </div>
            <div className="settings-fields">
              <div className="danger-warning">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>This will permanently delete all documents, OCR results, and inventory records. This action <strong>cannot be undone</strong>.</span>
              </div>
              {clearConfirm ? (
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Are you absolutely sure?</span>
                  <button className="btn btn-danger" onClick={handleClearAll} disabled={clearing}>
                    {clearing ? "Clearing..." : "Yes, delete everything"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setClearConfirm(false)}>Cancel</button>
                </div>
              ) : (
                <button className="btn btn-danger" onClick={handleClearAll}>
                  Clear All Data
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: System Info */}
        <div className="settings-sidebar">
          <div className="settings-card">
            <div className="settings-card-header" style={{ marginBottom: "16px" }}>
              <div className="settings-card-icon" style={{ background: "#0891b210", color: "#0891b2" }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </div>
              <div>
                <h3>System Status</h3>
                <p>Current database state</p>
              </div>
            </div>
            <div className="system-stats">
              {[
                { label: "Total Documents", value: total, color: "#4f46e5" },
                { label: "Archived", value: archived, color: "#10b981" },
                { label: "Pending Validation", value: pending, color: "#f59e0b" },
                { label: "Failed", value: failed, color: "#ef4444" },
              ].map(item => (
                <div key={item.label} className="system-stat-row">
                  <span className="system-stat-dot" style={{ background: item.color }} />
                  <span className="system-stat-label">{item.label}</span>
                  <span className="system-stat-value" style={{ color: item.color }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header" style={{ marginBottom: "16px" }}>
              <div className="settings-card-icon" style={{ background: "#8b5cf610", color: "#8b5cf6" }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <div>
                <h3>About</h3>
                <p>System information</p>
              </div>
            </div>
            <div className="about-list">
              {[
                ["Version", "2.0.0"],
                ["Stack", "React + FastAPI"],
                ["OCR Engine", "RunPod / AI Vision"],
                ["Database", "PostgreSQL / SQLite"],
                ["Export", "Excel / PDF"],
              ].map(([k, v]) => (
                <div key={k} className="about-row">
                  <span className="about-key">{k}</span>
                  <span className="about-val">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="settings-card">
            <h3 style={{ marginBottom: "12px", fontSize: "14px", fontWeight: "600" }}>Quick Actions</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start", gap: "8px" }} onClick={() => window.open(`http://${window.location.hostname}:8000/api/export/excel`, "_blank")}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download Excel Report
              </button>
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start", gap: "8px" }} onClick={() => window.open(`http://${window.location.hostname}:8000/docs`, "_blank")}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                API Documentation
              </button>
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start", gap: "8px" }} onClick={() => window.location.reload()}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Reload Application
              </button>
            </div>
          </div>
        </div>
      </div>
      <TemplateWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        showToast={showToast}
      />
    </div>
  );
}
