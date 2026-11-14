import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { getFullUrl } from '../../utils/helpers';

// Attendance regularization on the dashboard: requests from employees to be marked present on a day they worked
// but forgot to clock in. A card shows who and which day, with Approve / Reject. Opening a card shows the
// comment the employee wrote in the app and their supporting documents. Approving marks them present that day.

const longDate = (iso) => {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};
const sentAt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '');
const isImage = (doc) => String(doc.mimeType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(doc.url || '');

const smallButton = { border: 'none', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' };

export default function RegularizationPanel() {
    const [requests, setRequests] = useState([]);
    const [status, setStatus] = useState('loading'); // loading | ready | error
    const [openId, setOpenId] = useState(null);       // the card showing its comment and documents
    const [rejectingId, setRejectingId] = useState(null);
    const [note, setNote] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [message, setMessage] = useState(null);     // { kind: 'ok' | 'error', text }

    const load = useCallback(async () => {
        try {
            const data = await api.getRegularizations('PENDING');
            setRequests(Array.isArray(data?.requests) ? data.requests : []);
            setStatus('ready');
        } catch (err) {
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        load();
        const timer = setInterval(load, 60000);
        return () => clearInterval(timer);
    }, [load]);

    const decide = async (request, action) => {
        setBusyId(request.id);
        setMessage(null);
        try {
            if (action === 'approve') await api.approveRegularization(request.id);
            else await api.rejectRegularization(request.id, note.trim());
            setMessage({
                kind: 'ok',
                text: action === 'approve'
                    ? `${request.employeeName} is marked present on ${longDate(request.date)}.`
                    : `Request from ${request.employeeName} rejected.`
            });
            setRejectingId(null);
            setNote('');
            setOpenId(null);
            await load();
        } catch (err) {
            setMessage({ kind: 'error', text: err.message || 'Could not save the decision.' });
            // someone else decided it, or attendance appeared meanwhile: show what is current
            if (err.status === 409) await load();
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="glass dashboard-regularization-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>
                    <i className="fa-solid fa-user-check" style={{ color: 'var(--primary-color)', marginRight: '10px' }}></i> Regularization
                </h3>
                <span style={{ background: 'var(--primary-color)', color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
                    {requests.length} {requests.length === 1 ? 'Request' : 'Requests'}
                </span>
            </div>

            {message && (
                <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, color: message.kind === 'ok' ? '#16a34a' : '#dc2626', background: message.kind === 'ok' ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)' }}>
                    {message.text}
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: '440px', paddingRight: '10px' }}>
                {status === 'loading' && requests.length === 0 && (
                    <p style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>Loading requests...</p>
                )}
                {status === 'error' && (
                    <p style={{ textAlign: 'center', padding: '30px', color: 'var(--danger)' }}>Could not load the regularization requests.</p>
                )}
                {status === 'ready' && requests.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '40px', marginBottom: '16px', opacity: '0.5' }}>🎉</div>
                        <p style={{ fontSize: '16px', fontWeight: '500' }}>You're all caught up!</p>
                        <p style={{ fontSize: '13px' }}>No pending regularization requests.</p>
                    </div>
                )}

                {requests.map((r) => {
                    const open = openId === r.id;
                    const rejecting = rejectingId === r.id;
                    const busy = busyId === r.id;
                    return (
                        <div key={r.id} style={{ background: 'var(--input-bg)', border: '1px solid var(--border-subtle)', borderRadius: '12px', overflow: 'hidden' }}>
                            <div
                                onClick={() => setOpenId(open ? null : r.id)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '16px', cursor: 'pointer' }}
                                className="hover-lift"
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--panel-bg)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <i className="fa-solid fa-user-clock"></i>
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.employeeName || r.empCode || r.employeeId}
                                            {r.empCode && <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: '12px' }}> ({r.empCode})</span>}
                                        </p>
                                        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{longDate(r.date)}</p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                    <button
                                        disabled={busy}
                                        onClick={() => decide(r, 'approve')}
                                        style={{ ...smallButton, background: '#16a34a', color: '#fff', opacity: busy ? 0.6 : 1 }}
                                    >
                                        {busy && !rejecting ? 'Saving...' : 'Approve'}
                                    </button>
                                    <button
                                        disabled={busy}
                                        onClick={() => { setOpenId(r.id); setRejectingId(rejecting ? null : r.id); setNote(''); setMessage(null); }}
                                        style={{ ...smallButton, background: 'rgba(220, 38, 38, 0.12)', color: '#dc2626', opacity: busy ? 0.6 : 1 }}
                                    >
                                        Reject
                                    </button>
                                </div>
                            </div>

                            {open && (
                                <div className="regularization-details-expanded" style={{ padding: '0 16px 16px 72px', fontSize: '13px', color: 'var(--text-primary)' }}>
                                    <div style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: '12px' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>Comment from the employee</div>
                                        <p style={{ margin: 0, whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{r.comment}</p>

                                        {(r.requestedCheckIn || r.requestedCheckOut) && (
                                            <p style={{ margin: '8px 0 0', color: 'var(--text-muted)' }}>
                                                Says they worked {r.requestedCheckIn || 'shift start'} – {r.requestedCheckOut || 'shift end'}
                                            </p>
                                        )}
                                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Sent {sentAt(r.createdAt)}</p>

                                        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '12px 0 6px' }}>
                                            Supporting documents ({r.documents.length})
                                        </div>
                                        {r.documents.length === 0 && <p style={{ margin: 0, color: 'var(--text-muted)' }}>No document attached.</p>}
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                            {r.documents.map((doc, i) => (
                                                <a key={i} href={getFullUrl(doc.url)} target="_blank" rel="noopener noreferrer" title={doc.name}
                                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '96px', textDecoration: 'none', color: 'var(--text-primary)' }}>
                                                    {isImage(doc) ? (
                                                        <img src={getFullUrl(doc.url)} alt={doc.name} style={{ width: '96px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-subtle)' }} />
                                                    ) : (
                                                        <div style={{ width: '96px', height: '72px', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', color: '#dc2626', background: 'var(--panel-bg)' }}>
                                                            <i className="fa-solid fa-file-pdf"></i>
                                                        </div>
                                                    )}
                                                    <span style={{ fontSize: '11px', maxWidth: '96px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</span>
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
                                                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '13px', resize: 'vertical' }}
                                                />
                                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                                    <button
                                                        disabled={busy || note.trim().length < 3}
                                                        onClick={() => decide(r, 'reject')}
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
