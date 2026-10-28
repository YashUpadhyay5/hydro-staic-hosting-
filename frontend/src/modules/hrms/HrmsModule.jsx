import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from './services/api';
import { isActiveEmployee } from './utils/helpers';

// Components
import Login from './components/Login';
import Sidebar from './components/Sidebar';

import LoadingSpinner from './components/LoadingSpinner';

// Core High-Frequency Dashboard View (Bundled synchronously for 0ms initial render)
import DashboardView from './components/views/DashboardView';

// Code-Split Operational Views (Loaded on demand & idle preloaded to keep initial bundle tiny <65KB)
const EmployeesView = React.lazy(() => import('./components/views/EmployeesView'));
const AttendanceView = React.lazy(() => import('./components/views/AttendanceView'));
const LeavesView = React.lazy(() => import('./components/views/LeavesView'));
const LeaveBalancesView = React.lazy(() => import('./components/views/LeaveBalancesView'));
const EmployeeLeaveLedgerView = React.lazy(() => import('./components/views/EmployeeLeaveLedgerView'));
const ExpensesView = React.lazy(() => import('./components/views/ExpensesView'));
const PayrollView = React.lazy(() => import('./components/views/PayrollView/index.jsx'));
const LiveTrackingView = React.lazy(() => import('./components/views/LiveTrackingView'));
const RouteReplayView = React.lazy(() => import('./components/views/RouteReplayView'));
const GeofenceView = React.lazy(() => import('./components/views/GeofenceView'));
const DocumentsView = React.lazy(() => import('./components/views/DocumentsView'));
const MediaView = React.lazy(() => import('./components/views/MediaView'));
const EmployeeTrackingView = React.lazy(() => import('./components/views/EmployeeTrackingView'));
const NotificationCenter = React.lazy(() => import('./components/views/NotificationCenter/NotificationCenter'));
const SiteInfoView = React.lazy(() => import('./components/views/SiteInfoView'));
const SettingsView = React.lazy(() => import('./components/views/SettingsView'));
const WhatsAppNotificationSettingsView = React.lazy(() => import('./components/views/WhatsAppNotificationSettingsView'));

// Immediately kick off parallel download of the active route's chunk on cold/hard load
if (typeof window !== 'undefined') {
    const curPath = window.location.pathname;
    if (curPath.includes('/attendance')) import('./components/views/AttendanceView');
    else if (curPath.includes('/employees')) import('./components/views/EmployeesView');
    else if (curPath.includes('/live-tracking')) import('./components/views/LiveTrackingView');
    else if (curPath.includes('/route-replay')) import('./components/views/RouteReplayView');
    else if (curPath.includes('/geofence')) import('./components/views/GeofenceView');
    else if (curPath.includes('/site-info')) import('./components/views/SiteInfoView');
    else if (curPath.includes('/documents')) import('./components/views/DocumentsView');
    else if (curPath.includes('/payroll')) import('./components/views/PayrollView/index.jsx');
    else if (curPath.includes('/leaves/balances/detail')) import('./components/views/EmployeeLeaveLedgerView');
    else if (curPath.includes('/leaves/balances')) import('./components/views/LeaveBalancesView');
    else if (curPath.includes('/leaves')) import('./components/views/LeavesView');
    else if (curPath.includes('/expenses')) import('./components/views/ExpensesView');
    else if (curPath.includes('/media')) import('./components/views/MediaView');
    else if (curPath.includes('/notifications')) import('./components/views/NotificationCenter/NotificationCenter');
    else if (curPath.includes('/settings')) import('./components/views/SettingsView');
    else if (curPath.includes('/whatsapp')) import('./components/views/WhatsAppNotificationSettingsView');
}

import './index.css';

