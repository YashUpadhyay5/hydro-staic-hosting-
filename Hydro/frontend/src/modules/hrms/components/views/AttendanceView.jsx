import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useState, useRef } from 'react';
import { api } from '../../services/api';
import { formatDate, isActiveEmployee, formatTo12HourTime, isEmpActiveForPeriod, isEmpActiveOnDate } from '../../utils/helpers';

const getDaysInMonth = (year, month) => {
    return new Date(year, month + 1, 0).getDate();
};

const getEmpId = (emp, idx) => {
    if (emp?.empCode) return emp.empCode;
    if (emp?.employeeId) return emp.employeeId;
    if (emp?.id && !String(emp.id).startsWith('EMP0')) return emp.id;
    const prefix = emp?.department === 'Company' || !emp?.department ? 'HMPL' : 'ACSPL';
    return `${prefix}${String((idx || 0) + 1).padStart(2, '0')}`;
};

const cleanCheckOutVal = (val) => {
    if (!val) return null;
    const s = String(val).trim();
    if (s === '' || s === 'null' || s === 'undefined' || s === '-' || s.toLowerCase() === 'null') {
        return null;
    }
    return s;
};

const isSessionActive = (r) => {
    if (!r || !r.checkIn || r.checkIn === 'null' || r.checkIn === 'undefined') return false;
    const out = cleanCheckOutVal(r.checkOut);
    return !out;
};

const normalizeToIsoDate = (dStr) => {
    if (!dStr) return '';
    const clean = String(dStr).split('T')[0].split(' ')[0].trim();
    if (clean.includes('-')) {
        const parts = clean.split('-');
        if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    } else if (clean.includes('/')) {
        const parts = clean.split('/');
        if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    return clean;
};

const getAuthoritativeISTDate = (d = new Date()) => {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
    } catch {
        return new Date().toISOString().split('T')[0];
    }
};

const isToday = (dateStr) => {
    if (!dateStr) return false;
    const todayIso = normalizeToIsoDate(new Date().toISOString().split('T')[0]);
    const todayIst = getAuthoritativeISTDate();
    const clean = normalizeToIsoDate(dateStr);
    if (clean === todayIso || clean === todayIst) return true;
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
        return d.toDateString() === new Date().toDateString();
    }
    return false;
};

