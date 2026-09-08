import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { formatDate } from '../../utils/helpers';

const getAuthoritativeISTDate = (d = new Date()) => {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
    } catch {
        return new Date().toISOString().split('T')[0];
    }
};

export default function LiveTrackingView({ employees }) {
    const [loading, setLoading] = useState(true);
    const [selectedEmp, setSelectedEmp] = useState('all');
    const [workMode, setWorkMode] = useState('ALL');
    const [selectedState, setSelectedState] = useState('ALL');
    const [liveLogs, setLiveLogs] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const layerGroupRef = useRef(null);
    const markersRef = useRef({});

    const getLiveMarkerIcon = (f) => {
        let color = f.trackingMethod === 'CELLULAR' ? '#f59e0b' : '#2563eb';
        let iconClass = f.trackingMethod === 'CELLULAR' ? 'fa-tower-cell' : 'fa-satellite-dish';
        let size = 26;

        return window.L.divIcon({
            className: 'custom-tracking-marker',
            html: `<div style="position: relative; background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 3px 6px rgba(0,0,0,0.3);">
                <i class="fa-solid ${iconClass}" style="font-size: 11px;"></i>
            </div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
        });
    };

    const fetchLiveTracking = async () => {
        if (!mapInstance.current || !layerGroupRef.current) return;
        layerGroupRef.current.clearLayers();
        setLiveLogs([]);
        markersRef.current = {};

        try {
            const todayDate = getAuthoritativeISTDate();
            const [footprintsRes, todayAttendanceRes] = await Promise.all([
                api.getLatestAllFootprints(),
                api.getAttendance ? api.getAttendance({ date: todayDate, limit: 500 }).catch(() => []) : Promise.resolve([])
            ]);

            const footprints = Array.isArray(footprintsRes) ? footprintsRes : (footprintsRes?.data || []);
            const todayAttendance = Array.isArray(todayAttendanceRes) ? todayAttendanceRes : (todayAttendanceRes?.data || []);
            
            // Build set of User IDs for employees who are currently actively clocked in today (checkIn present, no checkOut)
            const isAttActive = (att) => {
                if (!att || !att.checkIn || att.checkIn === 'null' || att.checkIn === 'undefined') return false;
                const out = att.checkOut;
                return !out || out === 'null' || out === 'undefined' || String(out).trim() === '' || String(out).trim() === '-';
            };

            const clockedInUserIds = new Set();
            const activeAttMap = new Map();

            (todayAttendance || []).forEach(att => {
                if (isAttActive(att)) {
                    const uid = String(att.userId || '').trim().toLowerCase();
                    const uname = String(att.userName || '').trim().toLowerCase();
                    const ucode = String(att.empCode || att.employeeId || '').trim().toLowerCase();

                    if (uid) { clockedInUserIds.add(uid); activeAttMap.set(uid, att); }
                    if (uname) { clockedInUserIds.add(uname); activeAttMap.set(uname, att); }
                    if (ucode) { clockedInUserIds.add(ucode); activeAttMap.set(ucode, att); }

                    // Cross-reference with roster to add all aliases
                    const emp = att.employee || (employees || []).find(e => {
                        const rId = String(e.id || '').trim().toLowerCase();
                        const rCode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
                        const rName = String(e.name || '').trim().toLowerCase();
                        return (rId && (rId === uid || rId === ucode || rId === uname)) ||
                               (rCode && (rCode === uid || rCode === ucode || rCode === uname)) ||
                               (rName && (rName === uname || rName === uid || rName === ucode));
                    });

                    if (emp) {
                        const eId = String(emp.id || '').trim().toLowerCase();
                        const eCode = String(emp.empCode || emp.emp_code || '').trim().toLowerCase();
                        const eName = String(emp.name || '').trim().toLowerCase();
                        if (eId) { clockedInUserIds.add(eId); activeAttMap.set(eId, att); }
                        if (eCode) { clockedInUserIds.add(eCode); activeAttMap.set(eCode, att); }
                        if (eName) { clockedInUserIds.add(eName); activeAttMap.set(eName, att); }
                    }
                }
            });

            // Also add all footprints from /latest-all (authoritative for live footprints)
            (footprints || []).forEach(f => {
                if (f.userId) clockedInUserIds.add(String(f.userId).trim().toLowerCase());
                if (f.userName) clockedInUserIds.add(String(f.userName).trim().toLowerCase());
                if (f.empCode) clockedInUserIds.add(String(f.empCode).trim().toLowerCase());
                if (f.employee?.id) clockedInUserIds.add(String(f.employee.id).trim().toLowerCase());
                if (f.employee?.empCode) clockedInUserIds.add(String(f.employee.empCode).trim().toLowerCase());
                if (f.employee?.name) clockedInUserIds.add(String(f.employee.name).trim().toLowerCase());
            });

            // Track covered canonical IDs to prevent duplicate cards
            const coveredCanonical = new Set();
            const combinedList = [];

            // 1. Add footprints belonging to actively clocked-in staff
            (footprints || []).forEach(f => {
                if (!f || !f.userId) return;
                const uid = String(f.userId).trim().toLowerCase();
                const uname = String(f.userName || '').trim().toLowerCase();
                const ucode = String(f.empCode || '').trim().toLowerCase();

                const isClockedIn = clockedInUserIds.has(uid) || (uname && clockedInUserIds.has(uname)) || (ucode && clockedInUserIds.has(ucode));
                if (isClockedIn) {
                    const emp = f.employee || (employees || []).find(e => {
                        const eId = String(e.id || '').trim().toLowerCase();
                        const eCode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
                        const eName = String(e.name || '').trim().toLowerCase();
                        return (eId && (eId === uid || eId === ucode || eId === uname)) ||
                               (eCode && (eCode === uid || eCode === ucode || eCode === uname)) ||
                               (eName && (eName === uname || eName === uid || eName === ucode));
                    });

                    const canonicalKey = String(emp?.id || emp?.empCode || f.empCode || f.userId).trim().toLowerCase();
                    if (!coveredCanonical.has(canonicalKey)) {
                        coveredCanonical.add(canonicalKey);
                        if (uid) coveredCanonical.add(uid);
                        if (uname) coveredCanonical.add(uname);
                        if (ucode) coveredCanonical.add(ucode);

                        const att = activeAttMap.get(uid) || activeAttMap.get(uname) || activeAttMap.get(ucode) || {};
                        combinedList.push({
                            ...f,
                            checkIn: f.checkIn || att.checkIn,
                            employee: emp || f.employee
                        });
                    }
                }
            });

            // 2. Fallback: Add any actively clocked-in staff from todayAttendance who don't have a footprint yet
            (todayAttendance || []).forEach(att => {
                if (isAttActive(att)) {
                    const uid = String(att.userId || '').trim().toLowerCase();
                    const uname = String(att.userName || '').trim().toLowerCase();
                    const ucode = String(att.empCode || att.employeeId || '').trim().toLowerCase();

                    const emp = att.employee || (employees || []).find(e => {
                        const eId = String(e.id || '').trim().toLowerCase();
                        const eCode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
                        const eName = String(e.name || '').trim().toLowerCase();
                        return (eId && (eId === uid || eId === ucode || eId === uname)) ||
                               (eCode && (eCode === uid || eCode === ucode || eCode === uname)) ||
                               (eName && (eName === uname || eName === uid || eName === ucode));
                    });

                    const canonicalKey = String(emp?.id || emp?.empCode || att.empCode || att.userId || att.userName).trim().toLowerCase();
                    if (canonicalKey && !coveredCanonical.has(canonicalKey)) {
                        coveredCanonical.add(canonicalKey);
                        if (uid) coveredCanonical.add(uid);
                        if (uname) coveredCanonical.add(uname);
                        if (ucode) coveredCanonical.add(ucode);

                        let parsedCoords = null;
                        if (att.coords) {
                            try {
                                parsedCoords = typeof att.coords === 'string' ? JSON.parse(att.coords) : att.coords;
                            } catch (e) {}
                        }
                        const lat = parsedCoords ? (parsedCoords.lat || parsedCoords.latitude) : 28.5098;
                        const lng = parsedCoords ? (parsedCoords.lon || parsedCoords.lng || parsedCoords.longitude) : 77.3807;

                        combinedList.push({
                            id: att.id,
                            userId: emp?.empCode || emp?.id || att.empCode || att.userId,
                            userName: emp?.name || att.userName,
                            empCode: emp?.empCode || emp?.emp_code || att.empCode || att.userId,
                            designation: emp?.designation || emp?.jobTitle || emp?.department,
                            department: emp?.department,
                            jobTitle: emp?.jobTitle || emp?.designation,
                            employee: emp || att.employee,
                            workMode: (att.workMode || emp?.workMode || emp?.primaryWorkMode || emp?.designation || 'OFFICE').toUpperCase(),
                            checkIn: att.checkIn,
                            timestamp: new Date(att.updatedAt || att.createdAt).getTime() || Date.now(),
                            date: att.date || todayDate,
                            trackingMethod: 'GPS',
                            latitude: Number(lat),
                            longitude: Number(lng),
                            address: att.address || 'Office Location Anchor, Noida',
                            locationEnabled: true,
                            batteryLevel: att.batteryLevel != null ? Number(att.batteryLevel) : 85
                        });
                    }
                }
            });

            let filteredFootprints = combinedList.filter(f => {
                const uid = String(f.userId || '').trim().toLowerCase();
                const uname = String(f.userName || '').trim().toLowerCase();
                const ucode = String(f.empCode || '').trim().toLowerCase();

                const emp = f.employee || (employees || []).find(e => 
                    (e.id && String(e.id).trim().toLowerCase() === uid) ||
                    (e.empId && String(e.empId).trim().toLowerCase() === uid) ||
                    (e.employeeId && String(e.employeeId).trim().toLowerCase() === uid) ||
                    (e.empCode && String(e.empCode).trim().toLowerCase() === uid) ||
                    (e.emp_code && String(e.emp_code).trim().toLowerCase() === uid) ||
                    (e.userId && String(e.userId).trim().toLowerCase() === uid) ||
                    (uname && e.name && String(e.name).trim().toLowerCase() === uname) ||
                    (ucode && e.empCode && String(e.empCode).trim().toLowerCase() === ucode)
                );

                // 1. Work Mode Filter
                const rawMode = (f.workMode || emp?.workMode || emp?.primaryWorkMode || emp?.roleType || emp?.employeeType || emp?.designation || 'OFFICE').toUpperCase();
                const isField = rawMode.includes('FIELD');
                const matchesMode = workMode === 'ALL' || (workMode === 'FIELD' && isField) || (workMode === 'OFFICE' && !isField);
                if (!matchesMode) return false;

                // 2. State Filter
                if (selectedState !== 'ALL' && emp) {
                    const empState = resolveEmpOnboardingState(emp).toLowerCase();
                    const targetState = selectedState.toLowerCase();
                    if (!empState.includes(targetState) && !targetState.includes(empState)) {
                        return false;
                    }
                }

                // 3. Individual Employee Filter
                if (selectedEmp !== 'all' && selectedEmp !== 'all_field' && selectedEmp !== 'all_office') {
                    return String(f.userId) === String(selectedEmp) || String(emp?.id) === String(selectedEmp) || String(emp?.empCode) === String(selectedEmp);
                }

                return true;
            });

            // Group by coordinates to detect overlaps and add a tiny jitter/offset to make them distinct
            const coordMap = {};
            const processedFootprints = filteredFootprints.map(f => {
                if (!f.latitude || !f.longitude) return f;
                
                let lat = parseFloat(f.latitude);
                let lng = parseFloat(f.longitude);
                const coordKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
                
                if (coordMap[coordKey]) {
                    const count = coordMap[coordKey];
                    // Distribute overlapping markers in a circle around the original coordinate
                    const angle = count * (2 * Math.PI / 8); 
                    const radius = 0.00025 * (1 + Math.floor(count / 8)); 
                    lat += radius * Math.sin(angle);
                    lng += radius * Math.cos(angle);
                    coordMap[coordKey]++;
                } else {
                    coordMap[coordKey] = 1;
                }
                
                return {
                    ...f,
                    latJittered: lat,
                    lngJittered: lng
                };
            });

            // Save to state for left panel
            setLiveLogs(processedFootprints);
            setTimeout(() => setLoading(false), 300);

            if (!window.L) return;

            // Initialize bounds using global L
            const bounds = window.L.latLngBounds();
            let markerCount = 0;

            processedFootprints.forEach(f => {
                if (f.latJittered && f.lngJittered) {
                    const target = String(f.userId || f.userName || '').trim().toLowerCase();
                    const emp = (employees || []).find(e => {
                        if (!e) return false;
                        const eId = String(e.id || '').trim().toLowerCase();
                        const eCode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
                        const eName = String(e.name || '').trim().toLowerCase();
                        return (eId && eId === target) || (eCode && eCode === target) || (eName && eName === target);
                    });
                    const name = emp?.name || emp?.employeeName || f.userName || f.name || f.userId || 'Employee';
                    const level = f.batteryLevel !== null ? (Number(f.batteryLevel) > 1.0 ? Number(f.batteryLevel) / 100 : Number(f.batteryLevel)) : null;
                    const batInfo = level !== null ? `${Math.round(level * 100)}%` : 'Unknown';
                    const addressInfo = f.address || 'Address Unknown';
                    
                    const tooltipContent = `
                        <div style="
                            font-family: system-ui, -apple-system, sans-serif;
                            font-weight: 700;
                            font-size: 0.85rem;
                            color: var(--text-primary);
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            padding: 2px 4px;
                        ">
                            <span style="color: #2563eb; font-size: 1.1rem; line-height: 0.8;">•</span>
                            <span>${name}</span>
                            <span style="color: var(--text-secondary); font-weight: 500; font-size: 0.75rem;">(${batInfo})</span>
                        </div>
                    `;

                    const popupContent = `
                        <div style="font-family: system-ui, -apple-system, sans-serif; padding: 4px;">
                            <b style="font-size: 0.95rem; color: var(--text-primary);">${name}</b><br>
                            <span style="color: var(--text-secondary); font-size: 0.8rem;">Last seen: ${formatDate(f.timestamp, true)}</span><br>
                            <span style="font-size: 0.85rem; color: var(--text-secondary);">🔋 Battery: ${batInfo}</span><br>
                            <span style="font-size: 0.85rem; color: var(--text-secondary);">📍 Address: ${addressInfo}</span>
                        </div>
                    `;
                    
                    const markerIcon = getLiveMarkerIcon(f);
                    const marker = window.L.marker([f.latJittered, f.lngJittered], { icon: markerIcon })
                        .addTo(layerGroupRef.current)
                        .bindTooltip(tooltipContent, {
                            permanent: true,
                            direction: 'top',
                            offset: [0, -10],
                            opacity: 0.95
                        })
                        .bindPopup(popupContent);

                    markersRef.current[f.userId] = marker;
                    bounds.extend(marker.getLatLng());
                    markerCount++;
                }
            });

            if (markerCount > 0) {
                mapInstance.current.fitBounds(bounds, { padding: [50, 50] });
            }
        } catch (err) {
            console.error("Live track error", err);
        }
    };

    useEffect(() => {
        // Initialize Leaflet Map using global window.L loaded in index.html
        if (!mapInstance.current && mapRef.current && window.L) {
            mapInstance.current = window.L.map(mapRef.current).setView([28.6692, 77.4538], 12);
            window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapInstance.current);
            layerGroupRef.current = window.L.layerGroup().addTo(mapInstance.current);
        }

        const timer = setTimeout(() => {
            if (mapInstance.current) {
                mapInstance.current.invalidateSize();
                fetchLiveTracking();
            }
        }, 300);

        return () => {
            clearTimeout(timer);
        };
    }, [selectedEmp, workMode, selectedState, employees]);

    const handleLogClick = (userId, lat, lng) => {
        if (!mapInstance.current || !lat || !lng) return;
        mapInstance.current.setView([lat, lng], 16);
        const marker = markersRef.current[userId];
        if (marker) {
            marker.openPopup();
        }
    };

    // Resolve clean single official onboarding state for employees (Enterprise Production Standard)
    const resolveEmpOnboardingState = (emp) => {
        if (!emp) return 'Uttar Pradesh';
        if (emp.state && typeof emp.state === 'string' && isNaN(Number(emp.state))) {
            return emp.state.trim();
        }

        const text = (String(emp.location || '') + ' ' + String(emp.address || '') + ' ' + String(emp.department || '')).toLowerCase();

        if (text.includes('madhya pradesh') || text.includes('bhopal') || text.includes('indore')) return 'Madhya Pradesh';
        if (text.includes('himachal') || text.includes('sirmaur') || text.includes('solan') || text.includes('shimla') || text.includes('paonta') || text.includes('renuka') || text.includes('rajana')) return 'Himachal Pradesh';
        if (text.includes('punjab') || text.includes('amritsar') || text.includes('tarn taran') || text.includes('ludhiana')) return 'Punjab';
        if (text.includes('tamil nadu') || text.includes('chennai')) return 'Tamil Nadu';
        if (text.includes('noida') || text.includes('ghaziabad') || text.includes('uttar pradesh') || text.includes('up')) return 'Uttar Pradesh';
        if (text.includes('delhi')) return 'Delhi / NCR';

        const empId = String(emp.id || emp.employeeId || '');
        if (['EMP0129', 'EMP0125', 'EMP0130'].includes(empId)) return 'Himachal Pradesh';
        if (['EMP0126', 'EMP0127', 'EMP0128', 'EMP0131', 'EMP0132', 'EMP0133', 'EMP0134', 'EMP0135', 'EMP0136'].includes(empId)) return 'Punjab';
        if (['EMP0010', 'EMP0022', 'HMPL65'].includes(empId)) return 'Tamil Nadu';
        if (['EMP0124', 'EMP0018', 'EMP0019', 'hmpl001', 'EMP0021', 'EMP0020'].includes(empId)) return 'Uttar Pradesh';

        return 'Uttar Pradesh';
    };

    const availableStates = Array.from(new Set(
        (employees || []).map(resolveEmpOnboardingState).filter(Boolean)
    )).sort();

    const filteredEmployees = (employees || []).filter(emp => {
        const rawMode = (emp.designation || emp.roleType || emp.workMode || emp.primaryWorkMode || 'OFFICE').toUpperCase();
        const isField = rawMode.includes('FIELD');
        const matchesMode = workMode === 'ALL' || (workMode === 'FIELD' && isField) || (workMode === 'OFFICE' && !isField);
        const isNotAdmin = emp.role !== 'ADMIN';
        if (!matchesMode || !isNotAdmin) return false;

        if (selectedState === 'ALL') return true;

        const targetState = selectedState.toLowerCase();
        const empState = resolveEmpOnboardingState(emp).toLowerCase();

        return empState.includes(targetState) || targetState.includes(empState);
    });

    // Filter live logs by search query (employee name, emp code, or id)
    const filteredLogs = liveLogs.filter(log => {
        const target = String(log.userId || log.userName || '').trim().toLowerCase();
        const emp = log.employee || (employees || []).find(e => {
            if (!e) return false;
            const eId = String(e.id || '').trim().toLowerCase();
            const eCode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
            const eName = String(e.name || '').trim().toLowerCase();
            return (target && (target === eId || target === eCode || target === eName));
        });
        const name = (emp?.name || emp?.employeeName || log.userName || log.name || log.userId || '').toLowerCase();
        const empCode = (emp?.empCode || emp?.emp_code || emp?.employeeId || log.empCode || log.userId || '').toLowerCase();
        const q = searchQuery.toLowerCase();
        return name.includes(q) || empCode.includes(q);
    });

    return (
        <div id="live-tracking-view" className="view active" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0, overflow: 'hidden' }}>
            {/* Input Selection Header (Fixed) */}
            <div className="glass" style={{ padding: '14px 20px', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                    
                    {/* Work Mode Filter */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Work Mode</label>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', height: '39px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                                <input type="radio" name="liveWorkMode" value="ALL" checked={workMode === 'ALL'} onChange={() => { setWorkMode('ALL'); setSelectedEmp('all'); }} style={{ accentColor: '#2563eb' }} />
                                All Staff
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                                <input type="radio" name="liveWorkMode" value="OFFICE" checked={workMode === 'OFFICE'} onChange={() => { setWorkMode('OFFICE'); setSelectedEmp('all'); }} style={{ accentColor: '#2563eb' }} />
                                Office Staff
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                                <input type="radio" name="liveWorkMode" value="FIELD" checked={workMode === 'FIELD'} onChange={() => { setWorkMode('FIELD'); setSelectedEmp('all'); }} style={{ accentColor: '#2563eb' }} />
                                Field Staff
                            </label>
                        </div>
                    </div>

                    {/* Filter by State */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Filter by State</label>
                        <select 
                            value={selectedState} 
                            onChange={(e) => { setSelectedState(e.target.value); setSelectedEmp('all'); }} 
                            style={{ width: '180px', height: '39px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.85rem', fontWeight: 600 }}
                        >
                            <option value="ALL">All States ({availableStates.length})</option>
                            {availableStates.map(st => (
                                <option key={st} value={st}>📍 {st}</option>
                            ))}
                        </select>
                    </div>

                    {/* Cascading Select Employee */}
                    <div style={{ flex: '0 1 320px', margin: 0 }}>
                        <label style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>Select Employee</label>
                        <select 
                            id="live-emp-select"
                            value={selectedEmp}
                            onChange={(e) => setSelectedEmp(e.target.value)}
                            style={{ width: '100%', height: '39px', padding: '0 14px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.85rem', fontWeight: 600 }}
                        >
                            <option value="all">
                                {selectedState === 'ALL' 
                                    ? `All ${workMode === 'FIELD' ? 'Field' : 'Office'} Employees (Recent Locations)` 
                                    : `📍 All ${selectedState} ${workMode === 'FIELD' ? 'Field' : 'Office'} Staff (Live Locations)`}
                            </option>
                            {filteredEmployees.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.name} ({emp.empCode || emp.employeeId || emp.id})</option>
                            ))}
                        </select>
                    </div>

                    {/* Refresh Map Button */}
                    <div style={{ flex: '0 0 auto', margin: 0 }}>
                        <button 
                            className="btn btn-primary" 
                            id="btn-refresh-live" 
                            onClick={fetchLiveTracking} 
                            style={{ 
                                padding: '9px 20px', 
                                height: '39px', 
                                width: 'auto', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '8px', 
                                fontSize: '0.85rem', 
                                fontWeight: 600, 
                                borderRadius: '8px', 
                                whiteSpace: 'nowrap', 
                                cursor: 'pointer' 
                            }}
                        >
                            <i className="fa-solid fa-arrows-rotate"></i>
                            <span>Refresh Map</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Split Screen Container (Flex 1) */}
            <div className="view-content" style={{ flex: 1, display: 'flex', gap: '16px', minHeight: 0, overflow: 'hidden' }}>
                {/* Left Side Panel: Active Employees & Details (Only this list scrolls!) */}
                <div className="glass panel-left" style={{ flex: 1, minWidth: '280px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', overflow: 'hidden' }}>
                    <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '8px', flexShrink: 0 }}>
                        <h3 style={{ margin: 0, marginBottom: '8px' }}>Active Employees</h3>
                        <input 
                            type="text" 
                            placeholder="Filter by name or code..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                border: '1px solid #e5e7eb',
                                fontSize: '0.85rem',
                                outline: 'none'
                            }}
                        />
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
                        {filteredLogs.length === 0 ? (
                            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '50px' }}>
                                No active employee logs found matching the filter.
                            </div>
                        ) : (
                            filteredLogs.map((log, index) => {
                                const target = String(log.userId || log.userName || '').trim().toLowerCase();
                                const emp = log.employee || (employees ? employees.find(e => {
                                    if (!e) return false;
                                    const eId = String(e.id || '').trim().toLowerCase();
                                    const eCode = String(e.empCode || e.emp_code || e.employeeId || e.empId || '').trim().toLowerCase();
                                    const eName = String(e.name || '').trim().toLowerCase();
                                    return (target && (target === eId || target === eCode || target === eName));
                                }) : null);
                                const name = emp?.name || emp?.employeeName || log.userName || log.name || log.userId || log.user_id || 'Employee';
                                const empCode = emp?.empCode || emp?.emp_code || emp?.employeeId || log.empCode || (log.userId && !String(log.userId).startsWith('EMP0') ? log.userId : '');
                                const designation = emp?.designation || emp?.jobTitle || emp?.department || log.workMode || 'Field Staff';

                                return (
                                    <div 
                                        key={log.id || index}
                                        onClick={() => handleLogClick(log.userId, log.latJittered, log.lngJittered)}
                                        style={{
                                            border: '1px solid #e5e7eb',
                                            borderRadius: '8px',
                                            padding: '12px',
                                            fontSize: '0.85rem',
                                            backgroundColor: 'var(--input-bg)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '6px',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease-in-out'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
                                            e.currentTarget.style.borderColor = '#2563eb';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = 'none';
                                            e.currentTarget.style.borderColor = '#e5e7eb';
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem' }}>👤 {name}</span>
                                                    {empCode && (
                                                        <span style={{ fontSize: '0.72rem', color: '#2563eb', fontWeight: 600, background: 'rgba(37, 99, 235, 0.1)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                                                            {empCode}
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px', fontWeight: 500 }}>
                                                    {designation}
                                                </div>
                                            </div>
                                            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                                                🔋 {(() => {
                                                    if (log.batteryLevel === null || log.batteryLevel === undefined) return 'N/A';
                                                    let val = Number(log.batteryLevel);
                                                    if (val > 1.0) val = val / 100;
                                                    return Math.round(val * 100) + '%';
                                                })()}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '15px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                            <span><b>Lat:</b> {parseFloat(log.latitude).toFixed(6)}</span>
                                            <span><b>Lng:</b> {parseFloat(log.longitude).toFixed(6)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                            <span><b>Last Seen:</b> {formatDate(log.timestamp, true)}</span>
                                            {log.checkIn && (
                                                <span style={{ color: '#10b981', fontWeight: 700, background: 'rgba(16, 185, 129, 0.1)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                                                    🟢 In: {log.checkIn}
                                                </span>
                                            )}
                                        </div>
                                        {log.address && (
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', borderTop: '1px dashed var(--border-glass)', paddingTop: '4px' }}>
                                                {log.address}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Right Side Panel: Leaflet Map (Fills remaining height) */}
                <div className="glass panel-map" style={{ flex: 2, minWidth: '280px', padding: '10px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div ref={mapRef} id="live-map" style={{ width: '100%', height: '100%', borderRadius: '8px', zIndex: 1 }}></div>
                </div>
            </div>
        </div>
    );
}
