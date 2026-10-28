import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';

const prefetchViewChunk = (viewId) => {
    switch (viewId) {
        case 'leaves-view': 
            import('./views/LeavesView'); 
            api.getLeaves().catch(() => {});
            break;
        case 'expenses-view': import('./views/ExpensesView'); break;
        case 'payroll-view': import('./views/PayrollView/index.jsx'); break;
        case 'live-tracking-view': import('./views/LiveTrackingView'); break;
        case 'route-replay-view': import('./views/RouteReplayView'); break;
        case 'geofence-view': import('./views/GeofenceView'); break;
        case 'site-info-view': import('./views/SiteInfoView'); break;
        case 'documents-view': import('./views/DocumentsView'); break;
        case 'media-view': import('./views/MediaView'); break;
        case 'notifications-view': import('./views/NotificationCenter/NotificationCenter'); break;
        case 'whatsapp-settings-view': import('./views/WhatsAppNotificationSettingsView'); break;
        case 'settings-view': import('./views/SettingsView'); break;
        default: break;
    }
};

export default function Sidebar({ adminUser, currentView, trackingOrigin, onViewChange, onLogout, isSidebarOpen, isCollapsed, onToggleCollapse, badgeCounts = {}, onClose }) {
    const [isHovered, setIsHovered] = React.useState(false);
    
    const navSections = [
        {
            title: 'MODULES',
            items: [
                { id: 'platform-hub', label: 'Platform Hub', icon: 'fa-house', isExternal: true, path: '/' },
                { id: 'invoice-module', label: 'Invoice Extractor', icon: 'fa-file-invoice', isExternal: true, path: '/invoice' }
            ]
        },
        {
            title: 'CORE HRMS',
            items: [
                { id: 'dashboard-view', label: 'Dashboard', icon: 'fa-chart-pie' },
                { id: 'employees-view', label: 'Employees', icon: 'fa-user-group' },
                { id: 'attendance-view', label: 'Attendance', icon: 'fa-clock-rotate-left' },
                { id: 'leaves-view', label: 'Leaves', icon: 'fa-calendar-days' },
                { id: 'expenses-view', label: 'Expenses', icon: 'fa-file-invoice-dollar' },
                { id: 'payroll-view', label: 'Payroll', icon: 'fa-money-check-dollar' }
            ]
        },
        {
            title: 'OPERATIONS',
            items: [
                { id: 'live-tracking-view', label: 'Live Tracking', icon: 'fa-location-dot' },
                { id: 'route-replay-view', label: 'Route Replay', icon: 'fa-route' },
                { id: 'geofence-view', label: 'Geofence', icon: 'fa-draw-polygon' },
                { id: 'site-info-view', label: 'Site Info', icon: 'fa-city' }
            ]
        },
        {
            title: 'ORGANIZATION',
            items: [
                { id: 'documents-view', label: 'Documents', icon: 'fa-folder' },
                { id: 'media-view', label: 'Photos & Media', icon: 'fa-images' },
                { id: 'notifications-view', label: 'Notification Center', icon: 'fa-bell' },
                { id: 'whatsapp-settings-view', label: 'WhatsApp Summary', icon: 'fa-comment-dots' },
                { id: 'settings-view', label: 'Settings', icon: 'fa-sliders', isDesktopOnly: true }
            ]
        }
    ];

    const isExpanded = isSidebarOpen || !isCollapsed || isHovered;

    // Determine parent route if viewing employee-tracking-view
    const effectiveActiveView = currentView === 'employee-tracking-view'
        ? (trackingOrigin || 'attendance-view')
        : (currentView === 'leave-balances-view' || currentView === 'leave-balance-detail-view') ? 'leaves-view' : currentView;

    const userRole = String(adminUser?.role || 'ADMIN').toUpperCase();
    const isTrackingManager = userRole === 'TRACKING_MANAGER';
    const isFieldInvoiceManager = userRole === 'FIELD_INVOICE_MANAGER';
    const isNonAdminManager = isTrackingManager || isFieldInvoiceManager;

    const filterItem = (item) => {
        if (isTrackingManager && ['invoice-module', 'payroll-view', 'documents-view', 'settings-view'].includes(item.id)) {
            return false;
        }
        if (isFieldInvoiceManager && ['payroll-view', 'documents-view', 'settings-view'].includes(item.id)) {
            return false;
        }
        return true;
    };

    return (
        <aside 
            className={`sidebar glass ${isSidebarOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''} ${isHovered ? 'hover-expanded' : ''}`} 
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{ overflow: 'visible' }}
        >
            {/* Smooth Floating Collapse Button */}
            <div 
                onClick={onToggleCollapse} 
                style={{
                    position: 'absolute',
                    top: '20px',
                    right: '-11px',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: 'var(--bg-glass, #ffffff)',
                    border: '1px solid var(--border-glass, #e2e8f0)',
                    color: 'var(--text-muted, #64748b)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)',
                    zIndex: 1000,
                    padding: 0,
                    transition: 'all 0.15s ease',
                }}
                className="sidebar-collapse-btn"
                title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.2s ease', transform: isCollapsed && !isHovered ? 'rotate(0deg)' : 'rotate(180deg)' }}>
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </div>

            {/* Sidebar Brand Header (Matches Mobile Mockup) */}
            <div className="sidebar-header" style={{ justifyContent: !isExpanded ? 'center' : 'flex-start', padding: !isExpanded ? '10px 0' : '12px 14px', gap: '10px', borderBottom: '1px solid var(--border-glass)', minHeight: '52px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)', flexShrink: 0 }}>
                    <i className="fa-solid fa-building-user" style={{ fontSize: '15px', color: '#ffffff' }}></i>
                </div>
                {isExpanded && (
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            HRMS Suite
                        </h2>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#2563eb', letterSpacing: '0.8px', textTransform: 'uppercase', display: 'block', marginTop: '1px' }}>
                            ENTERPRISE
                        </span>
                    </div>
                )}
                {onClose && (
                    <button 
                        type="button" 
                        onClick={onClose} 
                        className="sidebar-mobile-close-btn"
                        aria-label="Close menu"
                        style={{
                            marginLeft: 'auto',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted, #64748b)',
                            fontSize: '18px',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            display: 'none'
                        }}
                    >
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                )}
            </div>

            {/* Nav Menu with Categorized Sections */}
            <nav className="sidebar-nav custom-scrollbar" style={{ overflowY: 'auto', flex: 1, padding: '6px 6px' }}>
                {navSections.map((sec, idx) => {
                    const visibleItems = sec.items.filter(filterItem);
                    if (visibleItems.length === 0) return null;

                    return (
                        <div key={sec.title} className="sidebar-section" style={{ marginBottom: '8px' }}>
                            {isExpanded ? (
                                <div className="sidebar-section-title" style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 8px 2px 8px', margin: idx === 0 ? '0' : '4px 0 2px 0' }}>
                                    {sec.title}
                                </div>
                            ) : (
                                idx > 0 && <div className="nav-separator" style={{ margin: '6px 8px', borderTop: '1px solid var(--border-glass)' }}></div>
                            )}

                            {visibleItems.map(item => {
                                const badgeCount = Number(badgeCounts[item.id] || 0);
                                const hasBadge = badgeCount > 0;
                                const badgeTheme = item.id === 'leaves-view'
                                    ? { bg: 'linear-gradient(135deg, #f59e0b, #d97706)', shadow: 'rgba(245, 158, 11, 0.45)' }
                                    : item.id === 'expenses-view'
                                    ? { bg: 'linear-gradient(135deg, #10b981, #059669)', shadow: 'rgba(16, 185, 129, 0.45)' }
                                    : { bg: 'linear-gradient(135deg, #ef4444, #dc2626)', shadow: 'rgba(239, 68, 68, 0.45)' };

                                if (item.isExternal) {
                                    return (
                                        <Link 
                                            key={item.id} 
                                            to={item.path} 
                                            className={`nav-item ${item.isDesktopOnly ? 'desktop-only-inline' : ''}`} 
                                            onClick={() => onClose && onClose()}
                                            title={!isExpanded ? item.label : undefined}
                                        >
                                            <div className="nav-icon-box" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <i className={`fa-solid ${item.icon}`}></i>
                                                {!isExpanded && hasBadge && (
                                                    <span 
                                                        className="nav-badge-dot"
                                                        style={{
                                                            position: 'absolute',
                                                            top: '-5px',
                                                            right: '-7px',
                                                            background: badgeTheme.bg,
                                                            color: '#ffffff',
                                                            width: '14px',
                                                            height: '14px',
                                                            borderRadius: '50%',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontSize: '9px',
                                                            fontWeight: 700,
                                                            boxShadow: `0 2px 5px ${badgeTheme.shadow}`
                                                        }}
                                                    >
                                                        {badgeCount > 9 ? '9+' : badgeCount}
                                                    </span>
                                                )}
                                            </div>
                                            {isExpanded && <span>{item.label}</span>}
                                            {isExpanded && hasBadge && (
                                                <span 
                                                    className="nav-badge-pill"
                                                    style={{
                                                        marginLeft: 'auto',
                                                        background: badgeTheme.bg,
                                                        color: '#ffffff',
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        width: '18px',
                                                        height: '18px',
                                                        borderRadius: '50%',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        boxShadow: `0 2px 5px ${badgeTheme.shadow}`,
                                                        flexShrink: 0
                                                    }}
                                                >
                                                    {badgeCount > 99 ? '99+' : badgeCount}
                                                </span>
                                            )}
                                        </Link>
                                    );
                                }

                                const targetViewId = item.targetView || item.id;
                                const isActive = currentView === targetViewId || item.id === effectiveActiveView || targetViewId === effectiveActiveView;
                                return (
                                    <a 
                                        key={item.id}
                                        href="#" 
                                        className={`nav-item ${isActive ? 'active' : ''} ${item.isDesktopOnly ? 'desktop-only-inline' : ''}`}
                                        onMouseEnter={() => prefetchViewChunk(targetViewId)}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            onViewChange(targetViewId);
                                            if (onClose) onClose();
                                        }}
                                        title={!isExpanded ? item.label : undefined}
                                    >
                                        <div className="nav-icon-box" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <i className={`fa-solid ${item.icon}`}></i>
                                            {!isExpanded && hasBadge && (
                                                <span 
                                                    className="nav-badge-dot"
                                                    style={{
                                                        position: 'absolute',
                                                        top: '-5px',
                                                        right: '-7px',
                                                        background: badgeTheme.bg,
                                                        color: '#ffffff',
                                                        width: '14px',
                                                        height: '14px',
                                                        borderRadius: '50%',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '9px',
                                                        fontWeight: 700,
                                                        boxShadow: `0 2px 5px ${badgeTheme.shadow}`
                                                    }}
                                                >
                                                    {badgeCount > 9 ? '9+' : badgeCount}
                                                </span>
                                            )}
                                        </div>
                                        {isExpanded && <span>{item.label}</span>}
                                        {isExpanded && hasBadge && (
                                            <span 
                                                className="nav-badge-pill"
                                                style={{
                                                    marginLeft: 'auto',
                                                    background: badgeTheme.bg,
                                                    color: '#ffffff',
                                                    fontSize: '11px',
                                                    fontWeight: 700,
                                                    width: '18px',
                                                    height: '18px',
                                                    borderRadius: '50%',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    boxShadow: `0 2px 5px ${badgeTheme.shadow}`,
                                                    flexShrink: 0
                                                }}
                                            >
                                                {badgeCount > 99 ? '99+' : badgeCount}
                                            </span>
                                        )}
                                    </a>
                                );
                            })}
                        </div>
                    );
                })}
            </nav>

            {/* Compact Footer Profile Card (Matches Mobile Mockup) */}
            <div className="sidebar-footer" style={{ padding: '12px 14px', borderTop: '1px solid var(--border-glass)', background: 'var(--bg-glass)' }}>
                <div className="admin-profile" style={{ display: 'flex', alignItems: 'center', justifyContent: !isExpanded ? 'center' : 'space-between', gap: '10px', margin: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <div className="avatar" style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#2563eb', color: '#ffffff', fontSize: '12.5px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {adminUser?.name ? adminUser.name.substring(0, 3).toUpperCase() : 'AA1'}
                        </div>
                        {isExpanded && (
                            <div className="admin-info" style={{ minWidth: 0 }}>
                                <span id="admin-name" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                                    {adminUser?.name || 'AA1'}
                                </span>
                                <span style={{ fontSize: '10.5px', color: 'var(--text-muted, #64748b)', fontWeight: 600, display: 'block' }}>
                                    Admin
                                </span>
                            </div>
                        )}
                    </div>
                    {isExpanded && (
                        <button 
                            type="button"
                            onClick={onLogout}
                            title="Sign out of HRMS"
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted, #64748b)',
                                cursor: 'pointer',
                                padding: '6px',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'color 0.15s ease'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.color = '#dc2626'}
                            onMouseLeave={(e) => e.currentTarget.style.color = '#64748b'}
                        >
                            <i className="fa-solid fa-arrow-right-from-bracket" style={{ fontSize: '16px' }}></i>
                        </button>
                    )}
                </div>
            </div>
        </aside>
    );
}
