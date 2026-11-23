import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { getFullUrl } from '../../utils/helpers';

// Attendance regularization on the dashboard:
// 1. Overtime Regularization: employees who worked > 8 hours/day. Overtime (>8h) is only added
//    to total working hours if approved by admin; otherwise capped at standard 8h.
// 2. Missed Clock-in Regularization: requests from employees to be marked present on a past day.

const longDate = (iso) => {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};

const sentAt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '');
const isImage = (doc) => String(doc.mimeType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(doc.url || '');

const smallButton = {
    border: 'none',
    borderRadius: '8px',
    padding: '7px 14px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'all 0.15s ease'
};

export default function RegularizationPanel() {
    const [panelTab, setPanelTab] = useState('overtime'); // 'overtime' | 'missed'
    
    // Overtime state
    const [overtimeRequests, setOvertimeRequests] = useState([]);
    const [overtimeStatusFilter, setOvertimeStatusFilter] = useState('PENDING'); // 'PENDING' | 'APPROVED' | 'ALL'
    const [overtimeDateFilter, setOvertimeDateFilter] = useState('ALL'); // 'ALL' | 'TODAY' | 'YESTERDAY'
    const [overtimeCounts, setOvertimeCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
    const [visibleCount, setVisibleCount] = useState(25);
    
    // Missed clock-in state
    const [missedRequests, setMissedRequests] = useState([]);
    const [missedCount, setMissedCount] = useState(0);

    const [status, setStatus] = useState('loading'); // loading | ready | error
    const [openId, setOpenId] = useState(null);
    const [rejectingId, setRejectingId] = useState(null);
    const [note, setNote] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [message, setMessage] = useState(null); // { kind: 'ok' | 'error', text }

    // Helper: calculate today / yesterday in YYYY-MM-DD
    const getDates = () => {
        const now = new Date();
        const yest = new Date(now);
        yest.setDate(yest.getDate() - 1);
        const toIso = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        return { today: toIso(now), yesterday: toIso(yest) };
    };

    // Load Overtime records
    const loadOvertime = useCallback(async () => {
        try {
            const params = { status: overtimeStatusFilter, limit: 150 };
            const { today, yesterday } = getDates();
            if (overtimeDateFilter === 'TODAY') params.date = today;
            else if (overtimeDateFilter === 'YESTERDAY') params.date = yesterday;

            const data = await api.getOvertimeRegularizations(params);
            setOvertimeRequests(Array.isArray(data?.requests) ? data.requests : []);
            setOvertimeCounts({
                pending: data?.pendingCount || 0,
                approved: data?.approvedCount || 0,
                rejected: data?.rejectedCount || 0
            });
        } catch (err) {
            console.error('Failed to load overtime requests:', err);
        }
    }, [overtimeStatusFilter, overtimeDateFilter]);

    // Load Missed clock-in records
    const loadMissed = useCallback(async () => {
        try {
            const data = await api.getRegularizations('PENDING');
            const reqs = Array.isArray(data?.requests) ? data.requests : [];
            setMissedRequests(reqs);
            setMissedCount(data?.pendingCount || reqs.length);
        } catch (err) {
            console.error('Failed to load missed clock-in requests:', err);
        }
    }, []);

    const loadAll = useCallback(async () => {
        setStatus('loading');
        try {
            await Promise.all([loadOvertime(), loadMissed()]);
            setStatus('ready');
        } catch (e) {
            setStatus('error');
        }
    }, [loadOvertime, loadMissed]);

    useEffect(() => {
        loadAll();
        const timer = setInterval(loadAll, 60000);
        return () => clearInterval(timer);
    }, [loadAll]);

    // Decide Missed Clock-in
    const decideMissed = async (request, action) => {
        setBusyId(request.id);
        setMessage(null);
        try {
            if (action === 'approve') await api.approveRegularization(request.id);
            else await api.rejectRegularization(request.id, note.trim());
            setMessage({
                kind: 'ok',
                text: action === 'approve'
                    ? `${request.employeeName} marked present on ${longDate(request.date)}.`
                    : `Request from ${request.employeeName} rejected.`
            });
            setRejectingId(null);
            setNote('');
            setOpenId(null);
            await loadMissed();
        } catch (err) {
            setMessage({ kind: 'error', text: err.message || 'Could not save the decision.' });
            if (err.status === 409) await loadMissed();
        } finally {
            setBusyId(null);
        }
    };

    // Decide Overtime
    const decideOvertime = async (request, action) => {
        setBusyId(request.id);
        setMessage(null);
        try {
            if (action === 'approve') {
                await api.approveOvertime(request.id, note.trim());
                setMessage({
                    kind: 'ok',
                    text: `Overtime of ${request.overtimeHoursFormatted || request.overtimeHours} approved for ${request.employeeName} on ${longDate(request.date)}. Overtime is added to their total working hours.`
                });
            } else if (action === 'reject') {
                await api.rejectOvertime(request.id, note.trim());
                setMessage({
                    kind: 'ok',
                    text: `Overtime rejected for ${request.employeeName} on ${longDate(request.date)}. Working hours capped at 8h 00m (overtime excluded).`
                });
            } else if (action === 'reset') {
                await api.resetOvertime(request.id);
                setMessage({
                    kind: 'ok',
                    text: `Reset overtime decision for ${request.employeeName} back to Pending.`
                });
            }
            setRejectingId(null);
            setNote('');
            setOpenId(null);
            await loadOvertime();
        } catch (err) {
            setMessage({ kind: 'error', text: err.message || 'Could not process overtime decision.' });
        } finally {
            setBusyId(null);
        }
    };

    const totalActiveBadge = panelTab === 'overtime' ? overtimeCounts.pending : missedCount;
    const displayedOvertime = overtimeRequests.slice(0, visibleCount);

    return (
        <div className="glass dashboard-regularization-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fa-solid fa-user-check" style={{ color: 'var(--primary-color)' }}></i> Regularization
                </h3>
                <span style={{ background: totalActiveBadge > 0 ? 'var(--primary-color)' : 'rgba(148, 163, 184, 0.2)', color: totalActiveBadge > 0 ? '#fff' : 'var(--text-muted)', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
                    {totalActiveBadge} {totalActiveBadge === 1 ? 'Pending' : 'Pending'}
                </span>
            </div>

            {/* Sub-Tabs: Overtime (>8h) vs Missed Clock-in */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px', background: 'rgba(255, 255, 255, 0.04)', padding: '4px', borderRadius: '10px' }}>
                <button
                    type="button"
                    onClick={() => { setPanelTab('overtime'); setOpenId(null); setMessage(null); }}
                    style={{
                        padding: '8px 12px',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        background: panelTab === 'overtime' ? 'var(--primary-color)' : 'transparent',
                        color: panelTab === 'overtime' ? '#fff' : 'var(--text-muted)',
                        boxShadow: panelTab === 'overtime' ? '0 2px 6px rgba(0,0,0,0.2)' : 'none',
                        transition: 'all 0.2s'
                    }}
                >
                    <i className="fa-solid fa-business-time"></i>
                    <span>Overtime (&gt;8h)</span>
                    {overtimeCounts.pending > 0 && (
                        <span style={{
                            background: panelTab === 'overtime' ? 'rgba(255,255,255,0.25)' : 'var(--primary-color)',
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: '800',
                            padding: '1px 6px',
                            borderRadius: '10px'
                        }}>
                            {overtimeCounts.pending}
                        </span>
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => { setPanelTab('missed'); setOpenId(null); setMessage(null); }}
                    style={{
                        padding: '8px 12px',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        background: panelTab === 'missed' ? 'var(--primary-color)' : 'transparent',
                        color: panelTab === 'missed' ? '#fff' : 'var(--text-muted)',
                        boxShadow: panelTab === 'missed' ? '0 2px 6px rgba(0,0,0,0.2)' : 'none',
                        transition: 'all 0.2s'
                    }}
                >
                    <i className="fa-solid fa-clock-rotate-left"></i>
                    <span>Missed Clock-in</span>
                    {missedCount > 0 && (
                        <span style={{
                            background: panelTab === 'missed' ? 'rgba(255,255,255,0.25)' : 'var(--primary-color)',
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: '800',
                            padding: '1px 6px',
                            borderRadius: '10px'
                        }}>
                            {missedCount}
                        </span>
                    )}
                </button>
            </div>

            {/* Overtime Filters Row */}
            {panelTab === 'overtime' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                    {/* Status Filter */}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {[
                            { key: 'PENDING', label: `Pending (${overtimeCounts.pending})` },
                            { key: 'APPROVED', label: `Approved (${overtimeCounts.approved})` },
                            { key: 'REJECTED', label: `Rejected (${overtimeCounts.rejected})` },
                            { key: 'ALL', label: 'All Records' }
                        ].map(f => (
                            <button
                                key={f.key}
                                type="button"
                                onClick={() => { setOvertimeStatusFilter(f.key); setVisibleCount(25); }}
                                style={{
                                    border: '1px solid ' + (overtimeStatusFilter === f.key ? 'var(--primary-color)' : 'var(--border-subtle)'),
                                    background: overtimeStatusFilter === f.key ? 'rgba(79, 70, 229, 0.15)' : 'transparent',
                                    color: overtimeStatusFilter === f.key ? 'var(--primary-color)' : 'var(--text-muted)',
                                    padding: '3px 8px',
                                    borderRadius: '12px',
                                    fontSize: '11px',
                                    fontWeight: overtimeStatusFilter === f.key ? 700 : 500,
                                    cursor: 'pointer'
                                }}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    {/* Date Scope Filter */}
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {[
                            { key: 'ALL', label: 'All Dates' },
                            { key: 'TODAY', label: 'Today' },
                            { key: 'YESTERDAY', label: 'Yesterday' }
                        ].map(d => (
                            <button
                                key={d.key}
                                type="button"
                                onClick={() => { setOvertimeDateFilter(d.key); setVisibleCount(25); }}
                                style={{
                                    border: 'none',
                                    background: overtimeDateFilter === d.key ? 'var(--border-subtle, rgba(125,125,125,0.15))' : 'transparent',
                                    color: overtimeDateFilter === d.key ? 'var(--text-primary)' : 'var(--text-muted)',
                                    padding: '3px 8px',
                                    borderRadius: '6px',
                                    fontSize: '11px',
                                    fontWeight: overtimeDateFilter === d.key ? 700 : 500,
                                    cursor: 'pointer'
                                }}
                            >
                                {d.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Feedback alert message */}
            {message && (
                <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, color: message.kind === 'ok' ? '#16a34a' : '#dc2626', background: message.kind === 'ok' ? 'rgba(22, 163, 74, 0.12)' : 'rgba(220, 38, 38, 0.12)', border: '1px solid ' + (message.kind === 'ok' ? 'rgba(22, 163, 74, 0.3)' : 'rgba(220, 38, 38, 0.3)') }}>
                    <i className={message.kind === 'ok' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-exclamation'} style={{ marginRight: '8px' }}></i>
                    {message.text}
                </div>
            )}

            {/* List Content Container */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', maxHeight: '430px', paddingRight: '6px' }}>
                {status === 'loading' && (panelTab === 'overtime' ? overtimeRequests.length === 0 : missedRequests.length === 0) && (
                    <p style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>Loading regularization data...</p>
                )}

                {status === 'error' && (
                    <p style={{ textAlign: 'center', padding: '30px', color: 'var(--danger)' }}>Could not load regularization requests.</p>
                )}

                {/* OVERTIME TAB CONTENT */}
                {panelTab === 'overtime' && status === 'ready' && displayedOvertime.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '36px', marginBottom: '12px', opacity: '0.6' }}>⏱️</div>
                        <p style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 4px', color: 'var(--text-primary)' }}>No Overtime Records</p>
                        <p style={{ fontSize: '12px', margin: 0 }}>No {overtimeStatusFilter.toLowerCase()} overtime records found.</p>
                    </div>
                )}

                {panelTab === 'overtime' && displayedOvertime.map((r) => {
                    const open = openId === r.id;
                    const rejecting = rejectingId === r.id;
                    const busy = busyId === r.id;
                    const isApproved = r.overtimeStatus === 'APPROVED';
                    const isRejected = r.overtimeStatus === 'REJECTED';
                    const isPending = !isApproved && !isRejected;

                    return (
                        <div
                            key={r.id}
                            style={{
                                background: 'var(--input-bg, var(--card-bg, #ffffff))',
                                border: '1px solid ' + (isApproved ? 'rgba(22, 163, 74, 0.4)' : isRejected ? 'rgba(220, 38, 38, 0.3)' : 'var(--border-subtle, rgba(125,125,125,0.15))'),
                                borderRadius: '12px',
                                overflow: 'hidden',
                                flexShrink: 0,
                                minHeight: '68px',
                                boxSizing: 'border-box',
                                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)'
                            }}
                        >
                            <div
                                onClick={() => setOpenId(open ? null : r.id)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 14px', cursor: 'pointer' }}
                                className="hover-lift"
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                                    <div style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '50%',
                                        background: isApproved ? 'rgba(22, 163, 74, 0.15)' : isRejected ? 'rgba(220, 38, 38, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                        color: isApproved ? '#16a34a' : isRejected ? '#dc2626' : '#d97706',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '17px',
                                        flexShrink: 0
                                    }}>
                                        <i className="fa-solid fa-business-time"></i>
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ fontWeight: '700', color: 'var(--text-primary)', margin: '0 0 2px', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.employeeName || r.empCode || r.userId}
                                            {r.empCode && <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: '12px' }}> ({r.empCode})</span>}
                                        </p>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{longDate(r.date)}</span>
                                            <span style={{
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                padding: '2px 7px',
                                                borderRadius: '6px',
                                                background: isApproved ? 'rgba(22, 163, 74, 0.15)' : isRejected ? 'rgba(220, 38, 38, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                                color: isApproved ? '#16a34a' : isRejected ? '#dc2626' : '#d97706'
                                            }}>
                                                {isApproved ? `+${r.overtimeHoursFormatted || r.overtimeHours} Approved` : isRejected ? `OT Rejected (-${r.overtimeHoursFormatted || r.overtimeHours})` : `+${r.overtimeHoursFormatted || r.overtimeHours} Overtime`}
                                            </span>
                                            <span style={{
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                color: isApproved ? '#16a34a' : isRejected ? '#dc2626' : 'var(--text-secondary)',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}>
                                                {isApproved ? (
                                                    <span>Working Time: <strong style={{ color: '#16a34a' }}>{r.totalHoursFormatted}</strong> (Overtime Approved)</span>
                                                ) : isRejected ? (
                                                    <span>Working Time: <strong style={{ color: '#dc2626' }}>8h 00m</strong> <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>(-{r.overtimeHoursFormatted || r.overtimeHours} Extra Decreased &bull; Was {r.totalHoursFormatted})</span></span>
                                                ) : (
                                                    <span>Working Time: <strong style={{ color: 'var(--text-primary)' }}>{r.totalHoursFormatted}</strong> <span style={{ color: '#d97706', fontWeight: 600 }}>({r.overtimeHoursFormatted || r.overtimeHours} extra pending approval)</span></span>
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                    {isPending ? (
                                        <>
                                            <button
                                                disabled={busy}
                                                onClick={() => decideOvertime(r, 'approve')}
                                                style={{ ...smallButton, background: '#16a34a', color: '#fff', opacity: busy ? 0.6 : 1 }}
                                                title="Approve overtime to add into total working hours"
                                            >
                                                {busy && !rejecting ? 'Saving...' : 'Approve'}
                                            </button>
                                            <button
                                                disabled={busy}
                                                onClick={() => { setOpenId(r.id); setRejectingId(rejecting ? null : r.id); setNote(''); setMessage(null); }}
                                                style={{ ...smallButton, background: 'rgba(220, 38, 38, 0.12)', color: '#dc2626', border: '1px solid rgba(220, 38, 38, 0.3)', opacity: busy ? 0.6 : 1 }}
                                                title="Reject overtime (cap working hours at 8h)"
                                            >
                                                Reject
                                            </button>
                                        </>
                                    ) : isRejected ? (
                                        <>
                                            <button
                                                disabled={busy}
                                                onClick={() => decideOvertime(r, 'approve')}
                                                style={{ ...smallButton, background: '#16a34a', color: '#fff', opacity: busy ? 0.6 : 1 }}
                                                title="Approve overtime to add into total working hours"
                                            >
                                                Approve
                                            </button>
                                            <button
                                                disabled={busy}
                                                onClick={() => decideOvertime(r, 'reset')}
                                                style={{ ...smallButton, background: 'var(--border-subtle, rgba(125,125,125,0.1))', color: 'var(--text-muted)' }}
                                                title="Reset decision back to Pending"
                                            >
                                                Reset
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                disabled={busy}
                                                onClick={() => { setOpenId(r.id); setRejectingId(rejecting ? null : r.id); setNote(''); setMessage(null); }}
                                                style={{ ...smallButton, background: 'rgba(220, 38, 38, 0.12)', color: '#dc2626', border: '1px solid rgba(220, 38, 38, 0.3)', opacity: busy ? 0.6 : 1 }}
                                                title="Reject overtime (cap working hours at 8h)"
                                            >
                                                Reject
                                            </button>
                                            <button
                                                disabled={busy}
                                                onClick={() => decideOvertime(r, 'reset')}
                                                style={{ ...smallButton, background: 'var(--border-subtle, rgba(125,125,125,0.1))', color: 'var(--text-muted)' }}
                                                title="Reset decision back to Pending"
                                            >
                                                Reset
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {open && (
                                <div style={{ padding: '0 14px 14px 66px', fontSize: '13px', color: 'var(--text-primary)' }}>
                                    <div style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: '10px' }}>
                                        {/* Work Duration Breakdown */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '10px' }}>
                                            <div style={{ background: 'var(--panel-bg, rgba(125,125,125,0.06))', padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>Punches</div>
                                                <div style={{ fontWeight: 700, fontSize: '11px', color: 'var(--text-primary)', marginTop: '2px' }}>
                                                    {r.checkIn || '-'} → {r.checkOut || '-'}
                                                </div>
                                                {r.isHomeClockIn && r.appCheckIn && (
                                                    <div style={{ fontSize: '10px', color: '#6366f1', marginTop: '2px', fontWeight: 600 }}>
                                                        App Punch: {r.appCheckIn} (Home)
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ background: 'var(--panel-bg, rgba(125,125,125,0.06))', padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>Worked Time (Punches)</div>
                                                <div style={{ fontWeight: 700, fontSize: '11px', color: 'var(--primary-color)', marginTop: '2px' }}>
                                                    {r.totalHoursFormatted} ({r.rawWorkingHours})
                                                </div>
                                            </div>
                                            <div style={{ background: 'var(--panel-bg, rgba(125,125,125,0.06))', padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>Official Working Hours</div>
                                                <div style={{ fontWeight: 700, fontSize: '11px', color: isApproved ? '#16a34a' : isRejected ? '#dc2626' : '#d97706', marginTop: '2px' }}>
                                                    {isApproved ? `${r.effectiveWorkingHours} (Full Overtime Added)` : isRejected ? '08:00:00 (Overtime Rejected — Extra Decreased)' : `${r.totalHoursFormatted} (${r.overtimeHoursFormatted || r.overtimeHours} extra pending approval)`}
                                                </div>
                                            </div>
                                        </div>

                                        <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                            <i className="fa-solid fa-circle-info" style={{ marginRight: '5px' }}></i>
                                            {isApproved
                                                ? `Overtime approved by ${r.decidedBy || 'Admin'}. Full hours are credited.`
                                                : isRejected
                                                ? `Overtime rejected by ${r.decidedBy || 'Admin'}. Extra overtime decreased; capped at standard 8h.`
                                                : 'Pending: if admin rejects overtime, extra time beyond 8h will be decreased from total working hours across the dashboard.'}
                                        </p>

                                        {rejecting && (
                                            <div style={{ marginTop: '12px' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                                    Reason for rejection (optional)
                                                </div>
                                                <textarea
                                                    value={note}
                                                    onChange={(e) => setNote(e.target.value)}
                                                    rows={2}
                                                    maxLength={500}
                                                    placeholder="e.g. Unscheduled overtime without approval"
                                                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--panel-bg, var(--input-bg))', color: 'var(--text-primary)', fontSize: '12px', resize: 'vertical' }}
                                                />
                                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                                    <button
                                                        disabled={busy}
                                                        onClick={() => decideOvertime(r, 'reject')}
                                                        style={{ ...smallButton, background: '#dc2626', color: '#fff', opacity: busy ? 0.5 : 1 }}
                                                    >
                                                        {busy ? 'Saving...' : 'Confirm Reject (Decrease Extra Overtime)'}
                                                    </button>
                                                    <button onClick={() => { setRejectingId(null); setNote(''); }} style={{ ...smallButton, background: 'transparent', color: 'var(--text-muted)' }}>Cancel</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Load More Button for Overtime */}
                {panelTab === 'overtime' && overtimeRequests.length > visibleCount && (
                    <button
                        type="button"
                        onClick={() => setVisibleCount(c => c + 25)}
                        style={{
                            padding: '10px',
                            borderRadius: '8px',
                            border: '1px dashed var(--border-subtle)',
                            background: 'transparent',
                            color: 'var(--primary-color)',
                            fontWeight: 600,
                            fontSize: '12px',
                            cursor: 'pointer',
                            flexShrink: 0
                        }}
                    >
                        Load More ({overtimeRequests.length - visibleCount} remaining)...
                    </button>
                )}

                {/* MISSED CLOCK-IN TAB CONTENT */}
                {panelTab === 'missed' && status === 'ready' && missedRequests.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '36px', marginBottom: '12px', opacity: '0.6' }}>🎉</div>
                        <p style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 4px', color: 'var(--text-primary)' }}>All Caught Up!</p>
                        <p style={{ fontSize: '12px', margin: 0 }}>No pending missed clock-in requests.</p>
                    </div>
                )}

                {panelTab === 'missed' && missedRequests.map((r) => {
                    const open = openId === r.id;
                    const rejecting = rejectingId === r.id;
                    const busy = busyId === r.id;
                    return (
                        <div
                            key={r.id}
                            style={{
                                background: 'var(--input-bg, var(--card-bg, #ffffff))',
                                border: '1px solid var(--border-subtle, rgba(125,125,125,0.15))',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                flexShrink: 0,
                                minHeight: '68px',
                                boxSizing: 'border-box',
                                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)'
                            }}
                        >
                            <div
                                onClick={() => setOpenId(open ? null : r.id)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 16px', cursor: 'pointer' }}
                                className="hover-lift"
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--panel-bg)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <i className="fa-solid fa-user-clock"></i>
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.employeeName || r.empCode || r.employeeId}
                                            {r.empCode && <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: '12px' }}> ({r.empCode})</span>}
                                        </p>
                                        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{longDate(r.date)}</p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                    <button
                                        disabled={busy}
                                        onClick={() => decideMissed(r, 'approve')}
                                        style={{ ...smallButton, background: '#16a34a', color: '#fff', opacity: busy ? 0.6 : 1 }}
                                    >
                                        {busy && !rejecting ? 'Saving...' : 'Approve'}
                                    </button>
                                    <button
                                        disabled={busy}
                                        onClick={() => { setOpenId(r.id); setRejectingId(rejecting ? null : r.id); setNote(''); setMessage(null); }}
                                        style={{ ...smallButton, background: 'rgba(220, 38, 38, 0.12)', color: '#dc2626', border: '1px solid rgba(220, 38, 38, 0.3)', opacity: busy ? 0.6 : 1 }}
                                    >
                                        Reject
                                    </button>
                                </div>
                            </div>

                            {open && (
                                <div className="regularization-details-expanded" style={{ padding: '0 16px 16px 72px', fontSize: '13px', color: 'var(--text-primary)' }}>
                                    <div style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: '12px' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>Comment from the employee</div>
                                        <p style={{ margin: 0, whiteSpace: 'pre-line', wordBreak: 'break-word', color: 'var(--text-primary)' }}>{r.comment}</p>

                                        {(r.requestedCheckIn || r.requestedCheckOut) && (
                                            <p style={{ margin: '8px 0 0', color: 'var(--text-muted)' }}>
                                                Says they worked {r.requestedCheckIn || 'shift start'} – {r.requestedCheckOut || 'shift end'}
                                            </p>
                                        )}
                                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Sent {sentAt(r.createdAt)}</p>

                                        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '12px 0 6px' }}>
                                            Supporting documents ({r.documents?.length || 0})
                                        </div>
                                        {(!r.documents || r.documents.length === 0) && <p style={{ margin: 0, color: 'var(--text-muted)' }}>No document attached.</p>}
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                            {(r.documents || []).map((doc, i) => (
                                                <a key={i} href={getFullUrl(doc.url)} target="_blank" rel="noopener noreferrer" title={doc.name}
                                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '96px', textDecoration: 'none', color: 'var(--text-primary)' }}>
                                                    {isImage(doc) ? (
                                                        <img src={getFullUrl(doc.url)} alt={doc.name} style={{ width: '96px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-subtle)' }} />
                                                    ) : (
                                                        <div style={{ width: '96px', height: '72px', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', color: '#dc2626', background: 'var(--panel-bg)' }}>
                                                            <i className="fa-solid fa-file-pdf"></i>
                                                        </div>
                                                    )}
                                                    <span style={{ fontSize: '11px', maxWidth: '96px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{doc.name}</span>
                                                </a>
                                            ))}
                                        </div>

                                        {rejecting && (
                                            <div style={{ marginTop: '14px' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>Why is it rejected? (the employee will see this)</div>
                                                <textarea
                                                    value={note}
                                                    onChange={(e) => setNote(e.target.value)}
                                                    rows={2}
                                                    maxLength={500}
                                                    placeholder="e.g. No proof of work on that day"
                                                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--panel-bg, var(--input-bg))', color: 'var(--text-primary)', fontSize: '13px', resize: 'vertical' }}
                                                />
                                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                                    <button
                                                        disabled={busy || note.trim().length < 3}
                                                        onClick={() => decideMissed(r, 'reject')}
                                                        style={{ ...smallButton, background: '#dc2626', color: '#fff', opacity: busy || note.trim().length < 3 ? 0.5 : 1 }}
                                                    >
                                                        {busy ? 'Saving...' : 'Confirm reject'}
                                                    </button>
                                                    <button onClick={() => { setRejectingId(null); setNote(''); }} style={{ ...smallButton, background: 'transparent', color: 'var(--text-muted)' }}>Cancel</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
