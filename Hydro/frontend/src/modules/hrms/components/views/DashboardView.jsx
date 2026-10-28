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

    // Highlights Slide Carousel State
    const [activeSlide, setActiveSlide] = useState(0);
    const [isSliderHovered, setIsSliderHovered] = useState(false);
    const sliderRef = useRef(null);

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

const DEFAULT_ANNOUNCEMENTS = [
    {
        id: 'gf-alert-1',
        type: 'ANNOUNCEMENT',
        category: 'OUTSIDE_GEOFENCE',
        recipient: 'Roop Singh (HMPL40)',
        title: 'Geofence Boundary Alert — Roop Singh (HMPL40)',
        site: 'Gurana & Associates',
        distance: '2.5 km away',
        breach: 'Wadala Bhiwandi (~2.4 km outside)',
        body: 'You have moved outside the approved geofence area. Please ensure you are at the correct location. If you think this is an error, contact your manager.',
        time: '28 mins ago',
        createdAt: Date.now() - 28 * 60 * 1000
    },
    {
        id: 'gf-alert-2',
        type: 'ANNOUNCEMENT',
        category: 'OUTSIDE_GEOFENCE',
        recipient: 'Vikash Kumar (HMPL23)',
        title: 'Geofence Boundary Alert — Vikash Kumar (HMPL23)',
        site: 'Gurana & Associates',
        distance: '4.8 km away',
        breach: 'Wadala Bhiwandi (~3.1 km outside)',
        body: 'You have moved outside the approved geofence area. Please ensure you are at the correct location. If you think this is an error, contact your manager.',
        time: '37 mins ago',
        createdAt: Date.now() - 37 * 60 * 1000
    },
    {
        id: 'ann-townhall-3',
        type: 'ANNOUNCEMENT',
        category: 'ANNOUNCEMENT',
        recipient: 'All Workforce',
        title: 'Q4 All-Hands Town Hall & Roadmap Review',
        site: 'Headquarters Broadcast',
        distance: 'HQ Broadcast',
        body: 'Join leadership this Friday at 4:00 PM for the quarterly company all-hands. We will cover project milestones, site expansions, and team performance recognitions.',
        time: '2 hours ago',
        createdAt: Date.now() - 2 * 60 * 60 * 1000
    },
    {
        id: 'ann-policy-4',
        type: 'ANNOUNCEMENT',
        category: 'POLICY',
        recipient: 'Field & Site Staff',
        title: 'Updated Travel & Expense Reimbursement Policy',
        site: 'Finance & HR Guidelines',
        distance: 'Policy Update',
        body: 'Effective next Monday, digital GST invoices are required for all fuel and hotel claims. Please submit claims within 7 days of trip completion via the Expenses portal.',
        time: '5 hours ago',
        createdAt: Date.now() - 5 * 60 * 60 * 1000
    },
    {
        id: 'ann-milestone-5',
        type: 'ANNOUNCEMENT',
        category: 'MILESTONE',
        recipient: 'Engineering Division',
        title: 'Project Handover: Wadala Bhiwandi Phase-1 Ready',
        site: 'Wadala Bhiwandi Site',
        distance: 'Milestone Met',
        body: 'Congratulations to the civil and operations crew for completing the Phase-1 pipeline infrastructure 4 days ahead of schedule with zero safety incidents!',
        time: 'Yesterday',
        createdAt: Date.now() - 24 * 60 * 60 * 1000
    },
    {
        id: 'ann-urgent-6',
        type: 'ANNOUNCEMENT',
        category: 'URGENT',
        recipient: 'All Field Engineers',
        title: 'Severe Weather & Heat Advisory for Outdoor Teams',
        site: 'All Active Sites',
        distance: 'Safety Notice',
        body: 'Due to forecasted high temperatures across regional sites, site supervisors are instructed to schedule heavy equipment operations before 11:30 AM and ensure hydration stations are stocked.',
        time: 'Yesterday',
        createdAt: Date.now() - 28 * 60 * 60 * 1000
    }
];

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
                setAnnouncements(DEFAULT_ANNOUNCEMENTS);
            } else {
                // If backend has fewer than 3 alerts, merge with defaults for rich display
                const merged = formatted.length < 3 
                    ? [...formatted, ...DEFAULT_ANNOUNCEMENTS.slice(formatted.length)]
                    : formatted;
                setAnnouncements(merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
            }
        } catch (err) {
            console.error('Failed to fetch announcements:', err);
            setAnnouncements(DEFAULT_ANNOUNCEMENTS);
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

    // Enhanced badge theme mapping for all announcement categories
    const getBadgeStyle = (cat) => {
        const catUpper = String(cat || '').toUpperCase();
        if (catUpper.includes('GEOFENCE') || catUpper.includes('OUTSIDE')) {
            return { color: '#d97706', bg: '#fffdf5', border: '#fef3c7', badgeBg: '#fef3c7', badgeText: '#d97706', icon: 'fa-triangle-exclamation', label: 'Geofence Alert' };
        }
        if (catUpper.includes('POLICY') || catUpper.includes('HR') || catUpper.includes('COMPLIANCE')) {
            return { color: '#059669', bg: '#f0fdf4', border: '#bbf7d0', badgeBg: '#dcfce7', badgeText: '#15803d', icon: 'fa-file-shield', label: 'Policy Update' };
        }
        if (catUpper.includes('MILESTONE') || catUpper.includes('SUCCESS') || catUpper.includes('COMPLETION')) {
            return { color: '#7c3aed', bg: '#faf5ff', border: '#e9d5ff', badgeBg: '#f3e8ff', badgeText: '#7e22ce', icon: 'fa-trophy', label: 'Milestone' };
        }
        if (catUpper.includes('URGENT') || catUpper.includes('IMPORTANT') || catUpper.includes('SAFETY') || catUpper.includes('ALERT')) {
            return { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', badgeBg: '#fee2e2', badgeText: '#b91c1c', icon: 'fa-bell', label: 'Urgent Notice' };
        }
        return { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', badgeBg: '#dbeafe', badgeText: '#1d4ed8', icon: 'fa-bullhorn', label: 'Announcement' };
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

    // Slider Navigation Functions
    const handleTabChange = (newTab) => {
        setActiveTab(newTab);
        setActiveSlide(0);
        if (sliderRef.current) {
            sliderRef.current.scrollTo({ left: 0, behavior: 'smooth' });
        }
    };

    const goToSlide = (idx) => {
        const total = currentFeedItems.length;
        if (total === 0 || !sliderRef.current) return;
        const validIdx = Math.max(0, Math.min(idx, total - 1));
        sliderRef.current.scrollTo({
            left: validIdx * sliderRef.current.offsetWidth,
            behavior: 'smooth'
        });
        setActiveSlide(validIdx);
    };

    const nextSlide = () => {
        if (currentFeedItems.length <= 1) return;
        goToSlide((activeSlide + 1) % currentFeedItems.length);
    };

    const prevSlide = () => {
        if (currentFeedItems.length <= 1) return;
        goToSlide((activeSlide - 1 + currentFeedItems.length) % currentFeedItems.length);
    };

    const handleSlideScroll = (e) => {
        const el = e.currentTarget;
        if (!el || el.offsetWidth === 0) return;
        const newIndex = Math.round(el.scrollLeft / el.offsetWidth);
        if (newIndex !== activeSlide && newIndex >= 0 && newIndex < currentFeedItems.length) {
            setActiveSlide(newIndex);
        }
    };

    // Auto-advance announcement slides every 5.5s (pauses on touch/hover)
    useEffect(() => {
        if (isSliderHovered || currentFeedItems.length <= 1) return;
        const timer = setInterval(() => {
            setActiveSlide(prev => {
                const next = (prev + 1) % currentFeedItems.length;
                if (sliderRef.current) {
                    sliderRef.current.scrollTo({
                        left: next * sliderRef.current.offsetWidth,
                        behavior: 'smooth'
                    });
                }
                return next;
            });
        }, 5500);
        return () => clearInterval(timer);
    }, [isSliderHovered, currentFeedItems.length]);

    return (
        <div id="dashboard-view" className="view active" style={{ display: 'flex', flexDirection: 'column', gap: '16px', animation: 'fadeIn 0.5s ease-out' }}>
            
            {/* Welcome & Stats Section */}
            <div>
                {/* Header Section */}
                <div className="dashboard-welcome-header" style={{ display: 'flex', flexDirection: 'column', marginBottom: '14px' }}>
                    <span className="desktop-only-inline" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>Overview</span>
                    <h2 className="welcome-heading-text" style={{ fontSize: '22px', fontWeight: '800', margin: '2px 0 0 0', color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
                        Welcome Back, {adminUser?.name || 'Admin'}
                    </h2>
                </div>

            {/* Stats Overview Grid (Matches Mobile 1 Full + 2x2 Mockup) */}
            <div className="stats-grid kpi-grid-mobile">
                {/* 1. Total Workforce (Full Width on Mobile) */}
                <div 
                    className="stat-card kpi-card kpi-card-workforce" 
                    onClick={() => onViewChange('employees-view')} 
                    style={{ 
                        cursor: 'pointer', 
                        padding: '14px 16px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '14px', 
                        borderRadius: '16px', 
                        border: '1px solid var(--border-glass, #e2e8f0)', 
                        background: 'var(--bg-glass, #ffffff)', 
                        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.03))' 
                    }}
                >
                    <div className="kpi-icon-box" style={{ 
                        background: '#2563eb', 
                        color: '#fff', 
                        width: '44px', 
                        height: '44px', 
                        borderRadius: '12px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontSize: '18px', 
                        flexShrink: 0 
                    }}>
                        <i className="fa-solid fa-users"></i>
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="kpi-label" style={{ color: 'var(--text-muted, #64748b)', fontSize: '12px', fontWeight: 600, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            Total Workforce
                        </div>
                        <div className="kpi-value" style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary, #0f172a)', lineHeight: 1.15, margin: 0 }}>
                            {workforceCount > 0 ? workforceCount : ((totalEmployees && totalEmployees > 0) ? totalEmployees : '--')}
                        </div>
                    </div>
                </div>

                {/* 2. Present Today */}
                <div 
                    className="stat-card kpi-card" 
                    onClick={() => { 
                        setShowPresentModal(true); 
                        if (todayAttendance.length === 0) fetchDetailedAttendance(); 
                    }} 
                    style={{ 
                        cursor: 'pointer', 
                        padding: '14px 16px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '14px', 
                        borderRadius: '16px', 
                        border: '1px solid var(--border-glass, #e2e8f0)', 
                        background: 'var(--bg-glass, #ffffff)', 
                        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.03))' 
                    }}
                    title="Click to view all employees present today"
                >
                    <div className="kpi-icon-box" style={{ 
                        background: '#10b981', 
                        color: '#fff', 
                        width: '44px', 
                        height: '44px', 
                        borderRadius: '12px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontSize: '18px', 
                        flexShrink: 0 
                    }}>
                        <i className="fa-solid fa-shield-halved"></i>
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="kpi-label" style={{ color: 'var(--text-muted, #64748b)', fontSize: '11px', fontWeight: 700, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            Present Today
                        </div>
                        <div className="kpi-value" style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary, #0f172a)', lineHeight: 1.15, margin: 0 }}>
                            {todayCount > 0 ? todayCount : 0}
                        </div>
                    </div>
                </div>

                {/* 3. Pending Leaves */}
                <div 
                    className="stat-card kpi-card" 
                    onClick={() => onViewChange('leaves-view')} 
                    style={{ 
                        cursor: 'pointer', 
                        padding: '14px 16px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '14px', 
                        borderRadius: '16px', 
                        border: '1px solid var(--border-glass, #e2e8f0)', 
                        background: 'var(--bg-glass, #ffffff)', 
                        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.03))' 
                    }}
                >
                    <div className="kpi-icon-box" style={{ 
                        background: '#f59e0b', 
                        color: '#fff', 
                        width: '44px', 
                        height: '44px', 
                        borderRadius: '12px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontSize: '18px', 
                        flexShrink: 0 
                    }}>
                        <i className="fa-solid fa-file-signature"></i>
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="kpi-label" style={{ color: 'var(--text-muted, #64748b)', fontSize: '11px', fontWeight: 700, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            Pending Leaves
                        </div>
                        <div className="kpi-value" style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary, #0f172a)', lineHeight: 1.15, margin: 0 }}>
                            {pendingLeavesCount}
                        </div>
                    </div>
                </div>

                {/* 4. Pending Expenses */}
                <div 
                    className="stat-card kpi-card" 
                    onClick={() => onViewChange('expenses-view')} 
                    style={{ 
                        cursor: 'pointer', 
                        padding: '14px 16px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '14px', 
                        borderRadius: '16px', 
                        border: '1px solid var(--border-glass, #e2e8f0)', 
                        background: 'var(--bg-glass, #ffffff)', 
                        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.03))' 
                    }}
                >
                    <div className="kpi-icon-box" style={{ 
                        background: '#ef4444', 
                        color: '#fff', 
                        width: '44px', 
                        height: '44px', 
                        borderRadius: '12px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontSize: '18px', 
                        flexShrink: 0 
                    }}>
                        <i className="fa-solid fa-receipt"></i>
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="kpi-label" style={{ color: 'var(--text-muted, #64748b)', fontSize: '11px', fontWeight: 700, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            Pending Expenses
                        </div>
                        <div className="kpi-value" style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary, #0f172a)', lineHeight: 1.15, margin: 0 }}>
                            {pendingExpensesCount}
                        </div>
                    </div>
                </div>

                {/* 5. Holidays (Completes 2x2 grid on mobile) */}
                <div 
                    className="stat-card kpi-card" 
                    onClick={() => setShowHolidayModal(true)} 
                    style={{ 
                        cursor: 'pointer', 
                        padding: '14px 16px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '14px', 
                        borderRadius: '16px', 
                        border: '1px solid var(--border-glass, #e2e8f0)', 
                        background: 'var(--bg-glass, #ffffff)', 
                        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.03))' 
                    }}
                    title="Click to view & manage Location Holiday Calendars"
                >
                    <div className="kpi-icon-box" style={{ 
                        background: '#8b5cf6', 
                        color: '#fff', 
                        width: '44px', 
                        height: '44px', 
                        borderRadius: '12px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontSize: '18px', 
                        flexShrink: 0 
                    }}>
                        <i className="fa-solid fa-calendar-days"></i>
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="kpi-label" style={{ color: 'var(--text-muted, #64748b)', fontSize: '11px', fontWeight: 700, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            Holidays
                        </div>
                        <div className="kpi-value" style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary, #0f172a)', lineHeight: 1.15, margin: 0 }}>
                            {holidays.length > 0 ? holidays.length : '12'}
                        </div>
                    </div>
                </div>
            </div>
            </div>

            {/* Quick Actions & Activity Layout */}
            <div className="responsive-split-grid">
                
                {/* Left Column: Organization Highlights & Slide Carousel */}
                <div className="glass dashboard-highlights-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', borderRadius: '20px', boxShadow: 'var(--shadow-md)' }}>
                    
                    {/* Header Row: Title, Counter & Action Buttons */}
                    <div className="highlights-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                        <h3 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: 'var(--text-primary, #0f172a)', display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <i className="fa-solid fa-bullhorn" style={{ color: '#2563eb', fontSize: '18px', flexShrink: 0 }}></i>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Organization Highlights</span>
                        </h3>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            {/* Slide Counter Badge */}
                            {currentFeedItems.length > 0 && (
                                <span style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    background: '#eff6ff',
                                    color: '#2563eb',
                                    border: '1px solid #dbeafe',
                                    padding: '3px 8px',
                                    borderRadius: '9999px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#2563eb', display: 'inline-block' }}></span>
                                    {activeSlide + 1} / {currentFeedItems.length}
                                </span>
                            )}

                            {/* View All Button */}
                            <button
                                onClick={() => setShowModal(true)}
                                className="highlights-action-btn"
                                style={{
                                    padding: '5px 14px',
                                    borderRadius: '9999px',
                                    background: '#2563eb',
                                    color: 'white',
                                    border: 'none',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
                                    transition: 'all 0.2s ease',
                                    flexShrink: 0,
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                <span>+ View All</span>
                            </button>
                        </div>
                    </div>

                    {/* Filter Tabs / Pills with Dynamic Counts */}
                    <div className="pill-tabs-scroll" style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '6px 0 8px 0', borderBottom: 'none' }}>
                        <button
                            type="button"
                            onClick={() => handleTabChange('ALL')}
                            style={{
                                background: activeTab === 'ALL' ? '#2563eb' : '#ffffff',
                                color: activeTab === 'ALL' ? '#ffffff' : '#334155',
                                borderRadius: '9999px',
                                padding: '6px 16px',
                                fontSize: '12.5px',
                                fontWeight: 600,
                                border: activeTab === 'ALL' ? 'none' : '1px solid #e2e8f0',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            All ({announcements.length + birthdays.length + holidays.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => handleTabChange('ANNOUNCEMENTS')}
                            style={{
                                background: activeTab === 'ANNOUNCEMENTS' ? '#2563eb' : '#ffffff',
                                color: activeTab === 'ANNOUNCEMENTS' ? '#ffffff' : '#334155',
                                borderRadius: '9999px',
                                padding: '6px 14px',
                                fontSize: '12.5px',
                                fontWeight: 500,
                                border: activeTab === 'ANNOUNCEMENTS' ? 'none' : '1px solid #e2e8f0',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            <span>📢</span>
                            <span>Announcements ({announcements.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleTabChange('BIRTHDAYS')}
                            style={{
                                background: activeTab === 'BIRTHDAYS' ? '#2563eb' : '#ffffff',
                                color: activeTab === 'BIRTHDAYS' ? '#ffffff' : '#334155',
                                borderRadius: '9999px',
                                padding: '6px 14px',
                                fontSize: '12.5px',
                                fontWeight: 500,
                                border: activeTab === 'BIRTHDAYS' ? 'none' : '1px solid #e2e8f0',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            <span>🎂</span>
                            <span>Birthdays ({birthdays.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleTabChange('HOLIDAYS')}
                            style={{
                                background: activeTab === 'HOLIDAYS' ? '#2563eb' : '#ffffff',
                                color: activeTab === 'HOLIDAYS' ? '#ffffff' : '#334155',
                                borderRadius: '9999px',
                                padding: '6px 14px',
                                fontSize: '12.5px',
                                fontWeight: 500,
                                border: activeTab === 'HOLIDAYS' ? 'none' : '1px solid #e2e8f0',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            <span>📅</span>
                            <span>Holidays ({holidays.length})</span>
                        </button>
                    </div>

                    {/* Announcement Slide Carousel Track */}
                    <div style={{ position: 'relative', width: '100%', minWidth: 0, overflow: 'hidden' }}>
                        {loadingHighlights ? (
                            <div style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                                <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '20px', marginBottom: '8px' }}></i>
                                <p style={{ margin: 0, fontSize: '13px' }}>Loading highlights & announcements...</p>
                            </div>
                        ) : currentFeedItems.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                                <div style={{ fontSize: '32px', marginBottom: '8px' }}>✨</div>
                                <p style={{ margin: 0, fontSize: '13px', fontWeight: '600' }}>No items found in this section.</p>
                            </div>
                        ) : (
                            <div
                                ref={sliderRef}
                                onScroll={handleSlideScroll}
                                onMouseEnter={() => setIsSliderHovered(true)}
                                onMouseLeave={() => setIsSliderHovered(false)}
                                onTouchStart={() => setIsSliderHovered(true)}
                                onTouchEnd={() => setTimeout(() => setIsSliderHovered(false), 3000)}
                                className="highlights-slider-track custom-scrollbar"
                                style={{
                                    display: 'flex',
                                    gap: '12px',
                                    overflowX: 'auto',
                                    scrollSnapType: 'x mandatory',
                                    scrollBehavior: 'smooth',
                                    WebkitOverflowScrolling: 'touch',
                                    scrollbarWidth: 'none',
                                    paddingBottom: '2px',
                                    width: '100%',
                                    boxSizing: 'border-box'
                                }}
                            >
                                {currentFeedItems.map((item, idx) => {
                                    const feedType = item.feedType || (item.type && item.type.includes('Holiday') ? 'HOLIDAY' : item.category ? 'ANNOUNCEMENT' : 'BIRTHDAY');

                                    // 1. BIRTHDAY SLIDE CARD
                                    if (feedType === 'BIRTHDAY') {
                                        return (
                                            <div key={`bday-${item.id}-${idx}`} className="highlights-slide-card" style={{
                                                flex: '0 0 100%',
                                                minWidth: '100%',
                                                maxWidth: '100%',
                                                scrollSnapAlign: 'start',
                                                scrollSnapStop: 'always',
                                                boxSizing: 'border-box',
                                                padding: '16px',
                                                borderRadius: '16px',
                                                background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)',
                                                border: '1px solid rgba(236, 72, 153, 0.2)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: '14px'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                                                    <div style={{
                                                        width: '46px',
                                                        height: '46px',
                                                        borderRadius: '50%',
                                                        background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
                                                        color: 'white',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontWeight: '800',
                                                        fontSize: '18px',
                                                        flexShrink: 0,
                                                        boxShadow: '0 4px 10px rgba(236, 72, 153, 0.3)'
                                                    }}>
                                                        {item.avatar && getFullUrl(item.avatar) ? (
                                                            <img 
                                                                src={getFullUrl(item.avatar)} 
                                                                alt={item.name}
                                                                onClick={() => setPreviewImage({ url: getFullUrl(item.avatar), title: item.name, subtitle: item.designation })}
                                                                style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }} 
                                                            />
                                                        ) : (
                                                            <span>{item.name ? item.name.charAt(0).toUpperCase() : '🎂'}</span>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <span style={{ fontSize: '11px', fontWeight: '800', color: '#ec4899', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                                🎂 UPCOMING BIRTHDAY
                                                            </span>
                                                            <span style={{ background: '#ec4899', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '800' }}>
                                                                {item.timeLabel}
                                                            </span>
                                                        </div>
                                                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</h4>
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
                                                        flexShrink: 0
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

                                    // 2. HOLIDAY SLIDE CARD
                                    if (feedType === 'HOLIDAY') {
                                        return (
                                            <div key={`hol-${item.id}-${idx}`} className="highlights-slide-card" style={{
                                                flex: '0 0 100%',
                                                minWidth: '100%',
                                                maxWidth: '100%',
                                                scrollSnapAlign: 'start',
                                                scrollSnapStop: 'always',
                                                boxSizing: 'border-box',
                                                padding: '16px',
                                                borderRadius: '16px',
                                                background: item.bg || 'rgba(249, 115, 22, 0.08)',
                                                border: `1px solid ${item.color || '#f97316'}33`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: '14px'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                                                    <div style={{
                                                        width: '46px',
                                                        height: '46px',
                                                        borderRadius: '12px',
                                                        background: item.color || '#f97316',
                                                        color: 'white',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '22px',
                                                        flexShrink: 0,
                                                        boxShadow: '0 4px 10px rgba(0,0,0,0.15)'
                                                    }}>
                                                        🏖️
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <span style={{ fontSize: '11px', fontWeight: '800', color: item.color || '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                                {item.type || 'HOLIDAY'}
                                                            </span>
                                                        </div>
                                                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</h4>
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
                                                    whiteSpace: 'nowrap',
                                                    flexShrink: 0
                                                }}>
                                                    {item.countdown}
                                                </span>
                                            </div>
                                        );
                                    }

                                    // 3. ANNOUNCEMENT / ALERT SLIDE CARD (Slide Carousel Format)
                                    const styleInfo = getBadgeStyle(item.category);
                                    const isGeofenceAlert = item.category === 'OUTSIDE_GEOFENCE' || (item.title && item.title.includes('Geofence'));
                                    const siteName = item.site || item.location || 'Gurana & Associates';
                                    const distanceText = item.distance || (idx === 0 ? '2.5 km away' : '4.8 km away');
                                    const timeText = item.time || (idx === 0 ? '28 mins ago' : '37 mins ago');

                                    return (
                                        <div 
                                            key={`slide-${item.id || idx}`}
                                            className="highlights-slide-card organization-alert-card"
                                            style={{
                                                flex: '0 0 100%',
                                                minWidth: '100%',
                                                maxWidth: '100%',
                                                scrollSnapAlign: 'start',
                                                scrollSnapStop: 'always',
                                                boxSizing: 'border-box',
                                                padding: '16px',
                                                borderRadius: '16px',
                                                background: styleInfo.bg,
                                                border: `1px solid ${styleInfo.border}`,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '8px',
                                                boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                                                position: 'relative'
                                            }}
                                        >
                                            {/* Top Banner Row: Category Pill & Distance/Status Pill */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                                                    <span style={{
                                                        fontSize: '10.5px',
                                                        fontWeight: 800,
                                                        background: styleInfo.badgeBg,
                                                        color: styleInfo.badgeText,
                                                        padding: '3px 8px',
                                                        borderRadius: '6px',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '5px',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.4px',
                                                        flexShrink: 0
                                                    }}>
                                                        <i className={`fa-solid ${styleInfo.icon}`}></i>
                                                        <span>{styleInfo.label}</span>
                                                    </span>

                                                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {siteName}
                                                    </span>
                                                </div>

                                                <span style={{
                                                    fontSize: '11px',
                                                    fontWeight: 700,
                                                    background: '#e0f2fe',
                                                    color: '#0284c7',
                                                    padding: '2px 8px',
                                                    borderRadius: '9999px',
                                                    flexShrink: 0,
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    {distanceText}
                                                </span>
                                            </div>

                                            {/* Slide Title */}
                                            <h4 style={{
                                                margin: '4px 0 0 0',
                                                fontSize: '14.5px',
                                                fontWeight: 700,
                                                color: 'var(--text-primary, #0f172a)',
                                                wordBreak: 'break-word',
                                                overflowWrap: 'break-word',
                                                lineHeight: 1.35
                                            }}>
                                                {item.title || 'System Notification'}
                                            </h4>

                                            {/* Slide Body Description */}
                                            <p style={{
                                                margin: 0,
                                                fontSize: '12.5px',
                                                color: '#475569',
                                                lineHeight: 1.5,
                                                wordBreak: 'break-word',
                                                overflowWrap: 'break-word'
                                            }}>
                                                {item.body || '⚠️ You are outside your assigned geofence area. Please ensure you are within the permitted location.'}
                                            </p>

                                            {/* Slide Footer: Timestamp & Interactive Action */}
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                marginTop: '6px',
                                                paddingTop: '8px',
                                                borderTop: '1px solid rgba(0,0,0,0.05)'
                                            }}>
                                                <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                    <i className="fa-regular fa-clock" style={{ fontSize: '11px' }}></i>
                                                    <span>{timeText}</span>
                                                </div>

                                                {isGeofenceAlert ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => onViewChange('geofence-view')}
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            color: '#2563eb',
                                                            fontSize: '11.5px',
                                                            fontWeight: 700,
                                                            cursor: 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            padding: 0
                                                        }}
                                                    >
                                                        <span>Inspect Geofence</span>
                                                        <i className="fa-solid fa-arrow-right" style={{ fontSize: '10px' }}></i>
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowModal(true)}
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            color: '#2563eb',
                                                            fontSize: '11.5px',
                                                            fontWeight: 700,
                                                            cursor: 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            padding: 0
                                                        }}
                                                    >
                                                        <span>View Details</span>
                                                        <i className="fa-solid fa-arrow-right" style={{ fontSize: '10px' }}></i>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Slide Navigation Dots & Previous / Next Controls */}
                    {currentFeedItems.length > 1 && (
                        <div className="highlights-slider-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', paddingTop: '4px' }}>
                            {/* Slide Pagination Dots */}
                            <div className="highlights-dots-container" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {currentFeedItems.map((_, dotIdx) => (
                                    <button
                                        key={dotIdx}
                                        type="button"
                                        onClick={() => goToSlide(dotIdx)}
                                        aria-label={`Go to announcement slide ${dotIdx + 1}`}
                                        style={{
                                            width: activeSlide === dotIdx ? '22px' : '6px',
                                            height: '6px',
                                            borderRadius: '9999px',
                                            background: activeSlide === dotIdx ? '#2563eb' : '#cbd5e1',
                                            border: 'none',
                                            padding: 0,
                                            cursor: 'pointer',
                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                                        }}
                                    />
                                ))}
                            </div>

                            {/* Chevron Slide Arrows */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button
                                    type="button"
                                    onClick={prevSlide}
                                    disabled={activeSlide === 0}
                                    style={{
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '50%',
                                        border: '1px solid #e2e8f0',
                                        background: '#ffffff',
                                        color: activeSlide === 0 ? '#cbd5e1' : '#334155',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: activeSlide === 0 ? 'not-allowed' : 'pointer',
                                        fontSize: '11px',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                                        transition: 'all 0.15s ease'
                                    }}
                                    aria-label="Previous Slide"
                                >
                                    <i className="fa-solid fa-chevron-left"></i>
                                </button>
                                <button
                                    type="button"
                                    onClick={nextSlide}
                                    disabled={activeSlide === currentFeedItems.length - 1}
                                    style={{
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '50%',
                                        border: '1px solid #e2e8f0',
                                        background: '#ffffff',
                                        color: activeSlide === currentFeedItems.length - 1 ? '#cbd5e1' : '#334155',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: activeSlide === currentFeedItems.length - 1 ? 'not-allowed' : 'pointer',
                                        fontSize: '11px',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                                        transition: 'all 0.15s ease'
                                    }}
                                    aria-label="Next Slide"
                                >
                                    <i className="fa-solid fa-chevron-right"></i>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Column: Pending Action Items / Needs Attention (Matches Mockup) */}
                <div className="glass needs-attention-card" style={{ 
                    padding: '18px 16px', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    background: 'var(--bg-glass, #ffffff)', 
                    border: '1px solid var(--border-glass, #e2e8f0)', 
                    borderRadius: '20px', 
                    boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.03))' 
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                        <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary, #0f172a)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i className="fa-solid fa-bell" style={{ color: '#2563eb' }}></i>
                            <span>Needs Attention</span>
                        </h3>
                        <span style={{
                            background: '#2563eb',
                            color: '#ffffff',
                            borderRadius: '9999px',
                            padding: '3px 12px',
                            fontSize: '11.5px',
                            fontWeight: 700
                        }}>
                            {pendingLeaves.length + pendingExpenses.length} Items
                        </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: '440px', paddingRight: '4px' }}>
                        {pendingLeaves.length === 0 && pendingExpenses.length === 0 ? (
                            <div className="needs-attention-empty-box" style={{ textAlign: 'center', padding: '36px 16px 20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                                <div style={{ 
                                    width: '74px', 
                                    height: '74px', 
                                    borderRadius: '50%', 
                                    background: '#eff6ff', 
                                    border: '1px solid #dbeafe', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center', 
                                    position: 'relative',
                                    marginBottom: '16px' 
                                }}>
                                    <i className="fa-regular fa-file-lines" style={{ fontSize: '28px', color: '#2563eb' }}></i>
                                    <div style={{ 
                                        position: 'absolute', 
                                        bottom: '-2px', 
                                        right: '-2px', 
                                        width: '24px', 
                                        height: '24px', 
                                        borderRadius: '50%', 
                                        background: '#10b981', 
                                        color: '#ffffff', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center', 
                                        fontSize: '12px',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                    }}>
                                        <i className="fa-solid fa-check"></i>
                                    </div>
                                </div>
                                <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)' }}>You're all caught up!</h4>
                                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted, #64748b)' }}>No pending items or concerns.</p>
                                
                                {/* Subtle decorative bottom wave matching mockup */}
                                <div style={{ 
                                    position: 'relative', 
                                    width: '100%', 
                                    height: '42px', 
                                    marginTop: '24px', 
                                    opacity: 0.2, 
                                    pointerEvents: 'none' 
                                }}>
                                    <svg viewBox="0 0 500 150" preserveAspectRatio="none" style={{ height: '100%', width: '100%' }}>
                                        <path d="M0.00,49.98 C149.99,150.00 349.20,-49.98 500.00,49.98 L500.00,150.00 L0.00,150.00 Z" style={{ stroke: 'none', fill: '#2563eb' }}></path>
                                    </svg>
                                </div>
                            </div>
                        ) : (
                            <>
                                {pendingLeaves.slice(0, 5).map(leave => (
                                    <div key={leave.id} onClick={() => onViewChange('leaves-view')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', background: 'var(--input-bg, #f8fafc)', border: '1px solid var(--border-glass, #e2e8f0)', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <i className="fa-solid fa-calendar-minus"></i>
                                            </div>
                                            <div>
                                                <p style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary, #0f172a)', margin: '0 0 2px 0' }}>Leave Request</p>
                                                <p style={{ fontSize: '11.5px', color: 'var(--text-muted, #64748b)', margin: 0 }}>Employee ID: {leave.userId}</p>
                                            </div>
                                        </div>
                                        <div style={{ background: '#2563eb', color: '#fff', padding: '4px 12px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600 }}>Review</div>
                                    </div>
                                ))}
                                
                                {pendingExpenses.slice(0, 5).map(exp => (
                                    <div key={exp.id} onClick={() => onViewChange('expenses-view')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', background: 'var(--input-bg, #f8fafc)', border: '1px solid var(--border-glass, #e2e8f0)', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <i className="fa-solid fa-receipt"></i>
                                            </div>
                                            <div>
                                                <p style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary, #0f172a)', margin: '0 0 2px 0' }}>Expense Claim</p>
                                                <p style={{ fontSize: '11.5px', color: 'var(--text-muted, #64748b)', margin: 0 }}>Amount: ₹{exp.amount} • {exp.userName || exp.name || 'Employee'}</p>
                                            </div>
                                        </div>
                                        <div style={{ background: '#2563eb', color: '#fff', padding: '4px 12px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600 }}>Review</div>
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