const getInitialView = () => {
    const path = window.location.pathname;
    if (path === '/hrms/employees/addemp' || path === '/employees/addemp') return 'add-employee-view';
    if (path === '/hrms/employees' || path === '/employees') return 'employees-view';
    if (path === '/hrms/attendance' || path === '/hrms/attendence' || path === '/attendance' || path === '/attendence') return 'attendance-view';
    if (path === '/hrms/leaves/balances/detail') return 'leave-balance-detail-view';
    if (path === '/hrms/leaves/balances') return 'leave-balances-view';
    if (path === '/hrms/leaves' || path === '/leaves') return 'leaves-view';
    if (path === '/hrms/expenses' || path === '/expenses') return 'expenses-view';
    if (path === '/hrms/payroll' || path === '/payroll') return 'payroll-view';
    if (path === '/hrms/live-tracking' || path === '/live-tracking') return 'live-tracking-view';
    if (path === '/hrms/route-replay' || path === '/route-replay') return 'route-replay-view';
    if (path === '/hrms/geofence' || path === '/geofence') return 'geofence-view';
    if (path === '/hrms/documents' || path === '/documents') return 'documents-view';
    if (path === '/hrms/media' || path === '/media') return 'media-view';
    if (path.includes('/attendance/tracking') || path.includes('/employees/tracking') || path === '/hrms/employee-tracking' || path === '/employee-tracking') return 'employee-tracking-view';
    if (path === '/hrms/notifications' || path === '/notifications') return 'notifications-view';
    if (path === '/hrms/whatsapp-settings' || path === '/whatsapp-settings') return 'whatsapp-settings-view';
    if (path === '/hrms/site-info' || path === '/site-info') return 'site-info-view';
    if (path === '/hrms/settings' || path === '/settings') return 'settings-view';
    
    // Fallback to last active view in localStorage if path is /hrms or /
    const savedView = localStorage.getItem('activeHrmsView');
    return savedView || 'dashboard-view';
};

const getPathForView = (view, employeeId, employeeName = '', origin = null, date = null) => {
    if (view === 'add-employee-view') return '/hrms/employees/addemp';
    if (view === 'employees-view') return '/hrms/employees';
    if (view === 'attendance-view') return '/hrms/attendance';
    if (view === 'leaves-view') return '/hrms/leaves';
    if (view === 'leave-balances-view') return '/hrms/leaves/balances';
    // For the ledger view, `date` carries the selected year.
    if (view === 'leave-balance-detail-view') {
        return `/hrms/leaves/balances/detail?id=${encodeURIComponent(employeeId || '')}${date ? `&year=${encodeURIComponent(date)}` : ''}`;
    }
    if (view === 'expenses-view') return '/hrms/expenses';
    if (view === 'payroll-view') return '/hrms/payroll';
    if (view === 'live-tracking-view') return '/hrms/live-tracking';
    if (view === 'route-replay-view') return '/hrms/route-replay';
    if (view === 'geofence-view') return '/hrms/geofence';
    if (view === 'documents-view') return '/hrms/documents';
    if (view === 'media-view') return '/hrms/media';
    if (view === 'employee-tracking-view') {
        const activeOrigin = origin || sessionStorage.getItem('trackingOrigin') || (window.location.pathname.includes('/attendance') ? 'attendance-view' : 'employees-view');
        const activeName = employeeName || sessionStorage.getItem('trackingName') || '';
        const nameQuery = activeName ? `&name=${encodeURIComponent(activeName)}` : '';
        const originQuery = `&origin=${activeOrigin}`;
        const activeDate = date || sessionStorage.getItem('trackingDate') || '';
        const dateQuery = activeDate ? `&date=${encodeURIComponent(activeDate)}` : '';
        const basePath = activeOrigin === 'attendance-view' ? '/hrms/attendance/tracking' : '/hrms/employees/tracking';
        return `${basePath}?id=${employeeId || ''}${nameQuery}${originQuery}${dateQuery}`;
    }
    if (view === 'notifications-view') return '/hrms/notifications';
    if (view === 'whatsapp-settings-view') return '/hrms/whatsapp-settings';
    if (view === 'site-info-view') return '/hrms/site-info';
    if (view === 'settings-view') return '/hrms/settings';
    return '/hrms';
};

