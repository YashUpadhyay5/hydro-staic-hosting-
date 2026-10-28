import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useState, useRef } from 'react';
import { api } from '../../services/api';
import { getFullUrl } from '../../utils/helpers';
import HolidayCalendarModal from './HolidayCalendarModal';

export default function DashboardView({ employees: propEmployees = [], totalEmployees, onViewChange }) {
    const adminUser = (() => {
        try {
            return JSON.parse(localStorage.getItem('adminUser'));
        } catch {
            return null;
        }
    })();
    const isTrackingManager = ['TRACKING_MANAGER', 'FIELD_INVOICE_MANAGER'].includes(String(adminUser?.role || 'ADMIN').toUpperCase());

    // Instant SWR Cache for Stat Cards (Frame 0 render, survives page reload)
    const cachedSummary = (() => {
        try {
            if (typeof sessionStorage !== 'undefined') {
                const raw = sessionStorage.getItem('swr:GET:/dashboard/summary');
                if (raw) return JSON.parse(raw).data;
            }
        } catch {}
        return null;
    })();

    const computeActiveCount = (list) => {
        if (!Array.isArray(list) || list.length === 0) return 0;
        return list.filter(e => String(e?.status || 'ACTIVE').toUpperCase() === 'ACTIVE' && !e?.isSystemAccount && !e?.is_system_account).length;
    };

    const [todayCount, setTodayCount] = useState(() => cachedSummary?.todayAttendanceCount ?? 0);
    const [pendingLeavesCount, setPendingLeavesCount] = useState(() => cachedSummary?.pendingLeavesCount ?? 0);
    const [pendingExpensesCount, setPendingExpensesCount] = useState(() => cachedSummary?.pendingExpensesCount ?? 0);
    const [workforceCount, setWorkforceCount] = useState(() => {
        if (cachedSummary?.activeEmployeesCount != null && Number(cachedSummary.activeEmployeesCount) > 0) {
            return Number(cachedSummary.activeEmployeesCount);
        }
        if (totalEmployees && totalEmployees > 0) return totalEmployees;
        const fromProps = computeActiveCount(propEmployees);
        return fromProps > 0 ? fromProps : 0;
    });

    useEffect(() => {
        if (totalEmployees && totalEmployees > 0) {
            setWorkforceCount(totalEmployees);
        } else if (propEmployees && propEmployees.length > 0) {
            const count = computeActiveCount(propEmployees);
            if (count > 0) setWorkforceCount(count);
        }
    }, [totalEmployees, propEmployees]);

    const [pendingLeaves, setPendingLeaves] = useState([]);
    const [pendingExpenses, setPendingExpenses] = useState([]);
    const [todayAttendance, setTodayAttendance] = useState([]);
    const isFetchingRef = useRef(false);
    const isFetchingDetailedRef = useRef(false);
    const lastFetchTimeRef = useRef(0);
    
    // Dynamic feeds state
    const [announcements, setAnnouncements] = useState([]);
    const [birthdays, setBirthdays] = useState([]);
    const [holidays, setHolidays] = useState([]);
    const [activeTab, setActiveTab] = useState('ALL'); // 'ALL' | 'ANNOUNCEMENTS' | 'BIRTHDAYS' | 'HOLIDAYS'
    const [loadingHighlights, setLoadingHighlights] = useState(true);

    // Modal state for creating dynamic announcements
    const [showModal, setShowModal] = useState(false);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [category, setCategory] = useState('ANNOUNCEMENT');
    const [submitting, setSubmitting] = useState(false);

    // Present Employees Modal state
    const [showPresentModal, setShowPresentModal] = useState(false);
    const [presentSearchTerm, setPresentSearchTerm] = useState('');

    // Holiday Calendar Modal state
    const [showHolidayModal, setShowHolidayModal] = useState(false);

    // Fullscreen Image Lightbox Preview State
    const [previewImage, setPreviewImage] = useState(null); // { url, title, subtitle }

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') setPreviewImage(null);
        };
        if (previewImage) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [previewImage]);

    const formatRelativeTime = (dateStr) => {
        if (!dateStr) return 'Just Now';
        const diffMs = new Date() - new Date(dateStr);
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 2) return 'Just Now';
        if (diffMins < 60) return `${diffMins} mins ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours} hrs ago`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays === 1) return 'Yesterday';
        return `${diffDays} days ago`;
    };

    const [wishingEmpId, setWishingEmpId] = useState(null);

    const handleWishBirthday = async (item) => {
        const rawId = item.id ? String(item.id).replace('bday-', '') : null;
        setWishingEmpId(item.id || item.name);
        try {
            // 1. Send direct FCM Push Notification to employee's mobile app
            if (rawId) {
                await api.sendDirectNotification(
                    rawId,
                    `🎂 Happy Birthday, ${item.name}! 🎉`,
                    `Warmest birthday wishes from Management & Team Hydro! Wishing you a joyous day and a fantastic year ahead! 🥳🎈`,
                    { type: 'BIRTHDAY_WISH', sender: 'ADMIN' }
                ).catch(err => console.warn('Direct push notice error:', err));
            }

            // 2. Broadcast celebration notification to organization Chat & Highlights feed
            await api.createAnnouncement(
                `🎂 Birthday Celebration for ${item.name}! 🎉`,
                `Let's all wish ${item.name} a very Happy Birthday! 🥳🎈 Wishing you great success and happiness!`,
                'BIRTHDAY_WISH'
            ).catch(err => console.warn('Public announcement error:', err));

            // Refresh highlights feed to show new celebration post
            fetchAnnouncements();

            // Modern glassmorphism UI Toast feedback
            const toast = document.createElement('div');
            toast.style.position = 'fixed';
            toast.style.bottom = '24px';
            toast.style.right = '24px';
            toast.style.background = 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)';
            toast.style.color = '#ffffff';
            toast.style.padding = '14px 22px';
            toast.style.borderRadius = '12px';
            toast.style.fontSize = '14px';
            toast.style.fontWeight = '700';
            toast.style.boxShadow = '0 10px 25px rgba(236, 72, 153, 0.4)';
            toast.style.zIndex = '99999';
            toast.style.display = 'flex';
            toast.style.alignItems = 'center';
            toast.style.gap = '10px';
            toast.innerHTML = `<i class="fa-solid fa-paper-plane" style="font-size: 16px;"></i> App Push Notification & Chat wish delivered to ${item.name}! 🎉`;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.4s ease';
                setTimeout(() => toast.remove(), 400);
            }, 3500);

        } catch (error) {
            console.error('Error sending birthday wish:', error);
        } finally {
            setWishingEmpId(null);
        }
    };

    const getAuthoritativeISTDate = (d = new Date()) => {
        try {
            return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
        } catch {
            return new Date().toISOString().split('T')[0];
        }
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

    const fetchSummaryCounts = async () => {
        try {
            const summary = await api.getDashboardSummary();
            if (summary) {
                if (summary.todayAttendanceCount !== undefined) setTodayCount(Number(summary.todayAttendanceCount));
                if (summary.pendingLeavesCount !== undefined) setPendingLeavesCount(Number(summary.pendingLeavesCount));
                if (summary.pendingExpensesCount !== undefined) setPendingExpensesCount(Number(summary.pendingExpensesCount));
                if (summary.activeEmployeesCount !== undefined) setWorkforceCount(Number(summary.activeEmployeesCount));
            }
        } catch (err) {
            console.warn('Dashboard summary fetch failed:', err);
        }
    };

    const fetchApprovals = async () => {
        try {
            const [leavesRes, expensesRes] = await Promise.allSettled([
                api.getLeaves(),
                api.getExpenses()
            ]);
            const leaves = leavesRes.status === 'fulfilled' ? leavesRes.value : [];
            const expenses = expensesRes.status === 'fulfilled' ? expensesRes.value : [];
            const pendingL = Array.isArray(leaves) ? leaves.filter(l => l && l.status === 'pending') : [];
            const pendingE = Array.isArray(expenses) ? expenses.filter(e => e && e.status === 'pending') : [];
            setPendingLeaves(pendingL);
            setPendingExpenses(pendingE);
            setPendingLeavesCount(pendingL.length);
            setPendingExpensesCount(pendingE.length);
        } catch (err) {
            console.warn('Approvals fetch error:', err);
        }
    };

    const fetchDetailedAttendance = async () => {
        if (isFetchingDetailedRef.current) return;
        isFetchingDetailedRef.current = true;
        try {
            const today = getAuthoritativeISTDate();
            const empsPromise = (propEmployees && propEmployees.length > 0)
                ? Promise.resolve(propEmployees)
                : (api.getEmployees ? api.getEmployees({ limit: 1000 }) : Promise.resolve([]));

            const results = await Promise.allSettled([
                api.getAttendance ? api.getAttendance({ date: today }) : Promise.resolve([]),
                empsPromise,
                api.getLatestAllFootprints ? api.getLatestAllFootprints() : Promise.resolve([])
            ]);

            const attendanceRes = results[0].status === 'fulfilled' ? results[0].value : [];
            const empsRes = results[1].status === 'fulfilled' ? results[1].value : [];
            const footprintsRes = results[2].status === 'fulfilled' ? results[2].value : [];

            const attendance = Array.isArray(attendanceRes) ? attendanceRes : (attendanceRes && attendanceRes.data ? attendanceRes.data : []);
            const emps = Array.isArray(empsRes) ? empsRes : (empsRes && empsRes.data ? empsRes.data : []);
            const footprints = Array.isArray(footprintsRes) ? footprintsRes : (footprintsRes && footprintsRes.data ? footprintsRes.data : []);

            if (emps && emps.length > 0) {
                setWorkforceCount(computeActiveCount(emps));
                computeBirthdays(emps);
            }

            const todaysRecords = attendance.filter(a => {
                if (!a) return false;
                const normDate = normalizeToIsoDate(a.date);
                if (normDate) return normDate === today;
                if (a.date) return getAuthoritativeISTDate(a.date) === today;
                if (a.createdAt) return normalizeToIsoDate(a.createdAt) === today || getAuthoritativeISTDate(a.createdAt) === today;
                return false;
            });

            const uniqueAttendance = [];
            const seenUsers = new Set();

            const findEmpByAnyCode = (searchId, empList) => {
                if (!searchId || !empList) return null;
                const target = String(searchId).trim().toLowerCase();
                return empList.find(e => {
                    if (!e) return false;
                    const eId = String(e.id || '').trim().toLowerCase();
                    const eCode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
                    const eName = String(e.name || '').trim().toLowerCase();
                    if (eId === target || eCode === target || eName === target) return true;

                    // Check legacy codes or aliases from customFields
                    try {
                        const rawCf = e.customFields || e.custom_fields || {};
                        const cf = typeof rawCf === 'string' ? JSON.parse(rawCf) : rawCf;
                        const leg = [...(cf.legacyCodes || []), ...(cf.aliases || []), cf.legacyId, cf.oldCode].filter(Boolean);
                        if (leg.some(l => String(l).trim().toLowerCase() === target)) return true;
                    } catch (err) {}
                    return false;
                });
            };

            todaysRecords.forEach(record => {
                const rId = String(record.userId || '').trim().toLowerCase();
                const rName = String(record.userName || '').trim().toLowerCase();
                const rCode = String(record.empCode || record.employeeId || '').trim().toLowerCase();

                const matchedEmp = record.employee || findEmpByAnyCode(rId, emps) || findEmpByAnyCode(rCode, emps) || findEmpByAnyCode(rName, emps);

                const canonicalKey = matchedEmp?.id || matchedEmp?.empCode || record.empCode || record.userId || record.userName;
                const canonicalLower = String(canonicalKey).trim().toLowerCase();

                if (canonicalLower && !seenUsers.has(canonicalLower)) {
                    seenUsers.add(canonicalLower);
                    if (rId) seenUsers.add(rId);
                    if (rName) seenUsers.add(rName);
                    if (rCode) seenUsers.add(rCode);

                    if (matchedEmp) {
                        if (matchedEmp.id) seenUsers.add(String(matchedEmp.id).trim().toLowerCase());
                        if (matchedEmp.empCode) seenUsers.add(String(matchedEmp.empCode).trim().toLowerCase());
                        if (matchedEmp.emp_code) seenUsers.add(String(matchedEmp.emp_code).trim().toLowerCase());
                        if (matchedEmp.name) seenUsers.add(String(matchedEmp.name).trim().toLowerCase());
                        try {
                            const rawCf = matchedEmp.customFields || matchedEmp.custom_fields || {};
                            const cf = typeof rawCf === 'string' ? JSON.parse(rawCf) : rawCf;
                            const leg = [...(cf.legacyCodes || []), ...(cf.aliases || []), cf.legacyId, cf.oldCode].filter(Boolean);
                            leg.forEach(l => seenUsers.add(String(l).trim().toLowerCase()));
                        } catch (err) {}
                    }

                    uniqueAttendance.push({
                        ...record,
                        matchedEmp: matchedEmp || record.employee
                    });
                }
            });

            // Fallback: Also include any actively transmitting employees from footprints today
            footprints.forEach(f => {
                if (!f) return;
                const fId = String(f.userId || '').trim().toLowerCase();
                const fName = String(f.userName || '').trim().toLowerCase();
                const fCode = String(f.empCode || '').trim().toLowerCase();
                const fRaw = String(f.rawUserId || '').trim().toLowerCase();

                const isAlreadyIncluded = (fId && seenUsers.has(fId)) || 
                                          (fName && seenUsers.has(fName)) || 
                                          (fCode && seenUsers.has(fCode)) ||
                                          (fRaw && seenUsers.has(fRaw));
                if (!isAlreadyIncluded) {
                    const matchedEmp = f.employee || findEmpByAnyCode(fId, emps) || findEmpByAnyCode(fCode, emps) || findEmpByAnyCode(fRaw, emps) || findEmpByAnyCode(fName, emps);

                    const canonicalKey = matchedEmp?.id || matchedEmp?.empCode || f.empCode || f.userId || f.userName;
                    const canonicalLower = String(canonicalKey).trim().toLowerCase();

                    if (canonicalLower && !seenUsers.has(canonicalLower)) {
                        seenUsers.add(canonicalLower);
                        if (fId) seenUsers.add(fId);
                        if (fName) seenUsers.add(fName);
                        if (fCode) seenUsers.add(fCode);
                        if (fRaw) seenUsers.add(fRaw);

                        if (matchedEmp) {
                            if (matchedEmp.id) seenUsers.add(String(matchedEmp.id).trim().toLowerCase());
                            if (matchedEmp.empCode) seenUsers.add(String(matchedEmp.empCode).trim().toLowerCase());
                            if (matchedEmp.emp_code) seenUsers.add(String(matchedEmp.emp_code).trim().toLowerCase());
                            if (matchedEmp.name) seenUsers.add(String(matchedEmp.name).trim().toLowerCase());
                            try {
                                const rawCf = matchedEmp.customFields || matchedEmp.custom_fields || {};
                                const cf = typeof rawCf === 'string' ? JSON.parse(rawCf) : rawCf;
                                const leg = [...(cf.legacyCodes || []), ...(cf.aliases || []), cf.legacyId, cf.oldCode].filter(Boolean);
                                leg.forEach(l => seenUsers.add(String(l).trim().toLowerCase()));
                            } catch (err) {}
                        }

                        uniqueAttendance.push({
                            id: f.id,
                            userId: matchedEmp?.empCode || matchedEmp?.id || f.empCode || f.userId,
                            userName: matchedEmp?.name || f.userName,
                            empCode: matchedEmp?.empCode || matchedEmp?.emp_code || f.empCode || f.userId,
                            date: f.date || today,
                            checkIn: f.checkIn || (f.timestamp ? new Date(Number(f.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active Today'),
                            checkOut: null,
                            workMode: (f.workMode || matchedEmp?.workMode || matchedEmp?.primaryWorkMode || matchedEmp?.designation || 'OFFICE').toUpperCase(),
                            matchedEmp: matchedEmp || f.employee,
                            employee: matchedEmp || f.employee,
                            address: f.address
                        });
                    }
                }
            });

            setTodayAttendance(uniqueAttendance);
            if (uniqueAttendance.length > 0) {
                setTodayCount(uniqueAttendance.length);
            }
        } catch (fetchErr) {
            console.error('Detailed attendance fetch error:', fetchErr);
        } finally {
            isFetchingDetailedRef.current = false;
        }
    };

    const fetchDashboardData = async () => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        lastFetchTimeRef.current = Date.now();
        try {
            await Promise.allSettled([
                fetchSummaryCounts(),
                fetchApprovals()
            ]);
            // Non-blocking idle fetch for detailed modal data
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                window.requestIdleCallback(() => fetchDetailedAttendance(), { timeout: 4000 });
            } else {
                setTimeout(() => fetchDetailedAttendance(), 400);
            }
        } finally {
            isFetchingRef.current = false;
        }
    };

    const computeBirthdays = (empList) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const bdays = [];

        const parseDobString = (dobVal) => {
            if (!dobVal) return null;
            const str = String(dobVal).trim();
            if (str.includes('-')) {
                const parts = str.split('T')[0].split('-');
                if (parts.length === 3) {
                    const year = parseInt(parts[0], 10);
                    const month = parseInt(parts[1], 10) - 1;
                    const day = parseInt(parts[2], 10);
                    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                        return { month, day };
                    }
                }
            }
            const d = new Date(dobVal);
            if (!isNaN(d.getTime())) {
                return { month: d.getMonth(), day: d.getDate() };
            }
            return null;
        };

        empList.forEach((emp) => {
            const rawDob = emp.dob || emp.dateOfBirth || emp.birthDate;
            const parsed = parseDobString(rawDob);
            if (!parsed) return; // Skip if employee has no valid DOB

            const { month, day } = parsed;

            // Calculate next upcoming birthday date for current/next calendar year
            let targetBday = new Date(today.getFullYear(), month, day);
            targetBday.setHours(0, 0, 0, 0);

            // If birthday has already passed in current year, roll over to next year
            if (targetBday.getTime() < today.getTime()) {
                targetBday = new Date(today.getFullYear() + 1, month, day);
                targetBday.setHours(0, 0, 0, 0);
            }

            const diffTime = targetBday.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            let timeLabel = `In ${diffDays} days`;
            if (diffDays === 0) timeLabel = 'Today 🎉';
            else if (diffDays === 1) timeLabel = 'Tomorrow 🎈';

            const desigText = (emp.jobTitle && emp.jobTitle !== 'OFFICE' && emp.jobTitle !== 'FIELD') 
                ? emp.jobTitle 
                : (emp.department || (emp.designation && emp.designation !== 'OFFICE' && emp.designation !== 'FIELD' ? emp.designation : 'Team Member'));

            bdays.push({
                id: `bday-${emp.id}`,
                feedType: 'BIRTHDAY',
                name: emp.name,
                designation: desigText,
                dateStr: targetBday.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
                diffDays,
                timeLabel,
                avatar: emp.profilePhotoUrl || emp.avatar || null
            });
        });

        bdays.sort((a, b) => a.diffDays - b.diffDays);
        setBirthdays(bdays);
    };

    useEffect(() => {
        if (propEmployees && propEmployees.length > 0) {
            computeBirthdays(propEmployees);
        }
    }, [propEmployees]);

    const loadHolidays = (overrideHolidays = null) => {
        let calendarHolidays = [];
        if (overrideHolidays && Array.isArray(overrideHolidays)) {
            calendarHolidays = overrideHolidays;
        } else {
            try {
                const saved = localStorage.getItem('hrms_location_holiday_calendars');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        calendarHolidays = parsed[0].holidays || [];
                    }
                }
            } catch {}
        }

        if (!calendarHolidays || calendarHolidays.length === 0) {
            setHolidays([]);
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const currentYear = today.getFullYear();

        const processed = calendarHolidays.map(item => {
            let hDate = new Date(item.date);
            if (isNaN(hDate.getTime())) {
                hDate = new Date(currentYear, item.month !== undefined ? item.month : 0, item.day || 1);
            }
            hDate.setHours(0, 0, 0, 0);

            // If holiday has passed in current year, roll over to next year automatically
            if (hDate.getTime() < today.getTime()) {
                if (item.date && String(item.date).includes('-')) {
                    const parts = item.date.split('-');
                    if (parts.length >= 3) {
                        hDate = new Date(currentYear + 1, parseInt(parts[1]) - 1, parseInt(parts[2]));
                        hDate.setHours(0, 0, 0, 0);
                    }
                } else if (item.month !== undefined && item.day !== undefined) {
                    hDate = new Date(currentYear + 1, item.month, item.day);
                    hDate.setHours(0, 0, 0, 0);
                }
            }

            const diffTime = hDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            let countdown = 'Upcoming';
            if (diffDays === 0) countdown = 'Today 🎉';
            else if (diffDays === 1) countdown = 'Tomorrow 🎈';
            else if (diffDays > 1) countdown = `In ${diffDays} days`;

            const dateStr = !isNaN(hDate.getTime()) 
                ? hDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
                : (item.date || 'TBD');

            return {
                ...item,
                feedType: 'HOLIDAY',
                dateStr,
                diffDays,
                countdown
            };
        }).sort((a, b) => a.diffDays - b.diffDays);

        setHolidays(processed);
    };

    const fetchAnnouncements = async () => {
        setLoadingHighlights(true);
        try {
            const res = await api.getNotificationHistory({ limit: 15 });
            let history = [];
            if (res && res.data && Array.isArray(res.data)) {
                history = res.data;
            } else if (Array.isArray(res)) {
                history = res;
            }

            // Exclude chat push notifications from organization announcements
            const nonChatHistory = history.filter(item => {
                let payloadType = '';
                if (item.payload) {
                    if (typeof item.payload === 'string') {
                        try {
                            const parsed = JSON.parse(item.payload);
                            payloadType = (parsed.type || '').toUpperCase();
                        } catch {}
                    } else if (typeof item.payload === 'object') {
                        payloadType = (item.payload.type || '').toUpperCase();
                    }
                }
                const cat = (payloadType || item.target || item.type || '').toUpperCase();
                return cat !== 'CHAT' && cat !== 'CHAT_MESSAGE' && payloadType !== 'CHAT';
            });

            const formatted = nonChatHistory.map(item => {
                let payloadObj = {};
                if (item.payload) {
                    if (typeof item.payload === 'string') {
                        try {
                            payloadObj = JSON.parse(item.payload);
                        } catch {}
                    } else if (typeof item.payload === 'object') {
                        payloadObj = item.payload;
                    }
                }
                const payloadType = (payloadObj.type || '').toUpperCase();
                const cat = payloadType || item.target || 'ANNOUNCEMENT';

                // Recipient resolution
                let recipientLabel = item.recipientName || '';
                if (!recipientLabel && item.recipient?.name) {
                    recipientLabel = `${item.recipient.name} (${item.recipient.empCode || item.recipient.id || ''})`;
                }
                if (!recipientLabel && payloadObj.employeeName) {
                    recipientLabel = `${payloadObj.employeeName} (${payloadObj.empCode || payloadObj.employeeId || ''})`;
                }
                if (!recipientLabel && item.targetId) {
                    const matchedEmp = (propEmployees || []).find(e => e.id === item.targetId || e.empCode === item.targetId);
                    if (matchedEmp) {
                        recipientLabel = `${matchedEmp.name} (${matchedEmp.empCode || matchedEmp.id})`;
                    } else if (item.target === 'ALL') {
                        recipientLabel = 'All Employees';
                    } else {
                        recipientLabel = String(item.targetId);
                    }
                }

                // Breach location context
                let breachText = '';
                const nearestGf = item.breachDetails?.nearestGeofence || payloadObj.nearestGeofence;
                const distM = item.breachDetails?.distanceMeters || payloadObj.distanceMeters;
                if (nearestGf) {
                    const distKm = distM ? ` (~${(distM / 1000).toFixed(1)} km outside)` : '';
                    breachText = `${nearestGf}${distKm}`;
                }

                return {
                    id: item.id,
                    type: 'ANNOUNCEMENT',
                    category: cat.toUpperCase(),
                    title: item.title || 'System Notification',
                    body: item.body || item.message || '',
                    time: formatRelativeTime(item.createdAt),
                    createdAt: new Date(item.createdAt).getTime(),
                    recipient: recipientLabel,
                    breach: breachText,
                    target: item.target
                };
            });

            if (formatted.length === 0) {
                setAnnouncements([
                    {
                        id: 'def-1',
                        type: 'ANNOUNCEMENT',
                        category: 'FCM SYSTEM',
                        title: 'Direct FCM Notifications Online',
                        body: 'All clock-in and document push reminders are now live via Firebase Cloud Messaging.',
                        time: 'Just Now'
                    },
                    {
                        id: 'def-2',
                        type: 'ANNOUNCEMENT',
                        category: 'GENERAL',
                        title: 'Monthly Expense Submissions',
                        body: 'Please submit outstanding expense receipts before the payroll cycle generation.',
                        time: '2 hrs ago'
                    }
                ]);
            } else {
                setAnnouncements(formatted.sort((a, b) => b.createdAt - a.createdAt));
            }
        } catch (err) {
            console.error('Failed to fetch announcements:', err);
            setAnnouncements([
                {
                    id: 'fallback-1',
                    type: 'ANNOUNCEMENT',
                    category: 'FCM SYSTEM',
                    title: 'Direct FCM Notifications Online',
                    body: 'All clock-in and document push reminders are now live via Firebase Cloud Messaging.',
                    time: 'Just Now'
                },
                {
                    id: 'fallback-2',
                    type: 'ANNOUNCEMENT',
                    category: 'GENERAL',
                    title: 'Monthly Expense Submissions',
                    body: 'Please submit outstanding expense receipts before the payroll cycle generation.',
                    time: '2 hrs ago'
                }
            ]);
        } finally {
            setLoadingHighlights(false);
        }
    };

    useEffect(() => {
        fetchDashboardData();
        fetchAnnouncements();
        loadHolidays();

        // Controlled background auto-refresh every 60 seconds only if tab is visible and not busy
        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible' && !isFetchingRef.current) {
                fetchDashboardData();
            }
        }, 60000);

        // Smart refresh when admin tab gains focus or visibility (throttled to at least 5s since last fetch)
        const handleFocus = () => {
            if (document.visibilityState === 'visible' && !isFetchingRef.current && (Date.now() - lastFetchTimeRef.current > 5000)) {
                fetchDashboardData();
            }
        };

        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleFocus);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleFocus);
        };
    }, []);

    const handleCreateAnnouncement = async (e) => {
        e.preventDefault();
        if (!title.trim() || !body.trim()) {
            alert('Please enter title and announcement body.');
            return;
        }

        setSubmitting(true);
        try {
            await api.createAnnouncement(title.trim(), body.trim(), category);
            setTitle('');
            setBody('');
            setShowModal(false);
            await fetchAnnouncements();
        } catch (err) {
            console.error('Failed to post announcement:', err);
            alert('Failed to broadcast announcement. ' + (err.message || ''));
        } finally {
            setSubmitting(false);
        }
    };

    const getBadgeStyle = (cat) => {
        const catUpper = (cat || '').toUpperCase();
        if (catUpper.includes('OUTSIDE_GEOFENCE') || catUpper.includes('GEOFENCE')) {
            return { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.25)', icon: '⚠️' };
        }
        if (catUpper.includes('FCM') || catUpper.includes('SYSTEM')) {
            return { color: '#10b981', bg: 'rgba(16, 185, 129, 0.08)', border: 'rgba(16, 185, 129, 0.2)', icon: '🟢' };
        }
        if (catUpper.includes('HOLIDAY') || catUpper.includes('ALERT') || catUpper.includes('WARN')) {
            return { color: '#d97706', bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.2)', icon: '⚠️' };
        }
        if (catUpper.includes('URGENT') || catUpper.includes('IMPORTANT')) {
            return { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.2)', icon: '🚨' };
        }
        return { color: '#6366f1', bg: 'rgba(99, 102, 241, 0.08)', border: 'rgba(99, 102, 241, 0.2)', icon: '📢' };
    };

    // Filter dynamic combined feeds
    const getFilteredFeed = () => {
        if (activeTab === 'ANNOUNCEMENTS') return announcements;
        if (activeTab === 'BIRTHDAYS') return birthdays;
        if (activeTab === 'HOLIDAYS') return holidays;
        
        // ALL TAB: Interleave announcements, birthdays, and holidays
        const combined = [
            ...announcements.map(a => ({ ...a, feedType: 'ANNOUNCEMENT' })),
            ...birthdays.map(b => ({ ...b, feedType: 'BIRTHDAY' })),
            ...holidays.map(h => ({ ...h, feedType: 'HOLIDAY' }))
        ];
        return combined;
    };

    const currentFeedItems = getFilteredFeed();

    return (
        <div id="dashboard-view" className="view active" style={{ display: 'flex', flexDirection: 'column', gap: '16px', animation: 'fadeIn 0.5s ease-out' }}>
            
            {/* Welcome & Stats Section */}
            <div>
                {/* Header Section */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h2 style={{ fontSize: '24px', fontWeight: '800', margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
                        Welcome Back, Admin
                    </h2>
                </div>

            {/* Stats Overview Grid */}
            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                <div className="stat-card glass" onClick={() => onViewChange('employees-view')} style={{ cursor: 'pointer', padding: '22px 24px', display: 'flex', alignItems: 'center', gap: '20px', borderRadius: '20px', border: '1px solid var(--border-glass)', background: 'var(--bg-glass)', boxShadow: 'var(--shadow-md)', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                    <div className="stat-icon" style={{ background: '#2563eb', color: '#fff', width: '56px', height: '56px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', boxShadow: '0 4px 14px rgba(37, 99, 235, 0.25)' }}>
                        <i className="fa-solid fa-users"></i>
                    </div>
                    <div className="stat-details">
                        <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Total Workforce</p>
                        <h3 style={{ fontSize: '30px', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.5px' }}>{workforceCount > 0 ? workforceCount : ((totalEmployees && totalEmployees > 0) ? totalEmployees : '--')}</h3>
                    </div>
                </div>

                <div 
                    className="stat-card glass" 
                    onClick={() => { 
                        setShowPresentModal(true); 
                        if (todayAttendance.length === 0) fetchDetailedAttendance(); 
                    }} 
                    style={{ 
                        cursor: 'pointer', 
                        padding: '22px 24px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '20px', 
                        borderRadius: '20px', 
                        border: '1px solid var(--border-glass)', 
                        background: 'var(--bg-glass)', 
                        boxShadow: 'var(--shadow-md)', 
                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' 
                    }}
                    title="Click to view all employees present today"
                >
                    <div className="stat-icon" style={{ background: '#10b981', color: '#fff', width: '56px', height: '56px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)' }}>
                        <i className="fa-solid fa-clock"></i>
                    </div>
                    <div className="stat-details">
                        <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Present Today</p>
                        <h3 style={{ fontSize: '30px', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.5px' }}>{todayCount}</h3>
                    </div>
                </div>

                <div className="stat-card glass" onClick={() => onViewChange('leaves-view')} style={{ cursor: 'pointer', padding: '22px 24px', display: 'flex', alignItems: 'center', gap: '20px', borderRadius: '20px', border: '1px solid var(--border-glass)', background: 'var(--bg-glass)', boxShadow: 'var(--shadow-md)', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                    <div className="stat-icon" style={{ background: '#f59e0b', color: '#fff', width: '56px', height: '56px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', boxShadow: '0 4px 14px rgba(245, 158, 11, 0.25)' }}>
                        <i className="fa-solid fa-file-signature"></i>
                    </div>
                    <div className="stat-details">
                        <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Pending Leaves</p>
                        <h3 style={{ fontSize: '30px', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.5px' }}>{pendingLeavesCount}</h3>
                    </div>
                </div>

                <div className="stat-card glass" onClick={() => onViewChange('expenses-view')} style={{ cursor: 'pointer', padding: '22px 24px', display: 'flex', alignItems: 'center', gap: '20px', borderRadius: '20px', border: '1px solid var(--border-glass)', background: 'var(--bg-glass)', boxShadow: 'var(--shadow-md)', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                    <div className="stat-icon" style={{ background: '#ef4444', color: '#fff', width: '56px', height: '56px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', boxShadow: '0 4px 14px rgba(239, 68, 68, 0.25)' }}>
                        <i className="fa-solid fa-receipt"></i>
                    </div>
                    <div className="stat-details">
                        <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Pending Expenses</p>
                        <h3 style={{ fontSize: '30px', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.5px' }}>{pendingExpensesCount}</h3>
                    </div>
                </div>

                {/* 5th Stat Card: Holidays */}
                <div 
                    className="stat-card glass" 
                    onClick={() => setShowHolidayModal(true)} 
                    style={{ 
                        cursor: 'pointer', 
                        padding: '22px 24px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '20px', 
                        borderRadius: '20px', 
                        border: '1px solid var(--border-glass)', 
                        background: 'var(--bg-glass)', 
                        boxShadow: 'var(--shadow-md)', 
                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' 
                    }}
                    title="Click to view & manage Location Holiday Calendars"
                >
                    <div className="stat-icon" style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)', color: '#fff', width: '56px', height: '56px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', boxShadow: '0 4px 14px rgba(139, 92, 246, 0.25)' }}>
                        <i className="fa-solid fa-calendar-days"></i>
                    </div>
                    <div className="stat-details">
                        <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Holidays</p>
                        <h3 style={{ fontSize: '30px', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.5px' }}>{holidays.length}</h3>
                    </div>
                </div>
            </div>
            </div>

            {/* Quick Actions & Activity Layout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                
                {/* Left Column: Organization Highlights & Feeds (Announcements, Birthdays, Holidays) */}
                <div className="glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', borderRadius: '20px', boxShadow: 'var(--shadow-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                        <h3 style={{ fontSize: '20px', fontWeight: '800', margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i className="fa-solid fa-bullhorn" style={{ color: '#2563eb' }}></i> Organization Highlights
                        </h3>
                        
                        {!isTrackingManager && (
                            <button
                                onClick={() => setShowModal(true)}
                                style={{
                                    padding: '10px 18px',
                                    borderRadius: '12px',
                                    background: '#2563eb',
                                    color: 'white',
                                    border: 'none',
                                    fontSize: '13px',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    boxShadow: '0 4px 14px rgba(37, 99, 235, 0.25)',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                <i className="fa-solid fa-plus"></i> Post Announcement
                            </button>
                        )}
                    </div>

                    {/* Filter Tabs / Pills */}
                    <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px', overflowX: 'auto' }}>
                        <button
                            onClick={() => setActiveTab('ALL')}
                            style={{
                                padding: '7px 16px',
                                borderRadius: '20px',
                                border: '1px solid ' + (activeTab === 'ALL' ? '#2563eb' : 'var(--border-glass)'),
                                fontSize: '12px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                background: activeTab === 'ALL' ? '#2563eb' : 'var(--bg-glass)',
                                color: activeTab === 'ALL' ? 'white' : 'var(--text-secondary)',
                                transition: 'all 0.2s'
                            }}
                        >
                            🌟 All Highlights
                        </button>
                        <button
                            onClick={() => setActiveTab('ANNOUNCEMENTS')}
                            style={{
                                padding: '7px 16px',
                                borderRadius: '20px',
                                border: '1px solid ' + (activeTab === 'ANNOUNCEMENTS' ? '#2563eb' : 'var(--border-glass)'),
                                fontSize: '12px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                background: activeTab === 'ANNOUNCEMENTS' ? '#2563eb' : 'var(--bg-glass)',
                                color: activeTab === 'ANNOUNCEMENTS' ? 'white' : 'var(--text-secondary)',
                                transition: 'all 0.2s'
                            }}
                        >
                            📢 Announcements ({announcements.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('BIRTHDAYS')}
                            style={{
                                padding: '7px 16px',
                                borderRadius: '20px',
                                border: '1px solid ' + (activeTab === 'BIRTHDAYS' ? '#2563eb' : 'var(--border-glass)'),
                                fontSize: '12px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                background: activeTab === 'BIRTHDAYS' ? '#2563eb' : 'var(--bg-glass)',
                                color: activeTab === 'BIRTHDAYS' ? 'white' : 'var(--text-secondary)',
                                transition: 'all 0.2s'
                            }}
                        >
                            🎂 Birthdays ({birthdays.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('HOLIDAYS')}
                            style={{
                                padding: '7px 16px',
                                borderRadius: '20px',
                                border: '1px solid ' + (activeTab === 'HOLIDAYS' ? '#2563eb' : 'var(--border-glass)'),
                                fontSize: '12px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                background: activeTab === 'HOLIDAYS' ? '#2563eb' : 'var(--bg-glass)',
                                color: activeTab === 'HOLIDAYS' ? 'white' : 'var(--text-secondary)',
                                transition: 'all 0.2s'
                            }}
                        >
                            🌴 Holidays ({holidays.length})
                        </button>
                    </div>
                    
                    {/* Feed Cards Scroll Area */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '440px', overflowY: 'auto', paddingRight: '4px' }}>
                        {loadingHighlights ? (
                            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                                <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '20px', marginBottom: '8px' }}></i>
                                <p style={{ margin: 0, fontSize: '13px' }}>Loading highlights & announcements...</p>
                            </div>
                        ) : currentFeedItems.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                                <div style={{ fontSize: '32px', marginBottom: '8px' }}>✨</div>
                                <p style={{ margin: 0, fontSize: '13px', fontWeight: '600' }}>No items found in this section.</p>
                            </div>
                        ) : (
                            currentFeedItems.map((item, idx) => {
                                const feedType = item.feedType || (item.type && item.type.includes('Holiday') ? 'HOLIDAY' : item.category ? 'ANNOUNCEMENT' : 'BIRTHDAY');

                                // -------------------------------------------------------------
                                // 1. BIRTHDAY FEED CARD
                                // -------------------------------------------------------------
                                if (feedType === 'BIRTHDAY') {
                                    return (
                                        <div key={`bday-${item.id}-${idx}`} style={{
                                            padding: '16px',
                                            borderRadius: '14px',
                                            background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)',
                                            border: '1px solid rgba(236, 72, 153, 0.2)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justify: 'space-between',
                                            gap: '14px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                                <div style={{
                                                    width: '46px',
                                                    height: '46px',
                                                    borderRadius: '50%',
                                                    background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
                                                    color: 'white',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justify: 'center',
                                                    fontWeight: '800',
                                                    fontSize: '18px',
                                                    boxShadow: '0 4px 10px rgba(236, 72, 153, 0.3)'
                                                }}>
                                                    {item.avatar && getFullUrl(item.avatar) ? (
                                                        <img 
                                                            src={getFullUrl(item.avatar)} 
                                                            alt={item.name}
                                                            onClick={() => setPreviewImage({ url: getFullUrl(item.avatar), title: item.name, subtitle: item.designation })}
                                                            title="Click to view full photo in same tab"
                                                            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }} 
                                                            onError={(e) => {
                                                                e.currentTarget.onerror = null;
                                                                e.currentTarget.style.display = 'none';
                                                                if (e.currentTarget.nextSibling) {
                                                                    e.currentTarget.nextSibling.style.display = 'inline';
                                                                }
                                                            }}
                                                            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} 
                                                        />
                                                    ) : null}
                                                    <span style={{ display: (item.avatar && getFullUrl(item.avatar)) ? 'none' : 'inline' }}>
                                                        {item.name ? item.name.charAt(0).toUpperCase() : '🎂'}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ fontSize: '11px', fontWeight: '800', color: '#ec4899', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                            🎂 UPCOMING BIRTHDAY
                                                        </span>
                                                        <span style={{ background: '#ec4899', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '800' }}>
                                                            {item.timeLabel}
                                                        </span>
                                                    </div>
                                                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>{item.name}</h4>
                                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{item.designation} • {item.dateStr}</span>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => handleWishBirthday(item)}
                                                disabled={wishingEmpId === (item.id || item.name)}
                                                style={{
                                                    padding: '8px 14px',
                                                    borderRadius: '8px',
                                                    background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
                                                    color: 'white',
                                                    border: 'none',
                                                    fontSize: '12px',
                                                    fontWeight: '700',
                                                    cursor: wishingEmpId === (item.id || item.name) ? 'not-allowed' : 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    whiteSpace: 'nowrap',
                                                    boxShadow: '0 4px 12px rgba(236, 72, 153, 0.3)',
                                                    transition: 'all 0.2s ease',
                                                    opacity: wishingEmpId === (item.id || item.name) ? 0.7 : 1
                                                }}
                                            >
                                                {wishingEmpId === (item.id || item.name) ? (
                                                    <><i className="fa-solid fa-spinner fa-spin"></i> Sending...</>
                                                ) : (
                                                    <>Wish 🎉</>
                                                )}
                                            </button>
                                        </div>
                                    );
                                }

                                // -------------------------------------------------------------
                                // 2. HOLIDAY / FESTIVAL FEED CARD
                                // -------------------------------------------------------------
                                if (feedType === 'HOLIDAY') {
                                    return (
                                        <div key={`hol-${item.id}-${idx}`} style={{
                                            padding: '16px',
                                            borderRadius: '14px',
                                            background: item.bg || 'rgba(249, 115, 22, 0.08)',
                                            border: `1px solid ${item.color || '#f97316'}33`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justify: 'space-between',
                                            gap: '14px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                                <div style={{
                                                    width: '46px',
                                                    height: '46px',
                                                    borderRadius: '12px',
                                                    background: item.color || '#f97316',
                                                    color: 'white',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justify: 'center',
                                                    fontSize: '22px',
                                                    boxShadow: '0 4px 10px rgba(0,0,0,0.15)'
                                                }}>
                                                    🏖️
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ fontSize: '11px', fontWeight: '800', color: item.color || '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                            {item.type || 'HOLIDAY'}
                                                        </span>
                                                    </div>
                                                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>{item.title}</h4>
                                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Date: <b>{item.dateStr}</b></span>
                                                </div>
                                            </div>

                                            <span style={{
                                                padding: '6px 12px',
                                                borderRadius: '20px',
                                                background: item.color || '#f97316',
                                                color: 'white',
                                                fontSize: '11px',
                                                fontWeight: '800',
                                                whiteSpace: 'nowrap'
                                            }}>
                                                {item.countdown}
                                            </span>
                                        </div>
                                    );
                                }

                                // -------------------------------------------------------------
                                // 3. ADMIN ANNOUNCEMENT FEED CARD
                                // -------------------------------------------------------------
                                const styleInfo = getBadgeStyle(item.category);
                                const isGeofenceAlert = item.category === 'OUTSIDE_GEOFENCE' || (item.title && item.title.includes('Geofence'));
                                return (
                                    <div key={`ann-${item.id}-${idx}`} style={{
                                        padding: '16px',
                                        borderRadius: '14px',
                                        background: styleInfo.bg,
                                        border: `1px solid ${styleInfo.border}`,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '11px', fontWeight: '800', color: styleInfo.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                    {styleInfo.icon} {item.category}
                                                </span>
                                                {item.recipient && (
                                                    <span style={{ 
                                                        fontSize: '11px', 
                                                        fontWeight: '700', 
                                                        background: 'rgba(99, 102, 241, 0.15)', 
                                                        color: '#818cf8', 
                                                        padding: '2px 8px', 
                                                        borderRadius: '12px', 
                                                        border: '1px solid rgba(99, 102, 241, 0.3)',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}>
                                                        <i className="fa-solid fa-user" style={{ fontSize: '9px' }}></i> {item.recipient}
                                                    </span>
                                                )}
                                            </div>
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>{item.time}</span>
                                        </div>
                                        {item.breach && (
                                            <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <i className="fa-solid fa-location-dot"></i> Breached Boundary: <b>{item.breach}</b>
                                            </div>
                                        )}
                                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                                            {item.title}
                                            {isGeofenceAlert && item.recipient ? ` — ${item.recipient}` : ''}
                                        </h4>
                                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>{item.body}</p>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Right Column: Pending Action Items */}
                <div className="glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}><i className="fa-solid fa-bell" style={{ color: 'var(--primary-color)', marginRight: '8px' }}></i> Needs Attention</h3>
                        <span style={{ background: 'var(--primary-color)', color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
                            {pendingLeaves.length + pendingExpenses.length} Items
                        </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: '440px', paddingRight: '10px' }}>
                        {pendingLeaves.length === 0 && pendingExpenses.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                <div style={{ fontSize: '40px', marginBottom: '16px', opacity: '0.5' }}>🎉</div>
                                <p style={{ fontSize: '16px', fontWeight: '500' }}>You're all caught up!</p>
                                <p style={{ fontSize: '13px' }}>No pending leaves or expenses.</p>
                            </div>
                        ) : (
                            <>
                                {pendingLeaves.slice(0, 5).map(leave => (
                                    <div key={leave.id} onClick={() => onViewChange('leaves-view')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'var(--input-bg)', border: '1px solid var(--border-subtle)', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s ease' }} className="hover-lift">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--panel-bg)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)' }}>
                                                <i className="fa-solid fa-calendar-minus"></i>
                                            </div>
                                            <div>
                                                <p style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>Leave Request</p>
                                                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Employee ID: {leave.userId}</p>
                                            </div>
                                        </div>
                                        <div style={{ background: 'var(--primary-color)', color: '#fff', padding: '4px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600' }}>Review</div>
                                    </div>
                                ))}
                                
                                {pendingExpenses.slice(0, 5).map(exp => (
                                    <div key={exp.id} onClick={() => onViewChange('expenses-view')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'var(--input-bg)', border: '1px solid var(--border-subtle)', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s ease' }} className="hover-lift">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--panel-bg)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)' }}>
                                                <i className="fa-solid fa-receipt"></i>
                                            </div>
                                            <div>
                                                <p style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>Expense Claim</p>
                                                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Amount: ₹{exp.amount} • {exp.userName || exp.name || 'Employee'} ({exp.empCode || exp.userId})</p>
                                            </div>
                                        </div>
                                        <div style={{ background: 'var(--primary-color)', color: '#fff', padding: '4px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600' }}>Review</div>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>

            </div>

            {/* Post Announcement Modal Overlay */}
            {showModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0, 0, 0, 0.65)',
                    backdropFilter: 'blur(5px)',
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'center',
                    zIndex: 99999
                }}>
                    <div style={{
                        background: 'var(--bg-panel, #1e293b)',
                        border: '1px solid var(--border-glass, #334155)',
                        borderRadius: '16px',
                        padding: '28px',
                        width: '450px',
                        maxWidth: '90%',
                        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '20px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)' }}>
                                <i className="fa-solid fa-paper-plane" style={{ color: 'var(--primary-color)', marginRight: '8px' }}></i>
                                Post New Announcement
                            </h3>
                            <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer' }}>
                                &times;
                            </button>
                        </div>

                        <form onSubmit={handleCreateAnnouncement} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>Category Tag</label>
                                <select
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', fontWeight: '600' }}
                                >
                                    <option value="ANNOUNCEMENT">📢 General Announcement</option>
                                    <option value="FCM SYSTEM">🟢 FCM System Alert</option>
                                    <option value="HOLIDAY ALERT">🏖️ Holiday & Event Notice</option>
                                    <option value="URGENT">🚨 Urgent Notice</option>
                                </select>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>Announcement Title</label>
                                <input
                                    type="text"
                                    placeholder="Enter announcement headline..."
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    required
                                    style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', fontWeight: '600' }}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>Message Body</label>
                                <textarea
                                    rows={4}
                                    placeholder="Enter full announcement message..."
                                    value={body}
                                    onChange={(e) => setBody(e.target.value)}
                                    required
                                    style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', fontWeight: '500', resize: 'vertical' }}
                                />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    style={{ padding: '10px 20px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)', fontWeight: '600', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    style={{ padding: '10px 24px', borderRadius: '8px', background: 'var(--primary-color)', color: 'white', border: 'none', fontWeight: '700', cursor: 'pointer' }}
                                >
                                    {submitting ? 'Publishing...' : 'Publish & Broadcast'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Modal for Today's Present Employees */}
            {showPresentModal && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(17, 24, 39, 0.65)',
                        backdropFilter: 'blur(6px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000,
                        padding: '20px',
                        animation: 'fadeIn 0.2s ease-out'
                    }}
                    onClick={() => setShowPresentModal(false)}
                >
                    <div 
                        style={{
                            background: 'var(--bg-glass)',
                            borderRadius: '24px',
                            maxWidth: '680px',
                            width: '100%',
                            maxHeight: '85vh',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: 'var(--shadow-lg)',
                            border: '1px solid var(--border-glass)',
                            overflow: 'hidden'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--table-header)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', fontSize: '20px' }}>
                                    <i className="fa-solid fa-user-check"></i>
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
                                        Present Employees Today
                                    </h3>
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                                        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })} • <b style={{ color: '#10b981' }}>{todayAttendance.length || todayCount} Staff Present</b>
                                    </span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <button 
                                    onClick={() => fetchDetailedAttendance()}
                                    title="Refresh attendance records"
                                    style={{ 
                                        height: '32px', 
                                        padding: '0 12px', 
                                        borderRadius: '8px', 
                                        background: 'rgba(37, 99, 235, 0.1)', 
                                        border: '1px solid rgba(37, 99, 235, 0.25)', 
                                        color: '#2563eb', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '6px', 
                                        cursor: 'pointer', 
                                        fontSize: '12.5px', 
                                        fontWeight: 600 
                                    }}
                                >
                                    <i className="fa-solid fa-arrows-rotate"></i> Sync
                                </button>
                                <button 
                                    onClick={() => setShowPresentModal(false)}
                                    style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '14px' }}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        {/* Search Filter Bar */}
                        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border-glass)', background: 'var(--bg-glass)' }}>
                            <div style={{ position: 'relative' }}>
                                <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: '14px' }}></i>
                                <input 
                                    type="text"
                                    placeholder="Search present employee by name or designation..."
                                    value={presentSearchTerm}
                                    onChange={(e) => setPresentSearchTerm(e.target.value)}
                                    style={{ width: '100%', padding: '10px 14px 10px 38px', borderRadius: '10px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', fontSize: '13.5px', color: 'var(--text-primary)', outline: 'none' }}
                                />
                            </div>
                        </div>

                        {/* Present Employees List */}
                        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {(() => {
                                if (todayAttendance.length === 0 && todayCount > 0) {
                                    return (
                                        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                            <LoadingSpinner size={32} message="Loading present employees roster..." minHeight="100px" />
                                        </div>
                                    );
                                }

                                const filtered = todayAttendance.filter(item => {
                                    const emp = item.matchedEmp || {};
                                    const name = (emp.name || item.userName || item.name || item.userId || '').toLowerCase();
                                    const code = (emp.empCode || item.userId || '').toLowerCase();
                                    const desig = (item.designation || item.jobTitle || emp.designation || emp.jobTitle || '').toLowerCase();
                                    const term = presentSearchTerm.toLowerCase();
                                    return name.includes(term) || code.includes(term) || desig.includes(term);
                                });

                                if (filtered.length === 0) {
                                    return (
                                        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                             <div style={{ fontSize: '32px', marginBottom: '10px' }}>🔍</div>
                                            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>No Present Employees Found</h4>
                                            <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
                                                {presentSearchTerm ? `No matches for "${presentSearchTerm}"` : 'No clock-in records logged for today yet.'}
                                            </p>
                                        </div>
                                    );
                                }

                                return filtered.map((item, index) => {
                                    const emp = item.matchedEmp || item.employee || {};
                                    const empName = emp.name || item.userName || item.name || item.employeeName || item.userId || `Employee #${index + 1}`;
                                    const empCode = emp.empCode || emp.emp_code || emp.employeeId || item.empCode || (item.userId && !String(item.userId).startsWith('EMP0') ? item.userId : '');
                                    const checkInTime = item.checkIn || item.time || item.createdAt ? (item.checkIn || new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : 'Checked In';
                                    
                                    // Official duty mode determination: prioritize today's active punch workMode
                                    const officialDuty = String(item.workMode || item.mode || emp.primaryWorkMode || emp.workMode || emp.designation || '').trim().toUpperCase();
                                    const isFieldWorker = officialDuty.includes('FIELD');
                                    
                                    // Job title subtitle
                                    const jobTitleText = (emp.jobTitle && emp.jobTitle !== 'OFFICE' && emp.jobTitle !== 'FIELD') 
                                        ? emp.jobTitle 
                                        : (emp.department || (item.designation && item.designation !== 'OFFICE' && item.designation !== 'FIELD' ? item.designation : 'Team Member'));

                                    const rawPhoto = emp.profilePhotoUrl || emp.avatar || item.profilePhotoUrl;
                                    const photoUrl = rawPhoto ? getFullUrl(rawPhoto) : null;

                                    return (
                                        <div 
                                            key={item.id || item.userId || `present-${index}`}
                                            style={{
                                                padding: '14px 18px',
                                                borderRadius: '14px',
                                                border: '1px solid var(--border-glass)',
                                                background: 'var(--input-bg)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: '16px',
                                                transition: 'all 0.2s ease'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                                {photoUrl ? (
                                                    <img 
                                                        src={photoUrl} 
                                                        alt={empName}
                                                        onClick={() => setPreviewImage({ url: photoUrl, title: empName, subtitle: empCode ? `${empCode} • ${jobTitleText}` : jobTitleText })}
                                                        title="Click to view full photo in same tab"
                                                        style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #2563eb', flexShrink: 0, cursor: 'pointer' }}
                                                        onError={(e) => {
                                                            e.currentTarget.onerror = null;
                                                            e.currentTarget.style.display = 'none';
                                                            if (e.currentTarget.nextSibling) {
                                                                e.currentTarget.nextSibling.style.display = 'flex';
                                                            }
                                                        }}
                                                        style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #2563eb', flexShrink: 0 }}
                                                    />
                                                ) : null}
                                                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#2563eb', color: '#ffffff', display: photoUrl ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '15px', flexShrink: 0 }}>
                                                    {empName.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{empName}</h4>
                                                        {empCode && (
                                                            <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600, background: 'rgba(37, 99, 235, 0.1)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                                                                {empCode}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>{jobTitleText}</span>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                {/* Duty Mode Badge */}
                                                <span 
                                                    style={{
                                                        padding: '4px 10px',
                                                        borderRadius: '20px',
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        background: isFieldWorker ? 'rgba(245, 158, 11, 0.1)' : 'rgba(37, 99, 235, 0.1)',
                                                        color: isFieldWorker ? '#d97706' : '#2563eb',
                                                        border: isFieldWorker ? '1px solid rgba(245, 158, 11, 0.2)' : '1px solid rgba(37, 99, 235, 0.2)'
                                                    }}
                                                >
                                                    {isFieldWorker ? '🚗 Field Duty' : '🏢 Office'}
                                                </span>

                                                {/* Check-In / Check-Out Time Badge */}
                                                <div style={{ textAlign: 'right' }}>
                                                    {(() => {
                                                        const hasCheckedOut = item.checkOut && item.checkOut !== 'null' && item.checkOut !== 'undefined' && String(item.checkOut).trim() !== '' && String(item.checkOut).trim() !== '-';
                                                        if (hasCheckedOut) {
                                                            return (
                                                                <>
                                                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b', display: 'block' }}>
                                                                        🔴 {item.checkOut}
                                                                    </span>
                                                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>Clocked Out (In: {checkInTime})</span>
                                                                </>
                                                            );
                                                        }
                                                        return (
                                                            <>
                                                                <span style={{ fontSize: '12px', fontWeight: 700, color: '#10b981', display: 'block' }}>
                                                                    🟢 {checkInTime}
                                                                </span>
                                                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>Clocked In</span>
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        {/* Modal Footer */}
                        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--table-header)' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                                Total Present: <b style={{ color: 'var(--text-primary)' }}>{todayAttendance.length} Employees</b>
                            </span>
                            <button
                                onClick={() => {
                                    setShowPresentModal(false);
                                    if (onViewChange) onViewChange('attendance-view');
                                }}
                                style={{
                                    padding: '9px 18px',
                                    borderRadius: '10px',
                                    background: '#10b981',
                                    color: '#ffffff',
                                    border: 'none',
                                    fontSize: '13px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                View Full Attendance Register ➔
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Keka-Style Multi-Location Holiday Calendar Management Modal */}
            <HolidayCalendarModal
                isOpen={showHolidayModal}
                onClose={() => setShowHolidayModal(false)}
                onHolidaysUpdated={(hols) => loadHolidays(hols)}
            />

            {/* Fullscreen Image Preview Lightbox Modal (Same Tab, Cut / Close Option) */}
            {previewImage && (
                <div 
                    onClick={() => setPreviewImage(null)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.88)',
                        backdropFilter: 'blur(10px)',
                        zIndex: 99999,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justify: 'center',
                        padding: '24px',
                        animation: 'fadeIn 0.2s ease-out'
                    }}
                >
                    <div 
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'relative',
                            maxHeight: '85vh',
                            maxWidth: '90vw',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '16px',
                            background: 'rgba(30, 41, 59, 0.95)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '20px',
                            padding: '28px 36px',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)'
                        }}
                    >
                        {/* Close / Cut ('✕') Button */}
                        <button
                            type="button"
                            onClick={() => setPreviewImage(null)}
                            style={{
                                position: 'absolute',
                                top: '14px',
                                right: '14px',
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                background: 'rgba(255, 255, 255, 0.15)',
                                border: '1px solid rgba(255, 255, 255, 0.25)',
                                color: '#ffffff',
                                fontSize: '18px',
                                fontWeight: '800',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                zIndex: 10
                            }}
                            title="Close Preview (Esc)"
                            onMouseEnter={(e) => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'; }}
                        >
                            ✕
                        </button>

                        {/* Full Size Preview Image */}
                        <img 
                            src={previewImage.url} 
                            alt={previewImage.title || 'Profile Photo'} 
                            style={{
                                maxHeight: '60vh',
                                maxWidth: '75vw',
                                borderRadius: '14px',
                                objectFit: 'contain',
                                border: '3px solid rgba(255, 255, 255, 0.3)',
                                boxShadow: '0 15px 30px rgba(0,0,0,0.4)'
                            }}
                        />

                        {/* Title & Info */}
                        {previewImage.title && (
                            <div style={{ textAlign: 'center' }}>
                                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.01em' }}>
                                    {previewImage.title}
                                </h3>
                                {previewImage.subtitle && (
                                    <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>
                                        {previewImage.subtitle}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
