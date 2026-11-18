import React, { useEffect, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import { api } from '../../services/api';
import { Modal } from './leaveBalanceUi';
import { useToast } from './leaveBalanceUtils';
import { formatShiftHours, fmtCreditDays } from './specialShiftStatus';
import './leaveBalances.css';
import './weekendShifts.css';

// Sunday / holiday shifts: a shift adds special earned leave only once approved here.
// The server re-checks the attendance, the permissions and the amount on every decision.
// Shows every saved Sun/Hol record (dated credits and the register's undated months, as in Leave Balances).

const inputStyle = {
    height: '38px', padding: '0 12px', borderRadius: '6px', border: '1px solid var(--border-glass, #e5e7eb)',
    fontSize: '0.875rem', outline: 'none', background: 'var(--input-bg, #ffffff)', color: 'var(--text-primary, #111827)'
};
const tabStyle = (active, color) => ({
    height: '38px', padding: '0 16px', borderRadius: '6px', fontSize: '0.875rem',
    background: active ? color : 'var(--input-bg, #f3f4f6)', color: active ? 'white' : 'var(--text-primary, #374151)',
    border: active ? '1px solid transparent' : '1px solid var(--border-glass, #d1d5db)'
});
const subText = { display: 'block', fontSize: '0.74rem', color: 'var(--text-muted, #64748b)', fontWeight: 600 };
const fieldLabel = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary, #334155)' };
const filterLabel = { fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary, #4b5563)', whiteSpace: 'nowrap' };

const TABS = [
    { key: 'ALL', label: 'All', color: '#2563eb', statuses: null },
    { key: 'PENDING', label: 'Pending', color: '#f59e0b', statuses: ['PENDING'] },
    { key: 'APPROVED', label: 'Approved', color: '#10b981', statuses: ['ACTIVE'] },
    { key: 'REJECTED', label: 'Rejected', color: '#ef4444', statuses: ['REJECTED', 'REVERSED'] }
];
const BADGE = { PENDING: ['pending', 'PENDING'], ACTIVE: ['approved', 'APPROVED'], REJECTED: ['rejected', 'REJECTED'], REVERSED: ['rejected', 'REVERSED'] };

const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const plainDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const monthTitle = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const dayLabel = (s) => (s.source === 'REGISTER' ? 'Register' : (s.dayType === 'HOLIDAY' ? (s.holidayName || 'Holiday') : 'Sunday'));
// Register months (Leave Balances history without dates) sort as the start of their month.
const sortKey = (s) => s.workDate || `${s.period}-00`;
// A register month is in the range when its month overlaps it.
const inRange = (s, from, to) => (s.workDate
    ? (!from || s.workDate >= from) && (!to || s.workDate <= to)
    : (!from || s.period >= from.slice(0, 7)) && (!to || s.period <= to.slice(0, 7)));
const needsReview = (s) => !(s.eligibleDays > 0) || s.attendanceStatus !== 'COMPLETE';
const meaningful = (t) => /[a-z0-9]/i.test(String(t || ''));
const errorText = (err, fallback) => (err && err.data && err.data.error) || (err && err.message) || fallback;
const decidedBy = (s) => {
    if (s.status === 'PENDING') return '';
    if (s.source === 'LEGACY_AUTO') return 'auto-credited';
    if (s.source === 'REGISTER') return 'from register';
    const name = String(s.verifiedByName || '').replace(/\s*\([^)]*\)$/, '');
    return name ? `by ${name}` : '';
};
function creditOptions(policy) {
    const step = (policy && policy.leaveUnitStep) || 0.5;
    const max = (policy && policy.maxDays) || 1;
    const out = [];
    for (let v = step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
}

/** Confirmation before a decision. A single approval can change the credit; a change needs a reason. */
function DecisionDialog({ action, shifts, policy, onCancel, onConfirm }) {
    const approve = action === 'APPROVE';
    const single = shifts.length === 1 ? shifts[0] : null;
    const calc = single ? single.eligibleDays : null;
    const [days, setDays] = useState(single && calc > 0 ? String(calc) : '');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const override = approve && !!single && days !== '' && (Number(days) !== calc || single.attendanceStatus !== 'COMPLETE');
    const ready = !busy && (!approve || !single || (days !== '' && (!override || meaningful(reason))));
    const reviewCount = approve && !single ? shifts.filter(needsReview).length : 0;

    const submit = () => {
        if (!ready) return;
        setBusy(true);
        setError(null);
        onConfirm({ days: days === '' ? undefined : Number(days), reason: reason.trim(), override })
            .catch((err) => { setError(errorText(err, 'Nothing was saved.')); setBusy(false); });
    };

    const title = `${approve ? 'Approve' : 'Reject'} ${single ? 'shift' : `${shifts.length} shifts`}`;
    return (
        <div className="ws-dialog">
            <Modal
                title={title}
                onClose={busy ? () => {} : onCancel}
                footer={(
                    <>
                        <button className="btn btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>
                        <button className={`btn ${approve ? 'btn-success' : 'btn-danger'}`} onClick={submit} disabled={!ready}>
                            {busy ? 'Saving…' : (approve ? 'Approve' : 'Reject')}
                        </button>
                    </>
                )}
            >
                {single && (
                    <div>
                        <strong style={{ color: 'var(--text-primary)' }}>{single.employeeName}</strong>
                        <span style={subText}>{shortDate(single.workDate)} · {dayLabel(single)} · {single.checkIn || '--'} – {single.checkOut || '--'} · {formatShiftHours(single.workingHours)}</span>
                    </div>
                )}
                {approve && single && (
                    <>
                        {needsReview(single) && (
                            <div className="ws-hint">Calculated credit is {fmtCreditDays(calc)}{single.attendanceStatus !== 'COMPLETE' ? ' (punches incomplete)' : ' (under 4 hours)'}. Choose the credit to approve.</div>
                        )}
                        <label style={fieldLabel}>
                            Credit
                            <select style={inputStyle} value={days} onChange={(e) => setDays(e.target.value)} disabled={busy}>
                                <option value="">Choose…</option>
                                {creditOptions(policy).map((v) => <option key={v} value={String(v)}>{fmtCreditDays(v)}{v === calc ? ' (calculated)' : ''}</option>)}
                            </select>
                        </label>
                        {override && (
                            <label style={fieldLabel}>
                                Reason for changing the credit
                                <textarea style={{ ...inputStyle, height: '64px', padding: '8px 12px', resize: 'vertical', fontFamily: 'inherit' }} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
                            </label>
                        )}
                    </>
                )}
                {approve && !single && (
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        Each shift gets its calculated credit.{reviewCount > 0 && ` ${reviewCount} need${reviewCount === 1 ? 's' : ''} an individual review and will stay pending.`}
                    </div>
                )}
                {!approve && (
                    <>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No leave will be credited. The attendance is not changed.</div>
                        <label style={fieldLabel}>
                            Reason (optional)
                            <input style={inputStyle} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
                        </label>
                    </>
                )}
                {error && <div className="lb-error-text" role="alert">{error}</div>}
            </Modal>
        </div>
    );
}

// Everything saved, any date; register=1 adds the register's Sun/Hol months without dates (as in Leave Balances).
// The Attendance screen makes the same request (cached 30 s), so the page usually opens with its rows already there.
const LIST_PARAMS = { all: 1, register: 1 };
const LIST_CACHE_MS = 30000;
const toData = (res) => ({ loading: false, error: null, items: res.data || [], canVerify: !!res.canVerify, policy: res.policy || null });

export default function WeekendShiftsView({ initialSearch = '', onBack }) {
    const [tab, setTab] = useState('ALL');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [search, setSearch] = useState(initialSearch);
    const [data, setData] = useState(() => {
        const cached = api.getCached(api.specialShiftsPath(LIST_PARAMS));
        return cached ? toData(cached) : { loading: true, error: null, items: [], canVerify: false, policy: null };
    });
    const [reloadKey, setReloadKey] = useState(0);
    const [selected, setSelected] = useState(() => new Set());
    const [dialog, setDialog] = useState(null); // { action, shifts }
    const [notice, setNotice] = useState(null); // shifts a bulk decision could not save
    const [toast, showToast] = useToast();

    useEffect(() => {
        let alive = true;
        // Rows already on screen (cached) stay visible while the fresh list loads.
        setData((d) => ({ ...d, loading: true, error: null }));
        api.getSpecialShifts(LIST_PARAMS)
            .then((res) => {
                if (!alive || !res) return;
                setData(toData(res));
                api.setCached(api.specialShiftsPath(LIST_PARAMS), res, LIST_CACHE_MS);
            })
            .catch((err) => { if (alive) setData((d) => ({ ...d, loading: false, error: d.items.length ? null : errorText(err, 'Could not load the shifts.') })); });
        return () => { alive = false; };
    }, [reloadKey]);
    useEffect(() => { setSelected(new Set()); }, [tab, fromDate, toDate, search]);

    const q = search.trim().toLowerCase();
    const filtered = data.items.filter((s) => inRange(s, fromDate, toDate)
        && (!q || [s.employeeName, s.empCode, s.department].some((f) => String(f || '').toLowerCase().includes(q))));
    const current = TABS.find((t) => t.key === tab);
    const rows = filtered.filter((s) => !current.statuses || current.statuses.includes(s.status))
        .sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || String(a.employeeName).localeCompare(String(b.employeeName)));
    const pendingRows = rows.filter((s) => s.status === 'PENDING');
    const selectable = data.canVerify && pendingRows.length > 0;
    const selectedRows = pendingRows.filter((s) => selected.has(s.adjustmentId));
    const allSelected = pendingRows.length > 0 && selectedRows.length === pendingRows.length;
    const toggle = (id) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    const colCount = (selectable ? 1 : 0) + 7;
    const filtersOn = !!(fromDate || toDate || search);
    const rangeText = fromDate && toDate ? `${plainDate(fromDate)} – ${plainDate(toDate)}`
        : (fromDate ? `From ${plainDate(fromDate)}` : (toDate ? `Up to ${plainDate(toDate)}` : 'All dates'));

    const decide = async ({ days, reason, override }) => {
        const { action, shifts } = dialog;
        if (shifts.length === 1) {
            const s = shifts[0];
            await api.verifySpecialShift(action === 'APPROVE'
                ? { adjustmentId: s.adjustmentId, action, days, ...(override ? { confirmOverride: true, overrideReason: reason } : {}) }
                : { adjustmentId: s.adjustmentId, action, rejectionReason: reason || undefined });
            showToast('success', action === 'APPROVE' ? `Approved ${fmtCreditDays(days)} for ${s.employeeName}.` : `Rejected ${s.employeeName}'s shift.`);
            setNotice(null);
        } else {
            const res = await api.batchVerifySpecialShifts({ action, adjustmentIds: shifts.map((s) => s.adjustmentId), rejectionReason: action === 'REJECT' ? (reason || undefined) : undefined });
            const byId = new Map(shifts.map((s) => [s.adjustmentId, s]));
            const failed = (res.results || []).filter((r) => !r.success);
            showToast(failed.length ? 'error' : 'success', `${res.summary.succeeded} ${action === 'APPROVE' ? 'approved' : 'rejected'}${failed.length ? `, ${failed.length} not saved` : ''}.`);
            setNotice(failed.length ? failed.map((f) => {
                const s = byId.get(f.adjustmentId);
                return `${s ? `${s.employeeName}, ${shortDate(s.workDate)}` : f.adjustmentId}: ${f.error}`;
            }) : null);
        }
        setDialog(null);
        setSelected(new Set());
        setReloadKey((k) => k + 1);
    };

    return (
        <div id="weekend-shifts-view" className="view active" style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
            {/* Toolbar */}
            <div className="glass" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button className="btn btn-outline" onClick={onBack} title="Back to Attendance" style={{ width: '38px', height: '38px', padding: 0 }}>
                        <i className="fa-solid fa-arrow-left"></i>
                    </button>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Weekend / Holiday Shifts</h2>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>{rangeText}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {TABS.map((t) => (
                        <button key={t.key} className="btn" onClick={() => setTab(t.key)} style={tabStyle(tab === t.key, t.color)}>
                            {t.label} ({filtered.filter((s) => !t.statuses || t.statuses.includes(s.status)).length})
                        </button>
                    ))}
                </div>
            </div>

            {/* Filters */}
            <div className="glass" style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
                <span style={filterLabel}>From:</span>
                <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} aria-label="From date" />
                <span style={filterLabel}>To:</span>
                <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} style={inputStyle} aria-label="To date" />
                <input type="text" placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, minWidth: '200px', flex: '1 1 200px', maxWidth: '320px' }} />
                {filtersOn && (
                    <button className="btn btn-outline" style={{ height: '38px' }} onClick={() => { setFromDate(''); setToDate(''); setSearch(''); }}>Clear Filters</button>
                )}
                {selectable && selectedRows.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedRows.length} selected</span>
                        <button className="btn btn-success" onClick={() => setDialog({ action: 'APPROVE', shifts: selectedRows })}><i className="fa-solid fa-check"></i> Approve Selected</button>
                        <button className="btn btn-danger" onClick={() => setDialog({ action: 'REJECT', shifts: selectedRows })}><i className="fa-solid fa-xmark"></i> Reject Selected</button>
                    </div>
                )}
            </div>

            {notice && (
                <div className="ws-hint" role="status" style={{ flexShrink: 0, display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>{notice.map((n) => <div key={n}>{n}</div>)}</div>
                    <button className="btn btn-outline" style={{ height: '28px', padding: '0 8px' }} onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
                </div>
            )}

            <div className="table-container glass custom-scrollbar" style={{ padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', borderRadius: '16px' }}>
                <table id="weekend-shifts-table">
                    <thead>
                        <tr>
                            {selectable && (
                                <th style={{ width: '36px' }}>
                                    <input type="checkbox" aria-label="Select all pending" checked={allSelected}
                                        onChange={() => setSelected(allSelected ? new Set() : new Set(pendingRows.map((s) => s.adjustmentId)))} />
                                </th>
                            )}
                            <th>Employee</th>
                            <th>Date</th>
                            <th>In – Out</th>
                            <th>Hours</th>
                            <th>Credit</th>
                            <th>Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.loading && !data.items.length ? (
                            <tr><td colSpan={colCount} style={{ padding: '40px 0' }}><LoadingSpinner message="Loading shifts..." minHeight="200px" /></td></tr>
                        ) : data.error ? (
                            <tr><td colSpan={colCount} className="error-text" style={{ textAlign: 'center', padding: '30px' }}>{data.error}</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={colCount} style={{ textAlign: 'center', padding: '30px' }}>
                                {tab === 'PENDING' ? 'No shifts waiting for approval.' : 'No Sunday or holiday shifts found.'}
                            </td></tr>
                        ) : rows.map((s) => (
                            <tr key={s.adjustmentId}>
                                {selectable && (
                                    <td>
                                        {s.status === 'PENDING' && (
                                            <input type="checkbox" aria-label={`Select ${s.employeeName}, ${s.workDate}`} checked={selected.has(s.adjustmentId)} onChange={() => toggle(s.adjustmentId)} />
                                        )}
                                    </td>
                                )}
                                <td>
                                    <strong style={{ color: 'var(--accent-primary, #4f46e5)', display: 'block' }}>{s.employeeName}</strong>
                                    <span style={subText}>{s.empCode}</span>
                                </td>
                                <td>
                                    <span title={s.source === 'REGISTER' ? (s.reason || '') : undefined}>{s.workDate ? shortDate(s.workDate) : monthTitle(s.period)}</span>
                                    <span style={subText}>{dayLabel(s)}</span>
                                </td>
                                <td style={{ whiteSpace: 'nowrap' }}>{s.checkIn || s.checkOut ? `${s.checkIn || '--'} – ${s.checkOut || '--'}` : '-'}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>{s.workingHours !== null && s.workingHours !== undefined ? formatShiftHours(s.workingHours) : '-'}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>
                                    {s.status === 'PENDING'
                                        ? (needsReview(s)
                                            ? <span style={{ color: '#d97706', fontWeight: 700 }} title={s.attendanceStatus !== 'COMPLETE' ? 'Punches incomplete' : 'Under 4 hours'}>Review</span>
                                            : fmtCreditDays(s.eligibleDays))
                                        : (s.status === 'ACTIVE' ? fmtCreditDays(s.approvedDays) : '-')}
                                </td>
                                <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                                        <span className={`badge-status badge-${BADGE[s.status][0]}`}>{BADGE[s.status][1]}</span>
                                        {decidedBy(s) && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #64748b)', fontWeight: 600 }} title={s.rejectionReason || ''}>{decidedBy(s)}</span>}
                                    </div>
                                </td>
                                <td>
                                    {s.status === 'PENDING' && data.canVerify ? (
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button className="btn btn-success" title="Approve" onClick={() => setDialog({ action: 'APPROVE', shifts: [s] })}><i className="fa-solid fa-check"></i></button>
                                            <button className="btn btn-danger" title="Reject" onClick={() => setDialog({ action: 'REJECT', shifts: [s] })}><i className="fa-solid fa-xmark"></i></button>
                                        </div>
                                    ) : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {dialog && (
                <DecisionDialog
                    key={dialog.shifts.map((s) => s.adjustmentId).join(',')}
                    action={dialog.action}
                    shifts={dialog.shifts}
                    policy={data.policy}
                    onCancel={() => setDialog(null)}
                    onConfirm={decide}
                />
            )}
            {toast}
        </div>
    );
}
