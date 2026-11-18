// Sunday / holiday shift verification: how a shift's status is shown in the Attendance Record grid and
// its Excel export. Plain functions (no React) so the grid, the export and the tests share one mapping.

const pad2 = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD of a report date column, from its own year/month/day (no time-zone shift). */
export const isoOfItem = (item) => `${item.year}-${pad2(item.month + 1)}-${pad2(item.day)}`;

export function formatShiftHours(hours) {
    if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return '—';
    const mins = Math.round(Number(hours) * 60);
    return `${Math.floor(mins / 60)} h ${pad2(mins % 60)} m`;
}

export const fmtCreditDays = (n) => {
    const v = Math.round(Number(n || 0) * 100) / 100;
    return `${v} day${v === 1 ? '' : 's'}`;
};

export const PUNCH_ISSUE_TEXT = {
    MISSING_CHECK_IN: 'A session has a check-out but no check-in',
    UNREADABLE_CHECK_IN: 'A check-in time could not be read',
    UNREADABLE_CHECK_OUT: 'A check-out time could not be read',
    ZERO_DURATION: 'A session has the same check-in and check-out time',
    CHECK_OUT_BEFORE_CHECK_IN: 'A check-out is earlier than its check-in',
    MISSING_CHECK_OUT: 'The employee never checked out'
};

/** "6 h or more = 1 day, 4 h to under 6 h = 0.5 day, under 4 h = admin review" from the server policy. */
export function creditRulesText(policy) {
    const rules = [...((policy && policy.creditRules) || [])].sort((a, b) => b.minHours - a.minHours);
    if (!rules.length) return '';
    const parts = rules.map((r, i) => (i === 0
        ? `${r.minHours} h or more = ${fmtCreditDays(r.days)}`
        : `${r.minHours} h to under ${rules[i - 1].minHours} h = ${fmtCreditDays(r.days)}`));
    parts.push(`under ${rules[rules.length - 1].minHours} h = admin review`);
    return parts.join(', ');
}

// When one employee has more than one credit on a date, show the one that decides the balance.
const PRIORITY = { ACTIVE: 4, PENDING: 3, REJECTED: 2, REVERSED: 1 };

/** Map "<employee id or code, lower case>|YYYY-MM-DD" -> shift, for the grid and the export. */
export function buildSpecialShiftIndex(items = []) {
    const index = new Map();
    for (const s of items) {
        for (const key of [s.employeeId, s.empCode].filter(Boolean)) {
            const k = `${String(key).trim().toLowerCase()}|${s.workDate}`;
            const prev = index.get(k);
            if (!prev || (PRIORITY[s.status] || 0) > (PRIORITY[prev.status] || 0)) index.set(k, s);
        }
    }
    return index;
}

export function findSpecialShift(index, emp, iso) {
    if (!index || !emp) return null;
    for (const key of [emp.id, emp.empCode, emp.emp_code].filter(Boolean)) {
        const s = index.get(`${String(key).trim().toLowerCase()}|${iso}`);
        if (s) return s;
    }
    return null;
}

const STYLES = {
    PENDING: { bg: '#fef3c7', fg: '#92400e', badge: '#d97706', xlFont: 'FF92400E', xlFill: 'FFFEF3C7' },
    APPROVED: { bg: '#dcfce7', fg: '#166534', badge: '#16a34a', xlFont: 'FF166534', xlFill: 'FFDCFCE7' },
    REJECTED: { bg: '#f1f5f9', fg: '#475569', badge: '#64748b', xlFont: 'FF475569', xlFill: 'FFF1F5F9' },
    REVERSED: { bg: '#fee2e2', fg: '#991b1b', badge: '#dc2626', xlFont: 'FF991B1B', xlFill: 'FFFEE2E2' }
};

/**
 * Display data for a shift: the badge text, colours, credit line and tooltip.
 * state: PENDING (amber, awaiting review) | APPROVED (green, credited) | REJECTED (no credit) | REVERSED (credit taken back).
 */
