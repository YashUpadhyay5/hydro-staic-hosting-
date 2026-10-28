import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api } from '../../services/api';
import { Avatar, SummaryCard } from './leaveBalanceUi';
import MonthEditModal from './MonthEditModal';
import MonthDetailsModal from './MonthDetailsModal';
import { CreditsPanel, LeftSplit } from './LeaveCredits';
import { fmtDays, useToast, newIdempotencyKey, formatDateTime, formatDay, creditName, isAutoReason, showReason, whereConsumed, fromEarlierText, FIELD_LABEL } from './leaveBalanceUtils';
import './leaveBalances.css';

// Unsaved changes. migration: { [month]: { values: { earned?, special?, consumed? }, comments: { field: text } } };
// remarks: { [creditId]: new remark of a Sun/Hol credit }; carry: { value, comment } | null
const EMPTY_PENDING = { earned: {}, specialAdds: [], reversals: {}, remarks: {}, corrections: [], migration: {}, carry: null };
const MIGRATION_FIELDS = [
    { key: 'earned', label: 'Earned', className: '' },
    { key: 'special', label: 'Special earned', className: 'lb-purple' },
    { key: 'consumed', label: 'Consumed', className: 'lb-red' }
];
const UNSAVED_MESSAGE = 'You have unsaved leave changes. Leave without submitting them?';
const isHalfStep = (n) => Number.isFinite(n) && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;

function countPending(p) {
    const migrationValues = Object.values(p.migration).reduce((s, m) => s + Object.keys(m.values).length, 0);
    return Object.keys(p.earned).length + p.specialAdds.length + Object.keys(p.reversals).length + Object.keys(p.remarks).length
        + p.corrections.length + migrationValues + (p.carry ? 1 : 0);
}

function describeWorkDate(r) {
    const tags = [];
    if (r.dayName) tags.push(r.dayName);
    if (r.holidayName) tags.push(r.holidayName);
    return tags.join(' · ');
}

