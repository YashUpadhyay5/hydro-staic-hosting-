import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Core
import Login from './core/authentication/Login';
import Dashboard from './core/layouts/Dashboard';

// Lazy-loaded route components for high-speed initial page loads
const HrmsModule = React.lazy(() => import('./modules/hrms/HrmsModule'));
const InvoiceLayout = React.lazy(() => import('./modules/invoice/components/Layout'));
const UploadPage = React.lazy(() => import('./modules/invoice/pages/UploadPage'));
const ValidationPage = React.lazy(() => import('./modules/invoice/pages/ValidationPage'));
const ArchivePage = React.lazy(() => import('./modules/invoice/pages/ArchivePage'));
const AnalyticsPage = React.lazy(() => import('./modules/invoice/pages/AnalyticsPage'));
const SettingsPage = React.lazy(() => import('./modules/invoice/pages/SettingsPage'));

// Import style sheets
import './modules/invoice/styles/dashboard.css';

// Helper component for Route Protection
function ProtectedRoute({ children, allowedRoles }) {
    const token = localStorage.getItem('adminToken');
    const userJson = localStorage.getItem('adminUser');
    
    if (!token || !userJson) {
        return <Navigate to="/login" replace />;
    }

    if (allowedRoles) {
        try {
            const user = JSON.parse(userJson);
            const userRole = user.role?.toUpperCase();
            if (userRole !== 'ADMIN' && !allowedRoles.includes(userRole)) {
                return <Navigate to="/" replace />;
            }
        } catch (e) {
            return <Navigate to="/login" replace />;
        }
    }

    return children;
}

export default function AppRoutes() {
    return (
        <BrowserRouter>
            <Suspense fallback={
                <div style={{ minHeight: "100vh", width: "100vw", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-main, #0f172a)", color: "var(--text-primary, #f8fafc)", fontSize: "14px", fontWeight: 600 }}>
                    Loading Workspace...
                </div>
            }>
                <Routes>
                    {/* Public Auth Route */}
                    <Route path="/login" element={<Login />} />

                    {/* Platform Hub Dashboard */}
                    <Route path="/" element={
                        <ProtectedRoute>
                            <Dashboard />
                        </ProtectedRoute>
                    } />

                    {/* HRMS Module Routes */}
                    <Route path="/hrms/*" element={
                        <ProtectedRoute allowedRoles={['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'TRACKING_MANAGER', 'FIELD_INVOICE_MANAGER']}>
                            <HrmsModule />
                        </ProtectedRoute>
                    } />

                    {/* Invoice Extractor Module Routes */}
                    <Route path="/invoice" element={
                        <ProtectedRoute allowedRoles={['ADMIN', 'FINANCE', 'FIELD_INVOICE_MANAGER']}>
                            <InvoiceLayout />
                        </ProtectedRoute>
                    }>
                        <Route index element={<Navigate to="uploads" replace />} />
                        <Route path="uploads" element={<UploadPage />} />
                        <Route path="validation" element={<ValidationPage />} />
                        <Route path="archive" element={<ArchivePage />} />
                        <Route path="analytics" element={<AnalyticsPage />} />
                        <Route path="settings" element={<SettingsPage />} />
                    </Route>

                    {/* Fallback redirect */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Suspense>
        </BrowserRouter>
    );
}
