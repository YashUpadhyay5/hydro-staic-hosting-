import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useState, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { formatDate } from '../../utils/helpers';

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

            // 1. Deduplicate rapid double-tap punches (checkIn within 15 seconds of each other)
            const cleanPunches = [];
            item.punches.forEach(p => {
                const pTs = parseToTimestamp(p.checkIn);
                const prevP = cleanPunches[cleanPunches.length - 1];
                const prevTs = prevP ? parseToTimestamp(prevP.checkIn) : null;

                if (pTs && prevTs && Math.abs(pTs - prevTs) <= 15000) {
                    if (p.checkOut && !prevP.checkOut) {
                        prevP.checkOut = p.checkOut;
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
            const lastPunch = item.punches[item.punches.length - 1];
            
            if (isTodayRecord && lastPunch && !cleanCheckOutVal(lastPunch.checkOut)) {
                item.checkOut = null;
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

export default function AttendanceView({ employees = [], onSelectEmployee }) {
    const [attendance, setAttendance] = useState([]);
    const [leaves, setLeaves] = useState([]);
    const [footprints, setFootprints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [latestFootprints, setLatestFootprints] = useState({});
    const [todayDistances, setTodayDistances] = useState({});
    const [todayGpsOffDurations, setTodayGpsOffDurations] = useState({});
    const [latestAllFootprints, setLatestAllFootprints] = useState([]);
    const [selectedPunchHistory, setSelectedPunchHistory] = useState(null);

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
                    📱 App
                </span>
            );
        }
        if (m === 'MANUAL_WEB') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#2563eb', background: '#dbeafe', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Clocked via Web Portal">
                    💻 Web
                </span>
            );
        }
        if (m === 'AUTO_SHIFT_END') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#d97706', background: '#fef3c7', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Automatically clocked out at shift end">
                    🤖 Auto (Shift)
                </span>
            );
        }
        if (m === 'AUTO_STALE_CLEANUP') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#b45309', background: '#ffedd5', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Auto-closed by system fallback cleanup">
                    ⚠️ Auto-Closed
                </span>
            );
        }
        if (m === 'AUTO_LOCATION_ANCHOR') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#7c3aed', background: '#ede9fe', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Auto-closed at last known GPS location">
                    📍 Auto (GPS)
                </span>
            );
        }
        if (m === 'AUTO_RECOVERY_PUNCH') {
            return (
                <span style={{ fontSize: '0.68rem', color: '#0284c7', background: '#e0f2fe', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }} title="Auto-recovered from live device telemetry">
                    🔄 Auto-Recovered
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

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Phase 1: Fetch initial logs first & unblock UI immediately (<100ms)
                const attendanceRes = await api.getAttendance({ chunked: 'true', page: 1, limit: 20 });
                const attendanceData = Array.isArray(attendanceRes) ? attendanceRes : (attendanceRes.data || []);
                setAttendance(attendanceData);
                setTimeout(() => setLoading(false), 300);

                // Phase 2: Fetch full attendance logs for complete reports, footprints & leaves in background
                const targetDateQuery = fromDate || new Date().toISOString().split('T')[0];
                Promise.all([
                    api.getAttendance({ limit: 10000 }).catch(err => { console.warn('Full attendance fetch warning:', err); return null; }),
                    api.getLatestAllFootprints().catch(err => { console.warn('Footprints fetch warning:', err); return []; }),
                    api.getFootprints ? api.getFootprints(null, targetDateQuery).catch(err => { console.warn('Footprints history fetch warning:', err); return []; }) : Promise.resolve([]),
                    api.getLeaves ? api.getLeaves().catch(err => { console.warn('Leaves fetch warning:', err); return []; }) : Promise.resolve([])
                ]).then(([fullAttendanceRes, latestAllData, footprintsData, leavesData]) => {
                    if (fullAttendanceRes) {
                        const fullData = Array.isArray(fullAttendanceRes) ? fullAttendanceRes : (fullAttendanceRes.data || []);
                        if (fullData.length > 0) {
                            setAttendance(fullData);
                        }
                    }
                    if (latestAllData) setLatestAllFootprints(latestAllData);
                    if (footprintsData && Array.isArray(footprintsData)) setFootprints(footprintsData);
                    if (leavesData) setLeaves(leavesData);
                });
            } catch (err) {
                console.error(err);
                setError(true);
                setLoading(false);
            }
        };
        fetchData();
    }, [fromDate]);

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

    // Dedicated Audited Route Replay Multi-Date Travel Distance & GPS Off Duration Fetcher Engine
    useEffect(() => {
        if (!employees || employees.length === 0) return;
        const todayStr = new Date().toISOString().split('T')[0];
        const defaultDate = fromDate || todayStr;
        const pairsToFetch = new Map(); // pairKey -> { targetId, dateStr, emp }

        // 1. Gather all unique (targetId, dateStr) pairs from attendance records
        if (attendance && attendance.length > 0) {
            attendance.forEach(rec => {
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
        }

        // 2. Add default date for all employees
        employees.forEach(emp => {
            const targetId = emp.employeeId || emp.userId || emp.id;
            if (!targetId) return;
            const pairKey = `${String(targetId).trim().toLowerCase()}_${defaultDate}`;
            if (!pairsToFetch.has(pairKey)) {
                pairsToFetch.set(pairKey, { targetId, dateStr: defaultDate, emp });
            }
        });

        // 3. Query Route Replay for each unique (targetId, dateStr)
        pairsToFetch.forEach(({ targetId, dateStr, emp }) => {
            api.getRouteReplay(targetId, dateStr, 'osrm').then(res => {
                if (res) {
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
                        const distUpdates = {};
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
                        setTodayDistances(prev => ({ ...prev, ...distUpdates }));
                    }

                    if (res.gpsOffDurationLabel !== undefined && res.gpsOffDurationLabel !== null) {
                        const offLabel = res.gpsOffDurationLabel || '0m';
                        const offUpdates = {};
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
                        setTodayGpsOffDurations(prev => ({ ...prev, ...offUpdates }));
                    }
                }
            }).catch(err => {
                console.warn(`[RouteReplay Fetch Warning] Could not fetch distance/gps off for ${targetId} on ${dateStr}:`, err);
            });
        });
    }, [employees, attendance, fromDate]);

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

        // If record has multiple punches, sum working time across completed punch sessions
        if (punches && punches.length > 1) {
            let totalMs = 0;
            punches.forEach(p => {
                if (p.checkIn && p.checkOut) {
                    const start = parseDateTime(date, p.checkIn);
                    const end = parseDateTime(date, p.checkOut);
                    if (start && end && end > start) {
                        totalMs += (end - start);
                    }
                }
            });
            if (totalMs > 0) {
                const diffHrs = Math.floor(totalMs / 3600000);
                const diffMins = Math.floor((totalMs % 3600000) / 60000);
                const diffSecs = Math.floor((totalMs % 60000) / 1000);
                if (diffHrs > 0) return `${diffHrs}h ${diffMins}m ${diffSecs}s`;
                if (diffMins > 0) return `${diffMins}m ${diffSecs}s`;
                return `${diffSecs}s`;
            }
        }

        if (!checkIn || !checkOut) return '-';

        const start = parseDateTime(date, checkIn);
        const end = parseDateTime(date, checkOut);

        if (!start || !end) return '-';
        
        const diffMs = end - start;
        if (diffMs < 0) return '-';
        
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
        
        const absentEmployees = (employees || []).filter(emp => {
            if (!emp) return false;
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

    const getReportDates = () => {
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
        const days = Array.from({ length: daysCount }, (_, i) => i + 1);
        return { year, month, days };
    };

    if (activeSubView === 'attendance-summary') {
        const { year, month, days } = getReportDates();
        const monthName = new Date(year, month).toLocaleString('default', { month: 'long' });
        
        const summaryRows = employees.map((emp, idx) => {
            const empId = getEmpId(emp, idx);
            const dept = emp.department || 'Company';
            
            const today = new Date();
            let targetEndDay = days.length;
            if (year === today.getFullYear() && month === today.getMonth()) {
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
            
            days.forEach(day => {
                if (day <= targetEndDay) {
                    const targetDate = new Date(year, month, day);
                    targetDate.setHours(0, 0, 0, 0);

                    // 1. Check for actual attendance punches
                    const record = attendance.find(r => {
                        if (r.userName && r.userName.toLowerCase() === emp.name.toLowerCase()) {
                            const rDate = new Date(r.date);
                            if (!isNaN(rDate.getTime())) {
                                return rDate.getFullYear() === year && rDate.getMonth() === month && rDate.getDate() === day;
                            }
                        }
                        return false;
                    });
                    
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
                    } else {
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
            
            // Calculate employee-specific standard working days (excluding Weekly Offs) up to today
            let empStandardDays = 0;
            const empWeeklyOffs = String(emp.weeklyOffs || 'Sunday').toLowerCase();
            days.forEach(day => {
                if (day <= targetEndDay) {
                    const date = new Date(year, month, day);
                    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                    const isWeeklyOff = empWeeklyOffs.includes(dayName);
                    if (!isWeeklyOff) {
                        empStandardDays++;
                    }
                }
            });

            const standardDays = empStandardDays > 0 ? empStandardDays : 1;
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
        const { year, month, days } = getReportDates();
        const monthName = new Date(year, month).toLocaleString('default', { month: 'long' });
        
        // Generate rows for each employee
        const reportRows = employees.map((emp, idx) => {
            const empId = getEmpId(emp, idx);
            const dept = emp.department || 'Company';
            
            // Map day number -> check-in and check-out times
            const dayRecords = {};
            days.forEach(day => {
                const targetDate = new Date(year, month, day);
                targetDate.setHours(0, 0, 0, 0);

                const record = attendance.find(r => {
                    const empNameMatch = r.userName && String(r.userName).trim().toLowerCase() === String(emp.name).trim().toLowerCase();
                    const empIdMatch = r.userId && (
                        String(r.userId).trim().toLowerCase() === String(emp.id).trim().toLowerCase() || 
                        String(r.userId).trim().toLowerCase() === String(emp.empCode || '').trim().toLowerCase()
                    );
                    if (empNameMatch || empIdMatch) {
                        const rDate = new Date(r.date);
                        if (!isNaN(rDate.getTime())) {
                            return rDate.getFullYear() === year && rDate.getMonth() === month && rDate.getDate() === day;
                        }
                    }
                    return false;
                });
                
                const formatTime = (timeStr) => {
                    if (!timeStr) return '';
                    let d = new Date(timeStr);
                    if (isNaN(d.getTime()) && !isNaN(Number(timeStr))) {
                        d = new Date(Number(timeStr));
                    }
                    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
                        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                    }
                    const timeRegex = /(\d+):(\d+):?(\d+)?\s*(AM|PM)?/i;
                    const match = String(timeStr).match(timeRegex);
                    if (match) {
                        let hours = parseInt(match[1], 10);
                        const minutes = match[2];
                        const ampm = match[4] ? ` ${match[4].toUpperCase()}` : '';
                        return `${String(hours).padStart(2, '0')}:${minutes}${ampm}`;
                    }
                    return String(timeStr);
                };

                if (record && (record.checkIn || record.checkOut)) {
                    dayRecords[day] = {
                        in: formatTime(record.checkIn),
                        out: formatTime(record.checkOut)
                    };
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
                        dayRecords[day] = { in: 'Leave', out: 'Approved' };
                    } else {
                        dayRecords[day] = { in: '', out: '' };
                    }
                }
            });
            
            return {
                empId,
                name: emp.name,
                dept,
                dayRecords
            };
        });

        const handleExportRecordExcel = () => {
            const headers = ['Employee ID', 'Name', 'Department'];
            days.forEach(day => {
                headers.push(`${day} In`, `${day} Out`);
            });

            const rows = reportRows.map(row => {
                const rowData = [row.empId, row.name, row.dept];
                days.forEach(day => {
                    const rec = row.dayRecords[day] || { in: '', out: '' };
                    rowData.push(rec.in || '', rec.out || '');
                });
                return rowData;
            });

            exportToCSV(`Attendance_Record_${monthName}_${year}.csv`, headers, rows);
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
                                Period: {monthName} {year}
                            </span>
                        </div>
                    </div>

                    {/* Filter Periods: Last Month, Current Month, Custom */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
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
                                onClick={() => setReportPeriod('current-month')}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 16px',
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
                                onClick={() => setReportPeriod('custom')}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 16px',
                                    background: 'transparent',
                                    color: reportPeriod === 'custom' ? '#991b1b' : '#4b5563',
                                    fontWeight: 600,
                                    boxShadow: 'none',
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
                                {days.map(day => (
                                    <th key={day} colSpan="2" style={{ padding: '8px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#334155', position: 'sticky', top: 0, zIndex: 25, background: '#f8fafc', minWidth: '100px' }}>{day}</th>
                                ))}
                            </tr>
                            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1', position: 'sticky', top: '44px', zIndex: 20 }}>
                                {days.map(day => (
                                    <React.Fragment key={`io-${day}`}>
                                        <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #e2e8f0', fontWeight: 600, color: '#475569', fontSize: '0.75rem', minWidth: '50px', background: '#f1f5f9' }}>In</th>
                                        <th style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #cbd5e1', fontWeight: 600, color: '#475569', fontSize: '0.75rem', minWidth: '50px', background: '#f1f5f9' }}>Out</th>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {reportRows.map((row, idx) => (
                                <tr key={row.empId} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>
                                    <td style={{ padding: '10px 16px', borderRight: '1px solid #e2e8f0', color: '#475569', position: 'sticky', left: 0, zIndex: 5, background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>{row.empId}</td>
                                    <td style={{ padding: '10px 16px', borderRight: '1px solid #e2e8f0', fontWeight: 500, color: '#1e293b', position: 'sticky', left: '100px', zIndex: 5, background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>{row.name}</td>
                                    <td style={{ padding: '10px 16px', borderRight: '2px solid #cbd5e1', color: '#64748b' }}>{row.dept}</td>
                                    {days.map(day => {
                                        const record = row.dayRecords[day];
                                        return (
                                            <React.Fragment key={day}>
                                                <td 
                                                    style={{ 
                                                        padding: '8px 4px', 
                                                        textAlign: 'center', 
                                                        borderRight: '1px solid #e2e8f0',
                                                        color: record.in ? '#10b981' : '#cbd5e1',
                                                        background: record.in ? 'rgba(16, 185, 129, 0.03)' : 'transparent',
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
                                                        color: record.out ? '#ef4444' : '#cbd5e1',
                                                        background: record.out ? 'rgba(239, 68, 68, 0.03)' : 'transparent',
                                                        fontWeight: record.out ? 500 : 'normal'
                                                    }}
                                                >
                                                    {record.out || '-'}
                                                </td>
                                            </React.Fragment>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (activeSubView === 'abnormal-attendance') {
        const { year, month, days } = getReportDates();
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
        employees.forEach((emp, empIdx) => {
            const empId = getEmpId(emp, empIdx);
            const dept = emp.department || 'Company';

            days.forEach(day => {
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
                    remarks: onApprovedLeave ? 'On Leave' : 'Absent'
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
                row.firstOn || '',
                row.firstOff || '',
                row.secondOn || '',
                row.secondOff || '',
                row.thirdOn || '',
                row.thirdOff || '',
                row.overBegin || '',
                row.overEnd || '',
                row.lateTime,
                row.leaveTime,
                row.desTime,
                row.totalTime,
                row.remarks
            ]);

            exportToCSV(`Abnormal_Attendance_Report_${monthName}_${year}.csv`, headers, rows);
        };

        const formatTimeDisplay = (timeVal) => {
            if (!timeVal) return '00:00';
            const match = String(timeVal).match(/(\d+):(\d+)/);
            if (!match) return timeVal;
            return `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`;
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
        const { year, month, days } = getReportDates();
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

        // Filter employees based on search query (if any)
        let displayEmployees = employees;
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
                        if (!isWeeklyOff) absentDays++;
                    }
                }

                const formatTimeDisplay = (timeVal) => {
                    if (!timeVal) return '';
                    const match = String(timeVal).match(/(\d+):(\d+)/);
                    if (!match) return timeVal;
                    return `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`;
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

        const handleDownloadExcel = () => {
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
                let sheetName = card.name.substring(0, 31).replace(/[\\/?*\[\]]/g, '');
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
                        <div key={card.empId} style={{ minWidth: '450px', flex: '1 1 450px', border: '1px solid #000', backgroundColor: 'white', color: 'black', fontFamily: 'sans-serif', fontSize: '0.75rem' }}>
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
                                
                                return (
                                    <tr 
                                        key={record.id || index}
                                        onClick={() => onSelectEmployee && onSelectEmployee(emp?.id || record.userId, displayName)}
                                        style={{ cursor: 'pointer' }}
                                        title={`View ${displayName}'s Tracking Details`}
                                    >
                                        {statusFilter !== 'not-clocked-in' && <td>{formatDate(record.date)}</td>}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {record.type === 'absent' && (
                                                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0 }} title="Not Clocked-in"></span>
                                                )}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ fontWeight: 600 }}>{displayName}</span>
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
                            {startIndex + 1}–{endIndex} of {totalItems}
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
                                        Punch History • {formatDate(selectedPunchHistory.date)}
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
                                    ✕
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
                                                        📍 {p.address}
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
                                                        📍 {p.checkOutAddress}
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
