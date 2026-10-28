import React, { useEffect, useRef, useState, useCallback } from 'react';

// Non-component helpers for the Leave Balances pages.

export const fmtDays = (n) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
    return String(Math.round(Number(n) * 100) / 100);
};

export const initials = (name = '') => String(name).trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '?';

export function useToast() {
    const [toast, setToast] = useState(null);
    const timer = useRef(null);
    const show = useCallback((type, message, action = null, sticky = false) => {
        clearTimeout(timer.current);
        setToast({ type, message, action });
        if (!sticky) timer.current = setTimeout(() => setToast(null), 5000);
    }, []);
    useEffect(() => () => clearTimeout(timer.current), []);
    const node = toast ? (
        <div className={`lb-toast lb-toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
            <span>{toast.message}</span>
            {toast.action && <button onClick={() => { setToast(null); toast.action.onClick(); }}>{toast.action.label}</button>}
            <button aria-label="Dismiss" onClick={() => setToast(null)}>✕</button>
        </div>
    ) : null;
    return [node, show];
}

// crypto.randomUUID needs a secure context; the dashboard may be opened over plain http on the LAN.
export function newIdempotencyKey() {
    if (window.crypto?.randomUUID) {
        try { return window.crypto.randomUUID(); } catch { /* fall through */ }
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---- leave credits: short names in the register's own words ----
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const withYear = (text, year, viewYear) => (year && year !== viewYear ? `${text} ${year}` : text);

/** "5 Apr" (adds the year when it differs from the year being viewed). */
export function shortDate(iso, viewYear) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? withYear(`${Number(m[3])} ${MON[Number(m[2]) - 1]}`, Number(m[1]), viewYear) : '';
}

export const monthShort = (month, year, viewYear) => withYear(MON[month - 1], year, viewYear);

/** "Apr EL", "Feb Sun/Hol", "Sun 5 Apr", "Baishakhi 14 Apr", "2025 carry". */
export function creditName(c, viewYear) {
    if (c.kind === 'CARRY') return c.type === 'CARRY_FORWARD' ? `${c.year} carry` : 'Opening balance';
    if (c.kind === 'EL') return `${monthShort(c.month, c.year, viewYear)} EL`;
    if (!c.date) return `${monthShort(c.month, c.year, viewYear)} Sun/Hol`;
    if (c.type === 'HOLIDAY') return `${c.holidayName || 'Holiday'} ${shortDate(c.date, viewYear)}`;
    return `${c.type === 'SUNDAY' ? 'Sun' : 'Sun/Hol'} ${shortDate(c.date, viewYear)}`;
}

/** Where a credit went: "5 Nov, same month (0.5)". Undated uses in the month the credit was earned read "same month". */
export function usesText(uses, viewYear, credit = null) {
    return uses.map((u) => {
        const where = u.date ? shortDate(u.date, viewYear)
            : (credit && u.year === credit.year && u.month === credit.month ? 'same month' : monthShort(u.month, u.year, viewYear));
        return `${where}${u.days !== 1 ? ` (${fmtDays(u.days)})` : ''}`;
    }).join(', ');
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Where the credits earned in one month were consumed, in the register's words:
 * "consumed in the same month", "2 consumed in the same month, 1 in Jun", "0.5 consumed in Apr, 0.5 left",
 * "not consumed yet". Returns null when nothing was earned.
 */
export function whereConsumed(credits, year, month) {
    const total = credits.reduce((s, c) => s + c.days, 0);
    if (!(total > 0)) return null;
    const here = year * 12 + (month - 1);
    const byMonth = new Map();
    for (const c of credits) {
        for (const u of c.uses) {
            const k = u.year * 12 + (u.month - 1);
            byMonth.set(k, round2((byMonth.get(k) || 0) + u.days));
        }
    }
    const left = round2(credits.reduce((s, c) => s + c.left, 0));
    const parts = [...byMonth.entries()]
        .sort((a, b) => (a[0] === here ? -1 : b[0] === here ? 1 : a[0] - b[0]))
        .map(([k, days]) => ({ days, where: k === here ? 'the same month' : monthShort((k % 12) + 1, Math.floor(k / 12), year) }));
    if (!parts.length) return 'not consumed yet';
    if (parts.length === 1 && !(left > 0)) return `consumed in ${parts[0].where}`;
    const text = parts.map((p, i) => `${fmtDays(p.days)} ${i === 0 ? 'consumed ' : ''}in ${p.where}`).join(', ');
    return left > 0 ? `${text}, ${fmtDays(left)} left` : text;
}

/** Credits from other months that a month's consumed leave used: "0.5 Feb EL, 1 2025 carry". */
export function fromEarlierText(from, year, month) {
    const earlier = (from || []).filter((f) => !(f.kind !== 'CARRY' && f.year === year && f.month === month));
    return earlier.length ? earlier.map((f) => `${fmtDays(f.days)} ${creditName(f, year)}`).join(', ') : null;
}

const MONTH_WORDS = [['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'], ['may'], ['june', 'jun'], ['july', 'jul'],
    ['august', 'aug'], ['september', 'sept', 'sep'], ['october', 'oct'], ['november', 'nov'], ['december', 'dec']];
const FULL_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Months (1-12) named in a remark, e.g. "Consumed in 12 Apr 2026" -> [4]. */
export function monthsMentioned(text) {
    const found = new Set();
    const lower = String(text || '').toLowerCase();
    MONTH_WORDS.forEach((words, i) => { if (words.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) found.add(i + 1); });
    return [...found];
}

/**
 * Warning when a remark names a different month than the one being edited, e.g. "26th Aug 2026" in May:
 * that leave belongs to August, and the portal works out which earlier credit pays for it.
 */
export function otherMonthWarning(text, month) {
    const others = monthsMentioned(text).filter((m) => m !== month);
    if (!others.length) return null;
    return `This remark mentions ${others.map((m) => FULL_MONTH[m - 1]).join(' and ')}. Enter here only what happened in ${FULL_MONTH[month - 1]}; leave taken in another month goes in that month, and the portal works out which earlier EL or Sun/Hol pays for it.`;
}

export const FIELD_LABEL = { earned: 'Earned (EL)', special: 'Sun/Hol', consumed: 'Consumed', carry: 'Carry-forward' };

// ---- remarks ----
// Reasons the system fills in when an admin typed none ("Earned leave for 2026-01 set to 0", "Imported from Excel").
export const isAutoReason = (t) => !t || /^imported from excel$/i.test(String(t).trim()) || /^.+( for \d{4}-\d{2})? set to [\d.]+( \(was [\d.]+\))?$/i.test(String(t).trim());
// The register's "Adjusted: ..." notes are shown as "Used from"; as a remark only the list itself is useful.
export const showReason = (t) => String(t || '').replace(/^Adjusted:\s*/i, '');
// Keep the work description of a Sun/Hol remark, drop the "... adj in <month>" tail (shown as "Used" instead).
export const workOnly = (t) => String(t || '').split(/[,.]\s*(?:\d+(?:\.\d+)?\s+)?(?:remaining\s+)?(?:adj|adjusted)\b/i)[0].trim();

export function formatDay(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
