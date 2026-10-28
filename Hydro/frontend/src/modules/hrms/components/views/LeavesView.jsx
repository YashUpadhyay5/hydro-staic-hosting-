import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../../services/api';
import { formatDate } from '../../utils/helpers';
import LeaveAdjustmentModal from './LeaveAdjustmentModal';

export default function LeavesView({ employees = [], activeEmployees, onOpenBalances }) {
    const adminUser = (() => {
        try {
            return JSON.parse(localStorage.getItem('adminUser'));
        } catch {
            return null;
        }
    })();
    const isTrackingManager = ['TRACKING_MANAGER', 'FIELD_INVOICE_MANAGER'].includes(String(adminUser?.role || 'ADMIN').toUpperCase());

    const cachedLeaves = api.getCached('/leaves');
    const [leaves, setLeaves] = useState(() => Array.isArray(cachedLeaves) ? cachedLeaves : []);
    const [loading, setLoading] = useState(() => !cachedLeaves || cachedLeaves.length === 0);
    const [error, setError] = useState(false);
    
    // Search & Filter States
    const [filter, setFilter] = useState('all'); // 'all', 'pending', 'approved', 'rejected'
    const [searchQuery, setSearchQuery] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [showAdjustModal, setShowAdjustModal] = useState(false);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    // Fast O(1) Employee Lookup Map
    const empMap = useMemo(() => {
        const map = new Map();
        (employees || []).forEach(e => {
            if (e.id) map.set(String(e.id).toLowerCase(), e);
            if (e.empCode) map.set(String(e.empCode).toLowerCase(), e);
            if (e.name) map.set(String(e.name).toLowerCase(), e);
        });
        return map;
    }, [employees]);

    // O(1) Helper to resolve up-to-date employee ID (empCode) and Employee Name
    const getEmployeeDisplayInfo = useCallback((leave) => {
        if (!leave) return { empCode: '-', empName: 'Unknown' };
        const uId = String(leave.userId || '').toLowerCase();
        const uName = String(leave.userName || '').toLowerCase();
        const eCode = String(leave.empCode || '').toLowerCase();
        const emp = empMap.get(uId) || empMap.get(eCode) || empMap.get(uName);
        const empCode = emp?.empCode || leave.empCode || leave.userId || '-';
        const empName = emp?.name || leave.userName || 'Unknown';
        return { empCode, empName };
    }, [empMap]);

    const fetchLeaves = useCallback(async (signal = null) => {
        try {
            const data = await api.getLeaves(null, signal ? { signal } : {});
            if (Array.isArray(data)) {
                setLeaves(data);
                setError(false);
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Failed to load leaves:', err);
                if (!leaves.length) setError(true);
            }
        } finally {
            setLoading(false);
        }
    }, [leaves.length]);

    useEffect(() => {
        const controller = new AbortController();
        fetchLeaves(controller.signal);
        return () => controller.abort();
    }, [fetchLeaves]);

    // Reset pagination when filter or search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [filter, searchQuery, fromDate, toDate]);

    // Helper to get current acting admin name
    const getCurrentAdminName = () => {
        try {
            const raw = localStorage.getItem('adminUser');
            if (raw) {
                const admin = JSON.parse(raw);
                if (admin.name && admin.name.trim()) return admin.name.trim();
                if (admin.empCode && admin.empCode.trim()) return admin.empCode.trim();
                if (admin.email && admin.email.trim()) return admin.email.split('@')[0];
            }
            const username = localStorage.getItem('username');
            if (username && username.trim()) return username.trim();
        } catch (e) {}
        return 'Admin';
    };

    // 0ms Optimistic status change with automatic background sync
    const handleUpdateStatus = async (id, status) => {
        if (!confirm(`Are you sure you want to ${status} this leave request?`)) return;
        const currentAdmin = getCurrentAdminName();
        setLeaves(prev => prev.map(l => l.id === id ? { ...l, status, actionBy: currentAdmin } : l));
        try {
            await api.updateLeaveStatus(id, status, currentAdmin);
            window.dispatchEvent(new CustomEvent('hrms-badge-sync'));
        } catch (err) {
            alert('Failed to update leave status: ' + (err.response?.data?.error || err.message));
            fetchLeaves();
        }
    };

    // Memoized filtered leaves to prevent main thread stutters
    const filteredLeaves = useMemo(() => {
        let list = leaves;
        if (filter !== 'all') {
            list = list.filter(leave => String(leave.status || '').toLowerCase().trim() === filter);
        }

        if (fromDate) {
            const from = new Date(fromDate);
            from.setHours(0, 0, 0, 0);
            list = list.filter(leave => {
                if (!leave.startDate) return false;
                const leaveDate = new Date(leave.startDate);
                if (isNaN(leaveDate.getTime()) && !isNaN(Number(leave.startDate))) {
                    return new Date(Number(leave.startDate)) >= from;
                }
                return leaveDate >= from;
            });
        }

        if (toDate) {
            const to = new Date(toDate);
            to.setHours(23, 59, 59, 999);
            list = list.filter(leave => {
                if (!leave.startDate) return false;
                const leaveDate = new Date(leave.startDate);
                if (isNaN(leaveDate.getTime()) && !isNaN(Number(leave.startDate))) {
                    return new Date(Number(leave.startDate)) <= to;
                }
                return leaveDate <= to;
            });
        }

        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase();
            list = list.filter(leave => {
                const { empCode, empName } = getEmployeeDisplayInfo(leave);
                const nameMatch = empName && empName.toLowerCase().includes(query);
                const codeMatch = empCode && empCode.toLowerCase().includes(query);
                const reasonMatch = leave.reason && leave.reason.toLowerCase().includes(query);
                return nameMatch || codeMatch || reasonMatch;
            });
        }

        return list;
    }, [leaves, filter, fromDate, toDate, searchQuery, getEmployeeDisplayInfo]);

    // Paginated leaves
    const totalItems = filteredLeaves.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginatedLeaves = useMemo(() => {
        return filteredLeaves.slice(startIndex, endIndex);
    }, [filteredLeaves, startIndex, endIndex]);

    return (
        <div id="leaves-view" className="view active" style={{ minHeight: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Toolbar: Filters & Search */}
            <div className="glass" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <button 
                        className={`btn ${filter === 'all' ? 'btn-primary' : ''}`} 
                        onClick={() => setFilter('all')}
                        style={{ height: '38px', padding: '0 16px', borderRadius: '6px', fontSize: '0.875rem', background: filter !== 'all' ? 'var(--input-bg, #f3f4f6)' : undefined, color: filter !== 'all' ? 'var(--text-primary, #374151)' : undefined }}
                    >
                        All Requests
                    </button>
                    <button 
                        className={`btn ${filter === 'pending' ? 'btn-primary' : ''}`} 
                        onClick={() => setFilter('pending')}
                        style={{ 
                            height: '38px',
                            padding: '0 16px',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            background: filter === 'pending' ? undefined : 'var(--input-bg, #f3f4f6)', 
                            color: filter === 'pending' ? undefined : 'var(--text-primary, #374151)',
                            border: filter === 'pending' ? undefined : '1px solid var(--border-glass, #d1d5db)'
                        }}
                    >
                        Pending
                    </button>
                    <button 
                        className={`btn ${filter === 'approved' ? 'btn-primary' : ''}`} 
                        onClick={() => setFilter('approved')}
                        style={{ 
                            height: '38px',
                            padding: '0 16px',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            background: filter === 'approved' ? '#10b981' : 'var(--input-bg, #f3f4f6)', 
                            color: filter === 'approved' ? 'white' : 'var(--text-primary, #374151)',
                            border: filter === 'approved' ? undefined : '1px solid var(--border-glass, #d1d5db)'
                        }}
                    >
                        Approved
                    </button>
                    <button 
                        className={`btn ${filter === 'rejected' ? 'btn-primary' : ''}`} 
                        onClick={() => setFilter('rejected')}
                        style={{ 
                            height: '38px',
                            padding: '0 16px',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            background: filter === 'rejected' ? '#ef4444' : 'var(--input-bg, #f3f4f6)', 
                            color: filter === 'rejected' ? 'white' : 'var(--text-primary, #374151)',
                            border: filter === 'rejected' ? undefined : '1px solid var(--border-glass, #d1d5db)'
                        }}
                    >
                        Rejected
                    </button>
                    {onOpenBalances && (
                        <button
                            className="btn"
                            onClick={onOpenBalances}
                            style={{
                                height: '38px',
                                padding: '0 16px',
                                borderRadius: '6px',
                                fontSize: '0.875rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'var(--input-bg, #f3f4f6)',
                                color: 'var(--text-primary, #374151)',
                                border: '1px solid var(--border-glass, #d1d5db)'
                            }}
                        >
                            <i className="fa-solid fa-scale-balanced"></i>
                            <span>Leave Balances</span>
                        </button>
                    )}
                    {!isTrackingManager && (
                        <button
                            className="btn btn-primary"
                            onClick={() => setShowAdjustModal(true)}
                            style={{
                                height: '38px',
                                padding: '0 16px',
                                borderRadius: '6px',
                                fontSize: '0.875rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                                color: '#ffffff',
                                border: 'none',
                                cursor: 'pointer',
                                fontWeight: 600,
                                boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)'
                            }}
                        >
                            <i className="fa-solid fa-plus-circle"></i>
                            <span>Add Opening Balance</span>
                        </button>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary, #4b5563)' }}>From Date</span>
                            <input 
                                type="date" 
                                value={fromDate} 
                                onChange={(e) => setFromDate(e.target.value)}
                                style={{
                                    height: '38px',
                                    padding: '0 12px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-glass, #e5e7eb)',
                                    fontSize: '0.875rem',
                                    outline: 'none',
                                    background: 'var(--input-bg, #ffffff)',
                                    color: 'var(--text-primary, #111827)'
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary, #4b5563)' }}>To Date</span>
                            <input 
                                type="date" 
                                value={toDate} 
                                onChange={(e) => setToDate(e.target.value)}
                                style={{
                                    height: '38px',
                                    padding: '0 12px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-glass, #e5e7eb)',
                                    fontSize: '0.875rem',
                                    outline: 'none',
                                    background: 'var(--input-bg, #ffffff)',
                                    color: 'var(--text-primary, #111827)'
                                }}
                            />
                        </div>
                        {(fromDate || toDate) && (
                            <button 
                                className="btn"
                                onClick={() => { setFromDate(''); setToDate(''); }}
                                style={{ background: '#ef4444', color: 'white', padding: '0 12px', borderRadius: '6px', cursor: 'pointer', height: '38px', fontSize: '0.85rem' }}
                            >
                                Clear Range
                            </button>
                        )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '260px' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary, #4b5563)' }}>Search Requests</span>
                        <input 
                            type="text" 
                            placeholder="Search by Employee Name, ID, or Reason..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{
                                width: '100%',
                                height: '38px',
                                padding: '0 12px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-glass, #e5e7eb)',
                                fontSize: '0.875rem',
                                outline: 'none',
                                background: 'var(--input-bg, #ffffff)',
                                color: 'var(--text-primary, #111827)'
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Table Container */}
            <div className="table-container glass custom-scrollbar" style={{ padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', borderRadius: '16px' }}>
                <div className="desktop-table-view">
                <table id="leaves-table">
                    <thead>
                        <tr>
                            <th>Date Applied</th>
                            <th>Employee</th>
                            <th>Duration</th>
                            <th>Reason</th>
                            <th>Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && paginatedLeaves.length === 0 ? (
                            <tr><td colSpan="6" style={{ padding: "40px 0" }}><LoadingSpinner message="Fetching Leave Requests..." minHeight="220px" /></td></tr>
                        ) : error && paginatedLeaves.length === 0 ? (
                            <tr><td colSpan="6" className="error-text" style={{ textAlign: 'center', padding: '30px' }}>Failed to load leaves</td></tr>
                        ) : paginatedLeaves.length === 0 ? (
                            <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>No leave requests found.</td></tr>
                        ) : (
                            paginatedLeaves.map(leave => {
                                const { empCode, empName } = getEmployeeDisplayInfo(leave);
                                return (
                                    <tr key={leave.id}>
                                        <td>{formatDate(leave.appliedAt)}</td>
                                        <td>
                                            <strong style={{ color: '#4f46e5', display: 'block' }}>{empName}</strong>
                                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{empCode}</span>
                                        </td>
                                        <td>{formatDate(leave.startDate)} - {formatDate(leave.endDate)}</td>
                                        <td>{leave.reason}</td>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                                                <span className={`badge-status badge-${String(leave.status || '').toLowerCase()}`}>{String(leave.status || '').toUpperCase()}</span>
                                                {leave.actionBy && String(leave.status || '').toLowerCase() !== 'pending' && (
                                                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                                                        by <strong style={{ color: '#4f46e5' }}>{leave.actionBy}</strong>
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            {String(leave.status || '').toLowerCase() === 'pending' && !isTrackingManager ? (
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <button className="btn btn-success" title="Approve" onClick={() => handleUpdateStatus(leave.id, 'approved')}>
                                                        <i className="fa-solid fa-check"></i>
                                                    </button>
                                                    <button className="btn btn-danger" title="Reject" onClick={() => handleUpdateStatus(leave.id, 'rejected')}>
                                                        <i className="fa-solid fa-xmark"></i>
                                                    </button>
                                                </div>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
                </div>

                {/* Mobile Leave Cards */}
                <div className="mobile-cards-only" style={{ padding: '8px 12px' }}>
                    {loading && paginatedLeaves.length === 0 ? (
                        <LoadingSpinner message="Fetching Leave Requests..." minHeight="180px" />
                    ) : error && paginatedLeaves.length === 0 ? (
                        <div className="error-text" style={{ textAlign: 'center', padding: '30px' }}>Failed to load leaves</div>
                    ) : paginatedLeaves.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>No leave requests found.</div>
                    ) : (
                        paginatedLeaves.map(leave => {
                            const { empCode, empName } = getEmployeeDisplayInfo(leave);
                            const isPending = String(leave.status || '').toLowerCase() === 'pending';
                            return (
                                <div key={leave.id} className="mobile-record-card">
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{empName}</h4>
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{empCode} • Applied: {formatDate(leave.appliedAt)}</span>
                                        </div>
                                        <span className={`badge-status badge-${String(leave.status || '').toLowerCase()}`}>
                                            {String(leave.status || '').toUpperCase()}
                                        </span>
                                    </div>

                                    <div style={{ background: 'var(--input-bg, #f8fafc)', padding: '8px 12px', borderRadius: '8px', fontSize: '12px' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <i className="fa-solid fa-calendar-days" style={{ color: '#2563eb' }}></i>
                                            {formatDate(leave.startDate)} – {formatDate(leave.endDate)}
                                        </div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>
                                            {leave.reason || 'No reason provided'}
                                        </div>
                                    </div>

                                    {leave.actionBy && !isPending && (
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                            Processed by: <b>{leave.actionBy}</b>
                                        </div>
                                    )}

                                    {isPending && !isTrackingManager && (
                                        <div style={{ display: 'flex', gap: '8px', paddingTop: '6px', borderTop: '1px solid var(--border-glass, #e2e8f0)' }}>
                                            <button 
                                                type="button"
                                                className="btn btn-success" 
                                                onClick={() => handleUpdateStatus(leave.id, 'approved')}
                                                style={{ flex: 1, minHeight: '40px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                            >
                                                <i className="fa-solid fa-check"></i> Approve
                                            </button>
                                            <button 
                                                type="button"
                                                className="btn btn-danger" 
                                                onClick={() => handleUpdateStatus(leave.id, 'rejected')}
                                                style={{ flex: 1, minHeight: '40px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                            >
                                                <i className="fa-solid fa-xmark"></i> Reject
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Pagination Footer */}
                {totalItems > 0 && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        padding: '14px 24px',
                        borderTop: '1px solid #e5e7eb',
                        gap: '20px',
                        fontSize: '0.875rem',
                        color: '#4b5563'
                    }}>
                        <span>
                            {startIndex + 1}–{endIndex} of {totalItems}
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                                style={{
                                    border: '1px solid #e5e7eb',
                                    background: 'white',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                    opacity: currentPage === 1 ? 0.5 : 1,
                                    fontWeight: 'bold'
                                }}
                            >
                                &lt;
                            </button>
                            <button 
                                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                disabled={currentPage === totalPages}
                                style={{
                                    border: '1px solid #e5e7eb',
                                    background: 'white',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                    opacity: currentPage === totalPages ? 0.5 : 1,
                                    fontWeight: 'bold'
                                }}
                            >
                                &gt;
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Leave Balance Adjustment Modal - Conditionally Mounted */}
            {showAdjustModal && (
                <LeaveAdjustmentModal
                    isOpen={showAdjustModal}
                    onClose={() => setShowAdjustModal(false)}
                    employees={activeEmployees || employees}
                    onSuccess={() => {
                        fetchLeaves();
                    }}
                />
            )}
        </div>
    );
}
