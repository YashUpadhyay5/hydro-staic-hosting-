import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../../services/api';
import { Avatar, SummaryCard } from './leaveBalanceUi';
import { fmtDays, useToast } from './leaveBalanceUtils';
import LeaveImportModal from './LeaveImportModal';
import './leaveBalances.css';

const FILTERS_KEY = 'leaveBalancesFilters';
const PAGE_SIZE = 15;

function loadSavedFilters() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(FILTERS_KEY) || '{}');
        return { search: saved.search || '', department: saved.department || '', year: Number(saved.year) || new Date().getFullYear(), page: Number(saved.page) || 1 };
    } catch {
        return { search: '', department: '', year: new Date().getFullYear(), page: 1 };
    }
}

export default function LeaveBalancesView({ onOpenEmployee, onBackToRequests }) {
    const [filters, setFilters] = useState(loadSavedFilters);
    const [searchInput, setSearchInput] = useState(filters.search);
    const [meta, setMeta] = useState({ departments: [], years: [new Date().getFullYear()] });
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reloadToken, setReloadToken] = useState(0);
    const [showImport, setShowImport] = useState(false);
    const [toastNode, showToast] = useToast();

    // Persist filters so "Back to List" restores search, filters and page.
    useEffect(() => {
        try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* storage unavailable */ }
    }, [filters]);

    useEffect(() => {
        api.getLeaveBalanceMeta().then((m) => { if (m) setMeta(m); }).catch(() => { /* filters fall back to defaults */ });
    }, []);

    // Debounced search
    useEffect(() => {
        if (searchInput === filters.search) return undefined;
        const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchInput, page: 1 })), 350);
        return () => clearTimeout(t);
    }, [searchInput, filters.search]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError('');
        api.getLeaveBalances({ year: filters.year, department: filters.department, search: filters.search, page: filters.page, limit: PAGE_SIZE }, { signal: controller.signal })
            .then((data) => {
                if (!data) return;
                setResult(data);
                if (data.page !== filters.page) setFilters((f) => ({ ...f, page: data.page }));
            })
            .catch((err) => setError(err.message || 'Failed to load leave balances.'))
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [filters.year, filters.department, filters.search, filters.page, reloadToken]);

    const setFilter = useCallback((key, value) => setFilters((f) => ({ ...f, [key]: value, page: 1 })), []);
    const open = (row) => onOpenEmployee(row.employeeId, filters.year);
    const rows = result?.data || [];
    const summary = result?.summary;
    const years = meta.years?.length ? meta.years : [filters.year];
    const from = result && result.total ? (result.page - 1) * result.limit + 1 : 0;
    const to = result ? Math.min(result.total, result.page * result.limit) : 0;

    return (
        <div className="view active lb-view">
            <div className="glass lb-header">
                <div>
                    <h2 className="lb-title">Employee Leave Balances</h2>
                    <p className="lb-subtitle">Earned, special-earned and consumed leave for {filters.year}. Figures come from approved leave requests and audited adjustments.</p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {meta.canEdit && (
                        <button className="lb-btn lb-btn-purple" onClick={() => setShowImport(true)}>
                            <i className="fa-solid fa-file-import"></i> Import from Excel
                        </button>
                    )}
                    <button className="lb-btn" onClick={onBackToRequests}>
                        <i className="fa-solid fa-arrow-left"></i> Leave Requests
                    </button>
                </div>
            </div>
            {toastNode}
            {showImport && (
                <LeaveImportModal
                    onClose={() => setShowImport(false)}
                    onImported={(message) => { setShowImport(false); showToast('success', message); setReloadToken((n) => n + 1); }}
                />
            )}

            <div className="lb-cards" aria-live="polite">
                <SummaryCard icon="fa-users" tone="blue" label="Active Employees" value={summary ? summary.totalActiveEmployees : '—'} hint={filters.department || filters.search ? 'Matching current filters' : 'All departments'} />
                <SummaryCard icon="fa-calendar-minus" tone="red" label={`Leave Consumed (${filters.year})`} value={summary ? fmtDays(summary.totalLeaveConsumed) : '—'} hint="Days, approved requests + corrections" />
                <SummaryCard icon="fa-star" tone="purple" label={`Special Earned (${filters.year})`} value={summary ? fmtDays(summary.totalSpecialEarnedLeave) : '—'} hint="Sunday / holiday work credits" />
                <SummaryCard icon="fa-hourglass-half" tone="amber" label="Pending Requests" value={summary ? summary.pendingLeaveRequests : '—'} hint="Not deducted until approved" />
            </div>

            <div className="glass lb-filters">
                <label className="lb-field" style={{ flex: '2 1 240px' }}>
                    <span>Search</span>
                    <input className="lb-input" type="search" placeholder="Employee ID or name…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
                </label>
                <label className="lb-field" style={{ flex: '1 1 180px' }}>
                    <span>Department</span>
                    <select className="lb-input" value={filters.department} onChange={(e) => setFilter('department', e.target.value)}>
                        <option value="">All departments</option>
                        {(meta.departments || []).map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                </label>
                <label className="lb-field" style={{ flex: '0 1 120px' }}>
                    <span>Year</span>
                    <select className="lb-input" value={filters.year} onChange={(e) => setFilter('year', Number(e.target.value))}>
                        {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                </label>
                {(filters.search || filters.department) && (
                    <button className="lb-btn" onClick={() => { setSearchInput(''); setFilters((f) => ({ ...f, search: '', department: '', page: 1 })); }}>
                        Clear
                    </button>
                )}
            </div>

            <div className="glass lb-table-wrap custom-scrollbar desktop-table-view">
                <table className="lb-table">
                    <thead>
                        <tr>
                            <th scope="col">Employee ID</th>
                            <th scope="col">Employee</th>
                            <th scope="col" className="lb-hide-sm">Designation</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Consumed Leave</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Remaining Leave</th>
                            <th scope="col">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && !rows.length ? (
                            Array.from({ length: 6 }).map((_, i) => (
                                <tr key={i}>{Array.from({ length: 6 }).map((__, j) => <td key={j} className={j === 2 ? 'lb-hide-sm' : ''}><div className="lb-skeleton" /></td>)}</tr>
                            ))
                        ) : error ? (
                            <tr><td colSpan="6" className="lb-state">
                                <div className="lb-error-text" role="alert" style={{ marginBottom: 10 }}>{error}</div>
                                <button className="lb-btn" onClick={() => setReloadToken((n) => n + 1)}>Retry</button>
                            </td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan="6" className="lb-state">No active employees match these filters.</td></tr>
                        ) : rows.map((row) => (
                            <tr
                                key={row.employeeId}
                                className="lb-row"
                                tabIndex={0}
                                onClick={() => open(row)}
                                onKeyDown={(e) => { if (e.key === 'Enter') open(row); }}
                                aria-label={`Open leave details for ${row.name}`}
                                style={{ opacity: loading ? 0.6 : 1 }}
                            >
                                <td style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{row.empCode}</td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <Avatar name={row.name} photo={row.profilePhoto} />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 600 }}>{row.name}</div>
                                            {row.department && <div className="lb-muted" style={{ fontSize: '0.74rem' }}>{row.department}</div>}
                                            {row.registerChanges > 0 && (
                                                <div className="lb-register-flag" title="Jan–Sep figures changed after the register was imported. Open the employee to review.">
                                                    <i className="fa-solid fa-triangle-exclamation"></i> {row.registerChanges} differ{row.registerChanges === 1 ? 's' : ''} from register
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td className="lb-hide-sm">{row.designation || <span className="lb-muted">—</span>}</td>
                                <td className="lb-num lb-red" style={{ textAlign: 'right' }}>{fmtDays(row.consumedLeave)}</td>
                                <td className="lb-num lb-green" style={{ textAlign: 'right' }}>
                                    {fmtDays(row.remainingLeave)}
                                    {row.remainingSpecial > 0 && (
                                        <div className="lb-left-split">EL {fmtDays(row.remainingEl)} · <span className="lb-purple">Sun/Hol {fmtDays(row.remainingSpecial)}</span></div>
                                    )}
                                </td>
                                <td>
                                    <button className="lb-link" onClick={(e) => { e.stopPropagation(); open(row); }}>
                                        View Details <i className="fa-solid fa-chevron-right" style={{ fontSize: '0.7rem' }}></i>
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                
            {/* Mobile Cards Only View */}
            <div className="mobile-cards-only" style={{ display: 'none', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
                {loading && !rows.length ? (
                    <div className="card glass" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Loading leave balances...
                    </div>
                ) : error ? (
                    <div className="card glass" style={{ padding: '20px', textAlign: 'center' }}>
                        <div className="lb-error-text" role="alert" style={{ marginBottom: 10 }}>{error}</div>
                        <button className="lb-btn" onClick={() => setReloadToken((n) => n + 1)}>Retry</button>
                    </div>
                ) : rows.length === 0 ? (
                    <div className="card glass" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No active employees match these filters.
                    </div>
                ) : (
                    rows.map((row) => (
                        <div 
                            key={row.employeeId} 
                            className="mobile-record-card" 
                            onClick={() => open(row)} 
                            style={{ cursor: 'pointer', padding: '14px', borderRadius: '12px', background: 'var(--panel-bg)', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '10px' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <Avatar name={row.name} photo={row.profilePhoto} />
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>{row.name}</div>
                                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                            <span style={{ color: '#2563eb', fontWeight: 600 }}>{row.empCode}</span> {row.department ? '· ' + row.department : ''}
                                        </div>
                                    </div>
                                </div>
                                <button className="lb-link" onClick={(e) => { e.stopPropagation(); open(row); }}>
                                    Details <i className="fa-solid fa-chevron-right" style={{ fontSize: '0.7rem' }}></i>
                                </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: 'var(--input-bg)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                                <div>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block' }}>CONSUMED LEAVE</span>
                                    <strong className="lb-num lb-red" style={{ fontSize: '1rem' }}>{fmtDays(row.consumedLeave)}</strong>
                                </div>
                                <div>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block' }}>REMAINING LEAVE</span>
                                    <strong className="lb-num lb-green" style={{ fontSize: '1rem' }}>{fmtDays(row.remainingLeave)}</strong>
                                </div>
                            </div>

                            {row.remainingSpecial > 0 && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                    EL {fmtDays(row.remainingEl)} · <span className="lb-purple" style={{ fontWeight: 600 }}>Sun/Hol {fmtDays(row.remainingSpecial)}</span>
                                </div>
                            )}

                            {row.registerChanges > 0 && (
                                <div className="lb-register-flag" style={{ fontSize: '0.72rem' }}>
                                    <i className="fa-solid fa-triangle-exclamation"></i> {row.registerChanges} differ{row.registerChanges === 1 ? 's' : ''} from register
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {result && result.total > 0 && (
                    <div className="lb-pagination">
                        <span>{from}–{to} of {result.total}</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button className="lb-btn lb-btn-sm" aria-label="Previous page" disabled={result.page <= 1 || loading} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>&lt;</button>
                            <span style={{ alignSelf: 'center' }}>Page {result.page} / {result.totalPages}</span>
                            <button className="lb-btn lb-btn-sm" aria-label="Next page" disabled={result.page >= result.totalPages || loading} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>&gt;</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
