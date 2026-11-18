import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';

// What the employee did during the day, as logged from their phone: planned time, actual time,
// extra time asked for (with reasons) and how often the phone rang because the time ran out.
// A narrow column that sits between the map and Location History, one card per activity.

const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const clock = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '—');
const duration = (min) => {
    if (min === null || min === undefined) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

const STATES = {
    IN_PROGRESS: { color: '#2563eb', label: () => 'In progress' },
    OVERDUE: { color: '#dc2626', label: (a) => `Running over by ${duration(a.overMinutes)}` },
    COMPLETED: { color: '#16a34a', label: () => 'Done on time' },
    COMPLETED_LATE: { color: '#d97706', label: (a) => (a.overPlanMinutes < 1 ? 'Done late' : `Done ${duration(a.overPlanMinutes)} late`) },
    CANCELLED: { color: '#64748b', label: () => 'Cancelled' },
    UNFINISHED: { color: '#64748b', label: () => 'Not finished' }
};

const muted = { color: 'var(--text-muted)', fontSize: '11.5px' };
const label = { ...muted, fontWeight: 700, textTransform: 'uppercase', fontSize: '10.5px', marginRight: '6px' };

export default function DayActivitiesPanel({ employeeId, date }) {
    const [activities, setActivities] = useState([]);
    const [status, setStatus] = useState('loading'); // loading | ready | error
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!employeeId || !date) return undefined;
        let cancelled = false;
        const load = async () => {
            try {
                const data = await api.getEmployeeActivities(employeeId, date);
                if (!cancelled) {
                    setActivities(Array.isArray(data?.activities) ? data.activities : []);
                    setStatus('ready');
                }
            } catch (err) {
                if (!cancelled) setStatus('error');
            }
        };
        setStatus('loading');
        load();
        // Today's list changes as the employee works (and "running over" grows), so keep it fresh
        const timer = date === todayIST() ? setInterval(load, 30000) : null;
        return () => { cancelled = true; if (timer) clearInterval(timer); };
    }, [employeeId, date, reloadKey]);

    const over = activities.filter((a) => a.state === 'OVERDUE').length;

    return (
        <div id="day-activities-panel" className="glass custom-scrollbar" style={{ flex: '1 1 300px', minWidth: 0, height: '100%', maxHeight: '640px', overflowY: 'auto', padding: '15px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--border-glass)', position: 'sticky', top: 0, background: 'var(--bg-glass)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
                <h3 style={{ fontSize: '15px', margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>
                    <i className="fa-solid fa-list-check" style={{ color: '#2563eb', marginRight: '6px' }}></i> Day Activities
                </h3>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                        type="button"
                        onClick={() => setReloadKey((k) => k + 1)}
                        title="Refresh Day Activities"
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '4px 6px',
                            borderRadius: '6px',
                            fontSize: '13px'
                        }}
                    >
                        <i className={`fa-solid fa-arrows-rotate ${status === 'loading' ? 'fa-spin' : ''}`}></i>
                    </button>
                    {over > 0 && (
                        <span style={{ fontSize: '12px', color: '#dc2626', background: 'rgba(220, 38, 38, 0.1)', padding: '3px 10px', borderRadius: '12px', fontWeight: 600 }}>
                            {over} running over
                        </span>
                    )}
                    <span style={{ fontSize: '12px', color: '#2563eb', background: 'rgba(37, 99, 235, 0.1)', padding: '3px 10px', borderRadius: '12px', fontWeight: 600 }}>
                        {activities.length} {activities.length === 1 ? 'Activity' : 'Activities'}
                    </span>
                </div>
            </div>

            {status === 'loading' && activities.length === 0 && <p style={{ ...muted, margin: 0 }}>Loading activities...</p>}
            {status === 'error' && <p style={{ ...muted, margin: 0, color: 'var(--danger)' }}>Could not load the day's activities.</p>}
            {status === 'ready' && activities.length === 0 && <p style={{ ...muted, margin: 0 }}>No activities logged from the phone for this day.</p>}

            {activities.map((a) => {
                const st = STATES[a.state] || STATES.IN_PROGRESS;
                const extended = a.deadlineAt !== a.plannedEndAt;
                return (
                    <div key={a.id} style={{ padding: '10px 12px', marginBottom: '10px', borderRadius: '10px', border: '1px solid var(--border-glass)', fontSize: '12.5px', color: 'var(--text-primary)' }}>
                        {a.siteName && (
                            <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <i className="fa-solid fa-location-dot" style={{ fontSize: '10.5px' }}></i>
                                <span>{a.siteName}</span>
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                            <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{a.title}</div>
                            <span style={{ flexShrink: 0, color: st.color, background: `${st.color}1f`, padding: '2px 8px', borderRadius: '10px', fontWeight: 700, fontSize: '11px' }}>
                                {st.label(a)}
                            </span>
                        </div>
                        {a.notes && <div style={{ ...muted, whiteSpace: 'pre-line', marginTop: '2px' }}>{a.notes}</div>}

                        <div style={{ marginTop: '8px' }}>
                            <span style={label}>Planned</span>
                            {clock(a.startedAt)} – {clock(a.plannedEndAt)}
                            <span style={muted}> · {duration(a.plannedMinutes)}{extended ? ` · extended to ${clock(a.deadlineAt)}` : ''}</span>
                        </div>
                        <div style={{ marginTop: '3px' }}>
                            <span style={label}>Actual</span>
                            {clock(a.startedAt)} – {a.endedAt ? clock(a.endedAt) : 'now'}
                            <span style={muted}> · {duration(a.takenMinutes)}</span>
                        </div>
                        {a.remindersSent > 0 && (
                            <div style={{ ...muted, marginTop: '4px' }}>
                                <i className="fa-solid fa-bell" style={{ marginRight: '4px' }}></i>
                                Phone rang {a.remindersSent}×
                            </div>
                        )}

                        {(a.extensions.length > 0 || a.finishReason) && (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border-glass)' }}>
                                {a.extensions.map((e, i) => (
                                    <div key={i} style={{ marginBottom: '3px' }}>
                                        <strong>+{duration(e.extraMinutes)}</strong> <span style={muted}>at {clock(e.at)}</span> — {e.reason}
                                    </div>
                                ))}
                                {a.finishReason && (
                                    <div>
                                        <strong>{a.status === 'CANCELLED' ? 'Cancelled' : a.state === 'COMPLETED_LATE' ? 'Finished late' : 'Note'}:</strong> {a.finishReason}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