const MultiSelectEmployeeDropdown = ({ employees = [], selectedIds = [], onChange, getEmpId }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filtered = employees.filter(emp => {
        if (!search.trim()) return true;
        const q = search.toLowerCase().trim();
        const code = String(emp.empCode || emp.emp_code || '').toLowerCase();
        const name = String(emp.name || '').toLowerCase();
        return code.includes(q) || name.includes(q);
    });

    const isAllSelected = selectedIds.length === 0 || selectedIds.length === employees.length;

    const toggleSelectAll = () => {
        onChange([]);
    };

    const toggleEmp = (emp) => {
        const strId = String(emp.id);
        let next;
        if (selectedIds.length === 0) {
            next = employees.filter(e => String(e.id) !== strId).map(e => String(e.id));
        } else if (selectedIds.includes(strId)) {
            next = selectedIds.filter(id => id !== strId);
        } else {
            next = [...selectedIds, strId];
            if (next.length === employees.length) {
                next = [];
            }
        }
        onChange(next);
    };

    const getDisplayText = () => {
        if (selectedIds.length === 0 || selectedIds.length === employees.length) {
            return `All Employees (${employees.length})`;
        }
        if (selectedIds.length === 1) {
            const found = employees.find(e => String(e.id) === selectedIds[0] || String(e.empCode) === selectedIds[0]);
            return found ? found.name : '1 Employee Selected';
        }
        return `${selectedIds.length} Employees Selected`;
    };

    return (
        <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    backgroundColor: 'white',
                    color: '#1f2937',
                    fontSize: '0.85rem',
                    outline: 'none',
                    height: '36px',
                    cursor: 'pointer',
                    minWidth: '180px',
                    maxWidth: '240px',
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'space-between',
                    gap: '8px',
                    textAlign: 'left'
                }}
            >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {getDisplayText()}
                </span>
                <i className={`fa-solid fa-chevron-${isOpen ? 'up' : 'down'}`} style={{ fontSize: '0.75rem', color: '#6b7280' }}></i>
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '4px',
                    width: '280px',
                    maxHeight: '320px',
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                    zIndex: 1000,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    <div style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>
                        <input
                            type="text"
                            placeholder="Search employee..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '6px 10px',
                                borderRadius: '4px',
                                border: '1px solid #d1d5db',
                                fontSize: '0.8rem',
                                outline: 'none',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>
                    
                    <div style={{ padding: '6px 12px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', userSelect: 'none' }}>
                            <input
                                type="checkbox"
                                checked={isAllSelected}
                                onChange={toggleSelectAll}
                                style={{ accentColor: '#ef4444', cursor: 'pointer' }}
                            />
                            Select All
                        </label>
                        {selectedIds.length > 0 && selectedIds.length < employees.length && (
                            <button
                                type="button"
                                onClick={() => onChange([])}
                                style={{ border: 'none', background: 'none', color: '#ef4444', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Clear ({selectedIds.length})
                            </button>
                        )}
                    </div>

                    <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
                        {filtered.length === 0 ? (
                            <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.8rem', color: '#9ca3af' }}>
                                No employees found
                            </div>
                        ) : (
                            filtered.map((emp, idx) => {
                                const empIdStr = String(emp.id);
                                const isChecked = selectedIds.length === 0 || selectedIds.includes(empIdStr);
                                return (
                                    <label
                                        key={emp.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            padding: '6px 12px',
                                            fontSize: '0.8rem',
                                            cursor: 'pointer',
                                            color: '#1f2937',
                                            transition: 'background 0.15s',
                                            userSelect: 'none'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => toggleEmp(emp)}
                                            style={{ accentColor: '#ef4444', cursor: 'pointer' }}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontWeight: 500 }}>{emp.name}</span>
                                            <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{emp.empCode || (getEmpId ? getEmpId(emp, idx) : '')}</span>
                                        </div>
                                    </label>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const groupAttendanceRecords = (records, footprintsList = [], employeesList = []) => {
    const grouped = {};

    const parseToTimestamp = (timeVal) => {
        if (!timeVal) return null;
        let d = new Date(timeVal);
        if (isNaN(d.getTime()) && !isNaN(Number(timeVal))) {
            d = new Date(Number(timeVal));
        }
        if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
            return d.getTime();
        }
        
        const timeRegex = /(\d+):(\d+):?(\d+)?\s*(AM|PM)?/i;
        const match = String(timeVal).match(timeRegex);
        if (!match) return null;
        
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = match[3] ? parseInt(match[3], 10) : 0;
        const ampm = match[4] ? match[4].toUpperCase() : null;
        
        if (ampm === 'PM' && hours < 12) {
            hours += 12;
        } else if (ampm === 'AM' && hours === 12) {
            hours = 0;
        }
        
        const baseDate = new Date();
        baseDate.setHours(hours, minutes, seconds, 0);
        return baseDate.getTime();
    };

    const isTodayStr = (dStr) => {
        return isToday(dStr);
    };

    const formatTsTime = (ts) => {
        if (!ts) return null;
        const d = new Date(Number(ts));
        if (isNaN(d.getTime())) return null;
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    };

    records.forEach(r => {
        let dateStr = r.date;
        if (!dateStr && r.createdAt) {
            dateStr = r.createdAt.split('T')[0];
        }
        if (!dateStr) return;
        
        const uid = String(r.userId || '').trim().toLowerCase();
        const uname = String(r.userName || '').trim().toLowerCase();
        const ucode = String(r.empCode || r.employeeId || '').trim().toLowerCase();

        // Match employee from r.employee or employeesList to get a unified identity key
        const rEmp = r.employee || (employeesList || []).find(e => {
            if (!e) return false;
            const eid = String(e.id || '').trim().toLowerCase();
            const ecode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
            const ename = String(e.name || '').trim().toLowerCase();
            return (uid && (uid === eid || uid === ecode || uid === ename)) ||
                   (ucode && (ucode === ecode || ucode === eid)) ||
                   (uname && (uname === ename || uname === eid || uname === ecode));
        });

        const canonicalId = rEmp?.empCode || rEmp?.id || r.empCode || r.employeeId || r.userId || r.userName;
        const key = `${canonicalId}_${dateStr}`;
        
        const resolvedName = r.userName || rEmp?.name || r.name || r.employeeName;
        const resolvedCode = r.empCode || rEmp?.empCode || rEmp?.emp_code || r.employeeId;
        const resolvedJob = r.jobTitle || rEmp?.jobTitle || rEmp?.designation || r.designation;
        const resolvedDept = r.department || rEmp?.department;

        if (!grouped[key]) {
            grouped[key] = {
                ...r,
                date: dateStr,
                userName: resolvedName || r.userName,
                empCode: resolvedCode || r.empCode,
                jobTitle: resolvedJob,
                department: resolvedDept,
                employee: r.employee || rEmp,
                checkIn: r.checkIn,
                checkOut: r.checkOut,
                punchCount: 1,
                punches: [r]
            };
        } else {
            grouped[key].punchCount += 1;
            grouped[key].punches.push(r);
            if (!grouped[key].userName && resolvedName) grouped[key].userName = resolvedName;
            if (!grouped[key].empCode && resolvedCode) grouped[key].empCode = resolvedCode;
            if (!grouped[key].jobTitle && resolvedJob) grouped[key].jobTitle = resolvedJob;
            if (!grouped[key].department && resolvedDept) grouped[key].department = resolvedDept;
            if (!grouped[key].employee && (r.employee || rEmp)) grouped[key].employee = r.employee || rEmp;

            const existingCheckInTs = parseToTimestamp(grouped[key].checkIn);
            const newCheckInTs = parseToTimestamp(r.checkIn);
            if (newCheckInTs && (!existingCheckInTs || newCheckInTs < existingCheckInTs)) {
                grouped[key].checkIn = r.checkIn;
            }

            const existingCheckOutTs = parseToTimestamp(grouped[key].checkOut);
            const newCheckOutTs = parseToTimestamp(r.checkOut);
            if (newCheckOutTs && (!existingCheckOutTs || newCheckOutTs > existingCheckOutTs)) {
                grouped[key].checkOut = r.checkOut;
            }
        }
    });

    // Fallback: If employees have active live footprints today but no attendance entry in records, synthesize the active entry
    (footprintsList || []).forEach(f => {
        if (!f) return;
        const fUid = String(f.userId || '').trim().toLowerCase();
        const fUName = String(f.userName || '').trim().toLowerCase();
        const fUCode = String(f.empCode || '').trim().toLowerCase();
        const fDate = f.date ? normalizeToIsoDate(f.date) : getAuthoritativeISTDate();
        if (!isToday(fDate)) return;

        const fEmp = f.employee || (employeesList || []).find(e => {
            if (!e) return false;
            const eid = String(e.id || '').trim().toLowerCase();
            const ecode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
            const ename = String(e.name || '').trim().toLowerCase();
            return (fUid && (fUid === eid || fUid === ecode || fUid === ename)) ||
                   (fUCode && (fUCode === ecode || fUCode === eid)) ||
                   (fUName && (fUName === ename || fUName === eid || fUName === ecode));
        });

        const canonicalId = fEmp?.empCode || fEmp?.id || f.empCode || f.userId || f.userName;
        const key = `${canonicalId}_${fDate}`;

        if (!grouped[key]) {
            const timeStr = f.checkIn || formatTsTime(f.timestamp) || '09:30:00 AM';
            grouped[key] = {
                id: f.id || `fp-att-${canonicalId}`,
                userId: fEmp?.empCode || fEmp?.id || f.empCode || f.userId,
                userName: fEmp?.name || f.userName || 'Employee',
                empCode: fEmp?.empCode || fEmp?.emp_code || f.empCode || f.userId,
                jobTitle: fEmp?.jobTitle || fEmp?.designation || f.designation,
                department: fEmp?.department || f.department,
                employee: fEmp || f.employee,
                date: fDate,
                checkIn: timeStr,
                checkOut: null,
                checkInMethod: 'AUTO_RECOVERY_PUNCH',
                clockOutMethod: null,
                punchCount: 1,
                punches: [{
                    id: f.id || `fp-att-${canonicalId}`,
                    userId: fEmp?.empCode || fEmp?.id || f.empCode || f.userId,
                    userName: fEmp?.name || f.userName || 'Employee',
                    empCode: fEmp?.empCode || fEmp?.emp_code || f.empCode || f.userId,
                    date: fDate,
                    checkIn: timeStr,
                    checkOut: null,
                    checkInMethod: 'AUTO_RECOVERY_PUNCH'
                }]
            };
        }
    });

    // Dynamic Multi-Punch Active, Rapid Deduplication & Telemetry Check-Out Auto-Resolution:
    Object.values(grouped).forEach(item => {
        if (item.punches && item.punches.length > 0) {
            // Sort punches chronologically by checkIn timestamp
            item.punches.sort((a, b) => (parseToTimestamp(a.checkIn) || 0) - (parseToTimestamp(b.checkIn) || 0));

            // 1. Filter out redundant AUTO_RECOVERY_PUNCH ghost sessions if a legitimate MANUAL punch exists
            const hasManualPunch = item.punches.some(p => p.checkInMethod === 'MANUAL_APP' || p.checkInMethod === 'MANUAL_WEB');
            let candidatePunches = item.punches;
            if (hasManualPunch) {
                candidatePunches = candidatePunches.filter(p => {
                    if (p.checkInMethod === 'AUTO_RECOVERY_PUNCH') {
                        const autoInTs = parseToTimestamp(p.checkIn);
                        const autoOutTs = parseToTimestamp(p.checkOut);
                        const overlapsWithManual = item.punches.some(m => {
                            if (m.checkInMethod !== 'MANUAL_APP' && m.checkInMethod !== 'MANUAL_WEB') return false;
                            const manInTs = parseToTimestamp(m.checkIn);
                            const manOutTs = parseToTimestamp(m.checkOut);
                            if (!manInTs) return false;
                            if (autoInTs && Math.abs(autoInTs - manInTs) <= 1800000) return true;
                            if (autoOutTs && manOutTs && Math.abs(autoOutTs - manOutTs) <= 1800000) return true;
                            return false;
                        });
                        return !overlapsWithManual;
                    }
                    return true;
                });
            }

            // 2. Deduplicate rapid double-tap or overlapping punches
            const cleanPunches = [];
            candidatePunches.forEach(p => {
                const pTs = parseToTimestamp(p.checkIn);
                const prevP = cleanPunches[cleanPunches.length - 1];
                const prevTs = prevP ? parseToTimestamp(prevP.checkIn) : null;
                const prevOutTs = prevP ? parseToTimestamp(prevP.checkOut) : null;

                if (pTs && prevTs && (Math.abs(pTs - prevTs) <= 900000 || (prevOutTs && pTs < prevOutTs))) {
                    if (p.checkOut) {
                        const pOutTs = parseToTimestamp(p.checkOut);
                        if (!prevOutTs || (pOutTs && pOutTs > prevOutTs)) {
                            prevP.checkOut = p.checkOut;
                            prevP.clockOutMethod = p.clockOutMethod || prevP.clockOutMethod;
                        }
                    }
                } else {
                    cleanPunches.push(p);
                }
            });

            // Chronology Validation Guard: Invalidate checkOut if checkOut timestamp <= checkIn timestamp
            cleanPunches.forEach(p => {
                const inTs = parseToTimestamp(p.checkIn);
                const outTs = parseToTimestamp(p.checkOut);
                if (inTs && outTs && outTs <= inTs) {
                    p.checkOut = null;
                }
            });

            // Dynamic Shift Bridging & Closing Punch Consolidation:
            // When an employee has an earlier unclosed punch (or inverted check-out invalidated above)
            // followed by a trailing clock-out punch or short punch (<= 15 minutes) at the end of the shift:
            if (cleanPunches.length > 1) {
                const firstPunch = cleanPunches[0];
                const lastPunch = cleanPunches[cleanPunches.length - 1];
                const lastInTs = parseToTimestamp(lastPunch.checkIn);
                const lastOutTs = parseToTimestamp(lastPunch.checkOut);
                const lastDurationMs = (lastInTs && lastOutTs && lastOutTs >= lastInTs) ? (lastOutTs - lastInTs) : 0;

                // If first punch has no checkout, and last punch has a checkout:
                if (!firstPunch.checkOut && lastPunch.checkOut) {
                    firstPunch.checkOut = lastPunch.checkOut;
                    firstPunch.clockOutMethod = lastPunch.clockOutMethod || 'MANUAL_APP';
                    if (lastPunch.checkOutAddress) firstPunch.checkOutAddress = lastPunch.checkOutAddress;
                    // If the last punch was a short punch (<= 15 minutes), consolidate it away to avoid split card
                    if (lastDurationMs <= 900000) {
                        cleanPunches.splice(cleanPunches.length - 1, 1);
                    }
                }
            }

            // 2. Cap at maximum 3 punches per company daily limit rule
            if (cleanPunches.length > 3) {
                cleanPunches.splice(3);
            }

            // 3. Consolidate open sessions: Keep only the latest open session unclosed
            const openSessions = cleanPunches.filter(p => !p.checkOut);
            if (openSessions.length > 1) {
                const latestOpen = openSessions[openSessions.length - 1];
                openSessions.forEach(p => {
                    if (p !== latestOpen) {
                        p.checkOut = p.checkIn;
                    }
                });
            }

            item.punches = cleanPunches;
            item.punchCount = cleanPunches.length;

            // Ensure main summary Check-In is strictly the FIRST (earliest) Clock-In of the day
            if (cleanPunches.length > 0 && cleanPunches[0].checkIn) {
                item.checkIn = cleanPunches[0].checkIn;
            }

            // Ensure main summary Check-Out is strictly the LAST (latest) Clock-Out of the day
            const lastPunchWithOut = cleanPunches.slice().reverse().find(p => cleanCheckOutVal(p.checkOut));
            if (lastPunchWithOut && lastPunchWithOut.checkOut) {
                const mainInTs = parseToTimestamp(item.checkIn);
                const mainOutTs = parseToTimestamp(lastPunchWithOut.checkOut);
                if (mainInTs && mainOutTs && mainOutTs > mainInTs) {
                    item.checkOut = lastPunchWithOut.checkOut;
                    item.clockOutMethod = lastPunchWithOut.clockOutMethod || item.clockOutMethod;
                } else {
                    item.checkOut = null;
                }
            } else {
                item.checkOut = null;
            }

            const isTodayRecord = isTodayStr(item.date);
            const isFutureRecord = (() => {
                const cleanDate = normalizeToIsoDate(item.date);
                const todayIst = getAuthoritativeISTDate();
                return Boolean(cleanDate && todayIst && cleanDate > todayIst);
            })();
            const lastPunch = item.punches[item.punches.length - 1];
            
            if (isTodayRecord && lastPunch && !cleanCheckOutVal(lastPunch.checkOut)) {
                item.checkOut = null;
            } else if (isFutureRecord) {
                // Future-dated record: preserve true punch checkout without synthesizing synthetic shift end
                item.checkOut = lastPunch ? cleanCheckOutVal(lastPunch.checkOut) : null;
            } else if (!isTodayRecord && !item.checkOut) {
                // Past date record with no valid checkOut logged:
                const enrichedOutPunch = cleanPunches.find(p => p.clockOutMethod === 'AUTO_SHIFT_END' || p.clockOutMethod === 'AUTO_STALE_CLEANUP');
                if (enrichedOutPunch && enrichedOutPunch.checkOut) {
                    item.checkOut = enrichedOutPunch.checkOut;
                    item.clockOutMethod = enrichedOutPunch.clockOutMethod;
                } else {
                    // Auto-resolve checkOut from employee's location footprints on that date
                    const itemUserStr = String(item.userId || item.userName).trim().toLowerCase();
                    const itemUserNameStr = String(item.userName || '').trim().toLowerCase();
                    
                    const userFps = (footprintsList || []).filter(f => {
                        const fUser = String(f.userId || f.userName || '').trim().toLowerCase();
                        const fName = String(f.userName || '').trim().toLowerCase();
                        const fDate = f.date ? f.date.split('T')[0] : (f.createdAt ? f.createdAt.split('T')[0] : '');
                        
                        const matchUser = (fUser && fUser === itemUserStr) || (fName && fName === itemUserNameStr) || (fUser && itemUserNameStr.includes(fUser));
                        const matchDate = fDate && (fDate === item.date || new Date(fDate).toDateString() === new Date(item.date).toDateString());
                        return matchUser && matchDate;
                    }).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

                    if (userFps.length > 0) {
                        const lastFp = userFps[userFps.length - 1];
                        const lastFpTime = formatTsTime(lastFp.timestamp);
                        if (lastFpTime) {
                            item.checkOut = lastFpTime;
                            item.clockOutMethod = 'AUTO_LOCATION_ANCHOR';
                        }
                    } else {
                        // Dynamic Shift End fallback for unclosed past days
                        item.checkOut = item.shiftCode === '10-7' ? '19:00:00' : (item.shiftCode === '8-5' ? '17:00:00' : '18:00:00');
                        item.clockOutMethod = 'AUTO_SHIFT_END';
                    }
                }
            }

            // Synchronize the last punch's checkOut with item.checkOut if unclosed
            if (item.checkOut && cleanPunches.length > 0) {
                const lastP = cleanPunches[cleanPunches.length - 1];
                if (!lastP.checkOut) {
                    lastP.checkOut = item.checkOut;
                    lastP.clockOutMethod = item.clockOutMethod || lastP.clockOutMethod;
                }
            }
        }
    });

    return Object.values(grouped);
};

const exportToCSV = (filename, headers, rows) => {
    const escapeCSV = (val) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
    };
    
    const csvContent = "\ufeff" + [
        headers.map(escapeCSV).join(","),
        ...rows.map(row => row.map(escapeCSV).join(","))
    ].join("\r\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

export default function AttendanceView({ employees = [], activeEmployees, onSelectEmployee }) {
    const currentStaff = activeEmployees || employees.filter(isActiveEmployee);
    const cachedAttendance = api.getCached('/attendance?limit=10000');
    const [attendance, setAttendance] = useState(() => Array.isArray(cachedAttendance) ? cachedAttendance : (cachedAttendance?.data || []));
    const [leaves, setLeaves] = useState(() => api.getCached('/leaves') || []);
    const [footprints, setFootprints] = useState(() => api.getCached('/footprints') || []);
    const [loading, setLoading] = useState(() => !cachedAttendance);
    const [error, setError] = useState(false);
    const [latestFootprints, setLatestFootprints] = useState({});
    const [todayDistances, setTodayDistances] = useState({});
    const [todayGpsOffDurations, setTodayGpsOffDurations] = useState({});
    const [latestAllFootprints, setLatestAllFootprints] = useState([]);
    const [selectedPunchHistory, setSelectedPunchHistory] = useState(null);
    const [holidayCalendars, setHolidayCalendars] = useState(() => {
        try {
            const saved = localStorage.getItem('hrms_location_holiday_calendars');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch {}
        return [];
    });

    const getHolidayForEmp = (targetDateStr, emp) => {
        if (!targetDateStr) return null;
        let cals = holidayCalendars || [];
        if (!cals.length) {
            try {
                const saved = localStorage.getItem('hrms_location_holiday_calendars');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed) && parsed.length > 0) cals = parsed;
                }
            } catch {}
        }
        if (!cals.length) return null;

        const empLoc = String(emp?.location || '').trim().toLowerCase();
        const empHolDet = String(emp?.holidayDetails || '').trim().toLowerCase();
        let matchedCals = cals.filter(c => {
            const cName = String(c.name || '').trim().toLowerCase();
            const cLoc = String(c.location || '').trim().toLowerCase();
            return (empHolDet && (cName === empHolDet || cName.includes(empHolDet) || cLoc === empHolDet)) ||
                   (empLoc && (cLoc === empLoc || cName.includes(empLoc) || empLoc.includes(cLoc)));
        });
        if (!matchedCals.length) {
            matchedCals = cals.filter(c => c.isDefault);
        }
        if (!matchedCals.length) {
            return null;
        }

        for (const cal of matchedCals) {
            let list = cal.holidays;
            if (typeof list === 'string') {
                try { list = JSON.parse(list); } catch { list = []; }
            }
            if (Array.isArray(list)) {
                for (const h of list) {
                    if (h && h.date) {
                        const hDate = String(h.date).trim().slice(0, 10);
                        if (hDate === targetDateStr) {
                            return {
                                name: String(h.title || h.name || 'Holiday').trim(),
                                type: h.type || 'Holiday',
                                date: hDate
                            };
                        }
                    }
                }
            }
        }
        return null;
    };

    const getHolidayForDate = (targetDateStr) => {
        if (!targetDateStr) return null;
        let cals = holidayCalendars || [];
        if (!cals.length) {
            try {
                const saved = localStorage.getItem('hrms_location_holiday_calendars');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed) && parsed.length > 0) cals = parsed;
                }
            } catch {}
        }
        for (const cal of cals) {
            let list = cal.holidays;
            if (typeof list === 'string') {
                try { list = JSON.parse(list); } catch { list = []; }
            }
            if (Array.isArray(list)) {
                for (const h of list) {
                    if (h && h.date) {
                        const hDate = String(h.date).trim().slice(0, 10);
                        if (hDate === targetDateStr) {
                            return {
                                name: String(h.title || h.name || 'Holiday').trim(),
                                type: h.type || 'Holiday',
                                date: hDate
                            };
                        }
                    }
                }
            }
        }
        return null;
    };

    const isHolidayForEmp = (targetDateStr, emp) => Boolean(getHolidayForEmp(targetDateStr, emp));

    const logsTopScrollRef = useRef(null);
    const logsTableRef = useRef(null);
    const summaryTopScrollRef = useRef(null);
    const summaryTableRef = useRef(null);
    const recordTopScrollRef = useRef(null);
    const recordTableRef = useRef(null);
    const abnormalTopScrollRef = useRef(null);
    const abnormalTableRef = useRef(null);

    const [logsWidth, setLogsWidth] = useState(1200);
    const [summaryWidth, setSummaryWidth] = useState(1200);
    const [recordWidth, setRecordWidth] = useState(2500);
    const [abnormalWidth, setAbnormalWidth] = useState(1500);

    const handleLogsTopScroll = () => {
        if (logsTableRef.current && logsTopScrollRef.current) {
            logsTableRef.current.scrollLeft = logsTopScrollRef.current.scrollLeft;
        }
    };
    const handleLogsTableScroll = () => {
        if (logsTableRef.current && logsTopScrollRef.current) {
            logsTopScrollRef.current.scrollLeft = logsTableRef.current.scrollLeft;
        }
    };

    const handleSummaryTopScroll = () => {
        if (summaryTableRef.current && summaryTopScrollRef.current) {
            summaryTableRef.current.scrollLeft = summaryTopScrollRef.current.scrollLeft;
        }
    };
    const handleSummaryTableScroll = () => {
        if (summaryTableRef.current && summaryTopScrollRef.current) {
            summaryTopScrollRef.current.scrollLeft = summaryTableRef.current.scrollLeft;
        }
    };

    const handleRecordTopScroll = () => {
        if (recordTableRef.current && recordTopScrollRef.current) {
            recordTableRef.current.scrollLeft = recordTopScrollRef.current.scrollLeft;
        }
    };
    const handleRecordTableScroll = () => {
        if (recordTableRef.current && recordTopScrollRef.current) {
            recordTopScrollRef.current.scrollLeft = recordTableRef.current.scrollLeft;
        }
    };

    const handleAbnormalTopScroll = () => {
        if (abnormalTableRef.current && abnormalTopScrollRef.current) {
            abnormalTableRef.current.scrollLeft = abnormalTopScrollRef.current.scrollLeft;
        }
    };
    const handleAbnormalTableScroll = () => {
        if (abnormalTableRef.current && abnormalTopScrollRef.current) {
            abnormalTopScrollRef.current.scrollLeft = abnormalTableRef.current.scrollLeft;
        }
    };

    const normalizeDateStr = (dStr) => {
        if (!dStr) return '';
        const clean = String(dStr).split('T')[0].split(' ')[0].trim();
        if (clean.includes('-')) {
            const parts = clean.split('-');
            if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        } else if (clean.includes('/')) {
            const parts = clean.split('/');
            if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
        return clean;
    };

    const getAllDateAliases = (dStr) => {
        if (!dStr) return [];
        const aliases = new Set();
        const raw = String(dStr).split('T')[0].split(' ')[0].trim();
        aliases.add(raw);
        aliases.add(String(dStr));

        let year = null, month = null, day = null;
        if (raw.includes('-')) {
            const parts = raw.split('-');
            if (parts.length === 3) {
                if (parts[0].length === 4) {
                    year = parts[0]; month = parts[1]; day = parts[2];
                } else if (parts[2].length === 4) {
                    day = parts[0]; month = parts[1]; year = parts[2];
                }
            }
        } else if (raw.includes('/')) {
            const parts = raw.split('/');
            if (parts.length === 3) {
                if (parts[2].length === 4) {
                    day = parts[0]; month = parts[1]; year = parts[2];
                } else if (parts[0].length === 4) {
                    year = parts[0]; month = parts[1]; day = parts[2];
                }
            }
        }

        if (year && month && day) {
            const yStr = String(year);
            const mPad = String(month).padStart(2, '0');
            const dPad = String(day).padStart(2, '0');
            const mRaw = String(parseInt(month, 10));
            const dRaw = String(parseInt(day, 10));

            aliases.add(`${yStr}-${mPad}-${dPad}`);
            aliases.add(`${dPad}-${mPad}-${yStr}`);
            aliases.add(`${dRaw}-${mRaw}-${yStr}`);
            aliases.add(`${yStr}-${mRaw}-${dRaw}`);
            aliases.add(`${dPad}/${mPad}/${yStr}`);
            aliases.add(`${dRaw}/${mRaw}/${yStr}`);
            aliases.add(`${yStr}/${mPad}/${dPad}`);
            aliases.add(`${yStr}/${mRaw}/${dRaw}`);
        }
        return Array.from(aliases).filter(Boolean);
    };

    // Standardized GPS Off helpers
    const isCellularPing = (f) => {
        if (!f) return false;
        const provider = String(f.provider || f.trackingMethod || f.tracking_method || '').toLowerCase();
        return provider.includes('cell') || provider.includes('net') || f.trackingMethod === 'CELLULAR' || Boolean(f.cell_id || f.cellId);
    };

    const isExplicitGpsOff = (f) => {
        if (!f) return false;
        if (isCellularPing(f)) return false;
        return (
            f.isGpsOff === true || f.isGpsOff === 'true' ||
            f.isGpsOn === false || f.isGpsOn === 'false' || f.isGpsOn === 0 ||
            f.locationEnabled === false || f.locationEnabled === 'false' || f.locationEnabled === 0 || 
            f.location_enabled === 0 || f.location_enabled === '0' || f.location_enabled === false ||
            String(f.gpsStatus || '').toUpperCase() === 'OFF'
        );
    };

    const getGpsIcon = (empOrId, recordOrDate) => {
        let emp = typeof empOrId === 'object' && empOrId !== null ? empOrId : null;
        let record = typeof recordOrDate === 'object' && recordOrDate !== null ? recordOrDate : null;
        let userId = emp ? emp.id : (typeof empOrId === 'string' ? empOrId : null);
        let recordDate = record ? record.date : (typeof recordOrDate === 'string' ? recordOrDate : null);

        const empId = emp ? emp.id : (record ? record.userId : userId);
        const empCode = emp ? (emp.empCode || emp.emp_code) : (record ? (record.empCode || record.emp_code) : null);
        const empName = emp ? emp.name : (record ? record.userName : null);

        const normRecDate = recordDate ? normalizeDateStr(recordDate) : null;
        const todayStr = normalizeDateStr(new Date().toISOString().split('T')[0]);
        const isToday = !normRecDate || normRecDate === todayStr;

        if (!isToday) return null;

        // Tier 1: Direct map lookup
        let f = empId ? latestFootprints[empId] : null;

        // Tier 2: Search latestAllFootprints
        if (!f && latestAllFootprints && latestAllFootprints.length > 0) {
            const targetIds = [
                empId ? String(empId).trim().toLowerCase() : '',
                empCode ? String(empCode).trim().toLowerCase() : '',
                record?.userId ? String(record.userId).trim().toLowerCase() : ''
            ].filter(Boolean);
            const targetNames = [
                empName ? String(empName).trim().toLowerCase() : '',
                record?.userName ? String(record.userName).trim().toLowerCase() : ''
            ].filter(Boolean);

            f = latestAllFootprints.find(fp => {
                const fUid = fp.userId ? String(fp.userId).trim().toLowerCase() : '';
                const fUName = fp.userName ? String(fp.userName).trim().toLowerCase() : '';
                const fEmpCode = (fp.empCode || fp.emp_code) ? String(fp.empCode || fp.emp_code).trim().toLowerCase() : '';
                return (fUid && targetIds.includes(fUid)) || 
                       (fEmpCode && targetIds.includes(fEmpCode)) ||
                       (fUName && targetNames.includes(fUName)) ||
                       (fUid && targetNames.includes(fUid));
            });
        }

        if (!f) return null;
        
        const enabled = !isExplicitGpsOff(f) && f.locationEnabled !== false;
        const color = enabled ? "#10b981" : "#ef4444";
        
        return (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/>
                    <circle cx="12" cy="10" r="3"/>
                </svg>
                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{enabled ? 'Active' : 'Off'}</span>
            </div>
        );
    };

    const getLocationInfo = (emp, record) => {
        if (!emp && !record) {
            return {
                address: 'No location logged',
                timeDisplay: '',
                isLive: false,
                footprint: null
            };
        }

        const empId = emp ? emp.id : (record ? record.userId : null);
        const empCode = emp ? (emp.empCode || emp.emp_code) : (record ? (record.empCode || record.emp_code) : null);
        const empName = emp ? emp.name : (record ? record.userName : null);
        const recordDate = record?.date ? normalizeDateStr(record.date) : (record?.createdAt ? normalizeDateStr(record.createdAt) : null);
        const todayStr = normalizeDateStr(new Date().toISOString().split('T')[0]);
        const isToday = !recordDate || recordDate === todayStr;

        let address = null;
        let timeDisplay = null;
        let matchedFp = null;
        let isLive = false;

        // Multi-tier lookup for live / latest footprint if today
        if (isToday) {
            // Tier 1: Direct map lookup
            if (emp && emp.id && latestFootprints[emp.id]) {
                const f = latestFootprints[emp.id];
                const fpDate = f.date ? normalizeDateStr(f.date) : (f.timestamp ? normalizeDateStr(new Date(Number(f.timestamp)).toISOString()) : null);
                if (!recordDate || !fpDate || fpDate === recordDate) {
                    matchedFp = f;
                }
            }

            // Tier 2: Search latestAllFootprints array by alias
            if (!matchedFp && latestAllFootprints && latestAllFootprints.length > 0) {
                const targetIds = [
                    empId ? String(empId).trim().toLowerCase() : '',
                    empCode ? String(empCode).trim().toLowerCase() : '',
                    record?.userId ? String(record.userId).trim().toLowerCase() : ''
                ].filter(Boolean);
                const targetNames = [
                    empName ? String(empName).trim().toLowerCase() : '',
                    record?.userName ? String(record.userName).trim().toLowerCase() : ''
                ].filter(Boolean);

                matchedFp = latestAllFootprints.find(fp => {
                    const fUid = fp.userId ? String(fp.userId).trim().toLowerCase() : '';
                    const fUName = fp.userName ? String(fp.userName).trim().toLowerCase() : '';
                    const fEmpCode = (fp.empCode || fp.emp_code) ? String(fp.empCode || fp.emp_code).trim().toLowerCase() : '';
                    return (fUid && targetIds.includes(fUid)) || 
                           (fEmpCode && targetIds.includes(fEmpCode)) ||
                           (fUName && targetNames.includes(fUName)) ||
                           (fUid && targetNames.includes(fUid));
                });
            }

            if (matchedFp) {
                if (matchedFp.address && matchedFp.address.trim() && matchedFp.address !== 'No location logged' && matchedFp.address !== 'N/A' && matchedFp.address !== 'Location Logged') {
                    address = matchedFp.address;
                } else if (matchedFp.location && matchedFp.location.trim() && matchedFp.location !== 'No location logged' && matchedFp.location !== 'N/A') {
                    address = matchedFp.location;
                } else if ((matchedFp.latitude != null || matchedFp.lat != null) && (matchedFp.longitude != null || matchedFp.lon != null || matchedFp.lng != null)) {
                    const lat = matchedFp.latitude ?? matchedFp.lat;
                    const lon = matchedFp.longitude ?? matchedFp.lon ?? matchedFp.lng;
                    address = `Lat: ${Number(lat).toFixed(4)}, Lon: ${Number(lon).toFixed(4)}`;
                }
                if (matchedFp.timestamp) {
                    timeDisplay = formatLastUpdateTime(matchedFp.timestamp);
                    isLive = true;
                }
            }
        }

        // Tier 3: If address not yet resolved, check record fields
        if (!address && record) {
            if (record.address && record.address.trim() && record.address !== 'No location logged' && record.address !== 'N/A') {
                address = record.address;
            } else if (record.location && record.location.trim() && record.location !== 'No location logged' && record.location !== 'N/A') {
                address = record.location;
            } else if ((record.latitude != null || record.lat != null) && (record.longitude != null || record.lon != null || record.lng != null)) {
                const lat = record.latitude ?? record.lat;
                const lon = record.longitude ?? record.lon ?? record.lng;
                address = `Lat: ${Number(lat).toFixed(4)}, Lon: ${Number(lon).toFixed(4)}`;
            }
        }

        // Tier 4: Search historical footprints array matching date and employee
        if (!address && footprints && footprints.length > 0) {
            const targetIds = [
                empId ? String(empId).trim().toLowerCase() : '',
                empCode ? String(empCode).trim().toLowerCase() : '',
                record?.userId ? String(record.userId).trim().toLowerCase() : ''
            ].filter(Boolean);
            const targetNames = [
                empName ? String(empName).trim().toLowerCase() : '',
                record?.userName ? String(record.userName).trim().toLowerCase() : ''
            ].filter(Boolean);

            const histFp = footprints.slice().reverse().find(fp => {
                const fUid = fp.userId ? String(fp.userId).trim().toLowerCase() : '';
                const fUName = fp.userName ? String(fp.userName).trim().toLowerCase() : '';
                const fEmpCode = (fp.empCode || fp.emp_code) ? String(fp.empCode || fp.emp_code).trim().toLowerCase() : '';
                const fpDate = fp.date ? normalizeDateStr(fp.date) : (fp.timestamp ? normalizeDateStr(new Date(Number(fp.timestamp)).toISOString()) : null);
                
                const matchesUser = (fUid && targetIds.includes(fUid)) || 
                                    (fEmpCode && targetIds.includes(fEmpCode)) ||
                                    (fUName && targetNames.includes(fUName)) ||
                                    (fUid && targetNames.includes(fUid));
                const matchesDate = !recordDate || !fpDate || fpDate === recordDate;
                return matchesUser && matchesDate;
            });

            if (histFp) {
                if (histFp.address && histFp.address.trim() && histFp.address !== 'No location logged' && histFp.address !== 'N/A' && histFp.address !== 'Location Logged') {
                    address = histFp.address;
                } else if (histFp.location && histFp.location.trim() && histFp.location !== 'No location logged' && histFp.location !== 'N/A') {
                    address = histFp.location;
                } else if ((histFp.latitude != null || histFp.lat != null) && (histFp.longitude != null || histFp.lon != null || histFp.lng != null)) {
                    const lat = histFp.latitude ?? histFp.lat;
                    const lon = histFp.longitude ?? histFp.lon ?? histFp.lng;
                    address = `Lat: ${Number(lat).toFixed(4)}, Lon: ${Number(lon).toFixed(4)}`;
                }
                if (!timeDisplay && histFp.timestamp) {
                    timeDisplay = formatLastUpdateTime(histFp.timestamp);
                }
            }
        }

        // Final fallbacks for timeDisplay if not set from live footprint
        if (!timeDisplay && record) {
            if (record.checkIn) {
                timeDisplay = `${formatCheckInDisplay(record.checkIn)} (Check-in)`;
            } else if (record.createdAt) {
                timeDisplay = formatLastUpdateTime(new Date(record.createdAt).getTime());
            }
        }

        return {
            address: address || 'No location logged',
            timeDisplay: timeDisplay || '',
            isLive,
            footprint: matchedFp
        };
    };

    const formatLastUpdateTime = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(Number(timestamp));
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
        
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true };
        const timeStr = date.toLocaleTimeString([], timeOptions);
        
        if (isToday) {
            return timeStr;
        } else {
            const dateStr = date.toLocaleDateString([], { day: '2-digit', month: 'short' });
            return `${dateStr} ${timeStr}`;
        }
    };

    const formatCheckInDisplay = (checkInVal) => {
        if (!checkInVal) return '-';
        let str = String(checkInVal).trim();
        
        const timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;
        const match = str.match(timeRegex);
        if (match) {
            let hours = parseInt(match[1], 10);
            const minutes = match[2];
            const seconds = match[3] || '00';
            let ampm = match[4] ? match[4].toUpperCase() : null;

            if (!ampm) {
                ampm = hours >= 12 ? 'PM' : 'AM';
                if (hours > 12) hours -= 12;
                if (hours === 0) hours = 12;
            } else {
                if (hours > 12) hours -= 12;
                if (hours === 0) hours = 12;
            }
            return `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
        }
        return str;
    };

    const getBatteryIcon = (emp, record) => {
        if (!emp && !record) return <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No Data</span>;
        
        const empId = emp ? emp.id : (record ? record.userId : null);
        const empName = emp ? emp.name : (record ? record.userName : null);
        const recordDate = record?.date ? normalizeDateStr(record.date) : (record?.createdAt ? normalizeDateStr(record.createdAt) : null);
        const todayStr = normalizeDateStr(new Date().toISOString().split('T')[0]);
        const isToday = !recordDate || recordDate === todayStr;

        let batVal = null;
        let updateTime = null;

        // If today's record, prefer live/latest telemetry
        if (isToday) {
            // Tier 1: Direct map lookup
            let f = empId ? latestFootprints[empId] : null;

            // Tier 2: Search latestAllFootprints array by userId or userName
            if (!f && latestAllFootprints && latestAllFootprints.length > 0) {
                const targetId = empId ? String(empId).trim().toLowerCase() : '';
                const targetName = empName ? String(empName).trim().toLowerCase() : '';
                
                f = latestAllFootprints.find(fp => {
                    const fUid = fp.userId ? String(fp.userId).trim().toLowerCase() : '';
                    const fUName = fp.userName ? String(fp.userName).trim().toLowerCase() : '';
                    return (targetId && fUid === targetId) || (targetName && (fUName === targetName || fUid === targetName));
                });
            }

            if (f && (f.batteryLevel != null || f.battery_level != null)) {
                batVal = f.batteryLevel ?? f.battery_level;
                updateTime = formatLastUpdateTime(f.timestamp);
            }
        }

        // For past dates or if live telemetry not present, check enriched record data
        if (batVal === null && record) {
            if (record.batteryLevel != null || record.battery_level != null) {
                batVal = record.batteryLevel ?? record.battery_level;
                if (record.lastBatteryTime) {
                    updateTime = formatLastUpdateTime(record.lastBatteryTime);
                } else if (record.checkOut) {
                    updateTime = formatCheckInDisplay(record.checkOut);
                } else if (record.checkIn) {
                    updateTime = formatCheckInDisplay(record.checkIn);
                }
            }
        }

        // Tier 3: Search loaded footprints array matching date and employee
        if (batVal === null && footprints && footprints.length > 0) {
            const targetId = empId ? String(empId).trim().toLowerCase() : '';
            const targetName = empName ? String(empName).trim().toLowerCase() : '';
            
            const matchedFp = footprints.slice().reverse().find(fp => {
                const fUid = fp.userId ? String(fp.userId).trim().toLowerCase() : '';
                const fUName = fp.userName ? String(fp.userName).trim().toLowerCase() : '';
                const fpDate = fp.date ? normalizeDateStr(fp.date) : null;
                const matchesUser = (targetId && fUid === targetId) || (targetName && (fUName === targetName || fUid === targetName));
                const matchesDate = !recordDate || !fpDate || fpDate === recordDate;
                return matchesUser && matchesDate && (fp.batteryLevel != null || fp.battery_level != null);
            });

            if (matchedFp) {
                batVal = matchedFp.batteryLevel ?? matchedFp.battery_level;
                updateTime = formatLastUpdateTime(matchedFp.timestamp);
            }
        }

        if (batVal === null || batVal === undefined) {
            return <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No Data</span>;
        }

        let level = Number(batVal);
        if (level > 1.0) {
            level = level / 100;
        }
        const pct = Math.round(level * 100);
        const color = level < 0.2 ? "#ef4444" : level < 0.5 ? "#f59e0b" : "#10b981";

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg width="22" height="12" viewBox="0 0 24 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color }}>
                        <rect x="1" y="1" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
                        <path d="M21 4V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <rect x="3" y="3" width={Math.max(1, Math.min(14, 14 * level))} height="8" rx="1" fill="currentColor"/>
                    </svg>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color }}>{pct}%</span>
                </div>
                {updateTime && (
                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 500, paddingLeft: '2px' }}>
                        {updateTime}
                    </span>
                )}
            </div>
        );
    };

    const getPunchMethodBadge = (method, isCheckOut = false) => {
        if (!method) return null;
        const m = String(method).toUpperCase();
        if (m === 'MANUAL_APP') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#059669', background: '#d1fae5', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Clocked by employee on Mobile App">
                    ðŸ“± App
                </span>
            );
        }
        if (m === 'MANUAL_WEB') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#2563eb', background: '#dbeafe', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Clocked via Web Portal">
                    ðŸ’» Web
                </span>
            );
        }
        if (m === 'AUTO_SHIFT_END') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#d97706', background: '#fef3c7', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Automatically clocked out at shift end">
                    ðŸ¤– Auto (Shift)
                </span>
            );
        }
        if (m === 'AUTO_STALE_CLEANUP') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#b45309', background: '#ffedd5', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Auto-closed by system fallback cleanup">
                    âš ï¸ Auto-Closed
                </span>
            );
        }
        if (m === 'AUTO_LOCATION_ANCHOR') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#7c3aed', background: '#ede9fe', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Auto-closed at last known GPS location">
                    ðŸ“ Auto (GPS)
                </span>
            );
        }
        if (m === 'AUTO_RECOVERY_PUNCH') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#0284c7', background: '#e0f2fe', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Auto-recovered from live device telemetry">
                    ðŸ”„ Auto-Recovered
                </span>
            );
        }
        return null;
    };
    
    // Search & Filter States
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'not-clocked-in', 'clocked-out', 'active-today'
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [selectedRecordEmpIds, setSelectedRecordEmpIds] = useState([]); // [] means all employees, or array of selected employee IDs/codes
    
    // Dropdown & Report States
    const [showReportDropdown, setShowReportDropdown] = useState(false);
    const dropdownRef = useRef(null);
    const [activeSubView, setActiveSubView] = useState('logs'); // 'logs' or 'summary-report'
    const [reportPeriod, setReportPeriod] = useState('current-month'); // 'last-month', 'current-month', 'custom'
    const [customMonth, setCustomMonth] = useState(() => {
        const d = new Date();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        return `${d.getFullYear()}-${m}`;
    });

    // Pagination States
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    // Robust Multi-Key & ISO Date-Aware Employee Record Matching Engine
    const isRecordForEmpAndDate = (r, emp, targetDateStr) => {
        if (!r || !emp || !targetDateStr) return false;
        const rDateClean = normalizeToIsoDate(r.date || r.createdAt);
        if (rDateClean !== targetDateStr) return false;

        const rUid = String(r.userId || '').trim().toLowerCase();
        const rUName = String(r.userName || '').trim().toLowerCase();
        const rUCode = String(r.empCode || r.employeeId || '').trim().toLowerCase();

        const empId = String(emp.id || '').trim().toLowerCase();
        const empCode = String(emp.empCode || emp.emp_code || getEmpId(emp)).trim().toLowerCase();
        const empName = String(emp.name || '').trim().toLowerCase();

        const idMatches = (rUid && (rUid === empId || rUid === empCode || rUid === empName)) ||
                          (rUCode && (rUCode === empCode || rUCode === empId)) ||
                          (rUName && (rUName === empName || rUName === empId || rUName === empCode));

        const objMatches = r.employee && (
            String(r.employee.id || '').trim().toLowerCase() === empId ||
            String(r.employee.empCode || r.employee.emp_code || '').trim().toLowerCase() === empCode ||
            String(r.employee.name || '').trim().toLowerCase() === empName
        );

        return idMatches || objMatches;
    };

    useEffect(() => {
        const abortController = new AbortController();
        let isMounted = true;

        const fetchData = async () => {
            try {
                // Targeted date/month query to fetch current period instead of unbounded 10,000 records
                const now = new Date();
                const curMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                let attendanceQuery = {};

                if (fromDate) {
                    attendanceQuery.date = fromDate;
                } else if (reportPeriod === 'last-month') {
                    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    attendanceQuery.month = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}`;
                } else if (reportPeriod === 'custom' && customMonth) {
                    attendanceQuery.month = customMonth;
                } else {
                    // Default to current active month (40KB vs 900KB unbounded payload)
                    attendanceQuery.month = curMonthStr;
                }

                const fullAttendanceRes = await api.getAttendance(attendanceQuery, { signal: abortController.signal });
                if (!isMounted) return;
                const fullData = Array.isArray(fullAttendanceRes) ? fullAttendanceRes : (fullAttendanceRes?.data || []);
                setAttendance(fullData);
                setLoading(false);

                // Fetch footprints & leaves in background with request cancellation
                const targetDateQuery = fromDate || new Date().toISOString().split('T')[0];
                Promise.all([
                    api.getLatestAllFootprints({ signal: abortController.signal }).catch(() => []),
                    api.getFootprints ? api.getFootprints(null, targetDateQuery, { signal: abortController.signal }).catch(() => []) : Promise.resolve([]),
                    api.getLeaves ? api.getLeaves(null, { signal: abortController.signal }).catch(() => []) : Promise.resolve([])
                ]).then(([latestAllData, footprintsData, leavesData]) => {
                    if (!isMounted) return;
                    if (latestAllData) setLatestAllFootprints(latestAllData);
                    if (footprintsData && Array.isArray(footprintsData)) setFootprints(footprintsData);
                    if (leavesData) setLeaves(leavesData);
                });
                fetch('/api/v1/holidays/calendars')
                    .then(res => res.ok ? res.json() : [])
                    .then(calsData => {
                        if (!isMounted) return;
                        if (Array.isArray(calsData) && calsData.length > 0) {
                            setHolidayCalendars(calsData);
                            try { localStorage.setItem('hrms_location_holiday_calendars', JSON.stringify(calsData)); } catch {}
                        }
                    })
                    .catch(() => {});
            } catch (err) {
                if (err?.name === 'AbortError') return;
                console.error(err);
                if (isMounted) {
                    setError(true);
                    setLoading(false);
                }
            }
        };
        fetchData();

        return () => {
            isMounted = false;
            abortController.abort();
        };
    }, [fromDate, reportPeriod, customMonth, activeSubView]);

    useEffect(() => {
        if (!employees.length) return;
        
        // Map employee names to all userIds they have used in attendance
        const employeeIdsMap = {};
        employees.forEach(emp => {
            const ids = new Set([String(emp.id).trim().toLowerCase()]);
            if (emp.empCode) ids.add(String(emp.empCode).trim().toLowerCase());
            if (emp.emp_code) ids.add(String(emp.emp_code).trim().toLowerCase());
            if (emp.name) ids.add(String(emp.name).trim().toLowerCase());
            attendance.forEach(r => {
                if (r.userName && String(r.userName).trim().toLowerCase() === String(emp.name).trim().toLowerCase()) {
                    if (r.userId) ids.add(String(r.userId).trim().toLowerCase());
                    if (r.empCode) ids.add(String(r.empCode).trim().toLowerCase());
                }
            });
            employeeIdsMap[emp.id] = Array.from(ids);
        });

        const latest = {};
        employees.forEach(emp => {
            const associatedIds = employeeIdsMap[emp.id] || [String(emp.id).trim().toLowerCase()];
            let latestF = null;
            latestAllFootprints.forEach(f => {
                const fUid = f.userId ? String(f.userId).trim().toLowerCase() : '';
                const fUName = f.userName ? String(f.userName).trim().toLowerCase() : '';
                const empName = emp.name ? String(emp.name).trim().toLowerCase() : '';
                
                if ((fUid && associatedIds.includes(fUid)) || (fUName && fUName === empName)) {
                    if (!latestF || Number(f.timestamp) > Number(latestF.timestamp)) {
                        latestF = f;
                    }
                }
            });
            if (latestF) {
                latest[emp.id] = latestF;
                if (emp.empCode) latest[emp.empCode] = latestF;
                if (emp.emp_code) latest[emp.emp_code] = latestF;
            }
        });
        setLatestFootprints(latest);
    }, [employees, attendance, latestAllFootprints]);

    // Note: Route replay travel distances are fetched on-demand for the active paginated view below to prevent network flooding

    // Case-Insensitive & Multi-Key Date-Aware Distance Resolver
    const getAuditedDistanceForRecord = (record, emp) => {
        const rawDate = record?.date || record?.createdAt;
        const dateAliases = getAllDateAliases(rawDate);
        const possibleKeys = [
            record?.userId,
            record?.userName,
            record?.empCode,
            emp?.id,
            emp?.empCode,
            emp?.emp_code,
            emp?.employeeId,
            emp?.userId,
            emp?.name
        ].filter(Boolean).map(k => String(k).trim().toLowerCase());

        // Tier 1: Search date-specific keys across all date aliases
        for (const key of possibleKeys) {
            for (const dAlias of dateAliases) {
                const dateKey = `${key}_${dAlias}`;
                if (todayDistances[dateKey] !== undefined) {
                    return todayDistances[dateKey];
                }
            }
        }

        // Tier 2: Search fallback general keys ONLY if record is confirmed to be for today
        if (isToday(rawDate)) {
            for (const key of possibleKeys) {
                if (todayDistances[key] !== undefined) {
                    return todayDistances[key];
                }
            }
        }

        return null;
    };

    // Case-Insensitive & Multi-Key Date-Aware GPS Off Duration Resolver
    const getGpsOffDurationForRecord = (record, emp) => {
        const rawDate = record?.date || record?.createdAt;
        const dateAliases = getAllDateAliases(rawDate);
        const possibleKeys = [
            record?.userId,
            record?.userName,
            record?.empCode,
            emp?.id,
            emp?.empCode,
            emp?.emp_code,
            emp?.employeeId,
            emp?.userId,
            emp?.name
        ].filter(Boolean).map(k => String(k).trim().toLowerCase());

        // Tier 1: Search date-specific keys across all date aliases
        for (const key of possibleKeys) {
            for (const dAlias of dateAliases) {
                const dateKey = `${key}_${dAlias}`;
                if (todayGpsOffDurations[dateKey] !== undefined) {
                    return todayGpsOffDurations[dateKey];
                }
            }
        }

        // Tier 2: Search fallback general keys ONLY if record is confirmed to be for today
        if (isToday(rawDate)) {
            for (const key of possibleKeys) {
                if (todayGpsOffDurations[key] !== undefined) {
                    return todayGpsOffDurations[key];
                }
            }
        }

        return '0m';
    };

    // Reset page when search or filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, statusFilter, fromDate, toDate]);

    // Handle click outside for dropdown
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowReportDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (logsTableRef.current) {
                setLogsWidth(logsTableRef.current.scrollWidth);
            }
            if (summaryTableRef.current) {
                setSummaryWidth(summaryTableRef.current.scrollWidth);
            }
            if (recordTableRef.current) {
                setRecordWidth(recordTableRef.current.scrollWidth);
            }
            if (abnormalTableRef.current) {
                setAbnormalWidth(abnormalTableRef.current.scrollWidth);
            }
        }, 150);
        return () => clearTimeout(timer);
    }, [attendance, activeSubView, loading, customMonth, currentPage]);

    const reportOptions = [
        { label: 'Attendance Record', value: 'attendance-record', icon: 'fa-clipboard-user' },
        { label: 'Attendance Summary', value: 'attendance-summary', icon: 'fa-address-card' },
        { label: 'Abnormal Attendance', value: 'abnormal-attendance', icon: 'fa-triangle-exclamation' },
        { label: 'Attendance Card', value: 'attendance-card', icon: 'fa-id-card' },
        { label: 'Summary Report', value: 'summary-report', icon: 'fa-file-lines' },
        { label: 'Shift Schedule', value: 'shift-schedule', icon: 'fa-calendar-days' },
        { label: 'Total Reports', value: 'total-reports', icon: 'fa-square-poll-horizontal' }
    ];

    // Calculate working hours dynamically
    const calculateWorkingHours = (record) => {
        const { checkIn, checkOut, date, punches } = record;

        const parseDateTime = (dateVal, timeVal) => {
            if (!timeVal) return null;
            
            // Try parsing directly (ISO or timestamp)
            let d = new Date(timeVal);
            if (isNaN(d.getTime()) && !isNaN(Number(timeVal))) {
                d = new Date(Number(timeVal));
            }
            if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
                return d;
            }
            
            // Parse time components from string (e.g., "4:05:36 PM" or "11:19:17")
            const timeRegex = /(\d+):(\d+):?(\d+)?\s*(AM|PM)?/i;
            const match = String(timeVal).match(timeRegex);
            if (!match) return null;
            
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const seconds = match[3] ? parseInt(match[3], 10) : 0;
            const ampm = match[4] ? match[4].toUpperCase() : null;
            
            if (ampm === 'PM' && hours < 12) {
                hours += 12;
            } else if (ampm === 'AM' && hours === 12) {
                hours = 0;
            }
            
            let baseDate = new Date();
            if (dateVal) {
                let parsedBase = new Date(dateVal);
                if (isNaN(parsedBase.getTime()) && !isNaN(Number(dateVal))) {
                    parsedBase = new Date(Number(dateVal));
                }
                if (!isNaN(parsedBase.getTime())) {
                    baseDate = parsedBase;
                }
            }
            
            baseDate.setHours(hours, minutes, seconds, 0);
            return baseDate;
        };

        // Production Rule: Total working hours are strictly calculated from First Clock-In to Last Clock-Out of the day
        if (!checkIn || !checkOut) return '-';

        const start = parseDateTime(date, checkIn);
        const end = parseDateTime(date, checkOut);

        if (!start || !end) return '-';
        
        const diffMs = end - start;
        if (diffMs <= 0) return '0s';
        
        const diffHrs = Math.floor(diffMs / 3600000);
        const diffMins = Math.floor((diffMs % 3600000) / 60000);
        const diffSecs = Math.floor((diffMs % 60000) / 1000);
        
        if (diffHrs > 0) {
            return `${diffHrs}h ${diffMins}m ${diffSecs}s`;
        } else if (diffMins > 0) {
            return `${diffMins}m ${diffSecs}s`;
        } else {
            return `${diffSecs}s`;
        }
    };

    // 1. Apply Status Filter
    let filteredData = [];

    const groupedAttendance = groupAttendanceRecords(attendance, latestAllFootprints, employees);

    if (statusFilter === 'all') {
        filteredData = groupedAttendance.map(r => ({ ...r, type: 'log' }));
    } else if (statusFilter === 'not-clocked-in') {
        const activeOrLoggedTodayKeys = new Set();
        groupedAttendance
            .filter(r => isToday(r.date))
            .forEach(r => {
                if (r.userId) activeOrLoggedTodayKeys.add(String(r.userId).trim().toLowerCase());
                if (r.userName) activeOrLoggedTodayKeys.add(String(r.userName).trim().toLowerCase());
                if (r.empCode) activeOrLoggedTodayKeys.add(String(r.empCode).trim().toLowerCase());
                if (r.employeeId) activeOrLoggedTodayKeys.add(String(r.employeeId).trim().toLowerCase());
                if (r.employee?.id) activeOrLoggedTodayKeys.add(String(r.employee.id).trim().toLowerCase());
                if (r.employee?.empCode) activeOrLoggedTodayKeys.add(String(r.employee.empCode).trim().toLowerCase());
                if (r.employee?.name) activeOrLoggedTodayKeys.add(String(r.employee.name).trim().toLowerCase());
            });
        
        const absentEmployees = (currentStaff || []).filter(emp => {
            if (!emp) return false;
            if (!isEmpActiveOnDate(emp, new Date())) return false;
            const eid = emp.id ? String(emp.id).trim().toLowerCase() : '';
            const ecode = emp.empCode ? String(emp.empCode).trim().toLowerCase() : (emp.emp_code ? String(emp.emp_code).trim().toLowerCase() : '');
            const ename = emp.name ? String(emp.name).trim().toLowerCase() : '';
            const isLogged = (eid && activeOrLoggedTodayKeys.has(eid)) ||
                             (ecode && activeOrLoggedTodayKeys.has(ecode)) ||
                             (ename && activeOrLoggedTodayKeys.has(ename));
            return !isLogged;
        });
        
        filteredData = absentEmployees.map(emp => {
            let status = 'Absent';
            let reason = 'No info';
            
            if (leaves && leaves.length > 0) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const empLeaves = leaves.filter(l => 
                    (l.userName && String(l.userName).trim().toLowerCase() === String(emp.name).trim().toLowerCase()) ||
                    (l.employeeName && String(l.employeeName).trim().toLowerCase() === String(emp.name).trim().toLowerCase()) ||
                    (l.userId && String(l.userId).trim().toLowerCase() === String(emp.id).trim().toLowerCase()) ||
                    (l.userId && String(l.userId).trim().toLowerCase() === String(emp.empCode).trim().toLowerCase())
                );
                
                const leaveToday = empLeaves.find(l => {
                    // Only consider approved leaves
                    if (l.status && String(l.status).toLowerCase() !== 'approved') return false;
                    
                    if (l.date) {
                        const lDate = new Date(l.date);
                        lDate.setHours(0, 0, 0, 0);
                        if (lDate.getTime() === today.getTime()) return true;
                    }
                    if (l.startDate && l.endDate) {
                        const start = new Date(l.startDate);
                        start.setHours(0, 0, 0, 0);
                        const end = new Date(l.endDate);
                        end.setHours(23, 59, 59, 999);
                        if (today >= start && today <= end) return true;
                    }
                    return false;
                });
                
                if (leaveToday) {
                    status = 'On Leave';
                    reason = leaveToday.reason || leaveToday.leaveType || leaveToday.type || 'Approved Leave';
                }
            }

            return {
                id: `absent-${emp.id}`,
                date: new Date().toISOString().split('T')[0],
                userId: emp.id,
                userName: emp.name,
                empCode: emp.empCode || emp.emp_code,
                department: emp.department,
                jobTitle: emp.jobTitle || emp.designation,
                employee: emp,
                checkIn: null,
                checkOut: null,
                workingHours: '-',
                type: 'absent',
                status,
                reason
            };
        });
    } else if (statusFilter === 'clocked-out') {
        filteredData = groupedAttendance
            .filter(r => isToday(r.date) && cleanCheckOutVal(r.checkOut))
            .map(r => ({ ...r, type: 'log' }));
    } else if (statusFilter === 'active-today') {
        filteredData = groupedAttendance
            .filter(r => isToday(r.date) && !cleanCheckOutVal(r.checkOut))
            .map(r => ({ ...r, type: 'log' }));
    }

    // 2. Apply Date Range Filter if set
    if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        filteredData = filteredData.filter(item => {
            if (!item.date) return false;
            const itemDate = new Date(item.date);
            if (isNaN(itemDate.getTime()) && !isNaN(Number(item.date))) {
                return new Date(Number(item.date)) >= from;
            }
            return itemDate >= from;
        });
    }
    if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        filteredData = filteredData.filter(item => {
            if (!item.date) return false;
            const itemDate = new Date(item.date);
            if (isNaN(itemDate.getTime()) && !isNaN(Number(item.date))) {
                return new Date(Number(item.date)) <= to;
            }
            return itemDate <= to;
        });
    }

    // 3. Apply Search Query (by Employee Name, Code, or Date)
    if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        filteredData = filteredData.filter(item => {
            const nameMatch = item.userName && item.userName.toLowerCase().includes(query);
            const codeMatch = (item.empCode || item.userId) && String(item.empCode || item.userId).toLowerCase().includes(query);
            const dateMatch = item.date && formatDate(item.date).toLowerCase().includes(query);
            return nameMatch || codeMatch || dateMatch;
        });
    }

    // 3. Paginate
    const totalItems = filteredData.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginatedData = filteredData.slice(startIndex, endIndex);

    // High-Performance On-Demand Route Replay Fetcher (Scoped strictly to visible page rows, batched state update)
    useEffect(() => {
        if (!paginatedData || paginatedData.length === 0 || !employees || !employees.length) return;
        const abortController = new AbortController();
        let isMounted = true;

        const pairsToFetch = new Map();
        paginatedData.forEach(rec => {
            const recDate = normalizeDateStr(rec.date || rec.createdAt);
            if (!recDate) return;
            const rawUser = rec.userId || rec.userName || rec.empCode;
            if (!rawUser) return;

            const uLower = String(rawUser).trim().toLowerCase();
            const matchedEmp = employees.find(e => 
                (e.id && String(e.id).trim().toLowerCase() === uLower) ||
                (e.empCode && String(e.empCode).trim().toLowerCase() === uLower) ||
                (e.emp_code && String(e.emp_code).trim().toLowerCase() === uLower) ||
                (e.name && String(e.name).trim().toLowerCase() === uLower)
            );

            const targetId = matchedEmp ? (matchedEmp.id || matchedEmp.empCode || rawUser) : rawUser;
            const pairKey = `${String(targetId).trim().toLowerCase()}_${recDate}`;
            if (!pairsToFetch.has(pairKey)) {
                pairsToFetch.set(pairKey, { targetId, dateStr: recDate, emp: matchedEmp });
            }
        });

        if (pairsToFetch.size === 0) return;

        const fetchPromises = Array.from(pairsToFetch.values()).map(async ({ targetId, dateStr, emp }) => {
            try {
                const res = await api.getRouteReplay(targetId, dateStr, 'osrm', { signal: abortController.signal });
                if (!res) return null;
                return { targetId, dateStr, emp, res };
            } catch (err) {
                return null;
            }
        });

        Promise.all(fetchPromises).then(results => {
            if (!isMounted) return;
            const distUpdates = {};
            const offUpdates = {};

            results.forEach(item => {
                if (!item) return;
                const { targetId, dateStr, emp, res } = item;
                const dateAliases = getAllDateAliases(dateStr);
                const allAliasKeys = [
                    emp?.id,
                    emp?.empCode,
                    emp?.emp_code,
                    emp?.name,
                    targetId,
                    String(targetId).trim().toLowerCase()
                ].filter(Boolean);

                const isCurrentDate = isToday(dateStr);

                if (res.roadDistance !== undefined) {
                    const distStr = Number(res.roadDistance).toFixed(2);
                    allAliasKeys.forEach(k => {
                        const kStr = String(k).trim();
                        const kLower = kStr.toLowerCase();
                        dateAliases.forEach(dAlias => {
                            distUpdates[`${kStr}_${dAlias}`] = distStr;
                            distUpdates[`${kLower}_${dAlias}`] = distStr;
                        });
                        if (isCurrentDate) {
                            distUpdates[kStr] = distStr;
                            distUpdates[kLower] = distStr;
                        }
                    });
                }

                if (res.gpsOffDurationLabel !== undefined && res.gpsOffDurationLabel !== null) {
                    const offLabel = res.gpsOffDurationLabel || '0m';
                    allAliasKeys.forEach(k => {
                        const kStr = String(k).trim();
                        const kLower = kStr.toLowerCase();
                        dateAliases.forEach(dAlias => {
                            offUpdates[`${kStr}_${dAlias}`] = offLabel;
                            offUpdates[`${kLower}_${dAlias}`] = offLabel;
                        });
                        if (isCurrentDate) {
                            offUpdates[kStr] = offLabel;
                            offUpdates[kLower] = offLabel;
                        }
                    });
                }
            });

            if (Object.keys(distUpdates).length > 0) {
                setTodayDistances(prev => ({ ...prev, ...distUpdates }));
            }
            if (Object.keys(offUpdates).length > 0) {
                setTodayGpsOffDurations(prev => ({ ...prev, ...offUpdates }));
            }
        });

        return () => {
            isMounted = false;
            abortController.abort();
        };
    }, [currentPage, filteredData.length, employees]);


    const getReportDates = () => {
        // 1. If fromDate and toDate range is active
        if (fromDate && toDate) {
            const start = new Date(fromDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(toDate);
            end.setHours(0, 0, 0, 0);

            if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end) {
                const dateItems = [];
                const cur = new Date(start);
                const isSameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
                while (cur <= end) {
                    const y = cur.getFullYear();
                    const m = cur.getMonth();
                    const d = cur.getDate();
                    const dStr = cur.toISOString().split('T')[0];
                    dateItems.push({
                        day: d,
                        month: m,
                        year: y,
                        dateStr: dStr,
                        label: isSameMonth ? `${d}` : `${d}/${m + 1}`
                    });
                    cur.setDate(cur.getDate() + 1);
                }
                const startDate = new Date(start);
                const endDate = new Date(end);
                endDate.setHours(23, 59, 59, 999);
                return {
                    year: start.getFullYear(),
                    month: start.getMonth(),
                    days: dateItems.map(item => item.day),
                    dateItems,
                    isCustomRange: true,
                    rangeText: `${fromDate} to ${toDate}`,
                    startDate,
                    endDate
                };
            }
        }

        // 2. Standard month-based report period
        const today = new Date();
        let year = today.getFullYear();
        let month = today.getMonth(); // 0-indexed

        if (reportPeriod === 'last-month') {
            if (month === 0) {
                month = 11;
                year -= 1;
            } else {
                month -= 1;
            }
        } else if (reportPeriod === 'custom' && customMonth) {
            const [y, m] = customMonth.split('-');
            year = parseInt(y, 10);
            month = parseInt(m, 10) - 1;
        }

        const daysCount = getDaysInMonth(year, month);
        const dateItems = Array.from({ length: daysCount }, (_, i) => {
            const day = i + 1;
            const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return {
                day,
                month,
                year,
                dateStr: dStr,
                label: `${day}`
            };
        });

        const startDate = new Date(year, month, 1, 0, 0, 0, 0);
        const endDate = new Date(year, month, daysCount, 23, 59, 59, 999);

        return {
            year,
            month,
            days: dateItems.map(item => item.day),
            dateItems,
            isCustomRange: false,
            startDate,
            endDate
        };
    };

    if (activeSubView === 'attendance-summary') {
        const { year, month, days, startDate, endDate } = getReportDates();
        const monthName = new Date(year, month).toLocaleString('default', { month: 'long' });
        
        const activeEmployeesForPeriod = employees.filter(emp => isEmpActiveForPeriod(emp, startDate, endDate));

        const filteredSummaryEmployees = activeEmployeesForPeriod.filter((emp, idx) => {
            if (selectedRecordEmpIds && selectedRecordEmpIds.length > 0) {
                const empIdStr = String(emp.id).toLowerCase();
                const empCodeStr = String(emp.empCode || emp.emp_code || getEmpId(emp, idx)).toLowerCase();
                const matches = selectedRecordEmpIds.some(id => {
                    const s = String(id).toLowerCase();
                    return s === empIdStr || s === empCodeStr;
                });
                if (!matches) return false;
            }
            if (searchQuery && searchQuery.trim() !== '') {
                const q = searchQuery.toLowerCase().trim();
                const nameMatch = emp.name && String(emp.name).toLowerCase().includes(q);
                const codeMatch = (emp.empCode || emp.emp_code || emp.id) && String(emp.empCode || emp.emp_code || emp.id).toLowerCase().includes(q);
                const deptMatch = emp.department && String(emp.department).toLowerCase().includes(q);
                if (!nameMatch && !codeMatch && !deptMatch) return false;
            }
            return true;
        });

        const summaryRows = filteredSummaryEmployees.map((emp, idx) => {
            const empId = getEmpId(emp, idx);
            const dept = emp.department || 'Company';
            
            const today = new Date();
            let targetEndDay = days.length;
            if (year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth())) {
                targetEndDay = 0;
            } else if (year === today.getFullYear() && month === today.getMonth()) {
                targetEndDay = today.getDate();
            }

            // Calculate employee-specific standard days & hours based on actual work + approved leaves @ 9.0 hours/shift
            let actualWorkingDays = 0;
            let approvedLeaveDays = 0;
            let totalWorkedMs = 0;
            let lateTimes = 0;
            let lateDurationMin = 0;
            let leaveEarlyTimes = 0;
            let leaveEarlyDurationMin = 0;
            let totalOvertimeMs = 0;
            let lackTimes = 0;
            let lackDurationMin = 0;

            const isFlexible = String(emp.attendanceSetting || '9-6').toLowerCase().includes('flexible');
            const standardCheckInHour = 9; 
            const standardCheckOutHour = 18; 
            const requiredNetWorkMs = 9 * 60 * 60 * 1000; // 9.0 Hours daily shift
            const empWeeklyOffs = String(emp.weeklyOffs || 'Sunday').toLowerCase();
            
            days.forEach(day => {
                if (day <= targetEndDay && isEmpActiveOnDate(emp, new Date(year, month, day))) {
                    const targetDate = new Date(year, month, day);
                    targetDate.setHours(0, 0, 0, 0);

                    const targetDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                    const isWeeklyOff = empWeeklyOffs.includes(dayName);
                    const isHoliday = isHolidayForEmp(targetDateStr, emp);
                    const record = groupedAttendance.find(r => isRecordForEmpAndDate(r, emp, targetDateStr));
                    
                    if (record && record.checkIn && record.checkOut) {
                        actualWorkingDays += 1;
                        
                        const parseDateTime = (dateVal, timeVal) => {
                            if (!timeVal) return null;
                            let d = new Date(timeVal);
                            if (isNaN(d.getTime()) && !isNaN(Number(timeVal))) {
                                d = new Date(Number(timeVal));
                            }
                            if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
                                return d;
                            }
                            
                            const timeRegex = /(\d+):(\d+):?(\d+)?\s*(AM|PM)?/i;
                            const match = String(timeVal).match(timeRegex);
                            if (!match) return null;
                            
                            let hours = parseInt(match[1], 10);
                            const minutes = parseInt(match[2], 10);
                            const seconds = match[3] ? parseInt(match[3], 10) : 0;
                            const ampm = match[4] ? match[4].toUpperCase() : null;
                            
                            if (ampm === 'PM' && hours < 12) {
                                hours += 12;
                            } else if (ampm === 'AM' && hours === 12) {
                                hours = 0;
                            }
                            
                            let baseDate = new Date(dateVal);
                            baseDate.setHours(hours, minutes, seconds, 0);
                            return baseDate;
                        };
                        
                        const start = parseDateTime(record.date, record.checkIn);
                        const end = parseDateTime(record.date, record.checkOut);
                        
                        if (start && end) {
                            const totalDurationMs = end - start;
                            if (totalDurationMs > 0) {
                                totalWorkedMs += totalDurationMs;
                                
                                if (!isFlexible) {
                                    const standardStart = new Date(start);
                                    standardStart.setHours(standardCheckInHour, 0, 0, 0);
                                    if (start > standardStart) {
                                        lateTimes += 1;
                                        lateDurationMin += Math.floor((start - standardStart) / (60 * 1000));
                                    }
                                    
                                    const standardEnd = new Date(end);
                                    standardEnd.setHours(standardCheckOutHour, 0, 0, 0);
                                    if (end < standardEnd) {
                                        leaveEarlyTimes += 1;
                                        leaveEarlyDurationMin += Math.floor((standardEnd - end) / (60 * 1000));
                                    }
                                }
                                
                                // Calculate Overtime: Clock-out after 06:00 PM (18:00)
                                const standardEndOvertime = new Date(end);
                                standardEndOvertime.setHours(standardCheckOutHour, 0, 0, 0);
                                if (end > standardEndOvertime) {
                                    totalOvertimeMs += (end - standardEndOvertime);
                                }
                                
                                if (totalDurationMs < requiredNetWorkMs) {
                                    lackTimes += 1;
                                    lackDurationMin += Math.floor((requiredNetWorkMs - totalDurationMs) / (60 * 1000));
                                }
                            }
                        }
                    } else if (!isWeeklyOff && !isHoliday) {
                        // 2. Check for approved leave on this day
                        const onApprovedLeave = leaves.some(l => {
                            const lStatus = l.status ? String(l.status).toLowerCase() : 'approved';
                            if (lStatus !== 'approved') return false;

                            const empNameMatch = (l.userName && String(l.userName).trim().toLowerCase() === String(emp.name).trim().toLowerCase()) ||
                                                 (l.employeeName && String(l.employeeName).trim().toLowerCase() === String(emp.name).trim().toLowerCase());
                            const empIdMatch = l.userId && String(l.userId).trim().toLowerCase() === String(emp.id).trim().toLowerCase();

                            if (empNameMatch || empIdMatch) {
                                if (l.startDate && l.endDate) {
                                    const start = new Date(l.startDate); start.setHours(0, 0, 0, 0);
                                    const end = new Date(l.endDate); end.setHours(23, 59, 59, 999);
                                    return targetDate >= start && targetDate <= end;
                                }
                            }
                            return false;
                        });

                        if (onApprovedLeave) {
                            approvedLeaveDays += 1;
                        }
                    }
                }
            });
            
            // Calculate employee-specific standard working days (excluding Weekly Offs AND Holidays) up to today
            let empStandardDays = 0;
            days.forEach(day => {
                if (day <= targetEndDay && isEmpActiveOnDate(emp, new Date(year, month, day))) {
                    const date = new Date(year, month, day);
                    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                    const targetDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isWeeklyOff = empWeeklyOffs.includes(dayName);
                    const isHoliday = isHolidayForEmp(targetDateStr, emp);
                    if (!isWeeklyOff && !isHoliday) {
                        empStandardDays++;
                    }
                }
            });
            const standardDays = empStandardDays;
            const standardHoursVal = standardDays * 9; // 9.0 Hours daily standard shift
            const standardHours = `${standardHoursVal}:00`;
            const actualDays = actualWorkingDays;

            const totalWorkedHrs = Math.floor(totalWorkedMs / (3600 * 1000));
            const totalWorkedMins = Math.floor((totalWorkedMs % (3600 * 1000)) / (60 * 1000));
            const actualDurationFormatted = `${totalWorkedHrs}:${String(totalWorkedMins).padStart(2, '0')}`;
            
            const overtimeHrs = Math.floor(totalOvertimeMs / (3600 * 1000));
            const overtimeMins = Math.floor((totalOvertimeMs % (3600 * 1000)) / (60 * 1000));
            const overtimeFormatted = `${overtimeHrs}:${String(overtimeMins).padStart(2, '0')}`;
            
            // Absent Days = Standard Working Days minus (Actual Worked Days + Approved Leave Days)
            const absentDays = Math.max(0, standardDays - (actualWorkingDays + approvedLeaveDays));
            
            const lateHrs = Math.floor(lateDurationMin / 60);
            const lateMins = lateDurationMin % 60;
            const lateDurationFormatted = `${lateHrs}:${String(lateMins).padStart(2, '0')}`;
            
            const leaveEarlyHrs = Math.floor(leaveEarlyDurationMin / 60);
            const leaveEarlyMins = leaveEarlyDurationMin % 60;
            const leaveEarlyDurationFormatted = `${leaveEarlyHrs}:${String(leaveEarlyMins).padStart(2, '0')}`;
            
            const lackHrs = Math.floor(lackDurationMin / 60);
            const lackMins = lackDurationMin % 60;
            const lackDurationFormatted = `${lackHrs}:${String(lackMins).padStart(2, '0')}`;
            
            return {
                empId,
                name: emp.name,
                dept,
                standardHours,
                actualDurationFormatted,
                lateTimes,
                lateDurationFormatted,
                leaveEarlyTimes,
                leaveEarlyDurationFormatted,
                overtimeFormatted,
                lackTimes,
                lackDurationFormatted,
                attendanceDays: `${standardDays}/${actualDays}`,
                absentDays
            };
        });

        const handleExportSummaryExcel = () => {
            const headers = [
                'Employee ID', 'Name', 'Department', 'Standard Hours', 'Actual Duration', 
                'Late Times', 'Late Duration', 'Leave Early Times', 'Leave Early Duration', 
                'Overtime Duration', 'Lack Times', 'Lack Duration', 'Attendance Days (Standard/Actual)', 'Absent Days'
            ];

            const rows = summaryRows.map(row => [
                row.empId,
                row.name,
                row.dept,
                row.standardHours,
                row.actualDurationFormatted,
                row.lateTimes,
                row.lateDurationFormatted,
                row.leaveEarlyTimes,
                row.leaveEarlyDurationFormatted,
                row.overtimeFormatted,
                row.lackTimes,
                row.lackDurationFormatted,
                row.attendanceDays,
                row.absentDays
            ]);

            exportToCSV(`Attendance_Summary_${monthName}_${year}.csv`, headers, rows);
        };

        return (
            <div id="attendance-summary-view" className="view active" style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
                {/* Header Card */}
                <div className="glass" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <button 
                            className="btn btn-outline" 
                            onClick={() => setActiveSubView('logs')}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', background: '#f3f4f6', border: '1px solid #d1d5db', cursor: 'pointer', borderRadius: '6px' }}
                            title="Back to Logs"
                        >
                            <i className="fa-solid fa-arrow-left"></i>
                        </button>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Attendance Summary</h2>
                            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                                Period: {monthName} {year}
                            </span>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                        {/* Selected Employee Filter */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#4b5563', whiteSpace: 'nowrap' }}>Employee:</label>
                            <MultiSelectEmployeeDropdown
                                employees={activeEmployeesForPeriod}
                                selectedIds={selectedRecordEmpIds}
                                onChange={setSelectedRecordEmpIds}
                                getEmpId={getEmpId}
                            />
                        </div>
                        <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2px', background: 'white' }}>
                            <button
                                className="btn"
                                onClick={() => setReportPeriod('last-month')}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 16px',
                                    background: 'transparent',
                                    color: reportPeriod === 'last-month' ? '#991b1b' : '#4b5563',
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    borderBottom: reportPeriod === 'last-month' ? '2px solid #ef4444' : 'none'
                                }}
                            >
                                Last Month
                            </button>
                            <button
                                className="btn"
                                onClick={() => setReportPeriod('current-month')}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 16px',
                                    background: 'transparent',
                                    color: reportPeriod === 'current-month' ? '#991b1b' : '#4b5563',
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    borderBottom: reportPeriod === 'current-month' ? '2px solid #ef4444' : 'none'
                                }}
                            >
                                Current Month
                            </button>
                            <button
                                className="btn"
                                onClick={() => setReportPeriod('custom')}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 16px',
                                    background: 'transparent',
                                    color: reportPeriod === 'custom' ? '#991b1b' : '#4b5563',
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    borderBottom: reportPeriod === 'custom' ? '2px solid #ef4444' : 'none'
                                }}
                            >
                                Custom
                            </button>
                        </div>

                        {reportPeriod === 'custom' && (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <select
                                    value={customMonth ? customMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0')}
                                    onChange={(e) => {
                                        const currentYear = customMonth ? customMonth.split('-')[0] : String(new Date().getFullYear());
                                        setCustomMonth(`${currentYear}-${e.target.value}`);
                                    }}
                                    style={{
                                        padding: '6px 12px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-glass)',
                                        backgroundColor: 'var(--input-bg)',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.9rem',
                                        outline: 'none',
                                        height: '34px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value="01">January</option>
                                    <option value="02">February</option>
                                    <option value="03">March</option>
                                    <option value="04">April</option>
                                    <option value="05">May</option>
                                    <option value="06">June</option>
                                    <option value="07">July</option>
                                    <option value="08">August</option>
                                    <option value="09">September</option>
                                    <option value="10">October</option>
                                    <option value="11">November</option>
                                    <option value="12">December</option>
                                </select>
                                <select
                                    value={customMonth ? customMonth.split('-')[0] : String(new Date().getFullYear())}
                                    onChange={(e) => {
                                        const currentMonth = customMonth ? customMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0');
                                        setCustomMonth(`${e.target.value}-${currentMonth}`);
                                    }}
                                    style={{
                                        padding: '6px 12px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-glass)',
                                        backgroundColor: 'var(--input-bg)',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.9rem',
                                        outline: 'none',
                                        height: '34px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {Array.from({ length: 51 }, (_, i) => 1990 + i).map(year => (
                                        <option key={year} value={String(year)}>{year}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                    <button 
                        className="btn btn-primary" 
                        onClick={handleExportSummaryExcel}
                        style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <i className="fa-solid fa-file-excel"></i> Export Excel
                    </button>
                </div>

                {/* Dummy Top Scrollbar */}
                <div 
                    ref={summaryTopScrollRef}
                    onScroll={handleSummaryTopScroll}
                    style={{ overflowX: 'auto', overflowY: 'hidden', height: '8px', width: '100%', marginBottom: '-10px', background: 'transparent' }}
                >
                    <div style={{ width: `${summaryWidth}px`, height: '1px' }} />
                </div>

                <div 
                    ref={summaryTableRef}
                    onScroll={handleSummaryTableScroll}
                    className="table-container glass custom-scrollbar" 
                    style={{ padding: '0', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', borderRadius: '16px' }}
                >
                    <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1' }}>
                                <th rowSpan="2" style={{ padding: '12px 10px', textAlign: 'left', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#334155', minWidth: '90px' }}>Employee ID</th>
                                <th rowSpan="2" style={{ padding: '12px 10px', textAlign: 'left', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#334155', minWidth: '110px' }}>Name</th>
                                <th rowSpan="2" style={{ padding: '12px 10px', textAlign: 'left', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#334155', minWidth: '90px' }}>Department</th>
                                <th colSpan="2" style={{ padding: '8px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#334155' }}>Work Duration</th>
                                <th colSpan="2" style={{ padding: '8px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#334155' }}>Late</th>
                                <th colSpan="2" style={{ padding: '8px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#334155' }}>Leave Early</th>
                                <th colSpan="2" style={{ padding: '8px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#334155' }}>OverTime</th>
                                <th colSpan="2" style={{ padding: '8px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#334155' }}>Lack</th>
                                <th rowSpan="2" style={{ padding: '12px 10px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#334155', minWidth: '80px' }}>Attendance days St/Ac</th>
                                <th rowSpan="2" style={{ padding: '12px 10px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#334155', minWidth: '70px' }}>Absent (Days)</th>
                                <th rowSpan="2" style={{ padding: '12px 10px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#334155', minWidth: '85px' }}>On business (Days)</th>
                                <th rowSpan="2" style={{ padding: '12px 10px', textAlign: 'center', fontWeight: 600, color: '#334155', minWidth: '70px' }}>Ask Off (Days)</th>
                            </tr>
                             <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#475569', minWidth: '60px' }}>Standard</th>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#475569', minWidth: '60px' }}>Actual</th>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#475569', minWidth: '40px' }}>Times</th>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#475569', minWidth: '55px' }}>Duration(HH:MM)</th>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#475569', minWidth: '40px' }}>Times</th>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#475569', minWidth: '55px' }}>Duration(HH:MM)</th>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#475569', minWidth: '60px' }}>Normal</th>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#475569', minWidth: '60px' }}>Special</th>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#475569', minWidth: '40px' }}>Times</th>
                                <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#475569', minWidth: '55px' }}>Duration(HH:MM)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaryRows.map((row, idx) => (
                                <tr key={row.empId} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>
                                    <td style={{ padding: '10px 10px', borderRight: '1px solid #e2e8f0', color: '#475569' }}>{row.empId}</td>
                                    <td style={{ padding: '10px 10px', borderRight: '1px solid #e2e8f0', fontWeight: 500, color: '#1e293b' }}>{row.name}</td>
                                    <td style={{ padding: '10px 10px', borderRight: '2px solid #cbd5e1', color: '#64748b' }}>{row.dept}</td>
                                    
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', color: '#475569' }}>{row.standardHours}</td>
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#1e293b' }}>{row.actualDurationFormatted}</td>
                                    
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', color: '#475569' }}>{row.lateTimes}</td>
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', color: '#475569' }}>{row.lateDurationFormatted}</td>
                                    
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', color: '#475569' }}>{row.leaveEarlyTimes}</td>
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', color: '#475569' }}>{row.leaveEarlyDurationFormatted}</td>
                                    
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', color: '#475569' }}>{row.overtimeFormatted}</td>
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', color: '#cbd5e1' }}>0:00</td>
                                    
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', color: '#475569' }}>{row.lackTimes}</td>
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '2px solid #cbd5e1', color: '#475569' }}>{row.lackDurationFormatted}</td>
                                    
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#1e293b' }}>{row.attendanceDays}</td>
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', color: '#ef4444', fontWeight: 600 }}>{row.absentDays}</td>
                                    <td style={{ padding: '10px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', color: '#cbd5e1' }}>0</td>
                                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#cbd5e1' }}>0</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (activeSubView === 'attendance-record') {
        const { year, month, days, dateItems, isCustomRange, rangeText, startDate, endDate } = getReportDates();
        const monthName = new Date(year, month).toLocaleString('default', { month: 'long' });
        
        const activeEmployeesForPeriod = employees.filter(emp => isEmpActiveForPeriod(emp, startDate, endDate));

        // Filter employees by selected employee dropdown and search query
        const filteredReportEmployees = activeEmployeesForPeriod.filter((emp, idx) => {
            if (selectedRecordEmpIds && selectedRecordEmpIds.length > 0) {
                const empIdStr = String(emp.id).toLowerCase();
                const empCodeStr = String(emp.empCode || emp.emp_code || getEmpId(emp, idx)).toLowerCase();
                const matches = selectedRecordEmpIds.some(id => {
                    const s = String(id).toLowerCase();
                    return s === empIdStr || s === empCodeStr;
                });
                if (!matches) return false;
            }
            if (searchQuery && searchQuery.trim() !== '') {
                const q = searchQuery.toLowerCase().trim();
                const nameMatch = emp.name && String(emp.name).toLowerCase().includes(q);
                const codeMatch = (emp.empCode || emp.emp_code || emp.id) && String(emp.empCode || emp.emp_code || emp.id).toLowerCase().includes(q);
                const deptMatch = emp.department && String(emp.department).toLowerCase().includes(q);
                if (!nameMatch && !codeMatch && !deptMatch) return false;
            }
            return true;
        });

        // Generate rows for each filtered employee
        const reportRows = filteredReportEmployees.map((emp, idx) => {
            const empId = getEmpId(emp, idx);
            const dept = emp.department || 'Company';
            
            // Map dateStr -> check-in and check-out times
            const dayRecords = {};
            dateItems.forEach(item => {
                const targetDate = new Date(item.year, item.month, item.day);
                targetDate.setHours(0, 0, 0, 0);
                const isActiveOnThisDay = isEmpActiveOnDate(emp, targetDate);

                const record = groupedAttendance.find(r => isRecordForEmpAndDate(r, emp, item.dateStr));
                
                const formatTime = (timeStr) => formatTo12HourTime(timeStr);

                if (record && (record.checkIn || record.checkOut)) {
                    dayRecords[item.dateStr] = {
                        in: formatTime(record.checkIn),
                        out: formatTime(record.checkOut)
                    };
                } else if (!isActiveOnThisDay) {
                    dayRecords[item.dateStr] = { in: '-', out: '-' };
                } else {
                    // Check for approved leaves on this day
                    const onLeave = leaves.some(l => {
                        const lStatus = l.status ? String(l.status).toLowerCase() : 'approved';
                        if (lStatus !== 'approved') return false;

                        const empNameMatch = (l.userName && String(l.userName).trim().toLowerCase() === String(emp.name).trim().toLowerCase()) ||
                                             (l.employeeName && String(l.employeeName).trim().toLowerCase() === String(emp.name).trim().toLowerCase());
                        const empIdMatch = l.userId && String(l.userId).trim().toLowerCase() === String(emp.id).trim().toLowerCase();

                        if (empNameMatch || empIdMatch) {
                            if (l.date) {
                                const lD = new Date(l.date);
                                lD.setHours(0, 0, 0, 0);
                                if (lD.getTime() === targetDate.getTime()) return true;
                            }
                            if (l.startDate && l.endDate) {
                                const start = new Date(l.startDate);
                                start.setHours(0, 0, 0, 0);
                                const end = new Date(l.endDate);
                                end.setHours(23, 59, 59, 999);
                                if (targetDate >= start && targetDate <= end) return true;
                            }
                        }
                        return false;
                    });

                    if (onLeave) {
                        dayRecords[item.dateStr] = { in: 'Leave', out: 'Approved' };
                    } else {
                        dayRecords[item.dateStr] = { in: '', out: '' };
                    }
                }
            });
            
            return {
                empId,
                name: emp.name,
                dept,
                rawEmp: emp,
                dayRecords
            };
        });

        const handleExportRecordExcel = async () => {
            try {
                const { default: ExcelJS } = await import('exceljs');
                const wb = new ExcelJS.Workbook();
                wb.creator = 'Hydro HRMS';
                wb.created = new Date();

                const thinBorder = {
                    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
                };

                const headerBorder = {
                    top: { style: 'medium', color: { argb: 'FF0F172A' } },
                    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
                    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
                };

                const sundayLetters = ['S', 'U', 'N', 'D', 'A', 'Y'];
                const totalRows = reportRows.length;

                // ========================================================
                // SHEET 1: ATTENDANCE RECORD (IN - OUT TIMES)
                // ========================================================
                const ws1 = wb.addWorksheet('Attendance Record', {
                    views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }]
                });

                const totalCols1 = 3 + dateItems.length;

                // 1. Top Title Banner
                ws1.mergeCells(1, 1, 1, totalCols1);
                const titleCell1 = ws1.getCell(1, 1);
                titleCell1.value = 'ATTENDANCE RECORD (CLOCK IN / OUT)';
                titleCell1.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
                titleCell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
                titleCell1.alignment = { vertical: 'middle', horizontal: 'center' };
                ws1.getRow(1).height = 32;

                // 2. Month & Report Info Banner
                ws1.mergeCells(2, 1, 2, totalCols1);
                const subCell1 = ws1.getCell(2, 1);
                subCell1.value = `Month / Period: ${isCustomRange ? rangeText : `${monthName} ${year}`}    |    Total Employees: ${reportRows.length}    |    Generated: ${new Date().toLocaleDateString('en-GB')}`;
                subCell1.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF334155' } };
                subCell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                subCell1.alignment = { vertical: 'middle', horizontal: 'center' };
                ws1.getRow(2).height = 22;

                // 3. Legend Row
                ws1.mergeCells(3, 1, 3, totalCols1);
                const legCell1 = ws1.getCell(3, 1);
                legCell1.value = 'Legend:  🟢 Top: Clock-In (12-hr)    🔴 Bottom: Clock-Out (12-hr)    📅 Sunday: Weekly Off';
                legCell1.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF475569' } };
                legCell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                legCell1.alignment = { vertical: 'middle', horizontal: 'center' };
                ws1.getRow(3).height = 18;

                // 4. Table Header Row (Row 4) - Day Numbers (dd) Only
                ws1.getRow(4).height = 26;
                const headerCols1 = ['Emp ID', 'Name', 'Department', ...dateItems.map(d => String(d.day).padStart(2, '0'))];

                headerCols1.forEach((colName, idx) => {
                    const colNum = idx + 1;
                    const cell = ws1.getCell(4, colNum);
                    cell.value = colName;
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.border = headerBorder;

                    if (colNum <= 3) {
                        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
                    } else {
                        const item = dateItems[colNum - 4];
                        const isSunday = new Date(item.year, item.month, item.day).getDay() === 0;

                        if (isSunday) {
                            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF991B1B' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                        } else {
                            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
                        }
                    }
                });

                // Column Widths for Sheet 1
                ws1.getColumn(1).width = 14;
                ws1.getColumn(2).width = 22;
                ws1.getColumn(3).width = 16;
                for (let c = 4; c <= totalCols1; c++) {
                    ws1.getColumn(c).width = 11;
                }

                const startRowIdx1 = 5;
                const endRowIdx1 = startRowIdx1 + reportRows.length - 1;

                // Employee Data Rows for Sheet 1
                reportRows.forEach((row, rIdx) => {
                    const rowNum = startRowIdx1 + rIdx;
                    const wsRow = ws1.getRow(rowNum);
                    wsRow.height = 30;

                    const idCell = wsRow.getCell(1);
                    idCell.value = row.empId;
                    idCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF334155' } };
                    idCell.alignment = { vertical: 'middle', horizontal: 'center' };
                    idCell.border = thinBorder;

                    const nameCell = wsRow.getCell(2);
                    nameCell.value = row.name;
                    nameCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                    nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
                    nameCell.border = thinBorder;

                    const deptCell = wsRow.getCell(3);
                    deptCell.value = row.dept;
                    deptCell.font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };
                    deptCell.alignment = { vertical: 'middle', horizontal: 'left' };
                    deptCell.border = thinBorder;

                    dateItems.forEach((item, dIdx) => {
                        const colNum = 4 + dIdx;
                        const cell = wsRow.getCell(colNum);
                        cell.border = thinBorder;

                        const targetDate = new Date(item.year, item.month, item.day);
                        targetDate.setHours(0, 0, 0, 0);

                        const empObj = row.rawEmp || row;
                        const empWeeklyOffs = String(empObj.weeklyOffs || 'Sunday').toLowerCase();
                        const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                        const isSunday = targetDate.getDay() === 0 || empWeeklyOffs.includes(dayName);
                        const holidayObj = getHolidayForEmp(item.dateStr, empObj);
                        const isHoliday = Boolean(holidayObj);

                        const rec = row.dayRecords[item.dateStr] || { in: '', out: '' };
                        const inVal = rec.in ? String(rec.in).trim() : '';
                        const outVal = rec.out ? String(rec.out).trim() : '';
                        const hasPunch = Boolean((inVal && inVal !== '-' && inVal !== 'Leave') || (outVal && outVal !== '-' && outVal !== 'Approved'));

                        if (isSunday && hasPunch) {
                            cell.value = {
                                richText: [
                                    { text: 'WOS\n', font: { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF92400E' } } },
                                    { text: (inVal || '--') + ' - ' + (outVal || '--'), font: { name: 'Calibri', size: 7.5, bold: true, color: { argb: 'FFB45309' } } }
                                ]
                            };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
                            cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
                        } else if (isSunday && !hasPunch) {
                            cell.value = 'Sunday';
                            cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF991B1B' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                            cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        } else if (isHoliday && hasPunch) {
                            cell.value = {
                                richText: [
                                    { text: 'WOH\n', font: { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF6B21A8' } } },
                                    { text: (inVal || '--') + ' - ' + (outVal || '--'), font: { name: 'Calibri', size: 7.5, bold: true, color: { argb: 'FF7C3AED' } } }
                                ]
                            };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
                            cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
                        } else if (isHoliday && !hasPunch) {
                            cell.value = 'Holiday';
                            cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF7E22CE' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
                            cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        } else if (inVal === 'Leave' || outVal === 'Approved') {
                            cell.value = 'Leave';
                            cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF2563EB' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
                            cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        } else if (inVal === '-' && outVal === '-') {
                            cell.value = '-';
                            cell.font = { name: 'Calibri', size: 9, color: { argb: 'FF94A3B8' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };
                            cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        } else if (inVal && outVal) {
                            cell.value = {
                                richText: [
                                    { text: inVal + '\n', font: { name: 'Calibri', size: 8.5, bold: true, color: { argb: 'FF16A34A' } } },
                                    { text: outVal, font: { name: 'Calibri', size: 8.5, bold: true, color: { argb: 'FFDC2626' } } }
                                ]
                            };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };
                            cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
                        } else if (inVal) {
                            cell.value = {
                                richText: [
                                    { text: inVal + '\n', font: { name: 'Calibri', size: 8.5, bold: true, color: { argb: 'FF16A34A' } } },
                                    { text: '--:--', font: { name: 'Calibri', size: 8.5, color: { argb: 'FF94A3B8' } } }
                                ]
                            };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };
                            cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
                        } else if (outVal) {
                            cell.value = {
                                richText: [
                                    { text: '--:--\n', font: { name: 'Calibri', size: 8.5, color: { argb: 'FF94A3B8' } } },
                                    { text: outVal, font: { name: 'Calibri', size: 8.5, bold: true, color: { argb: 'FFDC2626' } } }
                                ]
                            };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };
                            cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
                        } else {
                            cell.value = '-';
                            cell.font = { name: 'Calibri', size: 9, color: { argb: 'FFCBD5E1' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };
                            cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        }
                    });
                });

                // ========================================================
                // SHEET 2: ATTENDANCE STATUS (PRESENT, ABSENT, LEAVES)
                // ========================================================
                const ws2 = wb.addWorksheet('Attendance Status', {
                    views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }]
                });

                const summaryHeaders = [
                    'Present (P)',
                    'Absent (A)',
                    'WOS',
                    'WOH',
                    'EL',
                    'Sun/Hol Consumed',
                    'LOP',
                    'Sunday (WO)',
                    'Holiday (H)',
                    'Total Payable Days'
                ];

                const totalCols2 = 3 + dateItems.length + summaryHeaders.length;

                // 1. Top Title Banner
                ws2.mergeCells(1, 1, 1, totalCols2);
                const titleCell2 = ws2.getCell(1, 1);
                titleCell2.value = 'ATTENDANCE STATUS (DATEWISE PRESENT, ABSENT & LEAVE BREAKDOWN)';
                titleCell2.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
                titleCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } };
                titleCell2.alignment = { vertical: 'middle', horizontal: 'center' };
                ws2.getRow(1).height = 32;

                // 2. Month & Report Info Banner
                ws2.mergeCells(2, 1, 2, totalCols2);
                const subCell2 = ws2.getCell(2, 1);
                subCell2.value = `Month / Period: ${isCustomRange ? rangeText : `${monthName} ${year}`}    |    Total Employees: ${reportRows.length}    |    Generated: ${new Date().toLocaleDateString('en-GB')}`;
                subCell2.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF334155' } };
                subCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                subCell2.alignment = { vertical: 'middle', horizontal: 'center' };
                ws2.getRow(2).height = 22;

                // 3. Legend Row
                ws2.mergeCells(3, 1, 3, totalCols2);
                const legCell2 = ws2.getCell(3, 1);
                legCell2.value = 'Status Codes:  🟢 Present  |  🔴 Absent  |  🔵 EL (Earned Leave)  |  🟠 Sunday/Holiday Consumed  |  🟣 LOP (Loss of Pay)  |  📅 Sunday (WO)  |  🌴 Holiday  |  ➖ Future Date / NA';
                legCell2.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF334155' } };
                legCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                legCell2.alignment = { vertical: 'middle', horizontal: 'center' };
                ws2.getRow(3).height = 18;

                // 4. Table Header Row (Row 4)
                ws2.getRow(4).height = 26;
                const headerCols2 = [
                    'Emp ID',
                    'Name',
                    'Department',
                    ...dateItems.map(d => String(d.day).padStart(2, '0')),
                    ...summaryHeaders
                ];

                headerCols2.forEach((colName, idx) => {
                    const colNum = idx + 1;
                    const cell = ws2.getCell(4, colNum);
                    cell.value = colName;
                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                    cell.border = headerBorder;

                    if (colNum <= 3) {
                        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
                    } else if (colNum <= 3 + dateItems.length) {
                        const item = dateItems[colNum - 4];
                        const isSunday = new Date(item.year, item.month, item.day).getDay() === 0;

                        if (isSunday) {
                            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF991B1B' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                        } else {
                            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
                        }
                    } else {
                        cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
                    }
                });

                // Set Column Widths for Sheet 2
                ws2.getColumn(1).width = 14;
                ws2.getColumn(2).width = 22;
                ws2.getColumn(3).width = 16;
                for (let c = 4; c <= 3 + dateItems.length; c++) ws2.getColumn(c).width = 13;
                for (let c = 4 + dateItems.length; c <= totalCols2; c++) ws2.getColumn(c).width = 14;

                const startRowIdx2 = 5;
                const endRowIdx2 = startRowIdx2 + reportRows.length - 1;

                // 5. Employee Data Rows for Sheet 2
                reportRows.forEach((row, rIdx) => {
                    const rowNum = startRowIdx2 + rIdx;
                    const wsRow = ws2.getRow(rowNum);
                    wsRow.height = 28;

                    const emp = row.emp || filteredReportEmployees[rIdx] || {};

                    const idCell = wsRow.getCell(1);
                    idCell.value = row.empId;
                    idCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF334155' } };
                    idCell.alignment = { vertical: 'middle', horizontal: 'center' };
                    idCell.border = thinBorder;

                    const nameCell = wsRow.getCell(2);
                    nameCell.value = row.name;
                    nameCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                    nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
                    nameCell.border = thinBorder;

                    const deptCell = wsRow.getCell(3);
                    deptCell.value = row.dept;
                    deptCell.font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };
                    deptCell.alignment = { vertical: 'middle', horizontal: 'left' };
                    deptCell.border = thinBorder;

                    let presentCount = 0;
                    let absentCount = 0;
                    let wosCount = 0;
                    let wohCount = 0;
                    let elCount = 0;
                    let sunHolCount = 0;
                    let lopCount = 0;
                    let sundayCount = 0;
                    let holidayCount = 0;

                    const empLeaves = (leaves || []).filter(l => {
                        const lStatus = l.status ? String(l.status).toLowerCase() : 'approved';
                        if (lStatus !== 'approved') return false;
                        const empNameMatch = (l.userName && String(l.userName).trim().toLowerCase() === String(emp.name).trim().toLowerCase()) ||
                                             (l.employeeName && String(l.employeeName).trim().toLowerCase() === String(emp.name).trim().toLowerCase());
                        const empIdMatch = l.userId && String(l.userId).trim().toLowerCase() === String(emp.id).trim().toLowerCase();
                        return empNameMatch || empIdMatch;
                    });

                    dateItems.forEach((item, dIdx) => {
                        const colNum = 4 + dIdx;
                        const cell = wsRow.getCell(colNum);
                        cell.border = thinBorder;

                        const targetDate = new Date(item.year, item.month, item.day);
                        targetDate.setHours(0, 0, 0, 0);

                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const isFutureDate = targetDate.getTime() > today.getTime();

                        const empObj = row.rawEmp || emp;
                        const empWeeklyOffs = String(empObj.weeklyOffs || 'Sunday').toLowerCase();
                        const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                        const isSunday = targetDate.getDay() === 0 || empWeeklyOffs.includes(dayName);
                        const holidayObj = getHolidayForEmp(item.dateStr, empObj);
                        const isHoliday = Boolean(holidayObj);
                        const isActiveOnDate = isEmpActiveOnDate(empObj, targetDate);

                        const record = groupedAttendance.find(r => isRecordForEmpAndDate(r, empObj, item.dateStr));
                        const hasPunch = record && (record.checkIn || record.checkOut);

                        let status = '-';
                        let fontColor = 'FF94A3B8';
                        let fillColor = 'FFFFFFFF';

                        const matchedLeave = empLeaves.find(l => {
                            if (l.date) {
                                const lDate = new Date(l.date); lDate.setHours(0, 0, 0, 0);
                                if (lDate.getTime() === targetDate.getTime()) return true;
                            }
                            if (l.startDate && l.endDate) {
                                const start = new Date(l.startDate); start.setHours(0, 0, 0, 0);
                                const end = new Date(l.endDate); end.setHours(23, 59, 59, 999);
                                return targetDate >= start && targetDate <= end;
                            }
                            return false;
                        });

                        if (!isActiveOnDate) {
                            status = '-';
                            fontColor = 'FF94A3B8';
                            fillColor = 'FFF8FAFC';
                        } else if (isSunday) {
                            if (hasPunch) {
                                status = 'WOS';
                                fontColor = 'FF92400E';
                                fillColor = 'FFFEF3C7';
                                wosCount++;
                            } else {
                                status = 'Sunday';
                                fontColor = 'FF991B1B';
                                fillColor = 'FFFEE2E2';
                                sundayCount++;
                            }
                        } else if (isHoliday) {
                            if (hasPunch) {
                                status = 'WOH';
                                fontColor = 'FF6B21A8';
                                fillColor = 'FFEDE9FE';
                                wohCount++;
                            } else {
                                status = 'Holiday';
                                fontColor = 'FF7E22CE';
                                fillColor = 'FFF3E8FF';
                                holidayCount++;
                            }
                        } else if (hasPunch) {
                            status = 'Present';
                            fontColor = 'FF15803D';
                            fillColor = 'FFDCFCE7';
                            presentCount++;
                        } else if (matchedLeave) {
                            const lType = String(matchedLeave.type || '').toLowerCase();
                            const lReason = String(matchedLeave.reason || '').toLowerCase();

                            let isLopDay = lType.includes('lop') || lType.includes('loss of pay');
                            if (!isLopDay && matchedLeave.startDate && matchedLeave.elDays !== undefined && matchedLeave.lopDays !== undefined) {
                                const lStart = new Date(matchedLeave.startDate);
                                lStart.setHours(0, 0, 0, 0);
                                const diffDays = Math.round((targetDate - lStart) / (1000 * 3600 * 24));
                                if (diffDays >= Number(matchedLeave.elDays || 0) && diffDays < (Number(matchedLeave.elDays || 0) + Number(matchedLeave.lopDays || 0))) {
                                    isLopDay = true;
                                }
                            }

                            if (isLopDay) {
                                status = 'LOP';
                                fontColor = 'FF991B1B';
                                fillColor = 'FFFEE2E2';
                                lopCount++;
                            } else {
                                const isSpecial = lType.includes('special') || lType.includes('sunday') || lType.includes('holiday') ||
                                                  lReason.includes('special') || lReason.includes('sunday') || lReason.includes('holiday') || lReason.includes('comp');
                                if (isSpecial) {
                                    status = 'Sunday/Holiday\r\nConsumed';
                                    fontColor = 'FFB45309';
                                    fillColor = 'FFFEF3C7';
                                    sunHolCount++;
                                } else {
                                    status = 'EL';
                                    fontColor = 'FF1D4ED8';
                                    fillColor = 'FFDBEAFE';
                                    elCount++;
                                }
                            }
                        } else if (isFutureDate) {
                            status = '-';
                            fontColor = 'FF94A3B8';
                            fillColor = 'FFF8FAFC';
                        } else {
                            status = 'Absent';
                            fontColor = 'FFBE123C';
                            fillColor = 'FFFFE4E6';
                            absentCount++;
                        }

                        const fontSize = status.length > 12 ? 8 : 9;
                        cell.value = status;
                        cell.font = { name: 'Calibri', size: fontSize, bold: true, color: { argb: fontColor } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
                        cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
                    });

                    // Summary Count Columns
                    const payableDays = presentCount + wosCount + wohCount + elCount + sunHolCount + sundayCount + holidayCount;
                    const counts = [
                        presentCount,
                        absentCount,
                        wosCount,
                        wohCount,
                        elCount,
                        sunHolCount,
                        lopCount,
                        sundayCount,
                        holidayCount,
                        payableDays
                    ];

                    counts.forEach((val, cIdx) => {
                        const colNum = 4 + dateItems.length + cIdx;
                        const cell = wsRow.getCell(colNum);
                        cell.value = val;
                        const isPayableCol = cIdx === counts.length - 1;
                        cell.font = {
                            name: 'Calibri',
                            size: 10,
                            bold: isPayableCol,
                            color: { argb: isPayableCol ? 'FF0F766E' : 'FF334155' }
                        };
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: isPayableCol ? 'FFCCFBF1' : (rIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC') }
                        };
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        cell.border = thinBorder;
                    });
                });

                // 7. Write to buffer and trigger browser download
                const buffer = await wb.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const downloadUrl = window.URL.createObjectURL(blob);
                const fileName = isCustomRange 
                    ? `Attendance_Record_${fromDate}_to_${toDate}.xlsx` 
                    : `Attendance_Record_${monthName}_${year}.xlsx`;
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(downloadUrl);
            } catch (err) {
                console.error('Error generating Attendance Record Excel:', err);
                alert('Failed to export Excel report. Please try again.');
            }
        };

        return (
            <div id="attendance-summary-view" className="view active" style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
                {/* Header Card */}
                <div className="glass" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <button 
                            className="btn btn-outline" 
                            onClick={() => setActiveSubView('logs')}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', background: '#f3f4f6', border: '1px solid #d1d5db', cursor: 'pointer', borderRadius: '6px' }}
                            title="Back to Logs"
                        >
                            <i className="fa-solid fa-arrow-left"></i>
                        </button>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Attendance Record</h2>
                            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                                Period: {isCustomRange ? rangeText : `${monthName} ${year}`}
                            </span>
                        </div>
                    </div>

                    {/* Filter Controls: Employee Select, Date Range & Quick Periods */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        {/* Selected Employee Filter */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#4b5563', whiteSpace: 'nowrap' }}>Employee:</label>
                            <MultiSelectEmployeeDropdown
                                employees={activeEmployeesForPeriod}
                                selectedIds={selectedRecordEmpIds}
                                onChange={setSelectedRecordEmpIds}
                                getEmpId={getEmpId}
                            />
                        </div>

                        {/* From Date & To Date Range Pickers */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#4b5563', whiteSpace: 'nowrap' }}>From:</label>
                            <input
                                type="date"
                                value={fromDate}
                                onChange={(e) => {
                                    setFromDate(e.target.value);
                                    if (e.target.value) setReportPeriod('custom-range');
                                }}
                                style={{
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid #d1d5db',
                                    fontSize: '0.85rem',
                                    height: '36px',
                                    backgroundColor: 'white',
                                    outline: 'none'
                                }}
                            />
                            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#4b5563', whiteSpace: 'nowrap' }}>To:</label>
                            <input
                                type="date"
                                value={toDate}
                                onChange={(e) => {
                                    setToDate(e.target.value);
                                    if (e.target.value) setReportPeriod('custom-range');
                                }}
                                style={{
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid #d1d5db',
                                    fontSize: '0.85rem',
                                    height: '36px',
                                    backgroundColor: 'white',
                                    outline: 'none'
                                }}
                            />
                        </div>

                        {/* Quick Period Buttons */}
                        <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2px', background: 'white' }}>
                            <button
                                className="btn"
                                onClick={() => {
                                    setFromDate('');
                                    setToDate('');
                                    setReportPeriod('last-month');
                                }}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    background: 'transparent',
                                    color: reportPeriod === 'last-month' ? '#991b1b' : '#4b5563',
                                    fontWeight: 600,
                                    boxShadow: 'none',
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    borderBottom: reportPeriod === 'last-month' ? '2px solid #ef4444' : 'none'
                                }}
                            >
                                Last Month
                            </button>
                            <button
                                className="btn"
                                onClick={() => {
                                    setFromDate('');
                                    setToDate('');
                                    setReportPeriod('current-month');
                                }}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    background: 'transparent',
                                    color: reportPeriod === 'current-month' ? '#991b1b' : '#4b5563',
                                    fontWeight: 600,
                                    boxShadow: 'none',
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    borderBottom: reportPeriod === 'current-month' ? '2px solid #ef4444' : 'none'
                                }}
                            >
                                Current Month
                            </button>
                            <button
                                className="btn"
                                onClick={() => {
                                    setFromDate('');
                                    setToDate('');
                                    setReportPeriod('custom');
                                }}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    background: 'transparent',
                                    color: reportPeriod === 'custom' ? '#991b1b' : '#4b5563',
                                    fontWeight: 600,
                                    boxShadow: 'none',
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    borderBottom: reportPeriod === 'custom' ? '2px solid #ef4444' : 'none'
                                }}
                            >
                                Custom Month
                            </button>
                        </div>

                        {reportPeriod === 'custom' && !fromDate && !toDate && (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <select
                                    value={customMonth ? customMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0')}
                                    onChange={(e) => {
                                        const currentYear = customMonth ? customMonth.split('-')[0] : String(new Date().getFullYear());
                                        setCustomMonth(`${currentYear}-${e.target.value}`);
                                    }}
                                    style={{
                                        padding: '6px 10px',
                                        borderRadius: '6px',
                                        border: '1px solid #d1d5db',
                                        backgroundColor: 'white',
                                        color: '#1f2937',
                                        fontSize: '0.85rem',
                                        outline: 'none',
                                        height: '36px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value="01">January</option>
                                    <option value="02">February</option>
                                    <option value="03">March</option>
                                    <option value="04">April</option>
                                    <option value="05">May</option>
                                    <option value="06">June</option>
                                    <option value="07">July</option>
                                    <option value="08">August</option>
                                    <option value="09">September</option>
                                    <option value="10">October</option>
                                    <option value="11">November</option>
                                    <option value="12">December</option>
                                </select>
                                <select
                                    value={customMonth ? customMonth.split('-')[0] : String(new Date().getFullYear())}
                                    onChange={(e) => {
                                        const currentMonth = customMonth ? customMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0');
                                        setCustomMonth(`${e.target.value}-${currentMonth}`);
                                    }}
                                    style={{
                                        padding: '6px 10px',
                                        borderRadius: '6px',
                                        border: '1px solid #d1d5db',
                                        backgroundColor: 'white',
                                        color: '#1f2937',
                                        fontSize: '0.85rem',
                                        outline: 'none',
                                        height: '36px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {Array.from({ length: 51 }, (_, i) => 1990 + i).map(year => (
                                        <option key={year} value={String(year)}>{year}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {(fromDate || toDate || selectedRecordEmpIds.length > 0) && (
                            <button
                                onClick={() => {
                                    setFromDate('');
                                    setToDate('');
                                    setSelectedRecordEmpIds([]);
                                    setSearchQuery('');
                                    setReportPeriod('current-month');
                                }}
                                style={{
                                    padding: '6px 10px',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    background: '#fee2e2',
                                    color: '#991b1b',
                                    border: '1px solid #fca5a5',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    height: '36px',
                                    whiteSpace: 'nowrap'
                                }}
                                title="Reset All Filters"
                            >
                                Clear Filters
                            </button>
                        )}
                    </div>

                    <button 
                        className="btn btn-primary" 
                        onClick={handleExportRecordExcel}
                        style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <i className="fa-solid fa-file-excel"></i> Export Excel
                    </button>
                </div>

                {/* Dummy Top Scrollbar */}
                <div 
                    ref={recordTopScrollRef}
                    onScroll={handleRecordTopScroll}
                    style={{ overflowX: 'auto', overflowY: 'hidden', height: '8px', width: '100%', marginBottom: '-10px', background: 'transparent' }}
                >
                    <div style={{ width: `${recordWidth}px`, height: '1px' }} />
                </div>

                <div 
                    ref={recordTableRef}
                    onScroll={handleRecordTableScroll}
                    className="table-container glass custom-scrollbar" 
                    style={{ padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', borderRadius: '16px' }}
                >
                    <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 20, background: '#f8fafc' }}>
                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 25 }}>
                                <th rowSpan="2" style={{ padding: '12px 16px', textAlign: 'left', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#334155', position: 'sticky', left: 0, top: 0, zIndex: 30, background: '#f8fafc' }}>Employee ID</th>
                                <th rowSpan="2" style={{ padding: '12px 16px', textAlign: 'left', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#334155', position: 'sticky', left: '100px', top: 0, zIndex: 30, background: '#f8fafc', minWidth: '120px' }}>Name</th>
                                <th rowSpan="2" style={{ padding: '12px 16px', textAlign: 'left', borderRight: '2px solid #cbd5e1', fontWeight: 600, color: '#334155', position: 'sticky', top: 0, zIndex: 25, background: '#f8fafc', minWidth: '100px' }}>Department</th>
                                {dateItems.map((item, idx) => {
                                    const isSunday = new Date(item.year, item.month, item.day).getDay() === 0;
                                    return (
                                        <th 
                                            key={`h-${item.dateStr}-${idx}`} 
                                            colSpan="2" 
                                            style={{ 
                                                padding: '8px 4px', 
                                                textAlign: 'center', 
                                                borderRight: '1px solid #e2e8f0', 
                                                fontWeight: 600, 
                                                color: isSunday ? '#991b1b' : '#334155', 
                                                position: 'sticky', 
                                                top: 0, 
                                                zIndex: 25, 
                                                background: isSunday ? '#fee2e2' : '#f8fafc', 
                                                minWidth: '100px' 
                                            }}
                                            title={isSunday ? 'Sunday' : `Date: ${item.dateStr}`}
                                        >
                                            <div>{item.label}</div>
                                            {isSunday && (
                                                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#991b1b', marginTop: '2px' }}>
                                                    Sunday
                                                </div>
                                            )}
                                        </th>
                                    );
                                })}
                            </tr>
                            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1', position: 'sticky', top: '44px', zIndex: 20 }}>
                                {dateItems.map((item, idx) => (
                                    <React.Fragment key={`io-${item.dateStr}-${idx}`}>
                                        <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#475569', fontSize: '0.75rem', minWidth: '50px', background: '#f1f5f9' }}>In</th>
                                        <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #cbd5e1', fontWeight: 600, color: '#475569', fontSize: '0.75rem', minWidth: '50px', background: '#f1f5f9' }}>Out</th>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {reportRows.length === 0 ? (
                                <tr>
                                    <td colSpan={3 + (dateItems.length * 2)} style={{ padding: '32px', textAlign: 'center', color: '#6b7280', fontSize: '0.9rem' }}>
                                        No attendance records found for the selected employee or date range.
                                    </td>
                                </tr>
                            ) : (
                                reportRows.map((row, idx) => (
                                    <tr key={row.empId} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>
                                        <td style={{ padding: '10px 16px', borderRight: '1px solid #e2e8f0', color: '#475569', position: 'sticky', left: 0, zIndex: 5, background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>{row.empId}</td>
                                        <td style={{ padding: '10px 16px', borderRight: '1px solid #e2e8f0', fontWeight: 500, color: '#1e293b', position: 'sticky', left: '100px', zIndex: 5, background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>{row.name}</td>
                                        <td style={{ padding: '10px 16px', borderRight: '2px solid #cbd5e1', color: '#64748b' }}>{row.dept}</td>
                                        {dateItems.map((item, dIdx) => {
                                            const targetDate = new Date(item.year, item.month, item.day);
                                            targetDate.setHours(0, 0, 0, 0);

                                            const empObj = row.rawEmp || row;
                                            const empWeeklyOffs = String(empObj.weeklyOffs || 'Sunday').toLowerCase();
                                            const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                                            const isSunday = targetDate.getDay() === 0 || empWeeklyOffs.includes(dayName);

                                            const holidayObj = getHolidayForEmp(item.dateStr, empObj);
                                            const isHoliday = Boolean(holidayObj);

                                            const record = row.dayRecords[item.dateStr] || { in: '', out: '' };
                                            const hasPunch = Boolean(
                                                (record.in && record.in !== '-' && record.in !== 'Leave') || 
                                                (record.out && record.out !== '-' && record.out !== 'Approved')
                                            );

                                            // 1. Worked on Sunday -> WOS
                                            if (isSunday && hasPunch) {
                                                return (
                                                    <td 
                                                        key={`c-${item.dateStr}-${dIdx}`}
                                                        colSpan="2"
                                                        style={{
                                                            padding: '4px 6px',
                                                            textAlign: 'center',
                                                            borderRight: '1px solid #cbd5e1',
                                                            background: '#fef3c7',
                                                            color: '#92400e'
                                                        }}
                                                        title={`Worked on Sunday (WOS): In: ${record.in || '--'} | Out: ${record.out || '--'}`}
                                                    >
                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#f59e0b', color: 'white', padding: '1px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>
                                                            WOS
                                                        </div>
                                                        <div style={{ fontSize: '0.68rem', color: '#b45309', fontWeight: 600, marginTop: '2px' }}>
                                                            {record.in || '--'} - {record.out || '--'}
                                                        </div>
                                                    </td>
                                                );
                                            }

                                            // 2. Off on Sunday -> Sunday
                                            if (isSunday && !hasPunch) {
                                                return (
                                                    <td 
                                                        key={`c-${item.dateStr}-${dIdx}`}
                                                        colSpan="2"
                                                        style={{
                                                            padding: '8px 4px',
                                                            textAlign: 'center',
                                                            borderRight: '1px solid #cbd5e1',
                                                            color: '#991b1b',
                                                            background: '#fee2e2',
                                                            fontWeight: 600,
                                                            fontSize: '0.75rem'
                                                        }}
                                                    >
                                                        Sunday
                                                    </td>
                                                );
                                            }

                                            // 3. Worked on Holiday -> WOH
                                            if (isHoliday && hasPunch) {
                                                return (
                                                    <td 
                                                        key={`c-${item.dateStr}-${dIdx}`}
                                                        colSpan="2"
                                                        style={{
                                                            padding: '4px 6px',
                                                            textAlign: 'center',
                                                            borderRight: '1px solid #cbd5e1',
                                                            background: '#ede9fe',
                                                            color: '#6b21a8'
                                                        }}
                                                        title={`Worked on Holiday (${holidayObj.name}) (WOH): In: ${record.in || '--'} | Out: ${record.out || '--'}`}
                                                    >
                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#7c3aed', color: 'white', padding: '1px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>
                                                            WOH
                                                        </div>
                                                        <div style={{ fontSize: '0.68rem', color: '#6b21a8', fontWeight: 600, marginTop: '2px' }}>
                                                            {record.in || '--'} - {record.out || '--'}
                                                        </div>
                                                    </td>
                                                );
                                            }

                                            // 4. Off on Holiday -> Holiday (no name needed)
                                            if (isHoliday && !hasPunch) {
                                                return (
                                                    <td 
                                                        key={`c-${item.dateStr}-${dIdx}`}
                                                        colSpan="2"
                                                        style={{
                                                            padding: '8px 4px',
                                                            textAlign: 'center',
                                                            borderRight: '1px solid #cbd5e1',
                                                            color: '#7e22ce',
                                                            background: '#f3e8ff',
                                                            fontWeight: 600,
                                                            fontSize: '0.75rem'
                                                        }}
                                                        title={holidayObj.name}
                                                    >
                                                        Holiday
                                                    </td>
                                                );
                                            }

                                            // 5. Regular Working Day / Approved Leave / Absent
                                            return (
                                                <React.Fragment key={`c-${item.dateStr}-${dIdx}`}>
                                                    <td 
                                                        style={{ 
                                                            padding: '8px 4px', 
                                                            textAlign: 'center', 
                                                            borderRight: '1px solid #e2e8f0',
                                                            color: record.in === 'Leave' ? '#3b82f6' : (record.in ? '#10b981' : '#cbd5e1'),
                                                            background: record.in === 'Leave' ? 'rgba(59, 130, 246, 0.05)' : (record.in ? 'rgba(16, 185, 129, 0.03)' : 'transparent'),
                                                            fontWeight: record.in ? 500 : 'normal'
                                                        }}
                                                    >
                                                        {record.in || '-'}
                                                    </td>
                                                    <td 
                                                        style={{ 
                                                            padding: '8px 4px', 
                                                            textAlign: 'center', 
                                                            borderRight: '1px solid #cbd5e1',
                                                            color: record.out === 'Approved' ? '#3b82f6' : (record.out ? '#ef4444' : '#cbd5e1'),
                                                            background: record.out === 'Approved' ? 'rgba(59, 130, 246, 0.05)' : (record.out ? 'rgba(239, 68, 68, 0.03)' : 'transparent'),
                                                            fontWeight: record.out ? 500 : 'normal'
                                                        }}
                                                    >
                                                        {record.out || '-'}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (activeSubView === 'abnormal-attendance') {
        const { year, month, days, startDate, endDate } = getReportDates();
        const monthName = new Date(year, month).toLocaleString('default', { month: 'long' });
        
        // Helper to parse time HH:MM into minutes from midnight
        const timeToMinutes = (timeStr) => {
            if (!timeStr) return null;
            
            let timeVal = String(timeStr);
            const timeRegex = /(\d+):(\d+):?(\d+)?\s*(AM|PM)?/i;
            const match = timeVal.match(timeRegex);
            if (!match) return null;
            
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const ampm = match[4] ? match[4].toUpperCase() : null;
            
            if (ampm === 'PM' && hours < 12) {
                hours += 12;
            } else if (ampm === 'AM' && hours === 12) {
                hours = 0;
            }
            return hours * 60 + minutes;
        };

        const shiftStartMin = 9 * 60; // 09:00 -> 540 min
        const shiftEndMin = 18 * 60; // 18:00 -> 1080 min
        const totalShiftDuration = 540; // 9 hours -> 540 min

        // Generate day-by-day rows for the selected date range for all employees
        const reportRows = [];
        const activeEmployeesForPeriod = employees.filter(emp => isEmpActiveForPeriod(emp, startDate, endDate));
        activeEmployeesForPeriod.forEach((emp, empIdx) => {
            const empId = getEmpId(emp, empIdx);
            const dept = emp.department || 'Company';

            days.forEach(day => {
                const targetDayDate = new Date(year, month, day);
                targetDayDate.setHours(0, 0, 0, 0);
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);
                if (targetDayDate.getTime() > todayMidnight.getTime()) return;
                if (!isEmpActiveOnDate(emp, targetDayDate)) return;
                // Filter logs for this employee on this specific day
                const dayLogs = attendance.filter(r => {
                    if (r.userName && r.userName.toLowerCase() === emp.name.toLowerCase()) {
                        const rDate = new Date(r.date);
                        if (!isNaN(rDate.getTime())) {
                            return rDate.getFullYear() === year && rDate.getMonth() === month && rDate.getDate() === day;
                        }
                    }
                    return false;
                }).sort((a, b) => {
                    const aMin = timeToMinutes(a.checkIn) || 0;
                    const bMin = timeToMinutes(b.checkIn) || 0;
                    return aMin - bMin;
                });

                const dateString = `${year}/${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`;

                // Check if employee is on approved leave on this day
                const onApprovedLeave = leaves.some(leave => {
                    if (leave.userId !== emp.id || leave.status !== 'approved') return false;
                    const start = new Date(leave.startDate);
                    const end = new Date(leave.endDate);
                    const current = new Date(year, month, day);
                    start.setHours(0, 0, 0, 0);
                    end.setHours(23, 59, 59, 999);
                    current.setHours(12, 0, 0, 0);
                    return current >= start && current <= end;
                });

                let punches = {
                    firstOn: null, firstOff: null,
                    secondOn: null, secondOff: null,
                    thirdOn: null, thirdOff: null,
                    overBegin: null, overEnd: null,
                    lateTime: 0,
                    leaveTime: 0,
                    desTime: onApprovedLeave ? 0 : totalShiftDuration,
                    totalTime: onApprovedLeave ? 0 : totalShiftDuration,
                    overtime: 0,
                    remarks: onApprovedLeave ? 'On Leave' : (isHolidayForEmp(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, emp) ? 'Holiday' : (String(emp.weeklyOffs || 'Sunday').toLowerCase().includes(new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()) ? 'Weekly Off' : 'Absent'))
                };

                if (dayLogs.length > 0) {
                    punches.desTime = 0; // Present for at least part of the day
                    punches.remarks = '';

                    // Map punch pairs chronologically
                    if (dayLogs[0]) {
                        punches.firstOn = dayLogs[0].checkIn || null;
                        punches.firstOff = dayLogs[0].checkOut || null;
                    }
                    if (dayLogs[1]) {
                        punches.secondOn = dayLogs[1].checkIn || null;
                        punches.secondOff = dayLogs[1].checkOut || null;
                    }
                    if (dayLogs[2]) {
                        punches.thirdOn = dayLogs[2].checkIn || null;
                        punches.thirdOff = dayLogs[2].checkOut || null;
                    }
                    if (dayLogs[3]) {
                        punches.overBegin = dayLogs[3].checkIn || null;
                        punches.overEnd = dayLogs[3].checkOut || null;
                    }

                    // 1. Calculate Late Time (Minutes)
                    if (punches.firstOn) {
                        const firstOnMin = timeToMinutes(punches.firstOn);
                        if (firstOnMin !== null && firstOnMin > shiftStartMin) {
                            punches.lateTime = firstOnMin - shiftStartMin;
                        }
                    }

                    // 2. Calculate Leave Time (Minutes)
                    let lastOff = null;
                    if (punches.overEnd) lastOff = punches.overEnd;
                    else if (punches.thirdOff) lastOff = punches.thirdOff;
                    else if (punches.secondOff) lastOff = punches.secondOff;
                    else if (punches.firstOff) lastOff = punches.firstOff;

                    if (lastOff) {
                        const lastOffMin = timeToMinutes(lastOff);
                        if (lastOffMin !== null && lastOffMin < shiftEndMin) {
                            punches.leaveTime = shiftEndMin - lastOffMin;
                        }
                    } else {
                        punches.leaveTime = 0;
                    }

                    // 3. Calculate Overtime (Minutes)
                    if (punches.overBegin && punches.overEnd) {
                        const overBeginMin = timeToMinutes(punches.overBegin);
                        const overEndMin = timeToMinutes(punches.overEnd);
                        if (overBeginMin !== null && overEndMin !== null && overEndMin > overBeginMin) {
                            punches.overtime = overEndMin - overBeginMin;
                        }
                    }

                    // 4. Calculate Total Time (Minutes)
                    punches.totalTime = punches.lateTime + punches.leaveTime + punches.desTime;

                    // Set remarks based on anomalies
                    const remarksList = [];
                    if (onApprovedLeave) remarksList.push('On Leave');
                    if (punches.lateTime > 0) remarksList.push(`Late ${punches.lateTime}m`);
                    if (punches.leaveTime > 0) remarksList.push(`Early Leave ${punches.leaveTime}m`);
                    if (punches.overtime > 0) remarksList.push(`OT ${punches.overtime}m`);
                    punches.remarks = remarksList.join(', ') || 'Normal';
                }

                reportRows.push({
                    empId,
                    name: emp.name,
                    dept,
                    date: dateString,
                    ...punches
                });
            });
        });

        const handleDownloadExcel = () => {
            const headers = [
                'Employee ID', 'Name', 'Department', 'Date',
                '1st On', '1st Off', '2nd On', '2nd Off', '3rd On', '3rd Off', 'Over Begin', 'Over End',
                'Late Time (min)', 'Leave Time (min)', 'Des Time (min)', 'Total time (min)', 'Remarks'
            ];

            const rows = reportRows.map(row => [
                row.empId,
                row.name,
                row.dept,
                row.date,
                formatTo12HourTime(row.firstOn),
                formatTo12HourTime(row.firstOff),
                formatTo12HourTime(row.secondOn),
                formatTo12HourTime(row.secondOff),
                formatTo12HourTime(row.thirdOn),
                formatTo12HourTime(row.thirdOff),
                formatTo12HourTime(row.overBegin),
                formatTo12HourTime(row.overEnd),
                row.lateTime,
                row.leaveTime,
                row.desTime,
                row.totalTime,
                row.remarks
            ]);

            exportToCSV(`Abnormal_Attendance_Report_${monthName}_${year}.csv`, headers, rows);
        };

        const formatTimeDisplay = (timeVal) => {
            return formatTo12HourTime(timeVal) || '-';
        };

        return (
            <div id="attendance-abnormal-view" className="view active" style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
                <div className="glass" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                    <div>
                        <button 
                            className="btn btn-outline" 
                            onClick={() => setActiveSubView('logs')}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}
                        >
                            <i className="fa-solid fa-arrow-left"></i> Back to Logs
                        </button>
                        <h2>Abnormal Attendance Report</h2>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                            Created Time: {new Date().toLocaleString()} | Range: {monthName} {year}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <select
                            value={customMonth ? customMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0')}
                            onChange={(e) => {
                                const currentYear = customMonth ? customMonth.split('-')[0] : String(new Date().getFullYear());
                                setCustomMonth(`${currentYear}-${e.target.value}`);
                            }}
                            style={{
                                padding: '8px 12px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-glass)',
                                backgroundColor: 'var(--input-bg)',
                                color: 'var(--text-primary)',
                                fontSize: '0.9rem',
                                cursor: 'pointer'
                            }}
                        >
                            <option value="01">January</option>
                            <option value="02">February</option>
                            <option value="03">March</option>
                            <option value="04">April</option>
                            <option value="05">May</option>
                            <option value="06">June</option>
                            <option value="07">July</option>
                            <option value="08">August</option>
                            <option value="09">September</option>
                            <option value="10">October</option>
                            <option value="11">November</option>
                            <option value="12">December</option>
                        </select>
                        <select
                            value={customMonth ? customMonth.split('-')[0] : String(new Date().getFullYear())}
                            onChange={(e) => {
                                const currentMonth = customMonth ? customMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0');
                                setCustomMonth(`${e.target.value}-${currentMonth}`);
                            }}
                            style={{
                                padding: '8px 12px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-glass)',
                                backgroundColor: 'var(--input-bg)',
                                color: 'var(--text-primary)',
                                fontSize: '0.9rem',
                                cursor: 'pointer'
                            }}
                        >
                            {Array.from({ length: 51 }, (_, i) => 1990 + i).map(yearOpt => (
                                <option key={yearOpt} value={String(yearOpt)}>{yearOpt}</option>
                            ))}
                        </select>
                        <button className="btn btn-primary" onClick={handleDownloadExcel}>
                            <i className="fa-solid fa-file-excel"></i> Export Excel
                        </button>
                    </div>
                </div>

                {/* Dummy Top Scrollbar */}
                <div 
                    ref={abnormalTopScrollRef}
                    onScroll={handleAbnormalTopScroll}
                    style={{ overflowX: 'auto', overflowY: 'hidden', height: '8px', width: '100%', marginBottom: '-10px', background: 'transparent' }}
                >
                    <div style={{ width: `${abnormalWidth}px`, height: '1px' }} />
                </div>

                <div 
                    ref={abnormalTableRef}
                    onScroll={handleAbnormalTableScroll}
                    className="table-container glass custom-scrollbar" 
                    style={{ padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', borderRadius: '16px' }}
                >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: '1500px' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#ebf5ff' }}>
                                <th rowSpan="2" style={{ padding: '12px 8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Employee ID</th>
                                <th rowSpan="2" style={{ padding: '12px 8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Name</th>
                                <th rowSpan="2" style={{ padding: '12px 8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Department</th>
                                <th rowSpan="2" style={{ padding: '12px 8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Date</th>
                                <th colSpan="2" style={{ padding: '8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>The first</th>
                                <th colSpan="2" style={{ padding: '8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>The second</th>
                                <th colSpan="2" style={{ padding: '8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>The third</th>
                                <th colSpan="2" style={{ padding: '8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>The Over</th>
                                <th rowSpan="2" style={{ padding: '12px 8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Late Time(min)</th>
                                <th rowSpan="2" style={{ padding: '12px 8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Leave Time(min)</th>
                                <th rowSpan="2" style={{ padding: '12px 8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Des Time(min)</th>
                                <th rowSpan="2" style={{ padding: '12px 8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Total time(min)</th>
                                <th rowSpan="2" style={{ padding: '12px 8px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Remarks</th>
                            </tr>
                            <tr style={{ backgroundColor: '#ebf5ff' }}>
                                <th style={{ padding: '6px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>On</th>
                                <th style={{ padding: '6px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Off</th>
                                <th style={{ padding: '6px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>On</th>
                                <th style={{ padding: '6px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Off</th>
                                <th style={{ padding: '6px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>On</th>
                                <th style={{ padding: '6px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Off</th>
                                <th style={{ padding: '6px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>Begin</th>
                                <th style={{ padding: '6px', border: '1px solid #cbd5e1', color: '#1e3a8a', textAlign: 'center' }}>End</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reportRows.map((row, rIdx) => (
                                <tr key={rIdx} style={{ backgroundColor: rIdx % 2 === 0 ? 'white' : '#f8fafc' }}>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 600 }}>{row.empId}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', fontWeight: 500 }}>{row.name}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0' }}>{row.dept}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{row.date}</td>
                                    
                                    {/* The first */}
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{formatTimeDisplay(row.firstOn)}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{formatTimeDisplay(row.firstOff)}</td>
                                    
                                    {/* The second */}
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{formatTimeDisplay(row.secondOn)}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{formatTimeDisplay(row.secondOff)}</td>
                                    
                                    {/* The third */}
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{formatTimeDisplay(row.thirdOn)}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{formatTimeDisplay(row.thirdOff)}</td>
                                    
                                    {/* The Over */}
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{formatTimeDisplay(row.overBegin)}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{formatTimeDisplay(row.overEnd)}</td>
                                    
                                    {/* Calculated Metrics */}
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center', color: row.lateTime > 0 ? '#ef4444' : '#1e293b', fontWeight: row.lateTime > 0 ? 600 : 400 }}>{row.lateTime}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center', color: row.leaveTime > 0 ? '#ef4444' : '#1e293b', fontWeight: row.leaveTime > 0 ? 600 : 400 }}>{row.leaveTime}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center', color: row.desTime > 0 ? '#ef4444' : '#1e293b', fontWeight: row.desTime > 0 ? 600 : 400 }}>{row.desTime}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 600 }}>{row.totalTime}</td>
                                    <td style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                                        <span style={{ 
                                            padding: '2px 8px', 
                                            borderRadius: '6px', 
                                            fontSize: '0.75rem', 
                                            fontWeight: 600,
                                            backgroundColor: row.remarks === 'Absent' ? '#fee2e2' : row.remarks === 'Normal' ? '#d1fae5' : '#fef3c7',
                                            color: row.remarks === 'Absent' ? '#ef4444' : row.remarks === 'Normal' ? '#10b981' : '#d97706'
                                        }}>
                                            {row.remarks}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (activeSubView === 'attendance-card') {
        const { year, month, days, startDate, endDate } = getReportDates();
        const monthName = new Date(year, month).toLocaleString('default', { month: 'long' });
        const dateRangeStr = `${year}/${String(month + 1).padStart(2, '0')}/01-${year}/${String(month + 1).padStart(2, '0')}/${String(days.length).padStart(2, '0')}`;

        // Helper to parse time HH:MM into minutes from midnight
        const timeToMinutes = (timeStr) => {
            if (!timeStr) return null;
            let timeVal = String(timeStr);
            const timeRegex = /(\d+):(\d+):?(\d+)?\s*(AM|PM)?/i;
            const match = timeVal.match(timeRegex);
            if (!match) return null;
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const ampm = match[4] ? match[4].toUpperCase() : null;
            if (ampm === 'PM' && hours < 12) hours += 12;
            else if (ampm === 'AM' && hours === 12) hours = 0;
            return hours * 60 + minutes;
        };

        const shiftStartMin = 9 * 60; // 09:00 -> 540 min
        const shiftEndMin = 18 * 60; // 18:00 -> 1080 min

        // Filter employees based on period activity and search query (if any)
        let displayEmployees = employees.filter(emp => isEmpActiveForPeriod(emp, startDate, endDate));
        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase();
            displayEmployees = displayEmployees.filter(emp => emp.name.toLowerCase().includes(query));
        }

        const reportCards = displayEmployees.map((emp, empIdx) => {
            const empId = getEmpId(emp, empIdx);
            const dept = emp.department || 'Company';

            let absentDays = 0;
            let attendanceDays = 0;
            let totalLateTimes = 0;
            let totalLateMins = 0;
            let totalLeaveEarlyTimes = 0;
            let totalLeaveEarlyMins = 0;
            let totalOvertimeMins = 0;

            const dayRecords = days.map(day => {
                const date = new Date(year, month, day);
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }) + '.';

                const dayLogs = attendance.filter(r => {
                    if (r.userName && r.userName.toLowerCase() === emp.name.toLowerCase()) {
                        const rDate = new Date(r.date);
                        if (!isNaN(rDate.getTime())) {
                            return rDate.getFullYear() === year && rDate.getMonth() === month && rDate.getDate() === day;
                        }
                    }
                    return false;
                }).sort((a, b) => {
                    const aMin = timeToMinutes(a.checkIn) || 0;
                    const bMin = timeToMinutes(b.checkIn) || 0;
                    return aMin - bMin;
                });

                let punches = { firstOn: '', firstOff: '', secondOn: '', secondOff: '', thirdOn: '', thirdOff: '', overBegin: '', overEnd: '' };
                
                if (dayLogs.length > 0) {
                    attendanceDays++;
                    if (dayLogs[0]) { punches.firstOn = dayLogs[0].checkIn || ''; punches.firstOff = dayLogs[0].checkOut || ''; }
                    if (dayLogs[1]) { punches.secondOn = dayLogs[1].checkIn || ''; punches.secondOff = dayLogs[1].checkOut || ''; }
                    if (dayLogs[2]) { punches.thirdOn = dayLogs[2].checkIn || ''; punches.thirdOff = dayLogs[2].checkOut || ''; }
                    if (dayLogs[3]) { punches.overBegin = dayLogs[3].checkIn || ''; punches.overEnd = dayLogs[3].checkOut || ''; }

                    if (punches.firstOn) {
                        const firstOnMin = timeToMinutes(punches.firstOn);
                        if (firstOnMin !== null && firstOnMin > shiftStartMin) {
                            totalLateTimes++;
                            totalLateMins += (firstOnMin - shiftStartMin);
                        }
                    }

                    let lastOff = null;
                    if (punches.overEnd) lastOff = punches.overEnd;
                    else if (punches.thirdOff) lastOff = punches.thirdOff;
                    else if (punches.secondOff) lastOff = punches.secondOff;
                    else if (punches.firstOff) lastOff = punches.firstOff;

                    if (lastOff) {
                        const lastOffMin = timeToMinutes(lastOff);
                        if (lastOffMin !== null && lastOffMin < shiftEndMin) {
                            totalLeaveEarlyTimes++;
                            totalLeaveEarlyMins += (shiftEndMin - lastOffMin);
                        }
                    }

                    if (punches.overBegin && punches.overEnd) {
                        const overBeginMin = timeToMinutes(punches.overBegin);
                        const overEndMin = timeToMinutes(punches.overEnd);
                        if (overBeginMin !== null && overEndMin !== null && overEndMin > overBeginMin) {
                            totalOvertimeMins += (overEndMin - overBeginMin);
                        }
                    }
                } else {
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    if (date < today) {
                        const isWeeklyOff = String(emp.weeklyOffs || 'Sunday').toLowerCase().includes(date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase());
                        const targetDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const isHoliday = isHolidayForEmp(targetDateStr, emp);
                        if (!isWeeklyOff && !isHoliday && isEmpActiveOnDate(emp, date)) absentDays++;
                    }
                }

                const formatTimeDisplay = (timeVal) => {
                    return formatTo12HourTime(timeVal);
                };

                return {
                    day, dayName,
                    firstOn: formatTimeDisplay(punches.firstOn), firstOff: formatTimeDisplay(punches.firstOff),
                    secondOn: formatTimeDisplay(punches.secondOn), secondOff: formatTimeDisplay(punches.secondOff),
                    thirdOn: formatTimeDisplay(punches.thirdOn), thirdOff: formatTimeDisplay(punches.thirdOff),
                    overBegin: formatTimeDisplay(punches.overBegin), overEnd: formatTimeDisplay(punches.overEnd)
                };
            });

            return {
                empId, name: emp.name, dept, dateRangeStr,
                absentDays, casualDays: 0, onBusinessDays: 0, attendanceDays,
                overNormal: `${Math.floor(totalOvertimeMins / 60)}:${String(totalOvertimeMins % 60).padStart(2, '0')}`,
                overSpecial: '0:00',
                lateTimes: totalLateTimes, lateMins: totalLateMins,
                leaveEarlyTimes: totalLeaveEarlyTimes, leaveEarlyMins: totalLeaveEarlyMins,
                dayRecords
            };
        });

        const handleDownloadPDF = async () => {
            const container = document.getElementById('attendance-cards-container');
            if (!container) return;
            const cards = container.children;
            if (cards.length === 0) return;
            
            try {
                // Dynamic imports â€” only download when user clicks PDF export
                const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
                    import('jspdf'),
                    import('html2canvas')
                ]);

                const pdf = new jsPDF({
                    orientation: 'landscape',
                    unit: 'pt',
                    format: 'a4'
                });
                
                for (let i = 0; i < cards.length; i++) {
                    const card = cards[i];
                    const canvas = await html2canvas(card, { scale: 1.5 });
                    const imgData = canvas.toDataURL('image/png');
                    
                    if (i > 0) {
                        pdf.addPage();
                    }
                    
                    const pdfWidth = pdf.internal.pageSize.getWidth();
                    const pdfHeight = pdf.internal.pageSize.getHeight();
                    const imgProps = pdf.getImageProperties(imgData);
                    const ratio = Math.min((pdfWidth - 40) / imgProps.width, (pdfHeight - 40) / imgProps.height); // Added 40pt margin padding
                    const width = imgProps.width * ratio;
                    const height = imgProps.height * ratio;
                    
                    const x = (pdfWidth - width) / 2;
                    const y = (pdfHeight - height) / 2;
                    
                    pdf.addImage(imgData, 'PNG', x, y, width, height);
                }
                pdf.save(`Attendance_Card_${monthName}_${year}.pdf`);
            } catch (err) {
                console.error("Failed to generate PDF", err);
                alert("Failed to generate PDF");
            }
        };

        const handleDownloadExcel = async () => {
            // Dynamic import â€” xlsx only downloads when user clicks Export Excel
            const XLSX = await import('xlsx');
            const wb = XLSX.utils.book_new();
            reportCards.forEach(card => {
                const wsData = [
                    ['Dept', card.dept, 'Company', '', 'Name', card.name],
                    ['Date', card.dateRangeStr, 'ID', card.empId],
                    ['Absent (Days)', 'Casual (Days)', 'On business (Days)', 'Attendance (Days)', 'Over(hours)', '', 'Late', '', 'Leave Early', ''],
                    ['', '', '', '', 'Normal', 'Special', '(times)', '(mins)', '(times)', '(mins)'],
                    [card.absentDays, card.casualDays, card.onBusinessDays, card.attendanceDays, card.overNormal, card.overSpecial, card.lateTimes, card.lateMins, card.leaveEarlyTimes, card.leaveEarlyMins],
                    [],
                    ['Date', 'Week', 'Attendance Info', '', '', '', '', '', '', ''],
                    ['', '', 'First', '', 'Second', '', 'Third', '', 'Over', ''],
                    ['', '', 'On', 'Off', 'On', 'Off', 'On', 'Off', 'In', 'Out']
                ];
                card.dayRecords.forEach(r => {
                    wsData.push([r.day, r.dayName, r.firstOn, r.firstOff, r.secondOn, r.secondOff, r.thirdOn, r.thirdOff, r.overBegin, r.overEnd]);
                });
                const ws = XLSX.utils.aoa_to_sheet(wsData);
                let sheetName = card.name.substring(0, 31).replace(/[\\/?*[\]]/g, '');
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            });
            XLSX.writeFile(wb, `Attendance_Card_${monthName}_${year}.xlsx`);
        };

        return (
            <div id="attendance-card-view" className="view active" style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
                <div className="glass" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <button className="btn btn-outline" onClick={() => setActiveSubView('logs')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', background: '#f3f4f6', border: '1px solid #d1d5db', cursor: 'pointer', borderRadius: '6px' }} title="Back to Logs">
                            <i className="fa-solid fa-arrow-left"></i>
                        </button>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Attendance Card</h2>
                            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>Period: {monthName} {year}</span>
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2px', background: 'white' }}>
                            <button className="btn" onClick={() => setReportPeriod('last-month')} style={{ border: 'none', borderRadius: '6px', padding: '8px 16px', background: 'transparent', color: reportPeriod === 'last-month' ? '#991b1b' : '#4b5563', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', borderBottom: reportPeriod === 'last-month' ? '2px solid #ef4444' : 'none' }}>Last Month</button>
                            <button className="btn" onClick={() => setReportPeriod('current-month')} style={{ border: 'none', borderRadius: '6px', padding: '8px 16px', background: 'transparent', color: reportPeriod === 'current-month' ? '#991b1b' : '#4b5563', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', borderBottom: reportPeriod === 'current-month' ? '2px solid #ef4444' : 'none' }}>Current Month</button>
                            <button className="btn" onClick={() => setReportPeriod('custom')} style={{ border: 'none', borderRadius: '6px', padding: '8px 16px', background: 'transparent', color: reportPeriod === 'custom' ? '#991b1b' : '#4b5563', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', borderBottom: reportPeriod === 'custom' ? '2px solid #ef4444' : 'none' }}>Custom</button>
                        </div>

                        {reportPeriod === 'custom' && (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <select value={customMonth ? customMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0')} onChange={(e) => { const currentYear = customMonth ? customMonth.split('-')[0] : String(new Date().getFullYear()); setCustomMonth(`${currentYear}-${e.target.value}`); }} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-glass)', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', height: '34px', cursor: 'pointer' }}>
                                    <option value="01">January</option><option value="02">February</option><option value="03">March</option><option value="04">April</option><option value="05">May</option><option value="06">June</option><option value="07">July</option><option value="08">August</option><option value="09">September</option><option value="10">October</option><option value="11">November</option><option value="12">December</option>
                                </select>
                                <select value={customMonth ? customMonth.split('-')[0] : String(new Date().getFullYear())} onChange={(e) => { const currentMonth = customMonth ? customMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0'); setCustomMonth(`${e.target.value}-${currentMonth}`); }} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-glass)', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', height: '34px', cursor: 'pointer' }}>
                                    {Array.from({ length: 51 }, (_, i) => 1990 + i).map(year => <option key={year} value={String(year)}>{year}</option>)}
                                </select>
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input type="text" placeholder="Search by name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-glass)', outline: 'none' }} />
                            <button className="btn btn-primary" onClick={handleDownloadPDF} style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '8px' }}><i className="fa-solid fa-file-pdf"></i> PDF</button>
                            <button className="btn btn-primary" onClick={handleDownloadExcel} style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '8px', background: '#10b981' }}><i className="fa-solid fa-file-excel"></i> Excel</button>
                        </div>
                    </div>
                </div>

                <div id="attendance-cards-container" className="custom-scrollbar" style={{ padding: '15px', flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '20px', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                    {reportCards.map(card => (
                        <div key={card.empId} style={{ minWidth: '540px', flex: '1 1 540px', border: '1px solid #000', backgroundColor: 'white', color: 'black', fontFamily: 'sans-serif', fontSize: '0.75rem' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                                <tbody>
                                    <tr>
                                        <td style={{ border: '1px solid #000', padding: '4px', fontWeight: 'bold' }}>Dept</td>
                                        <td colSpan="3" style={{ border: '1px solid #000', padding: '4px' }}>Company</td>
                                        <td colSpan="2" style={{ border: '1px solid #000', padding: '4px', fontWeight: 'bold' }}>Name</td>
                                        <td colSpan="4" style={{ border: '1px solid #000', padding: '4px' }}>{card.name}</td>
                                    </tr>
                                    <tr>
                                        <td style={{ border: '1px solid #000', padding: '4px', fontWeight: 'bold' }}>Date</td>
                                        <td colSpan="5" style={{ border: '1px solid #000', padding: '4px' }}>{card.dateRangeStr}</td>
                                        <td colSpan="1" style={{ border: '1px solid #000', padding: '4px', fontWeight: 'bold' }}>ID</td>
                                        <td colSpan="3" style={{ border: '1px solid #000', padding: '4px' }}>{card.empId}</td>
                                    </tr>
                                    <tr style={{ fontWeight: 'bold', fontSize: '0.65rem' }}>
                                        <td rowSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>Absent<br/>(Days)</td>
                                        <td rowSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>Casual<br/>(Days)</td>
                                        <td rowSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>On<br/>business<br/>(Days)</td>
                                        <td rowSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>Attenda<br/>nce<br/>(Days)</td>
                                        <td colSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>Over(hours)</td>
                                        <td colSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>Late</td>
                                        <td colSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>Leave Early</td>
                                    </tr>
                                    <tr style={{ fontWeight: 'bold', fontSize: '0.65rem' }}>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>Normal</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>Special</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>(times)</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>(mins)</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>(times)</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>(mins)</td>
                                    </tr>
                                    <tr>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.absentDays}</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.casualDays}</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.onBusinessDays}</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.attendanceDays}</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.overNormal}</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.overSpecial}</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.lateTimes}</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.lateMins}</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.leaveEarlyTimes}</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>{card.leaveEarlyMins}</td>
                                    </tr>
                                    <tr><td colSpan="10" style={{ height: '8px', border: 'none' }}></td></tr>
                                    <tr style={{ fontWeight: 'bold', fontSize: '0.65rem' }}>
                                        <td rowSpan="3" style={{ border: '1px solid #000', padding: '4px', width: '25px' }}>Date</td>
                                        <td rowSpan="3" style={{ border: '1px solid #000', padding: '4px', width: '35px' }}>Week</td>
                                        <td colSpan="8" style={{ border: '1px solid #000', padding: '4px' }}>Attendance Info</td>
                                    </tr>
                                    <tr style={{ fontWeight: 'bold', fontSize: '0.65rem' }}>
                                        <td colSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>First</td>
                                        <td colSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>Second</td>
                                        <td colSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>Third</td>
                                        <td colSpan="2" style={{ border: '1px solid #000', padding: '4px' }}>Over</td>
                                    </tr>
                                    <tr style={{ fontWeight: 'bold', fontSize: '0.65rem' }}>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>On</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>Off</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>On</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>Off</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>On</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>Off</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>In</td>
                                        <td style={{ border: '1px solid #000', padding: '4px' }}>Out</td>
                                    </tr>
                                    {card.dayRecords.map(r => (
                                        <tr key={r.day} style={{ fontSize: '0.65rem' }}>
                                            <td style={{ border: '1px solid #000', padding: '2px' }}>{r.day}</td>
                                            <td style={{ border: '1px solid #000', padding: '2px' }}>{r.dayName}</td>
                                            <td style={{ border: '1px solid #000', padding: '2px', color: '#c0392b' }}>{r.firstOn || '-:-'}</td>
                                            <td style={{ border: '1px solid #000', padding: '2px', color: '#c0392b' }}>{r.firstOff || '-:-'}</td>
                                            <td style={{ border: '1px solid #000', padding: '2px' }}>{r.secondOn}</td>
                                            <td style={{ border: '1px solid #000', padding: '2px' }}>{r.secondOff}</td>
                                            <td style={{ border: '1px solid #000', padding: '2px' }}>{r.thirdOn}</td>
                                            <td style={{ border: '1px solid #000', padding: '2px' }}>{r.thirdOff}</td>
                                            <td style={{ border: '1px solid #000', padding: '2px' }}>{r.overBegin}</td>
                                            <td style={{ border: '1px solid #000', padding: '2px' }}>{r.overEnd}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div id="attendance-view" className="view active" style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>

            {/* Top Toolbar: Filters & Search */}
            <div style={{ position: 'relative', overflow: 'visible', flexShrink: 0, zIndex: 9000 }}>
                <div className="glass" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}></div>
                <div style={{ position: 'relative', zIndex: 9000, padding: '20px', display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <button 
                            className={`btn ${statusFilter === 'all' ? 'btn-primary' : ''}`} 
                            onClick={() => setStatusFilter('all')}
                            style={{ height: '38px', display: 'inline-flex', alignItems: 'center', background: statusFilter !== 'all' ? '#f3f4f6' : undefined, color: statusFilter !== 'all' ? '#374151' : undefined }}
                        >
                            All Logs
                        </button>
                        <button 
                            className={`btn ${statusFilter === 'not-clocked-in' ? 'btn-primary' : ''}`} 
                            onClick={() => setStatusFilter('not-clocked-in')}
                            style={{ height: '38px', display: 'inline-flex', alignItems: 'center', background: statusFilter !== 'not-clocked-in' ? '#ef4444' : undefined, color: 'white' }}
                            title="Employees who haven't checked-in today"
                        >
                            Not Clocked-In (Today)
                        </button>
                        <button 
                            className={`btn ${statusFilter === 'clocked-out' ? 'btn-primary' : ''}`} 
                            onClick={() => setStatusFilter('clocked-out')}
                            style={{ height: '38px', display: 'inline-flex', alignItems: 'center', background: statusFilter !== 'clocked-out' ? '#10b981' : undefined, color: 'white' }}
                            title="Employees who checked-out today"
                        >
                            Clocked-Out (Today)
                        </button>
                        <button 
                            className={`btn ${statusFilter === 'active-today' ? 'btn-primary' : ''}`} 
                            onClick={() => setStatusFilter('active-today')}
                            style={{ height: '38px', display: 'inline-flex', alignItems: 'center', background: statusFilter !== 'active-today' ? '#f59e0b' : undefined, color: 'white' }}
                            title="Employees currently clocked-in"
                        >
                            Active / Clocked-In (Today)
                        </button>

                        {/* Attendance Report Dropdown */}
                        <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block', zIndex: 9999 }}>
                            <button 
                                className="btn" 
                                onClick={() => setShowReportDropdown(prev => !prev)}
                                style={{ 
                                    background: 'linear-gradient(135deg, #4f46e5, #3730a3)', 
                                    color: 'white',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontWeight: 600,
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    height: '38px',
                                    boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.2)'
                                }}
                            >
                                <i className="fa-solid fa-file-invoice"></i>
                                <span>Attendance Report</span>
                                <i className={`fa-solid fa-chevron-${showReportDropdown ? 'up' : 'down'}`} style={{ fontSize: '0.8rem' }}></i>
                            </button>
                            {showReportDropdown && (
                                <div style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 8px)',
                                    left: 0,
                                    zIndex: 99999,
                                    minWidth: '260px',
                                    width: 'max-content',
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '10px',
                                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                                    padding: '8px 0',
                                    backdropFilter: 'blur(16px)'
                                }}>
                                    {reportOptions.map((opt) => (
                                        <button
                                            key={opt.value}
                                            onClick={() => {
                                                if (opt.value === 'attendance-record') {
                                                    setActiveSubView('attendance-record');
                                                } else if (opt.value === 'attendance-summary') {
                                                    setActiveSubView('attendance-summary');
                                                } else if (opt.value === 'abnormal-attendance') {
                                                    setActiveSubView('abnormal-attendance');
                                                } else if (opt.value === 'attendance-card') {
                                                    setActiveSubView('attendance-card');
                                                } else {
                                                    alert(`Opening ${opt.label}...`);
                                                }
                                                setShowReportDropdown(false);
                                            }}
                                            style={{
                                                width: '100%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                padding: '10px 18px',
                                                border: 'none',
                                                background: 'transparent',
                                                color: '#1e293b',
                                                textAlign: 'left',
                                                cursor: 'pointer',
                                                fontSize: '0.88rem',
                                                fontWeight: 500,
                                                lineHeight: '1.4',
                                                whiteSpace: 'nowrap',
                                                boxSizing: 'border-box',
                                                height: 'auto',
                                                minHeight: '40px',
                                                transition: 'all 0.15s ease'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <i className={`fa-solid ${opt.icon}`} style={{ color: '#4f46e5', width: '18px', textAlign: 'center', flexShrink: 0, fontSize: '0.95rem' }}></i>
                                            <span style={{ whiteSpace: 'nowrap', flex: 1 }}>{opt.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', lineHeight: 1 }}>From Date</span>
                            <input 
                                type="date" 
                                value={fromDate} 
                                onChange={(e) => setFromDate(e.target.value)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #e5e7eb',
                                    fontSize: '0.875rem',
                                    outline: 'none',
                                    height: '38px',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', lineHeight: 1 }}>To Date</span>
                            <input 
                                type="date" 
                                value={toDate} 
                                onChange={(e) => setToDate(e.target.value)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #e5e7eb',
                                    fontSize: '0.875rem',
                                    outline: 'none',
                                    height: '38px',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                        {(fromDate || toDate) && (
                            <button 
                                className="btn"
                                onClick={() => { setFromDate(''); setToDate(''); }}
                                style={{ 
                                    height: '38px', 
                                    background: '#ef4444', 
                                    color: 'white', 
                                    padding: '0 14px', 
                                    borderRadius: '6px', 
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center'
                                }}
                            >
                                Clear Range
                            </button>
                        )}

                        <div className="form-group" style={{ margin: 0, minWidth: '280px' }}>
                            <input 
                                type="text" 
                                placeholder="Search by Employee Name..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '8px 14px',
                                    borderRadius: '6px',
                                    border: '1px solid #e5e7eb',
                                    fontSize: '0.875rem',
                                    outline: 'none',
                                    height: '38px',
                                    boxSizing: 'border-box',
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Table Container */}
            <div 
                ref={logsTableRef}
                onScroll={handleLogsTableScroll}
                className="table-container glass custom-scrollbar" 
                style={{ padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', borderRadius: '16px' }}
            >
                <table id="attendance-table">
                    <thead>
                        <tr>
                            {statusFilter !== 'not-clocked-in' && <th>Date</th>}
                            <th>Employee</th>
                            {statusFilter !== 'not-clocked-in' && <th>Check In</th>}
                            {statusFilter !== 'not-clocked-in' && <th>Check Out</th>}
                            {statusFilter !== 'not-clocked-in' && <th>Total Working Hour</th>}
                            {statusFilter !== 'not-clocked-in' && <th>Punch Count</th>}
                            {statusFilter !== 'not-clocked-in' && <th>Last Location & Time</th>}
                            {statusFilter !== 'not-clocked-in' && <th>Battery Info</th>}
                            {statusFilter !== 'not-clocked-in' && <th>Today Travel</th>}
                            {statusFilter === 'not-clocked-in' && <th>Status</th>}
                            {statusFilter === 'not-clocked-in' && <th>Reason</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="8" style={{ padding: "40px 0" }}><LoadingSpinner message="Loading Attendance Records & Logs..." minHeight="220px" /></td></tr>
                        ) : error ? (
                            <tr><td colSpan={statusFilter === 'not-clocked-in' ? 3 : 9} className="error-text" style={{ textAlign: 'center', padding: '30px' }}>Failed to load attendance</td></tr>
                        ) : paginatedData.length === 0 ? (
                            <tr><td colSpan={statusFilter === 'not-clocked-in' ? 3 : 9} style={{ textAlign: 'center', padding: '30px' }}>No logs or matching records found.</td></tr>
                        ) : (
                            paginatedData.map((record, index) => {
                                const targetUid = String(record.userId || '').trim().toLowerCase();
                                const targetUname = String(record.userName || '').trim().toLowerCase();
                                const targetEmpCode = String(record.empCode || record.employeeId || '').trim().toLowerCase();

                                const emp = record.employee || (employees || []).find(e => {
                                    if (!e) return false;
                                    const eId = String(e.id || '').trim().toLowerCase();
                                    const eCode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
                                    const eName = String(e.name || '').trim().toLowerCase();
                                    return (targetUid && (targetUid === eId || targetUid === eCode || targetUid === eName)) ||
                                           (targetEmpCode && (targetEmpCode === eCode || targetEmpCode === eId)) ||
                                           (targetUname && (targetUname === eName || targetUname === eId || targetUname === eCode));
                                });
                                
                                const displayName = emp?.name || record.userName || emp?.employeeName || record.userId || 'Employee';
                                const displayCode = emp?.empCode || emp?.emp_code || emp?.employeeId || record.empCode || (record.userId && !String(record.userId).startsWith('EMP0') ? record.userId : '');
                                const displayDept = emp?.department || record.department || emp?.designation || record.jobTitle || '';
                                const targetId = (emp && (emp.id || emp.empCode || emp._id || emp.employeeId)) || record.userId || record.empCode || record.id;
                                const targetName = (emp && emp.name) || displayName;
                                
                                return (
                                    <tr 
                                        key={record.id || index}
                                        onClick={() => {
                                            if (onSelectEmployee && targetId) {
                                                const recDate = record.date ? record.date.split('T')[0] : '';
                                                onSelectEmployee(targetId, targetName, recDate);
                                            }
                                        }}
                                        style={{ cursor: targetId ? 'pointer' : 'default', transition: 'background-color 0.15s ease' }}
                                        title={targetId ? `View ${targetName}'s Tracking Details` : ''}
                                    >
                                        {statusFilter !== 'not-clocked-in' && <td>{formatDate(record.date)}</td>}
                                        <td>
                                            <div 
                                                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (onSelectEmployee && targetId) {
                                                        const recDate = record.date ? record.date.split('T')[0] : '';
                                                        onSelectEmployee(targetId, targetName, recDate);
                                                    }
                                                }}
                                                title={`View ${targetName}'s Tracking Details`}
                                            >
                                                {record.type === 'absent' && (
                                                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0 }} title="Not Clocked-in"></span>
                                                )}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span 
                                                            style={{ 
                                                                fontWeight: 600, 
                                                                color: '#2563eb', 
                                                                cursor: 'pointer',
                                                                transition: 'color 0.15s ease'
                                                            }}
                                                            onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                                                            onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                                                        >
                                                            {displayName}
                                                        </span>
                                                        {displayCode && (
                                                            <span style={{ fontSize: '0.72rem', color: '#2563eb', fontWeight: 600, background: 'rgba(37, 99, 235, 0.08)', padding: '1px 5px', borderRadius: '4px', border: '1px solid rgba(37, 99, 235, 0.15)' }}>
                                                                {displayCode}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {displayDept && (
                                                        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                                            {displayDept}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        {statusFilter !== 'not-clocked-in' && (
                                            <td>
                                                {record.checkIn ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                        <span style={{ fontWeight: 600 }}>{formatDate(record.checkIn, true)}</span>
                                                        <div>
                                                            {getPunchMethodBadge(record.checkInMethod || (record.coords ? 'MANUAL_APP' : 'MANUAL_WEB'), false)}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    '-'
                                                )}
                                            </td>
                                        )}
                                        {statusFilter !== 'not-clocked-in' && (
                                            <td>
                                                {record.checkOut ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                        <span style={{ fontWeight: 600 }}>{formatDate(record.checkOut, true)}</span>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                                            {getPunchMethodBadge(record.clockOutMethod || (record.checkOut === '19:00:00' ? 'AUTO_STALE_CLEANUP' : (record.coords ? 'MANUAL_APP' : 'MANUAL_WEB')), true)}
                                                            {record.shiftCode && (
                                                                <span style={{ fontSize: '0.68rem', color: '#64748b', background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px', fontWeight: 500 }} title={`Shift: ${record.shiftLabel || record.shiftCode}`}>
                                                                    {record.shiftCode}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    '-'
                                                )}
                                            </td>
                                        )}
                                        {statusFilter !== 'not-clocked-in' && (
                                            <td>
                                                {record.checkOut ? (
                                                    <span style={{ fontWeight: 600, color: '#10b981' }}>
                                                        {calculateWorkingHours(record)}
                                                    </span>
                                                ) : isToday(record.date) ? (
                                                    <span style={{ color: '#f59e0b', fontSize: '0.9rem' }}>In Progress</span>
                                                ) : (
                                                    <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>-</span>
                                                )}
                                            </td>
                                        )}
                                        {statusFilter !== 'not-clocked-in' && (
                                            <td>
                                                <span 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedPunchHistory(record);
                                                    }}
                                                    style={{ 
                                                        fontWeight: 600, 
                                                        color: '#4f46e5', 
                                                        background: '#e0e7ff', 
                                                        padding: '4px 10px', 
                                                        borderRadius: '8px',
                                                        fontSize: '0.85rem',
                                                        cursor: 'pointer',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '5px',
                                                        boxShadow: '0 1px 3px rgba(79, 70, 229, 0.15)',
                                                        transition: 'all 0.2s ease'
                                                    }}
                                                    title="Click to view detailed punch session history"
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.background = '#4f46e5';
                                                        e.currentTarget.style.color = '#ffffff';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.background = '#e0e7ff';
                                                        e.currentTarget.style.color = '#4f46e5';
                                                    }}
                                                >
                                                    {record.punchCount || 1} { (record.punchCount || 1) === 1 ? 'time' : 'times' }
                                                    <i className="fa-solid fa-clock-rotate-left" style={{ fontSize: '0.75rem', opacity: 0.8 }}></i>
                                                </span>
                                            </td>
                                        )}
                                        {statusFilter !== 'not-clocked-in' && (
                                            <>
                                                <td>
                                                    {(() => {
                                                        const locInfo = getLocationInfo(emp, record);
                                                        return (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '240px' }}>
                                                                <span style={{ fontWeight: 600, color: '#334155', fontSize: '0.8rem', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                                                    {locInfo.address}
                                                                </span>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                                                    {locInfo.timeDisplay && (
                                                                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                                                            {locInfo.timeDisplay}
                                                                        </span>
                                                                    )}
                                                                    {getGpsIcon(emp, record)}
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                                <td>{getBatteryIcon(emp, record)}</td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center', justifyContent: 'center' }}>
                                                        <span style={{ 
                                                            fontWeight: 600, 
                                                            color: '#10b981', 
                                                            background: '#d1fae5', 
                                                            padding: '4px 10px', 
                                                            borderRadius: '12px',
                                                            fontSize: '0.85rem',
                                                            display: 'inline-block'
                                                        }}>
                                                            {(() => {
                                                                const dist = getAuditedDistanceForRecord(record, emp);
                                                                return dist && Number(dist) > 0 ? `${dist} km` : '0.00 km';
                                                            })()}
                                                        </span>
                                                        {emp && (() => {
                                                            const offDuration = getGpsOffDurationForRecord(record, emp);
                                                            const isOffActive = offDuration && offDuration !== '0m' && offDuration !== '0m Off' && offDuration !== '--';
                                                            const displayLabel = offDuration.endsWith('Off') ? offDuration : `${offDuration} Off`;
                                                            return (
                                                                <div style={{ 
                                                                    display: 'flex', 
                                                                    alignItems: 'center', 
                                                                    gap: '4px', 
                                                                    color: isOffActive ? '#ef4444' : '#64748b', 
                                                                    background: isOffActive ? '#fee2e2' : '#f1f5f9', 
                                                                    padding: '3px 8px', 
                                                                    borderRadius: '10px', 
                                                                    fontSize: '0.75rem', 
                                                                    fontWeight: 600 
                                                                }}>
                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                                                    </svg>
                                                                    <span>{displayLabel}</span>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </td>
                                            </>
                                        )}
                                        {statusFilter === 'not-clocked-in' && (
                                            <>
                                                <td>
                                                    <span style={{ 
                                                        fontWeight: 600, 
                                                        color: record.status === 'On Leave' ? '#f59e0b' : '#ef4444',
                                                        background: record.status === 'On Leave' ? '#fef3c7' : '#fee2e2',
                                                        padding: '4px 10px',
                                                        borderRadius: '8px',
                                                        fontSize: '0.85rem'
                                                    }}>
                                                        {record.status}
                                                    </span>
                                                </td>
                                                <td style={{ color: '#4b5563', fontSize: '0.9rem', maxWidth: '300px', whiteSpace: 'normal' }}>
                                                    {record.reason}
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>

                {/* Gmail-style Pagination Footer */}
                {totalItems > 0 && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        padding: '14px 24px',
                        borderTop: '1px solid #e5e7eb',
                        gap: '20px',
                        fontSize: '0.875rem',
                        color: '#4b5563'
                    }}>
                        <span>
                            {startIndex + 1}â€“{endIndex} of {totalItems}
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                                style={{
                                    border: '1px solid #e5e7eb',
                                    background: 'white',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                    opacity: currentPage === 1 ? 0.5 : 1,
                                    fontWeight: 'bold'
                                }}
                            >
                                &lt;
                            </button>
                            <button 
                                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                disabled={currentPage === totalPages}
                                style={{
                                    border: '1px solid #e5e7eb',
                                    background: 'white',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                    opacity: currentPage === totalPages ? 0.5 : 1,
                                    fontWeight: 'bold'
                                }}
                            >
                                &gt;
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Punch Session History Modal */}
            {selectedPunchHistory && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.65)',
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 9999,
                        padding: '20px'
                    }}
                    onClick={() => setSelectedPunchHistory(null)}
                >
                    <div 
                        style={{
                            background: 'var(--panel-bg, #ffffff)',
                            color: 'var(--text-primary, #1e293b)',
                            borderRadius: '16px',
                            width: '100%',
                            maxWidth: '560px',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
                            border: '1px solid var(--border-glass, #e2e8f0)',
                            overflow: 'hidden'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div style={{
                            padding: '20px 24px',
                            borderBottom: '1px solid var(--border-glass, #e2e8f0)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: 'linear-gradient(135deg, rgba(79,70,229,0.06) 0%, rgba(99,102,241,0.02) 100%)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '42px',
                                    height: '42px',
                                    borderRadius: '12px',
                                    background: '#e0e7ff',
                                    color: '#4f46e5',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '1.2rem'
                                }}>
                                    <i className="fa-solid fa-clock-rotate-left"></i>
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
                                        {selectedPunchHistory.userName}
                                    </h3>
                                    <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                                        Punch History â€¢ {formatDate(selectedPunchHistory.date)}
                                    </p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{
                                    fontWeight: 700,
                                    color: '#4f46e5',
                                    background: '#e0e7ff',
                                    padding: '4px 12px',
                                    borderRadius: '20px',
                                    fontSize: '0.8rem'
                                }}>
                                    {selectedPunchHistory.punches ? selectedPunchHistory.punches.length : 1} { (selectedPunchHistory.punches ? selectedPunchHistory.punches.length : 1) === 1 ? 'Session' : 'Sessions' }
                                </span>
                                <button 
                                    onClick={() => setSelectedPunchHistory(null)}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: '#64748b',
                                        fontSize: '1.2rem',
                                        cursor: 'pointer',
                                        padding: '4px 8px',
                                        borderRadius: '6px'
                                    }}
                                >
                                    âœ•
                                </button>
                            </div>
                        </div>

                        {/* Modal Body - Punch Sessions List */}
                        <div style={{ padding: '20px 24px', maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {(selectedPunchHistory.punches && selectedPunchHistory.punches.length > 0 ? selectedPunchHistory.punches : [selectedPunchHistory]).map((p, idx) => {
                                const sessionWorkingHours = (p.checkIn && p.checkOut) ? calculateWorkingHours({ checkIn: p.checkIn, checkOut: p.checkOut, date: selectedPunchHistory.date }) : null;
                                return (
                                    <div 
                                        key={p.id || idx}
                                        style={{
                                            border: '1px solid var(--border-glass, #e2e8f0)',
                                            borderRadius: '12px',
                                            padding: '16px',
                                            background: 'var(--panel-bg, #f8fafc)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '12px'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Session #{idx + 1}
                                            </span>
                                            {sessionWorkingHours && sessionWorkingHours !== '-' ? (
                                                <span style={{ fontWeight: 600, color: '#10b981', background: '#d1fae5', padding: '2px 8px', borderRadius: '6px', fontSize: '0.8rem' }}>
                                                    {sessionWorkingHours}
                                                </span>
                                            ) : (!p.checkOut && isToday(selectedPunchHistory.date)) ? (
                                                <span style={{ fontWeight: 600, color: '#f59e0b', background: '#fef3c7', padding: '2px 8px', borderRadius: '6px', fontSize: '0.8rem' }}>
                                                    In Progress
                                                </span>
                                            ) : null}
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                            {/* Check In Block */}
                                            <div style={{ background: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.75rem', fontWeight: 700 }}>
                                                        <i className="fa-solid fa-right-to-bracket"></i> CHECK IN
                                                    </div>
                                                    {getPunchMethodBadge(p.checkInMethod || (p.coords ? 'MANUAL_APP' : 'MANUAL_WEB'), false)}
                                                </div>
                                                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>
                                                    {formatDate(p.checkIn, true)}
                                                </div>
                                                {p.address && (
                                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px', wordBreak: 'break-word' }}>
                                                        ðŸ“ {p.address}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Check Out Block */}
                                            <div style={{ background: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '0.75rem', fontWeight: 700 }}>
                                                        <i className="fa-solid fa-right-from-bracket"></i> CHECK OUT
                                                    </div>
                                                    {p.checkOut && getPunchMethodBadge(p.clockOutMethod || (p.checkOut === '19:00:00' ? 'AUTO_STALE_CLEANUP' : (p.coords ? 'MANUAL_APP' : 'MANUAL_WEB')), true)}
                                                </div>
                                                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: p.checkOut ? '#1e293b' : '#f59e0b' }}>
                                                    {p.checkOut ? formatDate(p.checkOut, true) : (isToday(selectedPunchHistory.date) ? 'Active Session' : (selectedPunchHistory.checkOut ? formatDate(selectedPunchHistory.checkOut, true) : '-'))}
                                                </div>
                                                {p.checkOutAddress && (
                                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px', wordBreak: 'break-word' }}>
                                                        ðŸ“ {p.checkOutAddress}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Modal Footer */}
                        <div style={{
                            padding: '16px 24px',
                            borderTop: '1px solid var(--border-glass, #e2e8f0)',
                            background: 'var(--panel-bg, #f8fafc)',
                            display: 'flex',
                            justify: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div>
                                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Total Working Duration: </span>
                                <span style={{ fontWeight: 700, color: '#10b981', fontSize: '1rem', marginLeft: '6px' }}>
                                    {calculateWorkingHours(selectedPunchHistory)}
                                </span>
                            </div>
                            <button 
                                onClick={() => setSelectedPunchHistory(null)}
                                style={{
                                    padding: '8px 18px',
                                    borderRadius: '8px',
                                    background: '#4f46e5',
                                    color: 'white',
                                    border: 'none',
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 4px rgba(79,70,229,0.2)'
                                }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
