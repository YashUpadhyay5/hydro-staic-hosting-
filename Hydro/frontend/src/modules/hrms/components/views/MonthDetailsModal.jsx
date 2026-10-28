import React from 'react';
import { Modal } from './leaveBalanceUi';
import { fmtDays, formatDay, creditName, monthShort } from './leaveBalanceUtils';

// View one month as two columns, EL and Special earned leave: for every leave earned in the month,
// where it was adjusted (with the date when the leave day is known) or that it is carried forward.

const daysText = (d) => (d === 0.5 ? '½ day' : `${fmtDays(d)} ${Number(d) === 1 ? 'day' : 'days'}`);

/** Lines for one credit: "Adjusted on 14 Feb 2026", "Adjusted in Apr 2026 (same month)", "Carry forward". */
function creditLines(c, year, month, label) {
    const lines = [];
    const partial = c.uses.length + (c.left > 0 ? 1 : 0) > 1;
    for (const u of c.uses) {
        const where = u.date
            ? `Adjusted on ${formatDay(u.date)}`
            : `Adjusted in ${monthShort(u.month, null, null)} ${u.year}${u.year === year && u.month === month ? ' (same month)' : ''}`;
        lines.push({ key: `${c.id}-${u.date || `${u.year}-${u.month}`}-${lines.length}`, label, text: where, days: partial ? u.days : null, carry: false });
    }
    if (c.left > 0) lines.push({ key: `${c.id}-left`, label, text: 'Carry forward', days: partial ? c.left : null, carry: true });
    return lines;
}

function Line({ line }) {
    if (!line) return null;
    return (
        <div className={`lb-adjust-line${line.carry ? ' lb-adjust-carry' : ''}`}>
            {line.label && <strong>{line.label}: </strong>}
            {line.text}
            {line.days !== null && <span className="lb-muted"> · {daysText(line.days)}</span>}
        </div>
    );
}

export default function MonthDetailsModal({ month, year, ledger, onClose, onEdit }) {
    const credits = (ledger.credits || []).filter((c) => c.kind !== 'CARRY' && c.year === year && c.month === month.month);
    const el = credits.filter((c) => c.kind === 'EL');
    const special = credits.filter((c) => c.kind === 'SPECIAL');
    const total = (list) => list.reduce((s, c) => s + c.days, 0);
    const elLines = el.flatMap((c) => creditLines(c, year, month.month, null));
    // dated Sunday/holiday credits are named by their own date; undated ones (register totals) are not
    const specialLines = special.flatMap((c) => creditLines(c, year, month.month, c.date ? creditName(c, year) : null));
    const rows = Math.max(elLines.length, specialLines.length, 1);
    const requestDates = (month.consumedRecords || []).filter((r) => r.countedInLedger)
        .map((r) => `${formatDay(r.startDate)}${r.endDate && r.endDate !== r.startDate ? ` – ${formatDay(r.endDate)}` : ''}`);

    return (
        <Modal
            title={`${month.monthName} ${year} · ${ledger.name}`}
            onClose={onClose}
            footer={<>
                {onEdit && <button className="lb-btn lb-btn-primary" onClick={onEdit}><i className="fa-solid fa-pen-to-square"></i> Edit this month</button>}
                <button className="lb-btn" onClick={onClose}>Done</button>
            </>}
        >
            <div className="lb-table-wrap lb-adjust-wrap">
                <table className="lb-table lb-adjust-table">
                    <thead>
                        <tr>
                            <th scope="col">EL <span className="lb-adjust-total">{daysText(total(el))}</span></th>
                            <th scope="col">Special earned leave <span className="lb-adjust-total">{daysText(total(special))}</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: rows }).map((_, i) => (
                            <tr key={i}>
                                <td>{elLines[i] ? <Line line={elLines[i]} /> : (i === 0 && <span className="lb-muted">{!month.migrationMonth && month.ineligibleReason ? month.ineligibleReason : 'No EL this month'}</span>)}</td>
                                <td>{specialLines[i] ? <Line line={specialLines[i]} /> : (i === 0 && <span className="lb-muted">No special earned leave</span>)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="lb-adjust-taken">
                Leave taken in {month.monthName}: <strong>{daysText(month.consumedLeave)}</strong>
                {requestDates.length > 0 && <span className="lb-muted"> ({requestDates.join(', ')})</span>}
            </div>
        </Modal>
    );
}
