import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { Modal } from './leaveBalanceUi';
import { fmtDays, shortDate, isAutoReason, showReason, monthsMentioned, otherMonthWarning } from './leaveBalanceUtils';

// Edit one month: each figure is a days box with its remark, prefilled with what is saved now.
// Save stores the changes straight away (onSave resolves to { ok, errors }).
//  - Earned (EL): the remark is filled in automatically and can be changed.
//  - Consumed: a remark is required when the days change. In live months a new total is saved as a
//    correction of the difference; approved leave requests are never changed.
//  - Sun/Hol: dated Sunday/holiday entries (Sundays of the month, or holidays from the employee's own
//    calendar) with a required remark; history months also have the register's total without dates.

const round2 = (n) => Math.round(n * 100) / 100;
const isHalfStep = (n) => Number.isFinite(n) && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;
const validDays = (raw, max = 31) => raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) <= max && isHalfStep(Number(raw));
const meaningful = (t) => /[a-z0-9]/i.test(String(t || ''));
const asText = (v) => (v === null || v === undefined ? '' : String(v));
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RESTORED = 'Restored to the register value';

/** A Sun/Hol remark naming another month than its work date, e.g. "Adj against 1st Feb 2026" on a 5 Apr entry. */
function workMonthWarning(remark, workDate) {
    const workMonth = Number(String(workDate || '').slice(5, 7));
    const others = workMonth ? monthsMentioned(remark).filter((m) => m !== workMonth) : [];
    if (!others.length) return null;
    return `This remark mentions ${others.map((m) => MONTH_NAMES[m - 1]).join(' and ')}, but the work date is in ${MONTH_NAMES[workMonth - 1]}. If the Sunday/holiday was worked in ${MONTH_NAMES[others[0] - 1]}, it belongs to ${MONTH_NAMES[others[0] - 1]} (check it is not already counted there).`;
}
// A saved remark worth editing: not system-generated, not just punctuation.
const realRemark = (h) => (h && !isAutoReason(h.reason) && meaningful(h.reason) ? showReason(h.reason) : '');
let rowSeq = 0;

