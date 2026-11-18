import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import API from "../services/api";
import ExcelDateRangeModal from "../components/ExcelDateRangeModal";
import { downloadInvoiceFile } from "../utils/constants";

const getDocDetails = (doc) => {
  if (!doc) return { vendorName: "Unknown Vendor", invoiceNo: "N/A", invoiceDate: "N/A", grandTotal: 0 };
  const ext = doc.final_extraction || doc.ocr_result?.extraction || {};
  
  let vendorName = ext.vendor_details?.name || "";
  let invoiceNo = ext.invoice_details?.invoice_number || "";
  let invoiceDate = ext.invoice_details?.invoice_date || "";
  
  if (!vendorName || vendorName === "Unknown Vendor" || vendorName === "N/A") {
    if (doc.filename) {
      const parts = doc.filename.split(" - ");
      if (parts.length >= 2) {
        vendorName = parts[0].trim();
        if (!invoiceNo || invoiceNo === "N/A") {
          invoiceNo = parts.slice(1).join(" - ").trim();
        }
      } else {
        vendorName = doc.filename.trim();
      }
    }
  }
  
  if (!vendorName) vendorName = "Unknown Vendor";
  if (!invoiceNo) invoiceNo = "N/A";
  
  if (!invoiceDate || invoiceDate === "N/A") {
    if (doc.created_at) {
      try {
        invoiceDate = doc.created_at.split("T")[0];
      } catch (e) {
        invoiceDate = "N/A";
      }
    }
  }

  const grandTotal = parseFloat(doc.grand_total) || parseFloat(ext.tax_summary?.grand_total) || 0;

  return {
    vendorName,
    invoiceNo,
    invoiceDate,
    grandTotal
  };
};

