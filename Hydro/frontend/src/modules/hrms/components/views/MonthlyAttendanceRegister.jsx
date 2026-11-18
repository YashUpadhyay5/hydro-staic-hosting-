import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';

// Monthly attendance register: every employee x every day of a month. P (present) green, EL (earned leave
// used) yellow, A (loss of pay) red, SL special leave, WO / H Sunday / holiday. Totals at the end of each row.
// In edit mode an admin picks a new mark per day; nothing is saved until they confirm the list of changes,
// and each saved change writes the real records (attendance, EL or LOP leave) on the server.

const MARK_STYLE = {
    P: { label: 'P', bg: 'rgba(22, 163, 74, 0.18)', color: '#15803d', name: 'Present' },
    EL: { label: 'EL', bg: 'rgba(234, 179, 8, 0.25)', color: '#a16207', name: 'Earned leave' },
    A: { label: 'A', bg: 'rgba(220, 38, 38, 0.16)', color: '#dc2626', name: 'Absent (LOP)' },
    SL: { label: 'SL', bg: 'rgba(37, 99, 235, 0.15)', color: '#2563eb', name: 'Special leave' },
    WO: { label: 'WO', bg: 'rgba(100, 116, 139, 0.12)', color: '#64748b', name: 'Sunday' },
    H: { label: 'H', bg: 'rgba(100, 116, 139, 0.12)', color: '#64748b', name: 'Holiday' }
};
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const EFFECT = {
    P: 'adds an attendance row (shift hours); any leave on that day is taken back',
    EL: 'charges 1 day of Earned Leave; any clock-in on that day is removed',
    A: 'records 1 day of loss of pay for payroll; any clock-in or EL on that day is removed',
    WO: 'makes it a day off again; the clock-in on that day is removed',
    H: 'makes it a holiday off again; the clock-in on that day is removed'
};

const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const dayLabel = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`));
const monthLabel = (m) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${m}-01T00:00:00Z`));
const keyOf = (employeeId, date) => `${employeeId}|${date}`;

// Same counting as the server: Absent = EL + LOP + SL; Sundays / holidays only count when worked
function totalsOf(cells) {
    const t = { present: 0, el: 0, lop: 0, specialLeave: 0 };
    for (const c of cells) {
        if (c.mark === 'P') t.present++;
        else if (c.mark === 'EL') { t.el += c.part || 1; if (c.part) t.lop += 1 - c.part; }
        else if (c.mark === 'A') t.lop++;
        else if (c.mark === 'SL') t.specialLeave++;
    }
    const r = (n) => Math.round(n * 100) / 100;
    return { present: t.present, el: r(t.el), lop: r(t.lop), specialLeave: t.specialLeave, absent: r(t.el + t.lop + t.specialLeave) };
}

