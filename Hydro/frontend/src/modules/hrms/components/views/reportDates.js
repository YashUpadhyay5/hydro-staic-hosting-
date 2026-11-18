// Date helpers for the attendance report period (month view or a custom From–To range).
// Plain functions (no React) so they can be tested without a browser.

const pad2 = (n) => String(n).padStart(2, '0');

/** Local-midnight Date for a YYYY-MM-DD string (date input value), or null. `new Date('YYYY-MM-DD')` is UTC midnight instead. */
export function parseIsoDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
}

/**
 * One column per day from `fromIso` to `toIso` (inclusive), each with its own YYYY-MM-DD dateStr.
 * Returns null when either date is missing or invalid, or the range is reversed.
 */
export function rangeDateItems(fromIso, toIso) {
    const start = parseIsoDate(fromIso);
    const end = parseIsoDate(toIso);
    if (!start || !end || start > end) return null;
    const isSameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
    const items = [];
    for (let i = 0; ; i++) {
        const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        if (cur > end) break;
        const y = cur.getFullYear();
        const m = cur.getMonth();
        const d = cur.getDate();
        items.push({
            day: d,
            month: m,
            year: y,
            dateStr: `${y}-${pad2(m + 1)}-${pad2(d)}`,
            label: isSameMonth ? `${d}` : `${d}/${m + 1}`
        });
    }
    return items;
}

/** Every YYYY-MM month touched by the period from `start` to `end` (Dates), in order. */
export function monthsBetween(start, end) {
    const months = [];
    let y = start.getFullYear();
    let m = start.getMonth();
    const last = end.getFullYear() * 12 + end.getMonth();
    while (y * 12 + m <= last) {
        months.push(`${y}-${pad2(m + 1)}`);
        m += 1;
        if (m === 12) { m = 0; y += 1; }
    }
    return months;
}