export default function EmployeeLeaveLedgerView({ employeeId, initialYear, onBack, onYearChange, registerNavigationGuard }) {
    const [year, setYear] = useState(() => Number(initialYear) || new Date().getFullYear());
    const [ledger, setLedger] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [years, setYears] = useState([]);
    const [pending, setPending] = useState(EMPTY_PENDING);
    const [saving, setSaving] = useState(false);
    const [submitErrors, setSubmitErrors] = useState([]);
    const [modalMonth, setModalMonth] = useState(null);
    const [editMonth, setEditMonth] = useState(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [toastNode, showToast] = useToast();
    // A retry of exactly the same changes reuses its key (so it can never be saved twice); new changes get a new key.
    const attemptRef = useRef({ payload: null, key: null });
    const savingRef = useRef(false);

    const pendingCount = countPending(pending);
    const dirty = pendingCount > 0;
    const canEdit = !!ledger?.canEdit;

    useEffect(() => {
        api.getLeaveBalanceMeta().then((m) => { if (m?.years) setYears(m.years); }).catch(() => { /* fall back to the current year */ });
    }, []);

    const loadLedger = useCallback((signal) => {
        setLoading(true);
        setLoadError(null);
        return api.getEmployeeLeaveLedger(employeeId, year, { signal })
            .then((data) => { if (data) setLedger(data); return data; })
            .catch((err) => { setLoadError({ status: err.status, message: err.message || 'Failed to load the leave ledger.' }); })
            .finally(() => { if (!signal?.aborted) setLoading(false); });
    }, [employeeId, year]);

    useEffect(() => {
        if (!employeeId) { setLoading(false); setLoadError({ status: 404, message: 'No employee selected.' }); return undefined; }
        const controller = new AbortController();
        loadLedger(controller.signal);
        return () => controller.abort();
    }, [loadLedger, employeeId, reloadToken]);

    // Unsaved-changes protection: in-app navigation (guard) and tab close/refresh (beforeunload).
    useEffect(() => {
        registerNavigationGuard?.(dirty ? () => window.confirm(UNSAVED_MESSAGE) : null);
        if (!dirty) return undefined;
        const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = UNSAVED_MESSAGE; return UNSAVED_MESSAGE; };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [dirty, registerNavigationGuard]);
    useEffect(() => () => registerNavigationGuard?.(null), [registerNavigationGuard]);

    useEffect(() => { setSubmitErrors([]); }, [pending]);

    const monthsByNumber = useMemo(() => new Map((ledger?.months || []).map((m) => [m.month, m])), [ledger]);

    const changeYear = (y) => {
        if (y === year) return;
        if (dirty && !window.confirm(UNSAVED_MESSAGE)) return;
        setPending(EMPTY_PENDING);
        setYear(y);
        onYearChange?.(y);
    };

    // ---- edits: the month's Edit dialog saves straight away; anything that failed to save stays pending ----
    const inMonth = (iso, m) => Number(String(iso).slice(0, 4)) === year && Number(String(iso).slice(5, 7)) === m;
    const recordIdsOf = (m) => new Set((monthsByNumber.get(m)?.specialEarnedRecords || []).map((r) => r.id));
    const pick = (obj, ids, keep) => Object.fromEntries(Object.entries(obj).filter(([id]) => ids.has(id) === keep));
    const stagedForMonth = (m) => {
        const ids = recordIdsOf(m);
        return {
            earned: pending.earned[m] || null,
            migration: pending.migration[m] || null,
            specialAdds: pending.specialAdds.filter((s) => inMonth(s.workDate, m)),
            reversals: pick(pending.reversals, ids, true),
            remarks: pick(pending.remarks, ids, true),
            corrections: pending.corrections.filter((c) => c.month === m)
        };
    };
    // Replaces everything pending for one month with what the Edit dialog returned.
    const mergeMonth = (p, m, result) => {
        const ids = recordIdsOf(m);
        const earned = { ...p.earned };
        if (result.earned) earned[m] = result.earned; else delete earned[m];
        const migration = { ...p.migration };
        if (result.migration) migration[m] = result.migration; else delete migration[m];
        return {
            ...p,
            earned,
            migration,
            specialAdds: [...p.specialAdds.filter((s) => !inMonth(s.workDate, m)), ...result.specialAdds],
            reversals: { ...pick(p.reversals, ids, false), ...result.reversals },
            remarks: { ...pick(p.remarks, ids, false), ...result.remarks },
            corrections: [...p.corrections.filter((c) => c.month !== m), ...result.corrections]
        };
    };
    const saveMonth = async (m, result) => {
        const next = mergeMonth(pending, m, result);
        setPending(next);
        const res = await saveAll(next);
        if (res.ok) setEditMonth(null);
        return res;
    };
    const setCarry = (patch) => setPending((p) => {
        const saved = ledger.carryForward === null || ledger.carryForward === undefined ? '' : String(ledger.carryForward);
        const next = { value: p.carry ? p.carry.value : saved, comment: p.carry ? p.carry.comment : '', ...patch };
        return { ...p, carry: next.value === saved && !next.comment ? null : next };
    });
    const discard = () => { if (window.confirm('Discard all unsaved changes?')) setPending(EMPTY_PENDING); };

    const buildChanges = (p) => {
        const errors = [];
        const changes = [];
        Object.entries(p.earned).forEach(([month, e]) => {
            const v = Number(e.value);
            if (e.value === '' || !Number.isFinite(v) || v < 0 || v > 31 || !isHalfStep(v)) errors.push(`${monthsByNumber.get(Number(month))?.monthName}: earned leave must be 0–31 in steps of 0.5.`);
            changes.push({ kind: 'earned', year, month: Number(month), value: v, comment: e.comment || '' });
        });
        // removals before additions, so a removed date can be added again in the same save
        Object.entries(p.reversals).forEach(([id, reason]) => changes.push({ kind: 'special-reverse', adjustmentId: id, reason }));
        Object.entries(p.remarks).forEach(([id, reason]) => changes.push({ kind: 'special-remark', adjustmentId: id, reason }));
        p.specialAdds.forEach((s) => changes.push({ kind: 'special-add', creditType: s.creditType, workDate: s.workDate, days: s.days, reason: s.reason }));
        p.corrections.forEach((c) => changes.push({ kind: 'consumed', year, month: c.month, deltaDays: c.deltaDays, reason: c.reason }));
        Object.entries(p.migration).forEach(([month, entry]) => {
            Object.entries(entry.values).forEach(([field, raw]) => {
                const v = Number(raw);
                if (raw === '' || !Number.isFinite(v) || v < 0 || v > 31 || !isHalfStep(v)) errors.push(`${monthsByNumber.get(Number(month))?.monthName} ${field}: enter 0–31 in steps of 0.5.`);
                changes.push({ kind: 'migration', year, month: Number(month), field, value: v, comment: entry.comments?.[field] || '' });
            });
        });
        if (p.carry) {
            const v = Number(p.carry.value);
            if (p.carry.value === '' || !Number.isFinite(v) || v < 0 || v > 365 || !isHalfStep(v)) errors.push('Carry-forward: enter 0–365 in steps of 0.5.');
            changes.push({ kind: 'migration-carry', value: v, comment: p.carry.comment || '' });
        }
        return { changes, errors };
    };

    // Saves the given pending changes in one request. Resolves to { ok, errors }.
    const saveAll = async (p) => {
        if (savingRef.current) return { ok: false, errors: ['A save is already in progress.'] };
        const { changes, errors } = buildChanges(p);
        if (errors.length) { setSubmitErrors(errors); return { ok: false, errors }; }
        if (!changes.length) return { ok: true };
        const payload = JSON.stringify(changes);
        if (attemptRef.current.payload !== payload) attemptRef.current = { payload, key: newIdempotencyKey() };
        savingRef.current = true;
        setSaving(true);
        setSubmitErrors([]);
        try {
            const res = await api.submitLeaveLedgerChanges(ledger.employeeId, {
                year, expectedVersion: ledger.version, idempotencyKey: attemptRef.current.key, changes
            });
            if (!res?.ledger) throw new Error('The server did not confirm the save. Reload to check.');
            setLedger(res.ledger);
            setPending(EMPTY_PENDING);
            attemptRef.current = { payload: null, key: null };
            showToast('success', res.duplicate ? 'These changes were already saved.' : `Saved ${changes.length} change${changes.length === 1 ? '' : 's'}. Balances recalculated.`);
            return { ok: true };
        } catch (err) {
            if (err.status === 409) {
                showToast('error', err.message, { label: 'Reload latest', onClick: () => setReloadToken((n) => n + 1) }, true);
                return { ok: false, errors: [err.message] };
            }
            const list = err.status === 400 && Array.isArray(err.data?.details) ? err.data.details.map((d) => d.message) : [`${err.message || 'Save failed.'} Nothing was saved.`];
            setSubmitErrors(list);
            return { ok: false, errors: list };
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    // ---- render ----
    if (loading && !ledger) {
        return (
            <div className="view active lb-view">
                <div className="glass lb-profile"><div className="lb-skeleton" style={{ width: '40%', height: 22 }} /></div>
                <div className="lb-cards">{[0, 1, 2, 3].map((i) => <div key={i} className="glass lb-card"><div className="lb-skeleton" style={{ width: '100%', height: 34 }} /></div>)}</div>
                <div className="glass lb-table-wrap" style={{ padding: 16 }}>{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="lb-skeleton" style={{ margin: '12px 0' }} />)}</div>
            </div>
        );
    }
    if (loadError && !ledger) {
        return (
            <div className="view active lb-view">
                <div className="glass lb-state">
                    <div className="lb-error-text" role="alert" style={{ fontSize: '0.95rem', marginBottom: 12 }}>
                        {loadError.status === 404 ? 'Employee not found.' : loadError.status === 403 ? 'You do not have access to this employee’s leave ledger.' : loadError.message}
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                        <button className="lb-btn" onClick={onBack}><i className="fa-solid fa-arrow-left"></i> Back to List</button>
                        {loadError.status !== 404 && loadError.status !== 403 && <button className="lb-btn" onClick={() => setReloadToken((n) => n + 1)}>Retry</button>}
                    </div>
                </div>
            </div>
        );
    }

    const now = new Date();
    const yearOptions = [...new Set([...(years.length ? years : []), year, now.getFullYear()])].sort((a, b) => b - a);
    const ys = ledger.yearSummary;
    const ledgerStartLabel = ledger.policy?.ledgerStartMonth;

    const pendingSpecialFor = (m) => pending.specialAdds.filter((s) => Number(s.workDate.slice(5, 7)) === m && Number(s.workDate.slice(0, 4)) === year);
    const pendingReversalsFor = (month) => month.specialEarnedRecords.filter((r) => pending.reversals[r.id] !== undefined);
    const pendingCorrectionsFor = (m) => pending.corrections.filter((c) => c.month === m);

    // Cells are display-only; all editing happens in the month's Edit dialog. Pending values show "→ new".
    const pendingNote = (value) => <span className="lb-pending-note">→ {value === '' ? '0' : fmtDays(Number(value))} pending</span>;

    const renderMigrationField = (month, field) => {
        const saved = month.migrationValues ? month.migrationValues[field] : null;
        const staged = pending.migration[month.month]?.values?.[field];
        const cls = MIGRATION_FIELDS.find((f) => f.key === field).className;
        return (
            <span className={staged !== undefined ? 'lb-cell-changed' : ''} style={{ display: 'inline-block', padding: '2px 4px', borderRadius: 6 }}>
                <span className={`lb-num ${cls}`} title={month.ineligibleReason || ''}>{month.migrated ? fmtDays(saved ?? 0) : '—'}</span>
                {staged !== undefined && pendingNote(staged)}
            </span>
        );
    };

    const renderEarned = (month) => {
        if (month.migrationMonth) return renderMigrationField(month, 'earned');
        const staged = pending.earned[month.month];
        return (
            <span className={staged ? 'lb-cell-changed' : ''} style={{ display: 'inline-block', padding: '2px 4px', borderRadius: 6 }}>
                <span className="lb-num" title={month.ineligibleReason || ''}>{month.inLedger ? fmtDays(month.earnedLeave) : '—'}</span>
                {staged && pendingNote(staged.value)}
            </span>
        );
    };

    const renderSpecial = (month) => {
        if (month.migrationMonth && !month.specialEarnedRecords.length && !pendingSpecialFor(month.month).length) return renderMigrationField(month, 'special');
        if (!month.inLedger && !month.migrationMonth) return <span className="lb-muted">—</span>;
        const adds = pendingSpecialFor(month.month);
        const removals = pendingReversalsFor(month);
        const delta = adds.reduce((s, a) => s + a.days, 0) - removals.reduce((s, r) => s + r.days, 0);
        return (
            <>
                <button className="lb-chip lb-chip-purple" onClick={() => setModalMonth({ month: month.month, section: 'special' })} aria-label={`Special earned leave ${fmtDays(month.specialEarnedLeave)} days in ${month.monthName}. Open details.`}>
                    {fmtDays(month.specialEarnedLeave)} <i className="fa-solid fa-circle-info" style={{ fontSize: '0.72rem' }}></i>
                    <span className="lb-tooltip" role="tooltip">
                        {month.specialEarnedRecords.length === 0 ? 'No special-earned credits this month' : month.specialEarnedRecords.map((r) => (
                            <div key={r.id}>{formatDay(r.workDate)} · {fmtDays(r.days)} day{r.days === 1 ? '' : 's'}{describeWorkDate(r) ? ` · ${describeWorkDate(r)}` : ''}</div>
                        ))}
                    </span>
                </button>
                {(adds.length > 0 || removals.length > 0) && <span className="lb-pending-note">{delta >= 0 ? '+' : ''}{fmtDays(delta)} pending</span>}
            </>
        );
    };

    const renderConsumed = (month) => {
        if (month.migrationMonth) return renderMigrationField(month, 'consumed');
        const corr = pendingCorrectionsFor(month.month);
        const delta = corr.reduce((s, c) => s + c.deltaDays, 0);
        if (!month.inLedger && month.consumedRecords.length === 0) return <span className="lb-muted">—</span>;
        return (
            <>
                <button className="lb-chip lb-chip-red" onClick={() => setModalMonth({ month: month.month, section: 'consumed' })} aria-label={`Consumed leave ${fmtDays(month.consumedLeave)} days in ${month.monthName}. View leave records.`}>
                    {month.inLedger ? fmtDays(month.consumedLeave) : '—'} <i className="fa-solid fa-list" style={{ fontSize: '0.72rem' }}></i>
                    <span className="lb-tooltip" role="tooltip">
                        {month.usage?.from.length > 0 && (
                            <div>Used from: {month.usage.from.map((f) => `${fmtDays(f.days)} ${creditName(f, year)}`).join(', ')}</div>
                        )}
                        {month.consumedRecords.length} approved request{month.consumedRecords.length === 1 ? '' : 's'}
                        {month.consumedCorrection ? ` · correction ${month.consumedCorrection > 0 ? '+' : ''}${fmtDays(month.consumedCorrection)}` : ''}
                        {!month.inLedger ? ' · before ledger start, not deducted' : ''}
                    </span>
                </button>
                {corr.length > 0 && <span className="lb-pending-note">{delta > 0 ? '+' : ''}{fmtDays(delta)} pending</span>}
            </>
        );
    };

    // Backend fills in a generic reason ("Earned leave for 2026-01 set to 0") when the admin typed no comment; that is noise here.
    // Reasons the employee wrote on the approved leave requests that make up this month's consumed leave.
    const renderRequestReasons = (month) => {
        const recs = (month.consumedRecords || []).filter((r) => r.reason && String(r.reason).trim());
        if (!recs.length) return null;
        const shown = recs.slice(0, 2);
        return (
            <div title={recs.map((r) => `${formatDay(r.startDate)}${r.endDate && r.endDate !== r.startDate ? ` – ${formatDay(r.endDate)}` : ''}: ${r.reason}`).join('\n')}>
                <strong className="lb-red">Consumed:</strong>{' '}
                {shown.map((r) => `${r.reason} (${formatDay(r.startDate)}${r.endDate && r.endDate !== r.startDate ? ` – ${formatDay(r.endDate)}` : ''})`).join('; ')}
                {recs.length > shown.length ? ` (+${recs.length - shown.length} more)` : ''}
            </div>
        );
    };
    const whoWhen = (h) => `${h.fromImport ? 'Excel import' : h.adjustedBy}, ${formatDateTime(h.createdAt)}`;

    // Worked out automatically for every month: where this month's EL and Sun/Hol were consumed
    // (including the same month), and which earlier credits this month's leave used.
    const renderUsage = (month) => {
        if (!month.usage) return null;
        const earned = (ledger.credits || []).filter((c) => c.kind !== 'CARRY' && c.year === year && c.month === month.month);
        // only where something was consumed; "not consumed yet" on every untouched month would just be noise here
        const consumedOnly = (credits) => (credits.some((c) => c.used > 0) ? whereConsumed(credits, year, month.month) : null);
        const el = consumedOnly(earned.filter((c) => c.kind === 'EL'));
        const sunHol = consumedOnly(earned.filter((c) => c.kind === 'SPECIAL'));
        const earlier = fromEarlierText(month.usage.from, year, month.month);
        if (!el && !sunHol && !earlier) return null;
        return (
            <div className="lb-auto-note" title="Worked out from the leave records (first earned, first used)">
                {el && <div><strong>EL:</strong> {el}</div>}
                {sunHol && <div><strong className="lb-purple">Sun/Hol:</strong> {sunHol}</div>}
                {earlier && <div><strong className="lb-red">Consumed from earlier:</strong> {earlier}</div>}
            </div>
        );
    };

    // History figures that no longer match the register they were imported from.
    const renderRegisterFlag = (month) => {
        const diffs = month.register?.differences || [];
        if (!diffs.length) return null;
        return (
            <div className="lb-register-flag" title="Changed after the register was imported. Open Edit to compare and, if needed, use the register value.">
                <i className="fa-solid fa-triangle-exclamation"></i> Differs from register: {diffs.map((d) => `${FIELD_LABEL[d.field]} ${fmtDays(d.now)} (register ${fmtDays(d.register)})`).join(', ')}
            </div>
        );
    };

    const renderComments = (month) => {
        const usage = renderUsage(month);
        const registerFlag = renderRegisterFlag(month);
        if (month.migrationMonth) {
            const stagedMigration = pending.migration[month.month];
            // Only real admin remarks; who/when stays in the hover tooltip and the month's history popup.
            const latest = MIGRATION_FIELDS
                .map((f) => ({ f, h: month.migrationHistory.find((x) => x.field === f.key) }))
                .filter((x) => x.h && !isAutoReason(x.h.reason) && /[a-z0-9]/i.test(x.h.reason));
            const hasPending = stagedMigration && Object.values(stagedMigration.comments || {}).some(Boolean);
            return (
                <div className="lb-comment">
                    {registerFlag}
                    {stagedMigration && Object.entries(stagedMigration.comments || {}).filter(([, t]) => t).map(([field, t]) => (
                        <div key={field} className="lb-pending-note">{MIGRATION_FIELDS.find((f) => f.key === field)?.label}: “{t}” (pending)</div>
                    ))}
                    {latest.map(({ f, h }) => (
                        <div key={f.key} title={`${h.reason} — ${whoWhen(h)}`}><strong className={f.className}>{f.label}:</strong> {showReason(h.reason)}</div>
                    ))}
                    {renderRequestReasons(month)}
                    {usage}
                    {!latest.length && !hasPending && !usage && !registerFlag && !(month.consumedRecords || []).some((r) => r.reason) && <span className="lb-muted">—</span>}
                </div>
            );
        }
        const staged = pending.earned[month.month];
        const o = month.earnedLeaveOverride;
        return (
            <div className="lb-comment">
                {staged && staged.comment && <div className="lb-pending-note">Earned: “{staged.comment}” (pending)</div>}
                {pendingCorrectionsFor(month.month).map((c) => <div key={c.tempId} className="lb-pending-note">Consumed {c.deltaDays > 0 ? '+' : ''}{fmtDays(c.deltaDays)}: “{c.reason}” (pending)</div>)}
                {pendingSpecialFor(month.month).map((s) => <div key={s.tempId} className="lb-pending-note">Special {formatDay(s.workDate)} ({s.label}): “{s.reason}” (pending)</div>)}
                {o && <div title={`${o.reason} — ${whoWhen(o)}`}>Earned {fmtDays(o.previousValue)} → {fmtDays(o.newValue)}{isAutoReason(o.reason) ? '' : `: ${o.reason}`}</div>}
                {renderRequestReasons(month)}
                {month.consumedCorrections.length > 0 && <div title={month.consumedCorrections[month.consumedCorrections.length - 1].reason}><strong className="lb-red">Consumed:</strong> “{month.consumedCorrections[month.consumedCorrections.length - 1].reason}”{month.consumedCorrections.length > 1 ? ` (+${month.consumedCorrections.length - 1} more)` : ''}</div>}
                {month.specialEarnedRecords.length > 0 && <div title={month.specialEarnedRecords[month.specialEarnedRecords.length - 1].reason}><strong className="lb-purple">Special:</strong> “{month.specialEarnedRecords[month.specialEarnedRecords.length - 1].reason}”{month.specialEarnedRecords.length > 1 ? ` (+${month.specialEarnedRecords.length - 1} more)` : ''}</div>}
                {usage}
                {!o && !staged && !usage && month.consumedCorrections.length === 0 && month.specialEarnedRecords.length === 0 && !(month.consumedRecords || []).some((r) => r.reason)
                    && !pendingCorrectionsFor(month.month).length && !pendingSpecialFor(month.month).length
                    && <span className="lb-muted">{month.ineligibleReason || '—'}</span>}
            </div>
        );
    };

    const isCurrent = (m) => year === now.getFullYear() && m.month === now.getMonth() + 1;
    // Months with something to edit: history months, and live months already reached
    const canEditMonth = (m) => canEdit && (m.migrationMonth || (m.inLedger && m.ineligibleReason !== 'Month not reached yet'));
    // EL vs Sun/Hol left at the end of the year's last counted month
    const yearEndLeft = [...ledger.months].reverse().find((m) => m.usage)?.usage.left || null;
    const remainingClass = (v) => (v !== null && v < 0 ? 'lb-red' : 'lb-green');

    return (
        <div className="view active lb-view">
            {toastNode}
            <div className="glass lb-header">
                <div>
                    <h2 className="lb-title">Employee Leave Details</h2>
                    <p className="lb-subtitle">
                        {`Months from ${ledger.policy?.migrationStartMonth} to before ${ledgerStartLabel} are migration history from the previous platform${canEdit ? ' (editable)' : ''}; from ${ledgerStartLabel} balances are calculated from approved leave.`}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {dirty && <span className="lb-badge lb-badge-amber"><i className="fa-solid fa-pen"></i> Unsaved changes ({pendingCount})</span>}
                    {!canEdit && <span className="lb-badge lb-badge-grey"><i className="fa-solid fa-lock"></i> Read-only</span>}
                    {ledger.registerChanges?.length > 0 && (
                        <span className="lb-badge lb-badge-amber" title={ledger.registerChanges.map((c) => `${c.monthName || 'Carry-forward'}: ${FIELD_LABEL[c.field]} ${fmtDays(c.now)} (register ${fmtDays(c.register)})`).join('\n')}>
                            <i className="fa-solid fa-triangle-exclamation"></i> {ledger.registerChanges.length} differ{ledger.registerChanges.length === 1 ? 's' : ''} from the register
                        </span>
                    )}
                    <label className="lb-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <span>Year</span>
                        <select className="lb-input" value={year} onChange={(e) => changeYear(Number(e.target.value))}>
                            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </label>
                    <button className="lb-btn" onClick={onBack}><i className="fa-solid fa-arrow-left"></i> Back to List</button>
                </div>
            </div>

            <div className="glass lb-profile">
                <Avatar name={ledger.name} photo={ledger.profilePhoto} large />
                <div style={{ minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{ledger.name}</div>
                    <span className={`lb-badge ${ledger.status === 'ACTIVE' ? 'lb-badge-green' : 'lb-badge-grey'}`}>{ledger.status || 'UNKNOWN'}</span>
                </div>
                <dl className="lb-profile-grid">
                    <div><dt>Employee ID</dt><dd>{ledger.empCode}</dd></div>
                    <div><dt>Designation</dt><dd>{ledger.designation || '—'}</dd></div>
                    <div><dt>Department</dt><dd>{ledger.department || '—'}</dd></div>
                    <div><dt>Joining Date</dt><dd>{ledger.joiningDate ? formatDay(ledger.joiningDate) : '—'}{ledger.joiningDate && !ledger.joiningDateValid && <span className="lb-error-text"> (unreadable)</span>}</dd></div>
                    <div><dt>Location</dt><dd>{ledger.location || '—'}</dd></div>
                    <div>
                        <dt>{ledger.migrationActive ? 'Carried from previous year' : 'Opening Balance'}</dt>
                        <dd title={ledger.migrationActive ? `Carried into ${ledger.policy?.migrationStartMonth}` : `Carried in at ledger start (${ledgerStartLabel})`}>
                            {canEdit ? (
                                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input
                                        type="number" min="0" max="365" step="0.5" placeholder="0"
                                        className={`lb-input lb-earned-input${pending.carry ? ' lb-cell-changed' : ''}`}
                                        style={{ width: 80, height: 30 }}
                                        aria-label="Carry-forward from previous year"
                                        title="Carry-forward from the previous year (migration)"
                                        value={pending.carry ? pending.carry.value : (ledger.carryForward === null ? '' : String(ledger.carryForward))}
                                        onChange={(e) => setCarry({ value: e.target.value })}
                                    />
                                    days{!ledger.migrationActive && <span className="lb-muted" style={{ fontWeight: 500 }}> (opening {fmtDays(ledger.openingBalance)})</span>}
                                    {pending.carry && (
                                        <input className="lb-input" style={{ height: 30, fontSize: '0.78rem', minWidth: 180 }} placeholder="Comment (optional)" maxLength={500}
                                            aria-label="Comment for carry-forward change" value={pending.carry.comment} onChange={(e) => setCarry({ comment: e.target.value })} />
                                    )}
                                </span>
                            ) : `${fmtDays(ledger.openingBalance)} days`}
                        </dd>
                    </div>
                </dl>
            </div>

            {!ledger.migrationActive && (Object.keys(pending.migration).length > 0 || pending.carry) && (
                <div className="glass" role="alert" style={{ padding: '10px 16px', borderLeft: '4px solid #f59e0b', fontSize: '0.85rem' }}>
                    <strong>Heads up:</strong> this is the first migration history for {ledger.name}. Once saved, the monthly history
                    {' '}({ledger.policy?.migrationStartMonth} onward) and the carry-forward replace the current opening balance of {fmtDays(ledger.openingBalance)} days.
                    Fill in every month you have before submitting.
                </div>
            )}

            <div className="lb-cards">
                <SummaryCard icon="fa-calendar-plus" tone="blue" label={`Earned · Year ${year}`} value={fmtDays(ys.earnedLeave)} hint={`${fmtDays(ledger.policy?.earnedLeavePerMonth)} day per eligible month`} />
                <SummaryCard icon="fa-star" tone="purple" label={`Special Earned · Year ${year}`} value={fmtDays(ys.specialEarnedLeave)} hint="Sunday / holiday work" />
                <SummaryCard icon="fa-calendar-minus" tone="red" label={`Consumed · Year ${year}`} value={fmtDays(ys.consumedLeave)} hint="Approved requests + corrections" />
                <SummaryCard icon="fa-scale-balanced" tone="green" label={`Remaining · End of ${year}`} value={fmtDays(ys.remainingBalance)} hint={yearEndLeft
                    ? `EL ${fmtDays(yearEndLeft.el)} · Sun/Hol ${fmtDays(yearEndLeft.special)}`
                    : `Includes opening ${fmtDays(ledger.openingBalance)} · today ${fmtDays(ledger.currentBalance)}`} />
            </div>

            <div className="glass lb-table-wrap lb-ledger-table-wrap custom-scrollbar">
                <table className="lb-table lb-ledger-table">
                    <thead>
                        <tr>
                            <th scope="col">Month</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Earned</th>
                            <th scope="col">Special Earned</th>
                            <th scope="col">Consumed</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Remaining</th>
                            <th scope="col">Comments &amp; Details</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody style={{ opacity: loading ? 0.6 : 1 }}>
                        {ledger.months.map((m) => (
                            <tr key={m.month} className={`${m.migrationMonth || (m.inLedger && (m.eligible || m.consumedLeave || m.specialEarnedLeave)) ? '' : 'lb-ineligible'} ${isCurrent(m) ? 'lb-current' : ''}`}>
                                <th scope="row" style={{ textAlign: 'left', fontWeight: 600, fontSize: '0.86rem', padding: '10px 14px', borderTop: '1px solid var(--border-glass)' }}>
                                    {m.monthName}
                                    {m.migrationMonth && <span className="lb-badge lb-badge-grey" style={{ marginLeft: 6 }} title={m.ineligibleReason}>Migration</span>}
                                    {isCurrent(m) && <span className="lb-badge lb-badge-purple" style={{ marginLeft: 6 }}>Current</span>}
                                </th>
                                <td style={{ textAlign: 'right' }}>{renderEarned(m)}</td>
                                <td>{renderSpecial(m)}</td>
                                <td>{renderConsumed(m)}</td>
                                <td className={`lb-num ${remainingClass(m.remainingBalance)}`} style={{ textAlign: 'right' }}>
                                    {fmtDays(m.remainingBalance)}
                                    <LeftSplit left={m.usage?.left} />
                                </td>
                                <td>{renderComments(m)}</td>
                                <td>
                                    <span style={{ display: 'inline-flex', gap: 2 }}>
                                        <button className="lb-link" onClick={() => setModalMonth({ month: m.month, section: 'all' })} aria-label={`View ${m.monthName} records`}>
                                            <i className="fa-solid fa-folder-open"></i> View
                                        </button>
                                        {canEditMonth(m) && (
                                            <button className="lb-link" onClick={() => setEditMonth(m.month)} aria-label={`Edit ${m.monthName}`}>
                                                <i className="fa-solid fa-pen-to-square"></i> Edit
                                            </button>
                                        )}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <CreditsPanel credits={ledger.credits} summary={ledger.creditSummary} year={year} />

            <div className="lb-month-cards">
                {ledger.months.map((m) => (
                    <div key={m.month} className="glass lb-month-card" style={{ opacity: m.inLedger || m.migrationMonth ? 1 : 0.6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong>{m.monthName}{isCurrent(m) && <span className="lb-badge lb-badge-purple" style={{ marginLeft: 6 }}>Current</span>}</strong>
                            <span className={`lb-num ${remainingClass(m.remainingBalance)}`}>Remaining {fmtDays(m.remainingBalance)}</span>
                        </div>
                        <div className="lb-month-card-grid">
                            <div><div className="lb-card-label">Earned</div>{renderEarned(m)}</div>
                            <div><div className="lb-card-label">Special</div>{renderSpecial(m)}</div>
                            <div><div className="lb-card-label">Consumed</div>{renderConsumed(m)}</div>
                            <div style={{ alignSelf: 'end' }}>
                                <button className="lb-link" onClick={() => setModalMonth({ month: m.month, section: 'all' })}>View</button>
                                {canEditMonth(m) && <button className="lb-link" onClick={() => setEditMonth(m.month)}>Edit</button>}
                            </div>
                        </div>
                        <div style={{ marginTop: 6 }}>{renderComments(m)}</div>
                    </div>
                ))}
            </div>

            <div className="glass lb-sticky-bar">
                <div className="lb-sticky-stats">
                    <div><span className="lb-card-label">Remaining (end of {year})</span><span className={`lb-num ${remainingClass(ys.remainingBalance)}`} style={{ fontSize: '1.2rem' }}>{fmtDays(ys.remainingBalance)}</span></div>
                    <div><span className="lb-card-label">Consumed ({year})</span><span className="lb-num lb-red" style={{ fontSize: '1.2rem' }}>{fmtDays(ys.consumedLeave)}</span></div>
                    {dirty && <div style={{ justifyContent: 'center' }}><span className="lb-pending-note">{pendingCount} pending change{pendingCount === 1 ? '' : 's'}. Totals update after the server saves them.</span></div>}
                </div>
                {canEdit && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {submitErrors.length > 0 && <div className="lb-error-text" role="alert" style={{ maxWidth: 360 }}>{submitErrors.map((e, i) => <div key={i}>{e}</div>)}</div>}
                        <button className="lb-btn" onClick={discard} disabled={!dirty || saving}>Discard</button>
                        <button className="lb-btn lb-btn-primary" onClick={() => saveAll(pending)} disabled={!dirty || saving} aria-busy={saving}>
                            {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving…</> : <><i className="fa-solid fa-check"></i> Submit Changes</>}
                        </button>
                    </div>
                )}
            </div>

            {modalMonth && monthsByNumber.get(modalMonth.month) && (
                <MonthDetailsModal
                    month={monthsByNumber.get(modalMonth.month)}
                    year={year}
                    ledger={ledger}
                    onClose={() => setModalMonth(null)}
                    onEdit={canEditMonth(monthsByNumber.get(modalMonth.month)) ? () => { const m = modalMonth.month; setModalMonth(null); setEditMonth(m); } : null}
                />
            )}

            {editMonth && monthsByNumber.get(editMonth) && (
                <MonthEditModal
                    month={monthsByNumber.get(editMonth)}
                    year={year}
                    ledger={ledger}
                    staged={stagedForMonth(editMonth)}
                    onClose={() => setEditMonth(null)}
                    onSave={(result) => saveMonth(editMonth, result)}
                />
            )}
        </div>
    );
}