export default function MonthEditModal({ month, year, ledger, staged, onSave, onClose }) {
    const monthLabel = `${month.monthName} ${year}`;
    const migration = month.migrationMonth;
    const mv = month.migrationValues || {};
    const reached = month.ineligibleReason !== 'Month not reached yet';
    const canEditEarned = migration || month.editable;
    const canEditConsumed = migration || (month.inLedger && reached);
    const canAddSunHol = migration || (month.inLedger && reached);
    const latestOf = (field) => month.migrationHistory.find((h) => h.field === field);

    // ---- saved values and remarks (what the dialog opens with) ----
    const savedEarned = migration ? asText(mv.earned) : String(month.earnedLeave);
    const savedConsumed = migration ? asText(mv.consumed) : String(month.consumedLeave);
    const savedUndated = asText(mv.special);
    const autoEarned = (v) => `Earned leave for ${monthLabel}: ${v === '' ? 0 : fmtDays(Number(v))} day(s)`;
    const savedEarnedRemark = migration ? realRemark(latestOf('earned')) : realRemark(month.earnedLeaveOverride);
    const savedConsumedRemark = migration
        ? realRemark(latestOf('consumed'))
        : (month.consumedCorrections.length ? month.consumedCorrections[month.consumedCorrections.length - 1].reason : '');
    const savedUndatedRemark = realRemark(latestOf('special'));

    const stagedMigration = staged.migration || { values: {}, comments: {} };
    const stagedCorrection = (staged.corrections || []).reduce((s, c) => s + c.deltaDays, 0);

    const [earned, setEarned] = useState(staged.earned ? asText(staged.earned.value) : asText(stagedMigration.values.earned ?? savedEarned));
    const initialEarnedRemark = savedEarnedRemark || autoEarned(savedEarned);
    const [earnedRemark, setEarnedRemark] = useState(staged.earned?.comment ?? stagedMigration.comments.earned ?? initialEarnedRemark);
    const [earnedRemarkTyped, setEarnedRemarkTyped] = useState(!!savedEarnedRemark);

    const [consumed, setConsumed] = useState(migration
        ? asText(stagedMigration.values.consumed ?? savedConsumed)
        : String(round2(Number(savedConsumed) + stagedCorrection)));
    const [consumedRemark, setConsumedRemark] = useState(stagedMigration.comments.consumed ?? (staged.corrections?.length ? staged.corrections[staged.corrections.length - 1].reason : savedConsumedRemark));

    const [undated, setUndated] = useState(asText(stagedMigration.values.special ?? savedUndated));
    const [undatedRemark, setUndatedRemark] = useState(stagedMigration.comments.special ?? savedUndatedRemark);

    // dated Sun/Hol entries: remark edits and removals, keyed by credit id
    const [entryRemarks, setEntryRemarks] = useState(() => Object.fromEntries(month.specialEarnedRecords.map((r) => [r.id, staged.remarks?.[r.id] ?? r.reason ?? ''])));
    const [removals, setRemovals] = useState(() => ({ ...(staged.reversals || {}) }));
    const [newRows, setNewRows] = useState(() => (staged.specialAdds || []).map((a) => ({ key: `r${++rowSeq}`, type: a.creditType, date: a.workDate, days: a.days, remark: a.reason })));
    const [dateOptions, setDateOptions] = useState(null);
    const [dateError, setDateError] = useState('');

    const [tried, setTried] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState([]);

    useEffect(() => {
        if (!canAddSunHol) return;
        api.getSpecialEarnedDates(ledger.employeeId, year, month.month)
            .then((d) => { if (d) setDateOptions(d); })
            .catch((err) => setDateError(err.message || 'Could not load the Sundays and holidays of this month.'));
    }, [canAddSunHol, ledger.employeeId, year, month.month]);

    const changeEarned = (v) => {
        setEarned(v);
        if (!earnedRemarkTyped) setEarnedRemark(autoEarned(v));
    };

    const consumedChanged = Number(consumed) !== Number(savedConsumed) || (consumed === '') !== (savedConsumed === '');
    const undatedChanged = Number(undated) !== Number(savedUndated) || (undated === '') !== (savedUndated === '');
    const takenDates = useMemo(() => new Set([
        ...month.specialEarnedRecords.filter((r) => removals[r.id] === undefined).map((r) => r.workDate),
        ...newRows.map((r) => r.date).filter(Boolean)
    ]), [month.specialEarnedRecords, removals, newRows]);
    const sunHolTotal = round2((validDays(undated) ? Number(undated) : 0)
        + month.specialEarnedRecords.filter((r) => removals[r.id] === undefined).reduce((s, r) => s + r.days, 0)
        + newRows.filter((r) => r.date).reduce((s, r) => s + Number(r.days), 0));

    const dateChoices = (type) => {
        if (!dateOptions) return [];
        return type === 'HOLIDAY'
            ? dateOptions.holidays.map((h) => ({ ...h, label: `${h.name} · ${shortDate(h.date, year)}${h.isSunday ? ' (Sunday)' : ''}` }))
            : dateOptions.sundays.map((s) => ({ ...s, label: `Sun ${shortDate(s.date, year)}${s.holidayName ? ` · ${s.holidayName}` : ''}` }));
    };
    const updateRow = (key, patch) => setNewRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    const save = async () => {
        setTried(true);
        const errs = [];
        const result = { earned: null, migration: null, specialAdds: [], reversals: {}, corrections: [], remarks: {} };
        const migrationChange = { values: {}, comments: {} };

        if (canEditEarned && (Number(earned) !== Number(savedEarned) || earnedRemark.trim() !== initialEarnedRemark.trim())) {
            if (!validDays(earned)) errs.push('Earned: enter 0–31 days in steps of 0.5.');
            if (migration) { migrationChange.values.earned = earned; migrationChange.comments.earned = earnedRemark.trim(); }
            else result.earned = { value: earned, comment: earnedRemark.trim() };
        }

        if (canEditConsumed && (consumedChanged || consumedRemark.trim() !== savedConsumedRemark.trim())) {
            if (!validDays(consumed)) errs.push('Consumed: enter 0–31 days in steps of 0.5.');
            if (!meaningful(consumedRemark)) errs.push('Consumed: write a remark (a few words) for this change.');
            if (migration) { migrationChange.values.consumed = consumed; migrationChange.comments.consumed = consumedRemark.trim(); }
            else result.corrections.push({ tempId: `c${++rowSeq}`, month: month.month, deltaDays: round2(Number(consumed) - Number(savedConsumed)), reason: consumedRemark.trim() });
        }

        if (migration && (undatedChanged || undatedRemark.trim() !== savedUndatedRemark.trim())) {
            if (!validDays(undated)) errs.push('Sun/Hol from the register: enter 0–31 days in steps of 0.5.');
            if (!meaningful(undatedRemark)) errs.push('Sun/Hol from the register: write a remark (a few words) for this change.');
            migrationChange.values.special = undated;
            migrationChange.comments.special = undatedRemark.trim();
        }
        if (Object.keys(migrationChange.values).length) result.migration = migrationChange;

        for (const r of month.specialEarnedRecords) {
            if (removals[r.id] !== undefined) {
                if (!meaningful(removals[r.id])) errs.push(`${shortDate(r.workDate, year)}: write why it is removed.`);
                result.reversals[r.id] = removals[r.id].trim();
            } else if ((entryRemarks[r.id] || '').trim() !== (r.reason || '').trim()) {
                if (!meaningful(entryRemarks[r.id])) errs.push(`${shortDate(r.workDate, year)}: the remark cannot be empty.`);
                result.remarks[r.id] = entryRemarks[r.id].trim();
            }
        }
        for (const row of newRows) {
            if (!row.date && !row.remark.trim()) continue; // untouched new row
            if (!row.date) errs.push('New Sunday/holiday entry: pick a date.');
            if (!meaningful(row.remark)) errs.push(`New Sunday/holiday entry${row.date ? ` (${shortDate(row.date, year)})` : ''}: write a remark.`);
            const choice = dateChoices(row.type).find((c) => c.date === row.date);
            result.specialAdds.push({
                tempId: row.key, workDate: row.date, days: Number(row.days), reason: row.remark.trim(), creditType: row.type,
                label: row.type === 'HOLIDAY' ? `Holiday: ${choice?.name || ''}` : 'Sunday'
            });
        }

        if (errs.length) { setErrors(errs); return; }
        const nothing = !result.earned && !result.migration && !result.corrections.length && !result.specialAdds.length
            && !Object.keys(result.reversals).length && !Object.keys(result.remarks).length;
        if (nothing) { onClose(); return; }

        setSaving(true);
        setErrors([]);
        const res = await onSave(result);
        if (!res?.ok) {
            setErrors(res?.errors?.length ? res.errors : ['The changes could not be saved.']);
            setSaving(false);
        }
    };

    // ---- the register this month was imported from ----
    const register = month.register; // { earned, special, consumed, differences } or null
    const registerHint = (field, current, onUse) => {
        if (!register) return null;
        if (validDays(current) && Number(current) === register[field]) return null; // same as the register
        return (
            <div className="lb-edit-register">
                <i className="fa-solid fa-triangle-exclamation"></i> Register: {fmtDays(register[field])} days
                {onUse && <button type="button" className="lb-link" onClick={onUse}>Use register value</button>}
            </div>
        );
    };
    const restoreConsumed = () => {
        setConsumed(String(register.consumed));
        if (consumedRemark.trim() === savedConsumedRemark.trim()) setConsumedRemark(`${RESTORED} (${fmtDays(register.consumed)} days)`);
    };
    const restoreUndated = () => {
        setUndated(String(register.special));
        if (undatedRemark.trim() === savedUndatedRemark.trim()) setUndatedRemark(`${RESTORED} (${fmtDays(register.special)} days)`);
    };
    const warning = (text) => (text ? <div className="lb-edit-warning"><i className="fa-solid fa-circle-info"></i> {text}</div> : null);

    const remarkBox = ({ value, onChange, label, required, placeholder }) => (
        <textarea
            className={`lb-input lb-edit-remark${tried && required && !meaningful(value) ? ' lb-input-invalid' : ''}`}
            rows={2} maxLength={500} aria-label={label}
            placeholder={required ? `${placeholder || 'Remark'} (required)` : (placeholder || 'Remark')}
            value={value} onChange={(e) => onChange(e.target.value)}
        />
    );
    const daysBox = ({ value, onChange, label, invalid }) => (
        <span className="lb-edit-days">
            <input className={`lb-input${tried && invalid ? ' lb-input-invalid' : ''}`} type="number" min="0" max="31" step="0.5" placeholder="0"
                aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
            days
        </span>
    );

    return (
        <Modal
            title={`Edit ${monthLabel} · ${ledger.name}`}
            onClose={saving ? () => {} : onClose}
            footer={<>
                {errors.length > 0 && <div className="lb-error-text" role="alert" style={{ marginRight: 'auto' }}>{errors.map((e) => <div key={e}>{e}</div>)}</div>}
                <button className="lb-btn" onClick={onClose} disabled={saving}>Cancel</button>
                <button className="lb-btn lb-btn-primary" onClick={save} disabled={saving} aria-busy={saving}>
                    {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving…</> : <><i className="fa-solid fa-check"></i> Save</>}
                </button>
            </>}
        >
            <div className="lb-edit-cols">
                {/* ---- EL ---- */}
                <section className="lb-edit-col" aria-label="EL">
                    <div className="lb-edit-col-title lb-edit-el">EL</div>
                    {canEditEarned ? (
                        <>
                            <div className="lb-edit-row"><span>Earned</span>{daysBox({ value: earned, onChange: changeEarned, label: `EL earned in ${monthLabel}`, invalid: !validDays(earned) })}</div>
                            {migration && registerHint('earned', earned, () => changeEarned(String(register.earned)))}
                            {remarkBox({ value: earnedRemark, onChange: (v) => { setEarnedRemark(v); setEarnedRemarkTyped(true); }, label: 'Remark for EL' })}
                        </>
                    ) : <div className="lb-muted">{fmtDays(month.earnedLeave)} days · {month.ineligibleReason}</div>}
                </section>

                {/* ---- Special earned leave ---- */}
                <section className="lb-edit-col" aria-label="Special earned leave">
                    <div className="lb-edit-col-title lb-purple">Special earned leave <span className="lb-muted">{fmtDays(sunHolTotal)} days</span></div>
                    {migration && registerHint('special', String(sunHolTotal),
                        month.specialEarnedRecords.length === 0 && newRows.length === 0 ? restoreUndated : null)}
                    {migration && (
                        <>
                            <div className="lb-edit-row"><span>Without a date</span>{daysBox({ value: undated, onChange: setUndated, label: 'Special earned leave without a date', invalid: !validDays(undated) })}</div>
                            {remarkBox({ value: undatedRemark, onChange: setUndatedRemark, label: 'Remark for special earned leave without a date', required: undatedChanged })}
                        </>
                    )}

                    {month.specialEarnedRecords.map((r) => {
                        const removing = removals[r.id] !== undefined;
                        return (
                            <div key={r.id} className={`lb-edit-entry${removing ? ' lb-edit-removing' : ''}`}>
                                <div className="lb-edit-row">
                                    <span className="lb-edit-entry-name">
                                        {r.creditType === 'HOLIDAY' ? `${r.holidayName || 'Holiday'} ${shortDate(r.workDate, year)}` : `Sun ${shortDate(r.workDate, year)}`} · {r.days === 0.5 ? '½ day' : `${fmtDays(r.days)} day`}
                                    </span>
                                    {removing
                                        ? <button className="lb-link" onClick={() => setRemovals((m) => { const n = { ...m }; delete n[r.id]; return n; })}>Keep</button>
                                        : <button className="lb-link lb-btn-danger" onClick={() => setRemovals((m) => ({ ...m, [r.id]: '' }))} aria-label={`Remove ${r.workDate}`}>Remove</button>}
                                </div>
                                {removing ? (
                                    <input className={`lb-input lb-edit-remark${tried && !meaningful(removals[r.id]) ? ' lb-input-invalid' : ''}`} maxLength={500} aria-label="Why is it removed"
                                        placeholder="Why is it removed? (required)" value={removals[r.id]} onChange={(e) => setRemovals((m) => ({ ...m, [r.id]: e.target.value }))} />
                                ) : (
                                    <input className={`lb-input lb-edit-remark${tried && !meaningful(entryRemarks[r.id]) ? ' lb-input-invalid' : ''}`} maxLength={500} aria-label={`Remark for ${r.workDate}`}
                                        placeholder="Remark" value={entryRemarks[r.id]} onChange={(e) => setEntryRemarks((m) => ({ ...m, [r.id]: e.target.value }))} />
                                )}
                                {!removing && warning(workMonthWarning(entryRemarks[r.id], r.workDate))}
                            </div>
                        );
                    })}

                    {newRows.map((row) => (
                        <div key={row.key} className="lb-edit-entry lb-edit-new">
                            <div className="lb-edit-row">
                                <select className="lb-input" aria-label="Sunday or holiday" value={row.type} onChange={(e) => updateRow(row.key, { type: e.target.value, date: '' })}>
                                    <option value="SUNDAY">Sunday</option>
                                    <option value="HOLIDAY" disabled={dateOptions && !dateOptions.holidays.length}>Holiday</option>
                                </select>
                                <select className={`lb-input${tried && !row.date ? ' lb-input-invalid' : ''}`} aria-label="Date" value={row.date} onChange={(e) => updateRow(row.key, { date: e.target.value })} disabled={!dateOptions}>
                                    <option value="">{dateOptions ? 'Date…' : 'Loading…'}</option>
                                    {dateChoices(row.type).map((c) => {
                                        const taken = c.date !== row.date && takenDates.has(c.date);
                                        const blocked = taken ? 'already added' : (c.disabledReason && c.disabledReason !== 'Already credited' ? c.disabledReason.toLowerCase() : null);
                                        return <option key={c.date} value={c.date} disabled={!!blocked}>{c.label}{blocked ? ` (${blocked})` : ''}</option>;
                                    })}
                                </select>
                                <select className="lb-input" aria-label="Days" value={row.days} onChange={(e) => updateRow(row.key, { days: Number(e.target.value) })}>
                                    <option value={1}>1 day</option>
                                    <option value={0.5}>½ day</option>
                                </select>
                                <button className="lb-link" onClick={() => setNewRows((rows) => rows.filter((r) => r.key !== row.key))} aria-label="Discard this entry">✕</button>
                            </div>
                            <input className={`lb-input lb-edit-remark${tried && (row.date || row.remark) && !meaningful(row.remark) ? ' lb-input-invalid' : ''}`} maxLength={500}
                                aria-label="Remark for the new entry" placeholder="Remark (required)" value={row.remark} onChange={(e) => updateRow(row.key, { remark: e.target.value })} />
                            {warning(workMonthWarning(row.remark, row.date))}
                        </div>
                    ))}

                    {canAddSunHol && (
                        <button className="lb-link" style={{ alignSelf: 'flex-start' }} onClick={() => setNewRows((rows) => [...rows, { key: `r${++rowSeq}`, type: 'SUNDAY', date: '', days: 1, remark: '' }])}>
                            <i className="fa-solid fa-plus"></i> Add Sunday / holiday
                        </button>
                    )}
                    {dateOptions && !dateOptions.holidays.length && newRows.length > 0 && (
                        <div className="lb-edit-hint">No holidays this month in {dateOptions.calendars.length ? dateOptions.calendars.join(', ') : `a calendar for ${dateOptions.location || 'this location'}`}.</div>
                    )}
                    {dateError && <div className="lb-error-text">{dateError}</div>}
                </section>
            </div>

            {/* ---- Leave taken ---- */}
            <section className="lb-edit-col lb-edit-taken" aria-label={`Leave taken in ${month.monthName}`}>
                <div className="lb-edit-row">
                    <span className="lb-edit-col-title lb-red">Leave taken in {month.monthName}</span>
                    {canEditConsumed
                        ? daysBox({ value: consumed, onChange: setConsumed, label: `Leave taken in ${monthLabel}`, invalid: !validDays(consumed) })
                        : <span className="lb-muted">{fmtDays(month.consumedLeave)} days · {month.ineligibleReason}</span>}
                </div>
                {canEditConsumed && (
                    <>
                        <div className="lb-edit-hint">
                            {!migration && month.consumedFromRequests > 0 ? `${fmtDays(month.consumedFromRequests)} day(s) are from approved leave requests. ` : ''}
                            The EL or special leave it uses is picked automatically, oldest first.
                        </div>
                        {migration && registerHint('consumed', consumed, restoreConsumed)}
                        {remarkBox({ value: consumedRemark, onChange: setConsumedRemark, label: 'Remark for leave taken', required: consumedChanged })}
                        {warning(otherMonthWarning(consumedRemark, month.month))}
                    </>
                )}
            </section>
        </Modal>
    );
}
