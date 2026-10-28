import React from 'react';
import { fmtDays, creditName, usesText } from './leaveBalanceUtils';

// Leave credits (EL, Sun/Hol, carry-forward) and where they were used. Data comes from the ledger API:
// ledger.credits (queue order, oldest used first) and month.usage ({ from, days, recorded, left }).

const KIND_CLASS = { EL: 'lb-tag-el', SPECIAL: 'lb-tag-sunhol', CARRY: 'lb-tag-carry' };

/** "1 Apr EL" as a small colour-coded tag (blue EL, purple Sun/Hol, grey carry); `note` adds e.g. "same month". */
export function CreditTag({ credit, days, viewYear, note }) {
    return (
        <span className={`lb-tag ${KIND_CLASS[credit.kind] || 'lb-tag-carry'}`}>
            {days !== undefined && <strong>{fmtDays(days)}</strong>} {creditName(credit, viewYear)}
            {note && <span className="lb-tag-note">· {note}</span>}
        </span>
    );
}

/** "Used from: [1 Apr EL · same month] [0.5 Feb Sun/Hol] · as recorded in the register" */
export function UsedFrom({ from, recorded, uncovered = 0, viewYear, viewMonth }) {
    if (!from?.length && !uncovered) return null;
    const sameMonth = (f) => f.kind !== 'CARRY' && f.year === viewYear && f.month === viewMonth;
    return (
        <div className="lb-used-from">
            <span className="lb-muted">Used from</span>
            {from.map((f) => <CreditTag key={f.creditId} credit={f} days={f.days} viewYear={viewYear} note={sameMonth(f) ? 'same month' : null} />)}
            {uncovered > 0 && <span className="lb-tag lb-tag-missing"><strong>{fmtDays(uncovered)}</strong> not covered</span>}
            <span className="lb-muted lb-used-how">
                {recorded === true ? 'as recorded in the register' : recorded === false ? 'partly as recorded in the register, rest oldest first' : 'oldest first'}
            </span>
        </div>
    );
}

/** "EL 1 · Sun/Hol 2" (only when there is Sun/Hol left; otherwise the balance is all EL). */
export function LeftSplit({ left }) {
    if (!left || !(left.special > 0)) return null;
    return <div className="lb-left-split">EL {fmtDays(left.el)} · <span className="lb-purple">Sun/Hol {fmtDays(left.special)}</span></div>;
}

/** Every credit of the year in the order it is used, with where it went and what is left. */
export function CreditsPanel({ credits, summary, year }) {
    if (!credits?.length) return null;
    return (
        <details className="glass lb-credits-panel" open>
            <summary>
                <strong>Leave credits {year}</strong>
                <span className="lb-muted"> · used oldest first · left now: EL {fmtDays(summary.el)} · Sun/Hol {fmtDays(summary.special)}</span>
            </summary>
            <div className="lb-table-wrap custom-scrollbar" style={{ marginTop: 8 }}>
                <table className="lb-table lb-credits-table">
                    <thead>
                        <tr>
                            <th scope="col">Credit</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Days</th>
                            <th scope="col">Used</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Left</th>
                        </tr>
                    </thead>
                    <tbody>
                        {credits.map((c) => (
                            <tr key={c.id} className={c.left > 0 ? '' : 'lb-credit-done'}>
                                <td><CreditTag credit={c} viewYear={year} /></td>
                                <td className="lb-num" style={{ textAlign: 'right' }}>{fmtDays(c.days)}</td>
                                <td className="lb-comment">{c.uses.length ? usesText(c.uses, year, c) : <span className="lb-muted">Not consumed yet</span>}</td>
                                <td className={`lb-num ${c.left > 0 ? 'lb-green' : 'lb-muted'}`} style={{ textAlign: 'right' }}>{c.left > 0 ? fmtDays(c.left) : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {summary.uncovered > 0 && <div className="lb-error-text" style={{ marginTop: 6 }}>{fmtDays(summary.uncovered)} consumed day(s) are not covered by any credit.</div>}
        </details>
    );
}
