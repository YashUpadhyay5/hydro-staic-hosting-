import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { modulesConfig } from '../config/modules';

export default function Dashboard() {
    const [user, setUser] = useState(null);
    const navigate = useNavigate();
    const [darkMode, setDarkMode] = useState(() => {
        return localStorage.getItem('platform-theme') === 'dark';
    });

    useEffect(() => {
        const storedUser = localStorage.getItem('adminUser');
        if (storedUser) {
            try {
                setUser(JSON.parse(storedUser));
            } catch (e) {
                console.error(e);
            }
        } else {
            navigate('/login');
        }
    }, [navigate]);

    useEffect(() => {
        if (darkMode) {
            document.body.classList.add('dark-theme');
            localStorage.setItem('platform-theme', 'dark');
        } else {
            document.body.classList.remove('dark-theme');
            localStorage.setItem('platform-theme', 'light');
        }
    }, [darkMode]);

    const handleLogout = () => {
        localStorage.clear();
        document.body.classList.remove('dark-theme');
        navigate('/login');
    };

    const [showPrivacyModal, setShowPrivacyModal] = useState(false);
    const [isPrivacyHovered, setIsPrivacyHovered] = useState(false);

    if (!user) return null;

    // Filter modules based on user role (Admin can access all)
    const allowedModules = modulesConfig.filter(mod => {
        const uRole = String(user.role || '').trim().toUpperCase();
        if (uRole === 'ADMIN' || uRole === 'SUPER_ADMIN') return true;
        return mod.roles.some(r => r.toUpperCase() === uRole);
    });

    return (
        <div className="platform-dashboard-container">
            <header className="platform-header glass">
                <div className="header-left">
                    <div className="platform-logo-emblem">
                        <i className="fa-solid fa-bolt" style={{ color: '#ffffff', fontSize: '18px' }}></i>
                    </div>
                    <div>
                        <span className="platform-title" style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.4px', lineHeight: 1.1 }}>Hydro Hub</span>
                        <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginTop: '2px' }}>Platform Workspace</span>
                    </div>
                </div>
                <div className="header-right">
                    <div className="user-profile-badge">
                        <span className="user-avatar-initial">{user.name?.charAt(0) || 'A'}</span>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span className="user-badge" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{user.name}</span>
                            <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                                Active Admin
                            </span>
                        </div>
                    </div>
                    <button className="theme-toggle-btn" onClick={() => setDarkMode(!darkMode)} title="Toggle Color Theme">
                        {darkMode ? '☀️' : '🌙'}
                    </button>
                    <button className="logout-btn" onClick={handleLogout}>Sign Out</button>
                </div>
            </header>

            <main className="platform-main">
                <div className="welcome-banner">
                    <span className="banner-small-tag">⚡ ENTERPRISE WORKSPACE</span>
                    <h1 className="welcome-heading">Welcome back, {user.name}!</h1>
                    <p className="welcome-sub">Select a workspace below to launch your integrated business management applications.</p>
                </div>

                <div className="modules-grid">
                    {allowedModules.map(mod => {
                        const isInvoice = mod.id === 'invoice';
                        return (
                            <div key={mod.id} className="module-card glass" onClick={() => navigate(mod.path)}>
                                {/* Card Decorative Top Accent Border */}
                                <div className="card-top-accent"></div>
                                
                                <div className="module-card-header">
                                    <div className="module-card-icon-wrapper" style={{ background: isInvoice ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', color: '#ffffff', boxShadow: isInvoice ? '0 8px 20px rgba(5, 150, 105, 0.25)' : '0 8px 20px rgba(37, 99, 235, 0.25)' }}>
                                        <i className={`fa-solid ${isInvoice ? 'fa-file-invoice-dollar' : 'fa-users-gear'}`}></i>
                                    </div>
                                    <span className="module-status-badge">
                                        {isInvoice ? '✨ AI OCR ENGINE' : '⚡ CORE OPERATIONS'}
                                    </span>
                                </div>

                                <h3 className="module-card-name">{mod.name}</h3>
                                <p className="module-card-description">{mod.description}</p>
                                
                                {/* Feature Highlights List */}
                                <div style={{ width: '100%', marginBottom: '28px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                                    {!isInvoice ? (
                                        <>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                <i className="fa-solid fa-circle-check" style={{ color: '#10b981', fontSize: '15px' }}></i> Real-time GPS & Route Replay Tracking
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                <i className="fa-solid fa-circle-check" style={{ color: '#10b981', fontSize: '15px' }}></i> Geofence Site Info & Attendance Analytics
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                <i className="fa-solid fa-circle-check" style={{ color: '#10b981', fontSize: '15px' }}></i> Expense Claims & History Management
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                <i className="fa-solid fa-circle-check" style={{ color: '#10b981', fontSize: '15px' }}></i> Automated OCR Invoice Parsing
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                <i className="fa-solid fa-circle-check" style={{ color: '#10b981', fontSize: '15px' }}></i> Document Validation & Analytics Archival
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                <i className="fa-solid fa-circle-check" style={{ color: '#10b981', fontSize: '15px' }}></i> Multi-format Export & Tax Breakdown Reporting
                                            </div>
                                        </>
                                    )}
                                </div>

                                <button 
                                    className="module-card-btn" 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(mod.path);
                                    }}
                                >
                                    <span>Launch Workspace</span>
                                    <span className="btn-arrow-icon">→</span>
                                </button>
                            </div>
                        );
                    })}
                    {allowedModules.length === 0 && (
                        <div className="no-access-alert glass">
                            <h3>⚠️ No Access</h3>
                            <p>Your current role ({user.role}) does not have permissions to access any modules. Please contact an administrator.</p>
                        </div>
                    )}
                </div>
            </main>

            {/* Floating Privacy Policy Trigger at Right Bottom */}
            <div 
                style={{
                    position: 'fixed',
                    bottom: '28px',
                    right: '28px',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center'
                }}
            >
                <button
                    onClick={() => setShowPrivacyModal(true)}
                    onMouseEnter={() => setIsPrivacyHovered(true)}
                    onMouseLeave={() => setIsPrivacyHovered(false)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: isPrivacyHovered ? '12px 20px 12px 16px' : '12px',
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '30px',
                        boxShadow: isPrivacyHovered 
                            ? '0 12px 30px rgba(37, 99, 235, 0.2), 0 0 0 2px #2563eb' 
                            : '0 4px 16px rgba(0, 0, 0, 0.08)',
                        cursor: 'pointer',
                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        transform: isPrivacyHovered ? 'translateY(-3px)' : 'translateY(0)',
                        overflow: 'hidden'
                    }}
                    title="Privacy & Policy"
                >
                    {/* Privacy Policy SVG Icon */}
                    <div 
                        style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: isPrivacyHovered ? '#2563eb' : 'var(--icon-bg)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.3s ease',
                            flexShrink: 0
                        }}
                    >
                        <svg 
                            width="18" 
                            height="18" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke={isPrivacyHovered ? '#ffffff' : '#2563eb'} 
                            strokeWidth="2.2" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                        >
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            <path d="M12 8v4"/>
                            <path d="M12 16h.01"/>
                        </svg>
                    </div>

                    {/* Expandable Hover Text */}
                    <span 
                        style={{
                            fontSize: '13.5px',
                            fontWeight: 700,
                            color: isPrivacyHovered ? '#2563eb' : 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            maxWidth: isPrivacyHovered ? '160px' : '0px',
                            opacity: isPrivacyHovered ? 1 : 0,
                            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                            display: 'inline-block',
                            overflow: 'hidden'
                        }}
                    >
                        Privacy Policy
                    </span>
                </button>
            </div>

            {/* Informational Privacy Policy Modal */}
            {showPrivacyModal && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(17, 24, 39, 0.65)',
                        backdropFilter: 'blur(6px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000,
                        padding: '20px'
                    }}
                    onClick={() => setShowPrivacyModal(false)}
                >
                    <div 
                        style={{
                            background: '#ffffff',
                            borderRadius: '24px',
                            maxWidth: '720px',
                            width: '100%',
                            maxHeight: '85vh',
                            overflowY: 'auto',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                            border: '1px solid #e5e7eb',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div 
                            style={{
                                padding: '24px 28px',
                                borderBottom: '1px solid #e5e7eb',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: '#fafafb',
                                borderTopLeftRadius: '24px',
                                borderTopRightRadius: '24px',
                                position: 'sticky',
                                top: 0,
                                zIndex: 10
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#eff6ff', border: '1px solid rgba(37, 99, 235, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                        <path d="M9 12l2 2 4-4"/>
                                    </svg>
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#111827', letterSpacing: '-0.4px' }}>Privacy & Data Protection Policy</h3>
                                    <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>Hydro Platform Enterprise Data & Employee Privacy Disclosure</span>
                                </div>
                            </div>
                            <button 
                                onClick={() => setShowPrivacyModal(false)}
                                style={{
                                    width: '34px',
                                    height: '34px',
                                    borderRadius: '50%',
                                    background: '#ffffff',
                                    border: '1px solid #e5e7eb',
                                    color: '#6b7280',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Modal Body / Information Sections */}
                        <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            
                            {/* Section 1: Data Controller & Scope of Employer Authority */}
                            <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '20px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ background: '#eff6ff', color: '#2563eb', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}>1</span>
                                    Data Controller & Scope of Employer Authority
                                </h4>
                                <p style={{ margin: '0 0 10px 0', fontSize: '13.5px', color: '#4b5563', lineHeight: '1.6' }}>
                                    This Privacy & Data Protection Policy governs the collection, processing, transmission, and storage of employee telemetric and operational data by the Employer ("Data Controller") within the Hydro HRMS Enterprise System.
                                </p>
                                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', color: '#4b5563', lineHeight: '1.7' }}>
                                    <li><strong>Lawful Basis for Processing:</strong> Processing is conducted pursuant to the execution of the Employment Contract, compliance with statutory labor regulations, site safety mandates, and legitimate business interests (field logistics, duty verification, and accurate payroll calculation).</li>
                                    <li><strong>Scope of Operational Use:</strong> Data collected is restricted strictly to enterprise workforce administration, site geofencing, route coverage auditing, and reimbursement validation.</li>
                                </ul>
                            </div>

                            {/* Section 2: Comprehensive Categories of Data Processed */}
                            <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '20px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ background: '#eff6ff', color: '#2563eb', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}>2</span>
                                    Categories of Personal & Telemetric Data Processed
                                </h4>
                                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', color: '#4b5563', lineHeight: '1.7' }}>
                                    <li><strong>Personal Identity & HR Records:</strong> Full Name, Employee Code, Assigned Role/Designation, Primary Contact Phone, Emergency Contact, Profile Photo, and Tax/Salary Structures.</li>
                                    <li><strong>Telemetric & Geolocation Data:</strong> High-precision GPS Coordinates (Latitude, Longitude, Altitude, Speed, Bearing, Horizontal/Vertical Accuracy level), Tracking Method (GPS/Cellular/Network), Network Operator Parameters (MCC, MNC, LAC, TAC), Signal Strength, Battery State, and Automated Mock Location Detection flags (<code>is_mock_location</code>).</li>
                                    <li><strong>Work & Attendance Metrics:</strong> Shift Clock-In/Clock-Out timestamps, Active Duty duration, Overtime records, and Geofence boundary entry/exit pings.</li>
                                    <li><strong>Financial & Expense Records:</strong> Scanned Receipts, OCR-extracted Invoice amounts, Merchant metadata, Mileage reimbursement claims, and HR document attachments.</li>
                                </ul>
                            </div>

                            {/* Section 3: Geolocation Tracking Protocols & Off-Duty Guarantee */}
                            <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '20px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ background: '#eff6ff', color: '#2563eb', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}>3</span>
                                    Geolocation Tracking Protocols & Off-Duty Exclusion Guarantee
                                </h4>
                                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', color: '#4b5563', lineHeight: '1.7' }}>
                                    <li><strong>Shift-Bound Activation:</strong> Geolocation tracking initializes <strong>ONLY</strong> when an employee executes an active Shift <strong>CHECK-IN</strong> or duty status state change.</li>
                                    <li><strong>Collection Frequency & Precision:</strong> Periodic location pings occur automatically every <strong>5 to 15 minutes</strong> during active working hours with 5–15 meter GPS precision.</li>
                                    <li><strong>Off-Duty Privacy Exemption:</strong> Location telemetry is <strong>immediately and automatically terminated</strong> upon shift <strong>CHECK-OUT</strong>. The platform strictly prohibits location tracking outside authorized working hours, on weekends, or during approved leave.</li>
                                    <li><strong>Anti-Spoofing Audits:</strong> Device telemetry monitors for unauthorized location mock/GPS spoofing software to guarantee accurate attendance records.</li>
                                </ul>
                            </div>

                            {/* Section 4: Data Processing & Algorithmic Audit Mechanisms */}
                            <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '20px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ background: '#eff6ff', color: '#2563eb', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}>4</span>
                                    Data Processing & Automated Audit Mechanisms
                                </h4>
                                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', color: '#4b5563', lineHeight: '1.7' }}>
                                    <li><strong>Route Replay & Field Duty Verification:</strong> Sequential GPS pings are rendered into historical route replays to verify client site coverage and field engineer travel routes.</li>
                                    <li><strong>Geofence Boundary Cross-Referencing:</strong> Real-time automated spatial validation checks location coordinates against assigned work site polygons to confirm physical site presence.</li>
                                    <li><strong>AI/OCR Expense Verification:</strong> Optical Character Recognition (OCR) models analyze uploaded receipt media to extract invoice items, preventing fraudulent reimbursement claims.</li>
                                </ul>
                            </div>

                            {/* Section 5: Data Retention, Archival & Purge Schedule */}
                            <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '20px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ background: '#eff6ff', color: '#2563eb', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}>5</span>
                                    Data Retention, Archival & Automatic Purge Schedule
                                </h4>
                                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', color: '#4b5563', lineHeight: '1.7' }}>
                                    <li><strong>Telemetric Location Logs (Footprints):</strong> Retained in active database storage for <strong>90 days</strong> for operational auditing, after which raw coordinates are automatically purged or permanently anonymized.</li>
                                    <li><strong>Attendance & Payroll Compliance Records:</strong> Retained for <strong>7 years</strong> (or applicable statutory employment limit) to comply with labor laws, tax audits, and financial reporting obligations.</li>
                                    <li><strong>System Audit Logs & Security Traces:</strong> Security logs and authentication traces are retained for <strong>180 days</strong> before rolling archival.</li>
                                </ul>
                            </div>

                            {/* Section 6: Technical & Organizational Security Measures (TOMs) */}
                            <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '20px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ background: '#eff6ff', color: '#2563eb', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}>6</span>
                                    Technical & Organizational Security Measures (TOMs)
                                </h4>
                                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', color: '#4b5563', lineHeight: '1.7' }}>
                                    <li><strong>Encryption in Transit:</strong> Transport Layer Security (TLS 1.3 / HTTPS encryption) secures all API communication between client apps and server endpoints.</li>
                                    <li><strong>Encryption at Rest:</strong> AES-256 database storage encryption protects stored credentials, user documents, and financial records.</li>
                                </ul>
                            </div>

                        </div>

                        {/* Modal Footer */}
                        <div 
                            style={{
                                padding: '16px 28px',
                                borderTop: '1px solid #e5e7eb',
                                display: 'flex',
                                justifyContent: 'flex-end',
                                background: '#fafafb',
                                borderBottomLeftRadius: '24px',
                                borderBottomRightRadius: '24px'
                            }}
                        >
                            <button
                                onClick={() => setShowPrivacyModal(false)}
                                style={{
                                    padding: '10px 24px',
                                    borderRadius: '12px',
                                    background: '#2563eb',
                                    color: '#ffffff',
                                    border: 'none',
                                    fontSize: '13.5px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 14px rgba(37, 99, 235, 0.25)'
                                }}
                            >
                                Acknowledge & Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