const th = { position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-glass, var(--panel-bg))', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border-glass)', padding: '6px 4px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap' };
const nameCol = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--panel-bg, var(--bg-glass))', minWidth: '190px', maxWidth: '190px', padding: '6px 10px', borderBottom: '1px solid var(--border-glass)', borderRight: '1px solid var(--border-glass)', textAlign: 'left' };
const totalCol = { padding: '6px 8px', borderBottom: '1px solid var(--border-glass)', fontSize: '13px', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' };
const btn = { border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', height: '38px' };

export default function MonthlyAttendanceRegister({ onBack }) {
    const [month, setMonth] = useState(thisMonth);
    const [data, setData] = useState(null);
    const [status, setStatus] = useState('loading'); // loading | ready | error
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState(false);
    const [pending, setPending] = useState(() => new Map()); // key -> { employeeId, name, empCode, date, from, to }
    const [picker, setPicker] = useState(null);              // { employeeId, date, options, x, y }
    const [confirming, setConfirming] = useState(false);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState([]);                // server problems, one per change
    const [message, setMessage] = useState(null);

    const load = useCallback(async () => {
        setStatus('loading');
        try {
            const res = await api.getAttendanceRegister(month);
            setData(res);
            setStatus('ready');
        } catch (err) {
            setStatus('error');
        }
    }, [month]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPending(new Map()); setPicker(null); setErrors([]); }, [month]);

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = (data?.employees || []).filter((e) => !q
            || String(e.name || '').toLowerCase().includes(q)
            || String(e.empCode || '').toLowerCase().includes(q)
            || String(e.department || '').toLowerCase().includes(q));
        // what the row will look like once the pending changes are saved
        return list.map((e) => {
            const cells = e.cells.map((c) => {
                const p = pending.get(keyOf(e.id, c.date));
                return p ? { ...c, mark: p.to, part: null, changed: true } : c;
            });
            return { ...e, cells, totals: pending.size ? totalsOf(cells) : e.totals };
        });
    }, [data, search, pending]);

    const locked = data?.locked;

    const openPicker = (e, row, cell) => {
        if (!editing || locked || !cell.editable) return;
        const original = (data.employees.find((x) => x.id === row.id)?.cells || []).find((c) => c.date === cell.date);
        const options = cell.off ? ['P', cell.off] : ['P', 'EL', 'A'];
        const rect = e.currentTarget.getBoundingClientRect();
        setPicker({ employeeId: row.id, name: row.name, empCode: row.empCode, date: cell.date, from: original.mark, current: cell.mark, options, x: rect.left, y: rect.bottom + 4 });
    };

    const choose = (mark) => {
        const p = picker;
        setPicker(null);
        const next = new Map(pending);
        const key = keyOf(p.employeeId, p.date);
        if (mark === p.from) next.delete(key);
        else next.set(key, { employeeId: p.employeeId, name: p.name, empCode: p.empCode, date: p.date, from: p.from, to: mark });
        setPending(next);
        setErrors([]);
        setMessage(null);
    };

    const changes = [...pending.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.date.localeCompare(b.date));

    const save = async () => {
        setSaving(true);
        setErrors([]);
        try {
            const body = changes.map((c) => ({ employeeId: c.employeeId, date: c.date, mark: c.to === 'WO' || c.to === 'H' ? 'OFF' : c.to }));
            const res = await api.saveAttendanceRegisterEdits(body, note.trim());
            setMessage({ kind: 'ok', text: `${res.applied} change${res.applied === 1 ? '' : 's'} saved for ${monthLabel(month)}.` });
            setPending(new Map());
            setConfirming(false);
            setNote('');
            await load();
        } catch (err) {
            const list = err.data?.errors;
            if (Array.isArray(list) && list.length) setErrors(list);
            else setErrors([{ index: -1, message: err.message || 'Could not save the changes.' }]);
        } finally {
            setSaving(false);
        }
    };

    const discard = () => { setPending(new Map()); setErrors([]); setMessage(null); };

    return (
        <div id="monthly-register-view" className="view active" style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }} onClick={() => picker && setPicker(null)}>
            <div className="glass" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <button className="btn btn-outline" onClick={onBack} title="Back to Logs"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', cursor: 'pointer', borderRadius: '6px' }}>
                        <i className="fa-solid fa-arrow-left"></i>
                    </button>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Monthly Attendance Register</h2>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{monthLabel(month)}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)}
                        style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} />
                    <input type="text" placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)}
                        style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', minWidth: '200px' }} />
                    {!editing ? (
                        <button disabled={!!locked || status !== 'ready'} onClick={() => { setEditing(true); setMessage(null); }}
                            title={locked ? 'Payroll for this month is already done' : 'Change days in this month'}
                            style={{ ...btn, background: '#4f46e5', color: '#fff', opacity: locked || status !== 'ready' ? 0.5 : 1 }}>
                            <i className="fa-solid fa-pen"></i> Edit
                        </button>
                    ) : (
                        <>
                            <button disabled={!pending.size} onClick={() => { setConfirming(true); setErrors([]); }}
                                style={{ ...btn, background: '#16a34a', color: '#fff', opacity: pending.size ? 1 : 0.5 }}>
                                <i className="fa-solid fa-floppy-disk"></i> Save changes ({pending.size})
                            </button>
                            <button onClick={() => { discard(); setEditing(false); }} style={{ ...btn, background: 'var(--input-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)' }}>
                                {pending.size ? 'Discard' : 'Done'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>
                {Object.entries(MARK_STYLE).map(([k, s]) => (
                    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ background: s.bg, color: s.color, fontWeight: 700, borderRadius: '4px', padding: '1px 6px' }}>{s.label}</span>{s.name}
                    </span>
                ))}
                {editing && !locked && <span style={{ marginLeft: 'auto', color: '#4f46e5', fontWeight: 600 }}>Click a day to change it. Nothing is saved until you confirm.</span>}
            </div>

            {locked && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(234, 179, 8, 0.15)', color: '#a16207', fontSize: '13px', fontWeight: 500, flexShrink: 0 }}>
                    <i className="fa-solid fa-lock" style={{ marginRight: '6px' }}></i>
                    Payroll for {monthLabel(month)} is already {String(locked.status).toLowerCase()}, so its attendance cannot be edited.
                </div>
            )}
            {!locked && data?.olderPayrollRun && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(37, 99, 235, 0.1)', color: '#2563eb', fontSize: '13px', fontWeight: 500, flexShrink: 0 }}>
                    <i className="fa-solid fa-circle-info" style={{ marginRight: '6px' }}></i>
                    Payroll for {monthLabel(month)} was run before this register. Corrections here update attendance and leave balances, but that payroll keeps the LOP it was run with.
                </div>
            )}
            {message && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(22, 163, 74, 0.12)', color: '#16a34a', fontSize: '13px', fontWeight: 500, flexShrink: 0 }}>{message.text}</div>
            )}

            <div className="glass custom-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', borderRadius: '12px' }}>
                {status === 'loading' && !data && <p style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading the register...</p>}
                {status === 'error' && <p style={{ padding: '30px', textAlign: 'center', color: 'var(--danger)' }}>Could not load the register.</p>}
                {data && (
                    <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content', minWidth: '100%' }}>
                        <thead>
                            <tr>
                                <th style={{ ...th, ...nameCol, zIndex: 3, top: 0 }}>Employee</th>
                                {data.days.map((d) => (
                                    <th key={d.date} style={{ ...th, minWidth: '34px', background: d.weekday === 0 ? 'rgba(100, 116, 139, 0.15)' : th.background }}>
                                        <div style={{ color: 'var(--text-primary)', fontSize: '12px' }}>{d.day}</div>
                                        <div>{WEEKDAY[d.weekday]}</div>
                                    </th>
                                ))}
                                <th style={{ ...th, color: '#15803d' }}>Present</th>
                                <th style={{ ...th }}>Absent</th>
                                <th style={{ ...th, color: '#a16207' }}>EL</th>
                                <th style={{ ...th, color: '#dc2626' }}>LOP</th>
                                {rows.some((r) => r.totals.specialLeave) && <th style={{ ...th, color: '#2563eb' }}>SL</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && (
                                <tr><td colSpan={data.days.length + 5} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>No employees match.</td></tr>
                            )}
                            {rows.map((r) => (
                                <tr key={r.id}>
                                    <td style={nameCol}>
                                        <div style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{r.name}</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[r.empCode, r.location].filter(Boolean).join(' · ')}</div>
                                    </td>
                                    {r.cells.map((c) => {
                                        const s = MARK_STYLE[c.mark];
                                        const clickable = editing && !locked && c.editable;
                                        const title = [dayLabel(c.date), c.holiday, s ? s.name : (c.source === 'NOT_JOINED' ? 'Before joining' : ''),
                                            c.part ? `${c.part} day EL` : '', c.alsoOnLeave ? 'also has leave' : '', c.changed ? 'changed, not saved yet' : '']
                                            .filter(Boolean).join(' · ');
                                        return (
                                            <td key={c.date} title={title} onClick={(e) => { e.stopPropagation(); openPicker(e, r, c); }}
                                                style={{ padding: '3px', borderBottom: '1px solid var(--border-glass)', textAlign: 'center', cursor: clickable ? 'pointer' : 'default' }}>
                                                <div style={{
                                                    minWidth: '28px', height: '26px', lineHeight: '26px', borderRadius: '5px', fontSize: '11px', fontWeight: 700,
                                                    background: s ? s.bg : 'transparent', color: s ? s.color : 'var(--text-muted)',
                                                    outline: c.changed ? '2px solid #4f46e5' : (clickable ? '1px dashed rgba(79, 70, 229, 0.35)' : 'none'),
                                                    outlineOffset: '-1px'
                                                }}>
                                                    {s ? (c.part ? `${s.label}½` : s.label) : (c.source === 'NOT_JOINED' ? '–' : '')}
                                                </div>
                                            </td>
                                        );
                                    })}
                                    <td style={{ ...totalCol, color: '#15803d' }}>{r.totals.present}</td>
                                    <td style={{ ...totalCol, color: 'var(--text-primary)' }}>{r.totals.absent}</td>
                                    <td style={{ ...totalCol, color: '#a16207' }}>{r.totals.el}</td>
                                    <td style={{ ...totalCol, color: '#dc2626' }}>{r.totals.lop}</td>
                                    {rows.some((x) => x.totals.specialLeave) && <td style={{ ...totalCol, color: '#2563eb' }}>{r.totals.specialLeave}</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {picker && (
                <div onClick={(e) => e.stopPropagation()}
                    style={{ position: 'fixed', left: Math.min(picker.x, window.innerWidth - 200), top: Math.min(picker.y, window.innerHeight - 120), zIndex: 10000, background: 'var(--panel-bg, #fff)', border: '1px solid var(--border-glass)', borderRadius: '10px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', padding: '10px', minWidth: '180px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>{picker.name} · {dayLabel(picker.date)}</div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        {picker.options.map((m) => (
                            <button key={m} onClick={() => choose(m)}
                                style={{ border: picker.current === m ? '2px solid #4f46e5' : '1px solid transparent', borderRadius: '6px', padding: '6px 10px', fontWeight: 700, fontSize: '12px', cursor: 'pointer', background: MARK_STYLE[m].bg, color: MARK_STYLE[m].color }}>
                                {m === 'WO' || m === 'H' ? 'Off' : MARK_STYLE[m].label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {confirming && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                    <div className="glass" style={{ background: 'var(--panel-bg, #fff)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '620px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>
                            <i className="fa-solid fa-triangle-exclamation" style={{ color: '#d97706', marginRight: '8px' }}></i>
                            Confirm {changes.length} attendance change{changes.length === 1 ? '' : 's'}
                        </h3>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                            These changes update the database: attendance, leave balances and payroll loss of pay for {monthLabel(month)}. Please check them before you confirm.
                        </p>
                        <div className="custom-scrollbar" style={{ overflowY: 'auto', border: '1px solid var(--border-glass)', borderRadius: '10px' }}>
                            {changes.map((c, i) => {
                                const problem = errors.find((e) => e.index === i);
                                return (
                                    <div key={keyOf(c.employeeId, c.date)} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-glass)', fontSize: '13px', background: problem ? 'rgba(220, 38, 38, 0.08)' : 'transparent' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', color: 'var(--text-primary)' }}>
                                            <strong>{c.name}</strong>{c.empCode && <span style={{ color: 'var(--text-muted)' }}>({c.empCode})</span>}
                                            <span style={{ color: 'var(--text-muted)' }}>· {dayLabel(c.date)}:</span>
                                            <span style={{ background: MARK_STYLE[c.from]?.bg, color: MARK_STYLE[c.from]?.color, fontWeight: 700, borderRadius: '4px', padding: '1px 6px' }}>{c.from}</span>
                                            <i className="fa-solid fa-arrow-right" style={{ fontSize: '11px', color: 'var(--text-muted)' }}></i>
                                            <span style={{ background: MARK_STYLE[c.to]?.bg, color: MARK_STYLE[c.to]?.color, fontWeight: 700, borderRadius: '4px', padding: '1px 6px' }}>{c.to}</span>
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>This {EFFECT[c.to]}.</div>
                                        {problem && <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '3px', fontWeight: 600 }}>{problem.message}</div>}
                                    </div>
                                );
                            })}
                        </div>
                        {errors.some((e) => e.index === -1 || e.index >= changes.length) && (
                            <div style={{ fontSize: '13px', color: '#dc2626', fontWeight: 600 }}>{errors.find((e) => e.index === -1 || e.index >= changes.length).message}</div>
                        )}
                        {errors.length > 0 && <div style={{ fontSize: '13px', color: '#dc2626' }}>Nothing was saved. Fix or remove the marked changes and try again.</div>}
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Reason for the change (optional, kept in the edit log)"
                            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '13px', resize: 'vertical' }} />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button onClick={() => setConfirming(false)} disabled={saving} style={{ ...btn, background: 'var(--input-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)' }}>Cancel</button>
                            <button onClick={save} disabled={saving} style={{ ...btn, background: '#16a34a', color: '#fff', opacity: saving ? 0.6 : 1 }}>
                                {saving ? 'Saving...' : 'Confirm and save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