export function specialShiftDisplay(shift, { canVerify = false } = {}) {
    if (!shift) return null;
    const isHoliday = shift.dayType === 'HOLIDAY';
    const code = isHoliday ? 'WOH' : 'WOS';
    const dayWord = isHoliday ? 'Holiday' : 'Sunday';
    const dayName = isHoliday ? `holiday${shift.holidayName ? ` (${shift.holidayName})` : ''}` : 'Sunday';
    const times = `${shift.checkIn || '--'} - ${shift.checkOut || '--'}`;
    const hours = shift.workingHours !== null && shift.workingHours !== undefined ? formatShiftHours(shift.workingHours) : null;
    const who = shift.verifiedByName || shift.verifiedBy || 'an admin';
    const when = shift.verifiedAt ? new Date(shift.verifiedAt).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const changed = shift.changedAfterDecision
        ? ` Attendance changed after the decision (now ${formatShiftHours(shift.latestWorkingHours)}); correct the credit in Leave Balances if needed.`
        : '';

    if (shift.status === 'PENDING') {
        const needsReview = !(shift.eligibleDays > 0) || shift.attendanceStatus !== 'COMPLETE';
        return {
            state: 'PENDING', code, label: `${code} (Pending)`, colors: STYLES.PENDING,
            creditLine: needsReview ? 'Needs review' : `Eligible: ${fmtCreditDays(shift.eligibleDays)}`,
            times, hours,
            tooltip: `Worked on ${dayName}, awaiting verification. In: ${shift.checkIn || '--'} | Out: ${shift.checkOut || '--'}${hours ? ` | ${hours}` : ''} | `
                + `${needsReview ? 'Calculated credit: 0 (needs review)' : `Calculated credit: ${fmtCreditDays(shift.eligibleDays)}`}${canVerify ? '. Click to review.' : ''}`
        };
    }
    if (shift.status === 'REJECTED') {
        return {
            state: 'REJECTED', code, label: `${dayWord} (No Credit Approved)`, shortLabel: `${code} (No Credit)`, colors: STYLES.REJECTED,
            creditLine: 'No credit', times, hours,
            tooltip: `Worked on ${dayName}; no credit approved by ${who}${when ? ` on ${when}` : ''}.${shift.rejectionReason ? ` Reason: ${shift.rejectionReason}` : ''}${changed}`
        };
    }
    if (shift.status === 'REVERSED') {
        return {
            state: 'REVERSED', code, label: `${code} (Credit Reversed)`, shortLabel: `${code} (Reversed)`, colors: STYLES.REVERSED,
            creditLine: 'Credit reversed', times, hours,
            tooltip: `Worked on ${dayName}; the ${fmtCreditDays(shift.approvedDays)} credit was reversed in Leave Balances.`
        };
    }
    // ACTIVE: verified, or credited before verification existed / typed in through Leave Balances
    const source = shift.source === 'LEGACY_AUTO'
        ? ' Credited automatically before shift verification was introduced.'
        : (shift.source === 'MANUAL' ? ` Added in Leave Balances by ${who}.` : '');
    return {
        state: 'APPROVED', code, label: `${code} ✓`, colors: STYLES.APPROVED,
        creditLine: `+${fmtCreditDays(shift.approvedDays)}`, times, hours,
        tooltip: shift.source === 'ATTENDANCE'
            ? `Verified: ${fmtCreditDays(shift.approvedDays)} credited by ${who}${when ? ` on ${when}` : ''}.${shift.overrideApplied ? ` Override of the calculated ${fmtCreditDays(shift.eligibleDays)}${shift.overrideReason ? `: ${shift.overrideReason}` : ''}.` : ''}${changed}`
            : `${fmtCreditDays(shift.approvedDays)} credited.${source}`
    };
}

// ---- Excel "Attendance Status" summary columns (appended after the existing ones) ----
export const SPECIAL_SUMMARY_HEADERS = [
    'Verified WOS (Paid & Credited)',
    'Pending WOS (Under Admin Review)',
    'Rejected/Reversed WOS (No Credit)',
    'Verified WOH (Paid & Credited)',
    'Pending WOH (Under Admin Review)',
    'Rejected/Reversed WOH (No Credit)',
    'Approved Sun/Hol Credit (Days)'
];

export const emptySpecialCounts = () => ({ verifiedWos: 0, pendingWos: 0, noCreditWos: 0, verifiedWoh: 0, pendingWoh: 0, noCreditWoh: 0, creditDays: 0 });

/** Adds one shift (at most one per employee and date) to an employee's summary counts. */
export function addSpecialCount(counts, shift) {
    const d = specialShiftDisplay(shift);
    if (!d) return counts;
    const woh = d.code === 'WOH';
    if (d.state === 'APPROVED') {
        counts[woh ? 'verifiedWoh' : 'verifiedWos'] += 1;
        counts.creditDays = Math.round((counts.creditDays + Number(shift.approvedDays || 0)) * 100) / 100;
    } else if (d.state === 'PENDING') {
        counts[woh ? 'pendingWoh' : 'pendingWos'] += 1;
    } else {
        counts[woh ? 'noCreditWoh' : 'noCreditWos'] += 1;
    }
    return counts;
}

export const specialCountsRow = (c) => [c.verifiedWos, c.pendingWos, c.noCreditWos, c.verifiedWoh, c.pendingWoh, c.noCreditWoh, c.creditDays];