function App() {
    const [adminUser, setAdminUser] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('adminUser'));
        } catch {
            return null;
        }
    });
    const [token, setToken] = useState(() => localStorage.getItem('adminToken'));
    const [currentView, setCurrentView] = useState(getInitialView);
    const [employees, setEmployees] = useState([]);
    
    // Employee deep-dive tracking state with F5 page refresh persistence
    const [selectedEmployeeId, setSelectedEmployeeId] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('id') || sessionStorage.getItem('trackingId') || null;
    });
    const [selectedEmployeeName, setSelectedEmployeeName] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('name') || sessionStorage.getItem('trackingName') || '';
    });
    const [trackingOrigin, setTrackingOrigin] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = params.get('origin');
        if (fromQuery) return fromQuery;
        if (window.location.pathname.includes('/attendance')) return 'attendance-view';
        return sessionStorage.getItem('trackingOrigin') || 'attendance-view';
    });

    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => localStorage.getItem('isSidebarCollapsed') === 'true');
    const [badgeCounts, setBadgeCounts] = useState({
        'leaves-view': 0,
        'expenses-view': 0,
        'notifications-view': 0
    });

    useEffect(() => {
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    const navigate = useNavigate();
    const location = useLocation();




    // A view with unsaved edits registers a guard; it returns false to cancel navigation.
    const navigationGuardRef = React.useRef(null);
    const currentPathRef = React.useRef(window.location.pathname + window.location.search);
    const registerNavigationGuard = React.useCallback((guard) => { navigationGuardRef.current = guard; }, []);
    const [routeSearch, setRouteSearch] = useState(() => window.location.search);

    const navigateToView = (view, employeeId = null, employeeName = '', origin = null, date = null) => {
        if (navigationGuardRef.current && !navigationGuardRef.current()) return;
        navigationGuardRef.current = null;
        const path = getPathForView(view, employeeId, employeeName, origin, date);
        window.history.pushState(null, '', path);
        currentPathRef.current = path;
        localStorage.setItem('activeHrmsView', view);
        setRouteSearch(window.location.search);
        setCurrentView(view);
    };

    const handleLoginSuccess = (user, jwtToken) => {
        setAdminUser(user);
        setToken(jwtToken);
        const initial = getInitialView();
        setCurrentView(initial);
        
        let employeeId = null;
        if (initial === 'employee-tracking-view') {
            const params = new URLSearchParams(window.location.search);
            employeeId = params.get('id');
        }
        const path = initial === 'leave-balance-detail-view'
            ? window.location.pathname + window.location.search
            : getPathForView(initial, employeeId);
        window.history.replaceState(null, '', path);
    };

    const handleLogout = () => {
        localStorage.removeItem('adminUser');
        localStorage.removeItem('adminToken');
        sessionStorage.removeItem('trackingOrigin');
        sessionStorage.removeItem('trackingName');
        sessionStorage.removeItem('trackingId');
        setAdminUser(null);
        setToken(null);
        setEmployees([]);
        window.history.replaceState(null, '', '/');
    };

    // Load and refresh employees list
    const refreshEmployees = async () => {
        try {
            const data = await api.getEmployees({ limit: 1000 });
            const list = Array.isArray(data) ? data : (data && data.data ? data.data : []);
            setEmployees(list);
            return list;
        } catch (err) {
            console.error('Failed to refresh employees:', err);
            return [];
        }
    };

    useEffect(() => {
        if (adminUser && token) {
            refreshEmployees();
            
            // Prefetch secondary view code and data during idle time to prevent network saturation at startup
            const prefetchIdleViews = () => {
                import('./components/views/LeavesView');
                api.getLeaves().catch(() => {});
                import('./components/views/ExpensesView');
                import('./components/views/PayrollView/index.jsx');
                import('./components/views/DocumentsView');
                import('./components/views/SettingsView');
            };

            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                const idleId = window.requestIdleCallback(prefetchIdleViews, { timeout: 4000 });
                return () => window.cancelIdleCallback(idleId);
            } else {
                const timer = setTimeout(prefetchIdleViews, 2500);
                return () => clearTimeout(timer);
            }
        }
    }, [adminUser, token]);

    // Optimistic local state update on employee modifications
    useEffect(() => {
        const handleEmployeeUpdated = (e) => {
            const updated = e.detail;
            if (!updated) return;
            if (updated.action === 'delete') {
                setEmployees(prev => prev.filter(emp => emp.id !== updated.id));
            } else if (updated.id) {
                setEmployees(prev => prev.map(emp => emp.id === updated.id ? { ...emp, ...updated } : emp));
            }
        };
        window.addEventListener('employee-updated', handleEmployeeUpdated);
        return () => window.removeEventListener('employee-updated', handleEmployeeUpdated);
    }, []);

    // Real-time Badge Counts Sync (Leaves, Expenses, Notifications)
    const refreshBadgeCounts = async () => {
        if (!adminUser || !token) return;
        try {
            const [summaryRes, notifRes] = await Promise.allSettled([
                api.getDashboardSummary(true),
                api.getNotificationStats()
            ]);

            const nextBadges = {};
            if (summaryRes.status === 'fulfilled' && summaryRes.value) {
                nextBadges['leaves-view'] = Number(summaryRes.value.pendingLeavesCount || 0);
                nextBadges['expenses-view'] = Number(summaryRes.value.pendingExpensesCount || 0);
            }
            if (notifRes.status === 'fulfilled' && notifRes.value?.success && notifRes.value?.data) {
                nextBadges['notifications-view'] = Number(notifRes.value.data.pendingNotifications || 0);
            }

            setBadgeCounts(prev => ({
                ...prev,
                ...nextBadges
            }));
        } catch (err) {
            console.warn('Failed to refresh sidebar badges:', err);
        }
    };

    useEffect(() => {
        if (adminUser && token) {
            refreshBadgeCounts();
            const interval = setInterval(refreshBadgeCounts, 30000); // 30s background poll
            const handleFocus = () => refreshBadgeCounts();
            const handleCustomSync = () => refreshBadgeCounts();
            window.addEventListener('focus', handleFocus);
            window.addEventListener('hrms-badge-sync', handleCustomSync);

            return () => {
                clearInterval(interval);
                window.removeEventListener('focus', handleFocus);
                window.removeEventListener('hrms-badge-sync', handleCustomSync);
            };
        }
    }, [adminUser, token]);

    // Handle back/forward popstate
    useEffect(() => {
        const handlePopState = () => {
            if (navigationGuardRef.current && !navigationGuardRef.current()) {
                window.history.pushState(null, '', currentPathRef.current);
                return;
            }
            navigationGuardRef.current = null;
            currentPathRef.current = window.location.pathname + window.location.search;
            setRouteSearch(window.location.search);
            const initial = getInitialView();
            setCurrentView(initial);
            const params = new URLSearchParams(window.location.search);
            if (initial === 'employee-tracking-view') {
                setSelectedEmployeeId(params.get('id') || sessionStorage.getItem('trackingId'));
                setSelectedEmployeeName(params.get('name') || sessionStorage.getItem('trackingName') || '');
                setTrackingOrigin(params.get('origin') || sessionStorage.getItem('trackingOrigin') || (window.location.pathname.includes('/attendance') ? 'attendance-view' : 'employees-view'));
            } else {
                setSelectedEmployeeId(null);
                setSelectedEmployeeName('');
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    // Sync employee name if list is fetched and id is present
    useEffect(() => {
        if (selectedEmployeeId && employees.length > 0 && !selectedEmployeeName) {
            const emp = employees.find(e => String(e._id || e.id || e.employeeId) === String(selectedEmployeeId));
            if (emp) {
                setSelectedEmployeeName(emp.name);
                sessionStorage.setItem('trackingName', emp.name);
            }
        }
    }, [selectedEmployeeId, employees, selectedEmployeeName]);

    // Format current view title
    const getViewTitle = () => {
        if (currentView === 'employee-tracking-view') return 'Employee Tracking Details';
        const titleMap = {
            'dashboard-view': 'Overview',
            'employees-view': 'Employees',
            'attendance-view': 'Attendance Logs',
            'leaves-view': 'Leave Management',
            'leave-balances-view': 'Leave Management',
            'leave-balance-detail-view': 'Leave Management',
            'expenses-view': 'Expenses & Claims',
            'payroll-view': 'Payroll & Salary Management',
            'live-tracking-view': 'Live Employee Tracking',
            'route-replay-view': 'Historical Route Replay',
            'geofence-view': 'Office Geofence Configuration',
            'documents-view': 'Document Center',
            'media-view': 'Photos & Media',
            'notifications-view': 'Notification Center',
            'whatsapp-settings-view': 'WhatsApp Attendance Summary Notifications',
            'site-info-view': 'Site Info & GPS Geofence Analytics',
            'settings-view': 'System Settings & Legal Audit Log'
        };
        return titleMap[currentView] || 'Overview';
    };

    const handleSelectEmployee = (id, name, date = null) => {
        const origin = currentView === 'attendance-view' ? 'attendance-view' : 'employees-view';
        setTrackingOrigin(origin);
        setSelectedEmployeeId(id);
        setSelectedEmployeeName(name || '');
        sessionStorage.setItem('trackingOrigin', origin);
        sessionStorage.setItem('trackingName', name || '');
        sessionStorage.setItem('trackingId', id || '');
        if (date) sessionStorage.setItem('trackingDate', date);
        navigateToView('employee-tracking-view', id, name, origin, date);
        setIsSidebarOpen(false);
    };

    const handleBackToEmployees = () => {
        setSelectedEmployeeId(null);
        setSelectedEmployeeName('');
        const target = trackingOrigin || sessionStorage.getItem('trackingOrigin') || 'attendance-view';
        sessionStorage.removeItem('trackingOrigin');
        sessionStorage.removeItem('trackingName');
        sessionStorage.removeItem('trackingId');
        navigateToView(target);
    };

    if (!adminUser || !token) {
        return <Login onLoginSuccess={handleLoginSuccess} />;
    }

    const isFullViewportView = currentView === 'live-tracking-view' || currentView === 'route-replay-view';
    const activeEmployees = employees.filter(isActiveEmployee);

    return (
        <div id="dashboard-screen" className={isSidebarCollapsed ? 'sidebar-collapsed' : ''}>
            <div className={`sidebar-overlay ${isSidebarOpen ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}></div>
            <Sidebar 
                adminUser={adminUser} 
                currentView={currentView}
                trackingOrigin={trackingOrigin}
                badgeCounts={badgeCounts}
                onViewChange={(view) => {
                    navigateToView(view);
                    setIsSidebarOpen(false);
                }}
                onLogout={handleLogout}
                isSidebarOpen={isSidebarOpen}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => {
                    setIsSidebarCollapsed(prev => {
                        const next = !prev;
                        localStorage.setItem('isSidebarCollapsed', String(next));
                        return next;
                    });
                }}
            />
            <main className="main-content" style={{ overflow: 'hidden', height: '100vh', display: 'flex', flexDirection: 'column' }}>
                <header className="top-header glass" style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', top: 0, zIndex: 100, background: 'var(--panel-bg)', boxShadow: '0 1px 4px rgba(0,0,0,0.03)', margin: '0 0 10px 0', borderRadius: '10px', padding: '6px 14px', minHeight: '46px' }}>
                    <div className="header-left">
                        <h1 id="current-view-title" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>{getViewTitle()}</h1>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button 
                            onClick={toggleTheme}
                            style={{
                                background: 'var(--bg-dark)',
                                border: '1px solid var(--border-glass)',
                                color: 'var(--text-primary)',
                                padding: '5px 12px',
                                height: '32px',
                                borderRadius: '7px',
                                cursor: 'pointer',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.15s'
                            }}
                        >
                            {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
                        </button>
                        <div className="admin-profile-compact" onClick={() => navigateToView('dashboard-view')}>
                            <div className="avatar" style={{ width: '28px', height: '28px', fontSize: '11px' }}>
                                <i className="fa-solid fa-user-tie"></i>
                            </div>
                            <div className="info">
                                <span className="name" style={{ fontSize: '12px', fontWeight: 600 }}>{adminUser?.name || 'Admin'}</span>
                            </div>
                        </div>
                    </div>
                </header>

                <div className="content-wrapper custom-scrollbar" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: '12px' }}>
                    <React.Suspense fallback={
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', height: '100%' }}>
                            <div style={{ height: '48px', background: 'var(--panel-bg)', borderRadius: '10px', opacity: 0.5, border: '1px solid var(--border-glass)' }}></div>
                            <div style={{ flex: 1, background: 'var(--panel-bg)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, border: '1px solid var(--border-glass)' }}>
                                <LoadingSpinner size={36} message="" minHeight="120px" />
                            </div>
                        </div>
                    }>
                        {currentView === 'dashboard-view' && (
                            <DashboardView 
                                employees={activeEmployees} 
                                totalEmployees={employees.filter(e => String(e?.status || 'ACTIVE').toUpperCase() === 'ACTIVE' && !e?.isSystemAccount && !e?.is_system_account).length} 
                                onViewChange={navigateToView}
                            />
                        )}
                        {currentView === 'employees-view' && (
                            <EmployeesView 
                                employees={employees} 
                                onSelectEmployee={handleSelectEmployee}
                                refreshEmployees={refreshEmployees}
                                navigateToView={navigateToView}
                            />
                        )}
                        {currentView === 'add-employee-view' && (
                            <EmployeesView 
                                employees={employees} 
                                onSelectEmployee={handleSelectEmployee}
                                refreshEmployees={refreshEmployees}
                                initialAddMode={true}
                                navigateToView={navigateToView}
                            />
                        )}
                        {currentView === 'attendance-view' && <AttendanceView employees={employees} activeEmployees={activeEmployees} onSelectEmployee={handleSelectEmployee} />}
                        {currentView === 'leaves-view' && <LeavesView employees={employees} activeEmployees={activeEmployees} onOpenBalances={() => navigateToView('leave-balances-view')} />}
                        {currentView === 'leave-balances-view' && (
                            <LeaveBalancesView
                                onOpenEmployee={(employeeId, year) => navigateToView('leave-balance-detail-view', employeeId, '', null, year)}
                                onBackToRequests={() => navigateToView('leaves-view')}
                            />
                        )}
                        {currentView === 'leave-balance-detail-view' && (
                            <EmployeeLeaveLedgerView
                                key={routeSearch}
                                employeeId={new URLSearchParams(routeSearch).get('id')}
                                initialYear={new URLSearchParams(routeSearch).get('year')}
                                adminUser={adminUser}
                                onBack={() => navigateToView('leave-balances-view')}
                                onYearChange={(year) => {
                                    const id = new URLSearchParams(routeSearch).get('id');
                                    const path = getPathForView('leave-balance-detail-view', id, '', null, year);
                                    window.history.replaceState(null, '', path);
                                    currentPathRef.current = path;
                                }}
                                registerNavigationGuard={registerNavigationGuard}
                            />
                        )}
                        {currentView === 'expenses-view' && <ExpensesView employees={employees} />}
                        {currentView === 'payroll-view' && <PayrollView employees={employees} adminUser={adminUser} />}
                        {currentView === 'live-tracking-view' && <LiveTrackingView employees={activeEmployees} />}
                        {currentView === 'route-replay-view' && <RouteReplayView employees={activeEmployees} />}
                        {currentView === 'geofence-view' && <GeofenceView />}
                        {currentView === 'documents-view' && (
                            <DocumentsView 
                                employees={employees} 
                                adminUser={adminUser}
                            />
                        )}
                        {currentView === 'media-view' && <MediaView employees={employees} />}
                        {currentView === 'employee-tracking-view' && (
                            <EmployeeTrackingView 
                                userId={selectedEmployeeId}
                                userName={selectedEmployeeName}
                                employees={employees}
                                onBack={handleBackToEmployees}
                                backText={trackingOrigin === 'attendance-view' ? 'Back to Attendance' : 'Back to Employees'}
                            />
                        )}
                        {currentView === 'notifications-view' && <NotificationCenter />}
                        {currentView === 'whatsapp-settings-view' && <WhatsAppNotificationSettingsView />}
                        {currentView === 'site-info-view' && <SiteInfoView employees={activeEmployees} />}
                        {currentView === 'settings-view' && <SettingsView />}
                    </React.Suspense>
                </div>
            </main>
        </div>
    );
}

export default App;
