import { useState, useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import API from "../services/api";

export default function Layout() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === "light" ? "dark" : "light");

  const loadDocuments = async () => {
    try {
      const res = await API.get("/documents");
      const raw = res.data;
      const docs = Array.isArray(raw) ? raw : (raw?.documents || raw?.data || []);
      docs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setDocuments(docs);
    } catch (e) {
      console.error("Failed to load documents:", e);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  useEffect(() => {
    document.body.classList.add('invoice-body');
    return () => {
      document.body.classList.remove('invoice-body');
    };
  }, []);

  useEffect(() => {
    const hasProcessing = documents.some(d => 
      ["PROCESSING", "UPLOADING", "PENDING", "PROCESS"].includes(d.status?.toUpperCase())
    );
    // Adaptive polling: 2.5s when OCR is actively processing, 60s when idle
    const intervalTime = hasProcessing ? 2500 : 60000;
    const interval = setInterval(loadDocuments, intervalTime);
    return () => clearInterval(interval);
  }, [documents]);

  const showToast = (message, type = "success") => {
    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, fade: true } : t));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 300);
    }, 4000);
  };

  const handleFilesUpload = async (files) => {
    if (!files || !files.length) return;
    setUploading(true);
    const formData = new FormData();
    for (let file of files) formData.append("files", file);
    try {
      const res = await API.post("/upload", formData, { headers: { "Content-Type": "multipart/form-data" } });
      showToast(`✓ ${files.length} invoice(s) uploaded successfully!`);
      loadDocuments();
      const docs = res.data?.documents || [];
      if (docs.length > 0) {
        navigate("/invoice/uploads", { state: { autoSelectDocId: docs[0].document_id } });
      } else {
        navigate("/invoice/uploads");
      }
    } catch (error) {
      showToast("Upload failed. Please try again.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async (event) => {
    const files = event.target.files;
    if (!files || !files.length) return;
    await handleFilesUpload(files);
    event.target.value = "";
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleFilesUpload(e.dataTransfer.files);
    }
  };

  // Compute stats
  const stats = {
    total: documents.length,
    pending: documents.filter(d => d.status === "PENDING_VALIDATION").length,
    processing: documents.filter(d => d.status === "PROCESSING" || d.status === "UPLOADING").length,
    failed: documents.filter(d => d.status === "FAILED").length,
    archived: documents.filter(d => d.status === "ARCHIVED").length,
  };

  const navItems = [
    {
      to: "/",
      label: "Platform Hub",
      icon: (
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      ),
    },
    {
      to: "/hrms",
      label: "HRMS Module",
      icon: (
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      ),
    },
    {
      to: "/invoice/uploads",
      label: "Uploads",
      icon: (
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      ),
    },
    {
      to: "/invoice/validation",
      label: "Validation",
      icon: (
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      ),
      badge: stats.pending > 0 ? stats.pending : null,
      badgeColor: "#f59e0b",
    },
    {
      to: "/invoice/archive",
      label: "Archive",
      icon: (
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
      ),
      badge: stats.archived > 0 ? stats.archived : null,
      badgeColor: "#10b981",
    },
    {
      to: "/invoice/analytics",
      label: "Analytics",
      icon: (
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
      ),
    },
  ];

  return (
    <div 
      className="app-shell"
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      {/* Sidebar */}
      {(() => {
        const isExpanded = !sidebarCollapsed || isSidebarHovered;
        return (
          <aside 
            className={`sidebar ${sidebarCollapsed ? "collapsed" : ""} ${isSidebarHovered ? "hover-expanded" : ""}`} 
            onMouseEnter={() => setIsSidebarHovered(true)}
            onMouseLeave={() => setIsSidebarHovered(false)}
            style={{ position: 'relative', overflow: 'visible' }}
          >
            <div className="sidebar-header" style={{ justifyContent: !isExpanded ? 'center' : 'space-between', padding: !isExpanded ? '14px 0' : '14px 12px' }}>
              <div className="sidebar-logo" style={{ justifyContent: !isExpanded ? 'center' : 'flex-start', width: '100%' }}>
                <svg width="28" height="28" fill="none" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <rect width="24" height="24" rx="6" fill="var(--primary-color)" opacity="0.15"/>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="var(--primary-color)" strokeWidth="2"/>
                  <polyline points="14 2 14 8 20 8" stroke="var(--primary-color)" strokeWidth="2"/>
                  <line x1="16" y1="13" x2="8" y2="13" stroke="var(--primary-color)" strokeWidth="2"/>
                  <line x1="16" y1="17" x2="8" y2="17" stroke="var(--primary-color)" strokeWidth="2"/>
                </svg>
                {isExpanded && (
                  <div className="sidebar-brand">
                    <span className="brand-name">OCR Portal</span>
                    <span className="brand-sub">Invoice Intelligence</span>
                  </div>
                )}
              </div>
          <div 
            className="sidebar-toggle" 
            onClick={() => setSidebarCollapsed(c => !c)} 
            title="Toggle sidebar"
            style={{
              position: 'absolute',
              top: '16px',
              right: '-12px',
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
              zIndex: 1000,
              padding: 0,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.color = '#4f46e5';
              e.currentTarget.style.borderColor = '#cbd5e1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.color = '#64748b';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {sidebarCollapsed
                ? <path d="M9 18l6-6-6-6" />
                : <path d="M15 18l-6-6 6-6" />}
            </svg>
          </div>
        </div>



        {/* Quick Stats */}
        {isExpanded && (
          <div className="sidebar-stats">
            <div className="sidebar-stat">
              <span className="stat-dot processing" />
              <span className="stat-label">Processing</span>
              <span className="stat-val">{stats.processing}</span>
            </div>
            <div className="sidebar-stat">
              <span className="stat-dot pending" />
              <span className="stat-label">Pending</span>
              <span className="stat-val">{stats.pending}</span>
            </div>
            <div className="sidebar-stat">
              <span className="stat-dot failed" />
              <span className="stat-label">Failed</span>
              <span className="stat-val">{stats.failed}</span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              title={!isExpanded ? item.label : undefined}
              onClick={(e) => {
                if (item.to.includes("validation") && window.location.pathname.includes("validation")) {
                  window.dispatchEvent(new Event("reset-validation-dashboard"));
                }
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {isExpanded && <span className="nav-label">{item.label}</span>}
              {isExpanded && item.badge && (
                <span className="nav-badge" style={{ background: item.badgeColor }}>
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar Footer: Theme Mode Toggle */}
        <div className="sidebar-footer" style={{ padding: isExpanded ? '12px 14px' : '12px 0', borderTop: '1px solid var(--border-color)', marginTop: 'auto', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={toggleTheme}
            title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            style={{
              width: isExpanded ? '100%' : '40px',
              height: '40px',
              background: 'var(--bg-card-highlight, #f8fafc)',
              border: '1px solid var(--border-color, #e2e8f0)',
              color: 'var(--text-primary)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.2s',
              padding: isExpanded ? '0 12px' : '0'
            }}
          >
            <span>{theme === 'light' ? '🌙' : '☀️'}</span>
            {isExpanded && <span>{theme === 'light' ? 'Dark' : 'Light'}</span>}
          </button>
        </div>
       </aside>
        );
      })()}
 
       {/* Main Content Area */}
       <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
         <main className="main-content" style={{ flex: 1, overflowY: "auto" }}>
           <Outlet context={{ documents, loadDocuments, showToast, stats }} />
         </main>
       </div>

      {/* Drag & Drop Fullscreen Overlay */}
      {isDragActive && (
        <div 
          className="drag-drop-overlay"
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(79, 70, 229, 0.15)",
            backdropFilter: "blur(4px)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "4px dashed var(--primary-color)",
            margin: "16px",
            borderRadius: "var(--radius-lg)",
            pointerEvents: "auto",
            animation: "fadeIn 0.2s ease"
          }}
        >
          <div style={{
            background: "var(--bg-panel)",
            padding: "40px",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
            textAlign: "center",
            maxWidth: "360px"
          }}>
            <div style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              background: "rgba(79, 70, 229, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--primary-color)"
            }}>
              <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <div>
              <h2 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)", margin: "0 0 4px 0" }}>Drop Invoices to Upload</h2>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>Supports PDF, PNG, JPG, and JPEG</p>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Center */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast-card ${t.type} ${t.fade ? "fade-out" : ""}`}>
            {t.type === "success" ? (
              <svg width="16" height="16" fill="none" stroke="#10b981" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : t.type === "error" ? (
              <svg width="16" height="16" fill="none" stroke="#ef4444" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            ) : t.type === "warning" ? (
              <svg width="16" height="16" fill="none" stroke="#f59e0b" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            ) : (
              <svg width="16" height="16" fill="none" stroke="var(--primary-color)" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
            )}
            <span style={{ marginRight: "12px" }}>{t.message}</span>
            <button 
              className="toast-close" 
              onClick={() => {
                setToasts(prev => prev.map(item => item.id === t.id ? { ...item, fade: true } : item));
                setTimeout(() => {
                  setToasts(prev => prev.filter(item => item.id !== t.id));
                }, 300);
              }}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