export default function ArchivePage() {
  const { showToast } = useOutletContext();
  const [archived, setArchived] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [filterDate, setFilterDate] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [auditLog, setAuditLog] = useState(null);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [dynamicFilters, setDynamicFilters] = useState({});
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);

  const loadTemplates = async () => {
    try {
      const res = await API.get("/templates");
      const def = res.data.find(t => t.is_default) || res.data[0];
      if (def) setActiveTemplate(def);
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  };

  const loadArchived = async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const res = await API.get("/documents");
      const docs = (res.data || []).filter(d => d.status === "ARCHIVED");
      setArchived(docs);
    } catch (e) {
      console.error("Failed to load archive:", e);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
    loadArchived(true);
  }, []);

  const handleRestore = async (doc) => {
    if (!window.confirm(`Restore "${doc.filename}" to Pending Validation?`)) return;
    try {
      await API.post(`/documents/${doc.document_id}/retry`);
      showToast(`✓ Invoice "${doc.filename}" restored to validation queue.`);
      loadArchived();
      if (selectedDoc?.document_id === doc.document_id) setSelectedDoc(null);
    } catch (e) {
      showToast("Failed to restore invoice.", "error");
    }
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`Permanently delete "${doc.filename}"? This cannot be undone.`)) return;
    try {
      await API.delete(`/documents/${doc.document_id}`);
      showToast(`Invoice "${doc.filename}" deleted from archive.`);
      loadArchived();
      if (selectedDoc?.document_id === doc.document_id) setSelectedDoc(null);
    } catch {
      showToast("Failed to delete invoice.", "error");
    }
  };

  const handleDownload = async (doc) => {
    showToast(`Downloading "${doc.filename}"...`);
    await downloadInvoiceFile(doc);
  };

  const handlePrint = (doc) => {
    const token = localStorage.getItem("token") || "";
    window.open(`/api/documents/${doc.document_id}/file?token=${token}`, "_blank");
  };

  const handleSelectDoc = async (doc) => {
    const isSelected = selectedDoc?.document_id === doc.document_id;
    if (isSelected) {
      setSelectedDoc(null);
      return;
    }
    // Set clicked doc immediately to prevent stale details mismatch
    setSelectedDoc(doc);
    try {
      const res = await API.get(`/documents/${doc.document_id}`);
      setSelectedDoc(res.data);
    } catch (e) {
      console.error("Failed to fetch document details, falling back:", e);
      setSelectedDoc(doc);
    }
  };

  const handleViewAudit = (doc) => {
    const activeDoc = selectedDoc?.document_id === doc.document_id ? selectedDoc : doc;
    const ext = activeDoc.final_extraction || activeDoc.ocr_result?.extraction || {};
    const fallbackDetails = getDocDetails(activeDoc);
    
    setAuditLog({
      doc_id: activeDoc.document_id,
      filename: activeDoc.filename,
      status: activeDoc.status,
      saved: activeDoc.saved,
      verification_time: activeDoc.verification_time,
      added_by: ext.added_by || "System Agent",
      location: ext.location || "N/A",
      scheme_name: ext.scheme_name || "All Scheme",
      msid: ext.msid || "N/A",
      grand_total: fallbackDetails.grandTotal,
      vendor: fallbackDetails.vendorName,
      invoice_number: fallbackDetails.invoiceNo,
      invoice_date: fallbackDetails.invoiceDate,
    });
  };

  // Filter and sort
  const filtered = archived
    .filter(doc => {
      const ext = doc.final_extraction || doc.ocr_result?.extraction || {};
      const { vendorName, invoiceNo } = getDocDetails(doc);
      
      const query = searchQuery.toLowerCase();
      let matchSearch = !query ||
        doc.filename?.toLowerCase().includes(query) ||
        vendorName.toLowerCase().includes(query) ||
        invoiceNo.toLowerCase().includes(query) ||
        doc.document_id?.toLowerCase().includes(query);
        
      if (query && activeTemplate) {
        let foundInSearchable = false;
        activeTemplate.sections.forEach(sec => {
          if (!sec.enabled) return;
          sec.fields.forEach(f => {
            if (f.searchable) {
              const val = ext[sec.id]?.[f.key];
              if (val && String(val).toLowerCase().includes(query)) {
                foundInSearchable = true;
              }
            }
          });
        });
        matchSearch = matchSearch || foundInSearchable;
      }

      const matchDate = !filterDate || doc.created_at?.startsWith(filterDate);

      let matchDynamicFilters = true;
      Object.keys(dynamicFilters).forEach(filterKey => {
        const filterVal = dynamicFilters[filterKey];
        if (!filterVal) return;
        
        let val = null;
        if (activeTemplate) {
          activeTemplate.sections.forEach(sec => {
            if (sec.enabled) {
              sec.fields.forEach(f => {
                if (f.key === filterKey) {
                  val = ext[sec.id]?.[f.key];
                }
              });
            }
          });
        }
        
        if (val === null || val === undefined || !String(val).toLowerCase().includes(filterVal.toLowerCase())) {
          matchDynamicFilters = false;
        }
      });

      return matchSearch && matchDate && matchDynamicFilters;
    })
    .sort((a, b) => {
      const detailsA = getDocDetails(a);
      const detailsB = getDocDetails(b);
      
      if (activeTemplate && !["date_desc", "date_asc", "amount_desc", "vendor_asc"].includes(sortBy)) {
        let secId = null;
        activeTemplate.sections.forEach(sec => {
          if (sec.enabled && sec.fields.some(f => f.key === sortBy)) {
            secId = sec.id;
          }
        });
        if (secId) {
          const extA = a.final_extraction || a.ocr_result?.extraction || {};
          const extB = b.final_extraction || b.ocr_result?.extraction || {};
          const valA = extA[secId]?.[sortBy] ?? "";
          const valB = extB[secId]?.[sortBy] ?? "";
          
          const numA = parseFloat(valA);
          const numB = parseFloat(valB);
          if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
          }
          return String(valA).localeCompare(String(valB));
        }
      }
      
      if (sortBy === "date_desc") return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      if (sortBy === "date_asc") return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (sortBy === "amount_desc") return detailsB.grandTotal - detailsA.grandTotal;
      if (sortBy === "vendor_asc") return detailsA.vendorName.localeCompare(detailsB.vendorName);
      return 0;
    });

  const totalAmount = filtered.reduce((sum, doc) => {
    const { grandTotal } = getDocDetails(doc);
    return sum + grandTotal;
  }, 0);

  // Collect filterable fields from active template
  const filterableFields = [];
  if (activeTemplate && Array.isArray(activeTemplate.sections)) {
    activeTemplate.sections.forEach(sec => {
      if (sec.enabled && Array.isArray(sec.fields)) {
        sec.fields.forEach(f => {
          if (f.filterable && !f.hidden) {
            filterableFields.push({ ...f, sectionTitle: sec.title || sec.id });
          }
        });
      }
    });
  }

  const activeDynamicCount = Object.keys(dynamicFilters).filter(k => Boolean(dynamicFilters[k]?.trim())).length;
  const totalActiveFilters = (searchQuery ? 1 : 0) + (filterDate ? 1 : 0) + activeDynamicCount;

  const handleClearAllFilters = () => {
    setSearchQuery("");
    setFilterDate("");
    setDynamicFilters({});
  };

  const handleClearSingleFilter = (key) => {
    setDynamicFilters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <div className="page-archive">
      {/* Page Header */}
      <div className="page-header archive-header">
        <div className="page-header-left">
          <h1 className="page-title">Invoice Archive</h1>
          <p className="page-subtitle">
            <span className="count-pill">{archived.length} verified invoice(s)</span>
            <span className="dot-separator">•</span>
            <span className="total-pill">Total: ₹{totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </p>
        </div>
        <div className="archive-header-actions">
          <button
            className="btn btn-ghost archive-refresh-btn"
            onClick={() => loadArchived(false)}
            title="Refresh Archive"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <span>Refresh</span>
          </button>
          <button
            className="btn btn-excel-report"
            onClick={() => {
              setShowExcelModal(true);
            }}
            title="Download Excel Report"
          >
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span className="btn-text-desktop">Download Excel Report</span>
            <span className="btn-text-mobile">Excel Report</span>
          </button>
        </div>
      </div>

      {/* Archive Toolbar */}
      <div className="archive-toolbar">
        <div className="archive-toolbar-main">
          <div className="search-wrapper">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="search-icon">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              className="archive-search"
              placeholder="Search by vendor, invoice #, PO..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery("")} title="Clear search">×</button>
            )}
          </div>

          <div className="archive-toolbar-controls">
            <div className="archive-date-wrapper">
              <input
                type="date"
                className="archive-date-filter"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                title="Filter by upload date"
              />
              {filterDate && (
                <button
                  type="button"
                  className="archive-date-clear"
                  onClick={() => setFilterDate("")}
                  title="Clear date filter"
                >
                  ×
                </button>
              )}
            </div>

            <select className="archive-sort" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="date_desc">Newest First</option>
              <option value="date_asc">Oldest First</option>
              <option value="amount_desc">Highest Amount</option>
              <option value="vendor_asc">Vendor A-Z</option>
              
              {/* Dynamic template sort options */}
              {activeTemplate && activeTemplate.sections.map(sec => {
                if (!sec.enabled) return null;
                return sec.fields.filter(f => f.sortable && !f.hidden).map(field => (
                  <option key={field.key} value={field.key}>
                    Sort by {field.label}
                  </option>
                ));
              })}
            </select>

            {filterableFields.length > 0 && (
              <button
                type="button"
                className={`archive-filter-toggle-btn ${showAdvancedFilters ? "active" : ""} ${activeDynamicCount > 0 ? "has-filters" : ""}`}
                onClick={() => setShowAdvancedFilters(prev => !prev)}
                title="Toggle advanced template filters"
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
                <span>Filters</span>
                {activeDynamicCount > 0 && (
                  <span className="filter-count-badge">{activeDynamicCount}</span>
                )}
                <svg
                  className={`chevron-icon ${showAdvancedFilters ? "open" : ""}`}
                  width="11"
                  height="11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            )}

            {totalActiveFilters > 0 && (
              <button
                type="button"
                className="archive-reset-btn"
                onClick={handleClearAllFilters}
                title="Reset all search & filters"
              >
                Reset All
              </button>
            )}
          </div>
        </div>

        {/* Active Dynamic Filter Chips */}
        {activeDynamicCount > 0 && (
          <div className="archive-chips-bar">
            <span className="chips-title">Active Filters:</span>
            <div className="chips-list">
              {Object.keys(dynamicFilters).map(key => {
                const val = dynamicFilters[key];
                if (!val || !val.trim()) return null;
                const field = filterableFields.find(f => f.key === key);
                const label = field ? field.label : key;
                return (
                  <span key={key} className="filter-pill-chip">
                    <span className="pill-name">{label}:</span>
                    <span className="pill-value">{val}</span>
                    <button
                      type="button"
                      className="pill-close"
                      onClick={() => handleClearSingleFilter(key)}
                      title={`Remove ${label} filter`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                className="chips-clear-btn"
                onClick={() => setDynamicFilters({})}
              >
                Clear Template Filters
              </button>
            </div>
          </div>
        )}

        {/* Collapsible Advanced Template Filters Drawer */}
        {showAdvancedFilters && filterableFields.length > 0 && (
          <div className="archive-advanced-drawer">
            <div className="drawer-header">
              <div className="drawer-header-title">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
                <span>Advanced Template Filters ({filterableFields.length})</span>
                {activeDynamicCount > 0 && (
                  <span className="drawer-active-badge">{activeDynamicCount} Active</span>
                )}
              </div>
              <div className="drawer-header-actions">
                {activeDynamicCount > 0 && (
                  <button
                    type="button"
                    className="drawer-action-btn secondary"
                    onClick={() => setDynamicFilters({})}
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  className="drawer-action-btn primary"
                  onClick={() => setShowAdvancedFilters(false)}
                >
                  Done
                </button>
              </div>
            </div>

            <div className="drawer-fields-grid">
              {filterableFields.map(field => {
                const val = dynamicFilters[field.key] || "";
                return (
                  <div key={field.key} className="drawer-field-item">
                    <div className="drawer-field-label-row">
                      <label className="drawer-field-label">{field.label}</label>
                      {val && (
                        <button
                          type="button"
                          className="drawer-field-clear"
                          onClick={() => handleClearSingleFilter(field.key)}
                          title="Clear field"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="drawer-input-wrapper">
                      <input
                        type="text"
                        className="drawer-field-input"
                        placeholder={`Filter by ${field.label}...`}
                        value={val}
                        onChange={(e) => setDynamicFilters({
                          ...dynamicFilters,
                          [field.key]: e.target.value
                        })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Archive Content */}
      <div className={`archive-layout ${selectedDoc ? "has-selected-doc" : ""}`}>
        {/* List Panel */}
        <div className="archive-list-panel">
          {loading ? (
            <div className="archive-empty">
              <div className="loading-spinner" />
              <p>Loading archive...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="archive-empty">
              <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
                <line x1="10" y1="12" x2="14" y2="12"/>
              </svg>
              <h3>{searchQuery ? "No results found" : "Archive is empty"}</h3>
              <p>{searchQuery ? `No invoices match "${searchQuery}"` : "Validated invoices will appear here."}</p>
            </div>
          ) : (
            <div className="archive-items">
              {filtered.map(doc => {
                const { vendorName, invoiceNo, invoiceDate, grandTotal } = getDocDetails(doc);
                const isSelected = selectedDoc?.document_id === doc.document_id;
                return (
                  <div
                    key={doc.document_id}
                    className={`archive-item ${isSelected ? "selected" : ""}`}
                    onClick={() => handleSelectDoc(doc)}
                  >
                    <div className="archive-item-header">
                      <div className="archive-item-icon">
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </svg>
                      </div>
                      <div className="archive-item-info">
                        <span className="archive-vendor">{vendorName}</span>
                        <span className="archive-filename">{doc.filename}</span>
                      </div>
                      <div className="archive-item-amount">
                        <span className="archive-total">₹{grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                        <span className="archive-badge">✓ Verified</span>
                      </div>
                    </div>
                    <div className="archive-item-meta">
                      <span>Invoice: <strong>{invoiceNo}</strong></span>
                      <span>Date: <strong>{invoiceDate}</strong></span>
                      {doc.verification_time > 0 && <span>⏱ {doc.verification_time}s</span>}
                    </div>
                    {isSelected && (
                      <div className="archive-item-actions">
                        <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); handleViewAudit(doc); }}>
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          Audit Log
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); handleDownload(doc); }}>
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          Download
                        </button>
                        <button className="btn btn-sm btn-warning" onClick={e => { e.stopPropagation(); handleRestore(doc); }}>
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>
                          Restore
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); handleDelete(doc); }}>
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedDoc && (
          <div className="archive-detail-panel">
            <ArchiveDetailView doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
          </div>
        )}
      </div>

      {/* Audit Log Modal */}
      {auditLog && (
        <div className="modal-overlay" onClick={() => setAuditLog(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Audit Log — {auditLog.filename}</h3>
              <button className="modal-close" onClick={() => setAuditLog(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="audit-grid">
                {[
                  ["Document ID", auditLog.doc_id],
                  ["Status", auditLog.status],
                  ["Vendor", auditLog.vendor],
                  ["Invoice No.", auditLog.invoice_number],
                  ["Invoice Date", auditLog.invoice_date],
                  ["Grand Total", `₹${parseFloat(auditLog.grand_total || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
                  ["Added By", auditLog.added_by],
                  ["Location", auditLog.location],
                  ["Scheme", auditLog.scheme_name],
                  ["MSID", auditLog.msid],
                  ["Verification Time", `${auditLog.verification_time || 0} seconds`],
                  ["Saved to DB", auditLog.saved ? "Yes ✓" : "No"],
                ].map(([k, v]) => (
                  <div key={k} className="audit-row">
                    <span className="audit-key">{k}</span>
                    <span className="audit-val">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Date Range Modal for Excel Export */}
      <ExcelDateRangeModal
        isOpen={showExcelModal}
        onClose={() => setShowExcelModal(false)}
        showToast={showToast}
      />
    </div>
  );
}

function ArchiveDetailView({ doc, onClose }) {
  const ext = doc.final_extraction || doc.ocr_result?.extraction || {};
  const fallbackDetails = getDocDetails(doc);
  
  const vendor = ext.vendor_details || {};
  const consumer = ext.consumer_details || {};
  const invoice = ext.invoice_details || {};
  const bank = ext.bank_details || ext.vendor_details?.bank_details || {};
  const ts = ext.tax_summary || {};
  const items = ext.items || [];

  const vendorName = vendor.name || fallbackDetails.vendorName;
  const invoiceNo = invoice.invoice_number || fallbackDetails.invoiceNo;
  const invoiceDate = invoice.invoice_date || fallbackDetails.invoiceDate;
  const grandTotal = parseFloat(ts.grand_total) || fallbackDetails.grandTotal;

  return (
    <div className="archive-detail">
      <div className="archive-detail-header">
        <div className="archive-detail-header-left">
          <button
            type="button"
            className="archive-detail-back-btn"
            onClick={onClose}
            title="Back to Invoices list"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
            <span>Back</span>
          </button>
          <div className="archive-detail-title-group">
            <h3>{vendorName}</h3>
            <span className="archive-badge">✓ Archived</span>
          </div>
        </div>
        <div className="archive-detail-header-actions">
          <button
            className="btn btn-sm btn-detail-excel"
            onClick={() => {
              const token = localStorage.getItem("token") || "";
              window.open(`/api/export/excel?document_id=${encodeURIComponent(doc.document_id)}&token=${token}`, "_blank");
            }}
            title="Download Excel for this invoice"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span>Excel</span>
          </button>
          <button className="icon-btn archive-detail-close-btn" onClick={onClose} title="Close detail panel">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div className="archive-detail-scroll">
        {/* Invoice Info */}
        <div className="detail-section">
          <h4>Invoice Information</h4>
          <div className="detail-grid-2">
            <div className="detail-field"><label>Invoice No.</label><span>{invoiceNo}</span></div>
            <div className="detail-field"><label>Invoice Date</label><span>{invoiceDate}</span></div>
            <div className="detail-field"><label>PO Number</label><span>{invoice.po_number || "N/A"}</span></div>
            <div className="detail-field"><label>Verification Time</label><span>{doc.verification_time || 0}s</span></div>
          </div>
        </div>

        {/* Vendor */}
        <div className="detail-section">
          <h4>Vendor</h4>
          <div className="detail-grid-2">
            <div className="detail-field"><label>Name</label><span>{vendorName}</span></div>
            <div className="detail-field"><label>GSTIN</label><span>{vendor.gstin || "N/A"}</span></div>
            <div className="detail-field"><label>PAN</label><span>{vendor.pan || "N/A"}</span></div>
            <div className="detail-field"><label>State</label><span>{vendor.state || "N/A"}</span></div>
            <div className="detail-field" style={{ gridColumn: "span 2" }}><label>Address</label><span>{vendor.address || "N/A"}</span></div>
          </div>
        </div>

        {/* Consumer */}
        <div className="detail-section">
          <h4>Consumer</h4>
          <div className="detail-grid-2">
            <div className="detail-field"><label>Name</label><span>{consumer.name || "N/A"}</span></div>
            <div className="detail-field"><label>GSTIN</label><span>{consumer.gstin || "N/A"}</span></div>
          </div>
        </div>

        {/* Bank Details */}
        <div className="detail-section">
          <h4>Bank Details</h4>
          <div className="detail-grid-2">
            <div className="detail-field"><label>Bank Name</label><span>{bank.bank_name || bank.bank || "N/A"}</span></div>
            <div className="detail-field"><label>Account Number</label><span>{bank.account_number || bank.account_no || bank.acc_no || "N/A"}</span></div>
            <div className="detail-field"><label>IFSC Code</label><span>{bank.ifsc_code || bank.ifsc || "N/A"}</span></div>
            <div className="detail-field"><label>Branch</label><span>{bank.branch || bank.branch_name || "N/A"}</span></div>
          </div>
        </div>

        {/* Tax Summary */}
        <div className="detail-section">
          <h4>Tax Summary</h4>
          <div className="detail-grid-2">
            <div className="detail-field"><label>Taxable Amount</label><span>₹{parseFloat(ts.taxable_amount || 0).toFixed(2)}</span></div>
            <div className="detail-field"><label>CGST</label><span>₹{parseFloat(ts.cgst || 0).toFixed(2)}</span></div>
            <div className="detail-field"><label>SGST</label><span>₹{parseFloat(ts.sgst || 0).toFixed(2)}</span></div>
            <div className="detail-field"><label>IGST</label><span>₹{parseFloat(ts.igst || 0).toFixed(2)}</span></div>
          </div>
          <div className="detail-grand-total">
            <span>Grand Total</span>
            <span>₹{grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Items */}
        {items.length > 0 && (
          <div className="detail-section">
            <h4>Line Items ({items.length})</h4>
            <div className="detail-items-table">
              <div className="items-header">
                <span>Description</span>
                <span>Qty</span>
                <span>Rate</span>
                <span>Total</span>
              </div>
              {items.map((item, i) => (
                <div key={i} className="items-row">
                  <span>{item.description || item.description_of_goods || "N/A"}</span>
                  <span>{item.quantity}</span>
                  <span>₹{parseFloat(item.unit_price || 0).toFixed(2)}</span>
                  <span>₹{parseFloat(item.total_amount || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
