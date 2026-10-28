import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';

export default function SiteInfoView({ employees }) {
    const formatMinutes = (totalMinutes) => {
        const minsNum = Math.max(0, Math.round(totalMinutes || 0));
        const hrs = Math.floor(minsNum / 60);
        const mins = minsNum % 60;
        return `${hrs}h ${mins}m`;
    };

    const formatDurationSecs = (totalSecs) => {
        const secsNum = Math.max(0, Math.round(totalSecs || 0));
        const hrs = Math.floor(secsNum / 3600);
        const mins = Math.floor((secsNum % 3600) / 60);
        const secs = secsNum % 60;

        if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
    };

    const getMonthYearFromDate = (dateStr) => {
        if (!dateStr) return { date: 'N/A', month: 'N/A', year: 'N/A' };
        try {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                const y = parts[0];
                const mIdx = parseInt(parts[1], 10) - 1;
                const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                const month = monthNames[mIdx] || 'N/A';
                return { date: dateStr, month, year: y };
            }
            const d = new Date(dateStr);
            return {
                date: dateStr,
                month: d.toLocaleString('en-US', { month: 'long' }),
                year: d.getFullYear().toString()
            };
        } catch {
            return { date: dateStr, month: 'N/A', year: 'N/A' };
        }
    };

    const getDatesInRange = (startStr, endStr) => {
        if (!startStr) return [];
        if (!endStr || startStr === endStr) return [startStr];
        
        const dates = [];
        let current = new Date(startStr + 'T00:00:00');
        const end = new Date(endStr + 'T00:00:00');
        
        if (isNaN(current.getTime()) || isNaN(end.getTime())) return [startStr];

        while (current <= end) {
            const y = current.getFullYear();
            const m = String(current.getMonth() + 1).padStart(2, '0');
            const d = String(current.getDate()).padStart(2, '0');
            dates.push(`${y}-${m}-${d}`);
            current.setDate(current.getDate() + 1);
            if (dates.length > 90) break;
        }
        return dates;
    };

    const getTodayString = () => new Date().toISOString().split('T')[0];

    const [selectedEmp, setSelectedEmp] = useState('');
    const [selectedState, setSelectedState] = useState('ALL');
    const [workMode, setWorkMode] = useState('OFFICE');
    const [dateMode, setDateMode] = useState('SINGLE');
    const [selectedDate, setSelectedDate] = useState(getTodayString());
    const [fromDate, setFromDate] = useState(getTodayString());
    const [toDate, setToDate] = useState(getTodayString());

    const cachedGeofences = api.getCached('/geofence');
    const [loading, setLoading] = useState(() => !cachedGeofences);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [geofences, setGeofences] = useState(() => Array.isArray(cachedGeofences) ? cachedGeofences : []);
    const [logs, setLogs] = useState([]);
    const [metrics, setMetrics] = useState({
        insideTime: 0,
        outsideTime: 0,
        totalTime: 0,
        insidePercentage: 0,
        outsidePercentage: 0
    });
    const [visitedGeofences, setVisitedGeofences] = useState([]);
    const [searchPerformed, setSearchPerformed] = useState(false);
    const [overlapMode, setOverlapMode] = useState('CLOSEST'); // 'CLOSEST' (Single Nearest Site - Default) or 'SPLIT' (50/50 Equal Time Split)

    // Outside Geofence Timelines Modal & Interactive Details
    const [showOutsideModal, setShowOutsideModal] = useState(false);
    const [outsidePings, setOutsidePings] = useState([]);
    const [outsideSessions, setOutsideSessions] = useState([]);
    const [outsideSearchTerm, setOutsideSearchTerm] = useState('');

    // Inside Geofence Timelines Modal & Interactive Details
    const [showInsideModal, setShowInsideModal] = useState(false);
    const [insidePings, setInsidePings] = useState([]);
    const [insideSearchTerm, setInsideSearchTerm] = useState('');

    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const layersGroupRef = useRef(null);
    const exportMenuRef = useRef(null);
    const outsideMarkersRef = useRef({});
    const circleLayersRef = useRef({});

    const handleSiteCardClick = (site) => {
        if (!mapInstance.current || !site || site.latitude == null || site.longitude == null) return;
        const lat = parseFloat(site.latitude);
        const lng = parseFloat(site.longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        mapInstance.current.flyTo([lat, lng], 16, { animate: true, duration: 1.2 });
        const key = site.rawGfId || site.id || site.name;
        const circle = circleLayersRef.current[key] || circleLayersRef.current[site.name];
        if (circle) {
            setTimeout(() => {
                circle.openPopup();
            }, 600);
        }
    };

    // Auto-select first employee if unselected
    useEffect(() => {
        if (!selectedEmp && employees && employees.length > 0) {
            const firstEmp = employees.find(e => e.role !== 'ADMIN');
            if (firstEmp) setSelectedEmp(String(firstEmp.id));
        }
    }, [employees, selectedEmp]);

    // Close export menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
                setShowExportMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Initialize Map
    useEffect(() => {
        if (!mapInstance.current && mapRef.current && window.L) {
            mapInstance.current = window.L.map(mapRef.current).setView([28.6692, 77.4538], 12);
            window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_2ae4_1_8e228ec653d025bb97ea2305', {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapInstance.current);
            layersGroupRef.current = window.L.layerGroup().addTo(mapInstance.current);
        }

        setTimeout(() => {
            if (mapInstance.current) {
                mapInstance.current.invalidateSize();
            }
        }, 300);
    }, []);

    // Load Geofences List
    useEffect(() => {
        const loadGeofences = async () => {
            try {
                const res = await api.getGeofences();
                if (Array.isArray(res)) {
                    setGeofences(res);
                } else if (res) {
                    setGeofences([res]);
                }
            } catch (err) {
                console.error('Error fetching geofences:', err);
            } finally {
                setLoading(false);
            }
        };
        loadGeofences();
    }, []);

    // Haversine formula to compute distance in meters between two lat/lon pairs
    const getDistance = (lat1, lon1, lat2, lon2) => {
        const toRad = (x) => (x * Math.PI) / 180;
        const R = 6371000;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    // Calculate site analytics for a single employee on a given date
    const analyzeSingleEmployee = async (empId, date, geofenceList, currentOverlapMode = overlapMode) => {
        const rawLogs = await api.getFootprintHistory(empId, date);

        const parseTs = (item) => {
            if (!item) return 0;
            if (typeof item.timestamp === 'number') return item.timestamp;
            const parsed = new Date(item.timestamp || item.createdAt).getTime();
            return isNaN(parsed) ? 0 : parsed;
        };

        const isReliableGpsLog = (log) => {
            if (!log || log.latitude == null || log.longitude == null) return false;
            const lat = parseFloat(log.latitude);
            const lon = parseFloat(log.longitude);
            if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)) return false;
            if (log.isMockLocation === true || log.is_mock_location === true) return false;

            // Reject cellular tower jumps, wifi and network location estimations
            const method = String(log.trackingMethod || log.tracking_method || log.provider || '').toUpperCase();
            const hasCellId = Boolean(log.cellId || log.cell_id);
            if (method.includes('CELL') || method.includes('TOWER') || method.includes('WIFI') || method.includes('NETWORK') || hasCellId) {
                return false;
            }

            // Accuracy guard: Coarse / bad accuracy readings (> 500m) are unreliable and should not be considered in any calculation
            const acc = parseFloat(log.accuracy);
            if (!isNaN(acc) && acc > 500) {
                return false;
            }
            return true;
        };

        const validLogs = (rawLogs || []).filter(isReliableGpsLog);

        const gpsLogs = validLogs.sort((a, b) => parseTs(a) - parseTs(b));

        if (gpsLogs.length === 0) {
            return {
                hasData: false,
                gpsLogs: [],
                metrics: { insideTime: 0, outsideTime: 0, totalTime: 0, insidePercentage: 0, outsidePercentage: 0 },
                visitedGeofences: [],
                insidePings: [],
                outsidePings: [],
                outsideSessions: []
            };
        }

        const parsedGeofences = geofenceList.map(gf => ({
            ...gf,
            radius: parseFloat(gf.radius || 100),
            latitude: parseFloat(gf.latitude),
            longitude: parseFloat(gf.longitude)
        }));

        // Annotate each log as INSIDE vs OUTSIDE geofence and assign EXCLUSIVELY to nearest centroid geofence
        const annotatedLogs = gpsLogs.map((log, index) => {
            let isInside = false;
            let nearestGf = null;
            let minDistance = Infinity;
            let closestInsideGf = null;
            let minInsideDistance = Infinity;
            const insideGfs = [];

            parsedGeofences.forEach(gf => {
                const dist = getDistance(log.latitude, log.longitude, gf.latitude, gf.longitude);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestGf = gf;
                }
                if (dist <= gf.radius) {
                    isInside = true;
                    insideGfs.push(gf);
                    if (dist < minInsideDistance) {
                        minInsideDistance = dist;
                        closestInsideGf = gf;
                    }
                }
            });

            const timestamp = new Date(log.timestamp || log.createdAt);
            const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            return {
                ...log,
                index,
                date,
                isInside,
                insideGfs,
                insideCount: insideGfs.length,
                assignedGfName: closestInsideGf ? closestInsideGf.name : null,
                nearestGfName: nearestGf ? nearestGf.name : 'Unknown Site',
                minDistanceMeters: Math.round(minDistance),
                timeString,
                timestampMs: timestamp.getTime()
            };
        });

        const insidePings = annotatedLogs.filter(l => l.isInside);
        const outsidePings = annotatedLogs.filter(l => !l.isInside);

        // Group contiguous outside pings into excursion sessions
        const outsideSessions = [];
        let currentSession = null;

        const processSession = (session) => {
            if (!session || !session.pings || session.pings.length === 0) return;
            const startIdx = session.startLog.index;
            const endIdx = session.endLog.index;
            let sessionStartMs = session.startLog.timestampMs;
            let sessionEndMs = session.endLog.timestampMs;

            // If single isolated ping, estimate duration using adjacent logs or shift boundaries
            if (sessionStartMs === sessionEndMs) {
                const prevLog = annotatedLogs[startIdx - 1];
                const nextLog = annotatedLogs[endIdx + 1];
                if (prevLog && nextLog) {
                    sessionStartMs = Math.round((prevLog.timestampMs + sessionStartMs) / 2);
                    sessionEndMs = Math.round((nextLog.timestampMs + sessionEndMs) / 2);
                } else if (nextLog) {
                    sessionEndMs = nextLog.timestampMs;
                } else if (prevLog) {
                    sessionStartMs = prevLog.timestampMs;
                } else {
                    sessionEndMs = sessionStartMs + 300000; // 5 mins default
                }
            }

            const durationMs = Math.max(60000, sessionEndMs - sessionStartMs);
            const durationSecs = Math.round(durationMs / 1000);
            const durationMins = Math.max(1, Math.round(durationSecs / 60));

            const maxDistMeters = Math.max(...session.pings.map(p => p.minDistanceMeters || 0));
            const nearestGfName = session.pings[0] ? session.pings[0].nearestGfName : 'Geofence';

            outsideSessions.push({
                ...session,
                durationSecs,
                durationMins,
                maxDistMeters,
                nearestGfName,
                startTime: session.startLog.timeString,
                endTime: session.endLog.timeString
            });
        };

        annotatedLogs.forEach((log) => {
            const isOutside = !log.isInside;
            if (isOutside) {
                if (!currentSession) {
                    currentSession = {
                        date,
                        startLog: log,
                        endLog: log,
                        pings: [log]
                    };
                } else {
                    currentSession.endLog = log;
                    currentSession.pings.push(log);
                }
            } else {
                if (currentSession) {
                    processSession(currentSession);
                    currentSession = null;
                }
            }
        });

        if (currentSession) {
            processSession(currentSession);
            currentSession = null;
        }

        let totalTimeMs = 0;

        if (gpsLogs.length > 1) {
            const startTs = new Date(gpsLogs[0].timestamp || gpsLogs[0].createdAt).getTime();
            const endTs = new Date(gpsLogs[gpsLogs.length - 1].timestamp || gpsLogs[gpsLogs.length - 1].createdAt).getTime();
            totalTimeMs = endTs - startTs;
        }

        const visitedGeofences = parsedGeofences.map(gf => {
            // Find all raw pings that fell inside this geofence radius
            const siteInsidePings = annotatedLogs.filter(log => {
                const dist = getDistance(log.latitude, log.longitude, gf.latitude, gf.longitude);
                return dist <= gf.radius;
            });

            if (siteInsidePings.length === 0) return null;

            // Exclusive Pings (assigned strictly to this geofence as nearest centroid)
            const exclusivePings = annotatedLogs.filter(log => log.assignedGfName === gf.name);

            // Compute overlapping sites for transparency
            const otherInsideSites = [];
            gpsLogs.forEach(log => {
                const insideGeofencesForLog = parsedGeofences.filter(otherGf => {
                    const d = getDistance(log.latitude, log.longitude, otherGf.latitude, otherGf.longitude);
                    return d <= otherGf.radius;
                });
                if (insideGeofencesForLog.length > 1) {
                    insideGeofencesForLog.forEach(g => {
                        if (g.name !== gf.name && !otherInsideSites.includes(g.name)) {
                            otherInsideSites.push(g.name);
                        }
                    });
                }
            });

            // IN 'CLOSEST' MODE (Single Site / Winner-takes-all):
            // If another site was closer for ALL pings, this site gets 0 exclusive pings -> REMOVE COMPLETELY!
            if (currentOverlapMode === 'CLOSEST' && exclusivePings.length === 0) {
                return null;
            }

            // Determine effective pings to use for this site's visits and timeline
            const effectivePings = currentOverlapMode === 'CLOSEST' ? exclusivePings : siteInsidePings;
            if (effectivePings.length === 0) return null;

            const firstPing = effectivePings[0];
            const lastPing = effectivePings[effectivePings.length - 1];

            const arrivalTime = firstPing.timeString || new Date(firstPing.timestamp || firstPing.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const leavingTime = lastPing.timeString || new Date(lastPing.timestamp || lastPing.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            // Build discrete visit sessions for this geofence
            const visits = [];
            let currentVisit = null;

            effectivePings.forEach((p) => {
                if (!currentVisit) {
                    currentVisit = {
                        visitIndex: 1,
                        date,
                        siteName: gf.name,
                        pings: [p],
                        startPing: p,
                        endPing: p
                    };
                } else {
                    const prevPing = currentVisit.pings[currentVisit.pings.length - 1];
                    const deltaMs = p.timestampMs - prevPing.timestampMs;
                    // Check if employee was outside or at another site between prevPing and p
                    const hasLeftSite = annotatedLogs.some(l => 
                        l.timestampMs > prevPing.timestampMs && 
                        l.timestampMs < p.timestampMs && 
                        (!l.isInside || (currentOverlapMode === 'CLOSEST' && l.assignedGfName !== gf.name))
                    );

                    // A new visit starts if they exited the site boundary OR had a large tracking gap > 45 mins
                    if (hasLeftSite || deltaMs > 45 * 60 * 1000) {
                        visits.push(currentVisit);
                        currentVisit = {
                            visitIndex: visits.length + 1,
                            date,
                            siteName: gf.name,
                            pings: [p],
                            startPing: p,
                            endPing: p
                        };
                    } else {
                        currentVisit.pings.push(p);
                        currentVisit.endPing = p;
                    }
                }
            });

            if (currentVisit) {
                visits.push(currentVisit);
            }

            // Calculate duration for each visit session
            const processedVisits = visits.map((v, vIdx) => {
                let durMs = 0;
                if (currentOverlapMode === 'SPLIT') {
                    // Split mode: Divide each interval by number of overlapping sites for that ping
                    if (v.pings.length > 1) {
                        let prevP = v.pings[0];
                        for (let i = 1; i < v.pings.length; i++) {
                            const currP = v.pings[i];
                            const delta = currP.timestampMs - prevP.timestampMs;
                            const splitFactor = currP.insideCount || 1;
                            durMs += (delta / splitFactor);
                            prevP = currP;
                        }
                    } else {
                        durMs = 60000 / (v.pings[0].insideCount || 1);
                    }
                } else {
                    // Closest / Exclusive mode: 100% of the session time credited to this site
                    const sMs = v.startPing.timestampMs;
                    const eMs = v.endPing.timestampMs;
                    durMs = eMs - sMs;
                    if (durMs <= 0) {
                        durMs = 60000; // Single ping counted as 1 min
                    }
                }

                const durMins = Math.max(1, Math.round(durMs / 60000));
                const durSecs = Math.max(60, Math.round(durMs / 1000));
                return {
                    ...v,
                    visitNumber: vIdx + 1,
                    startTime: v.startPing.timeString,
                    endTime: v.endPing.timeString,
                    durationMs: durMs,
                    durationMins: durMins,
                    durationSecs: durSecs,
                    pingsCount: v.pings.length
                };
            });

            const spendingMins = Math.max(1, Math.round(processedVisits.reduce((acc, v) => acc + v.durationMs, 0) / 60000));
            const hasOverlap = otherInsideSites.length > 0;
            const isOverlapResolved = currentOverlapMode === 'CLOSEST' && hasOverlap;
            const isSplitOverlap = currentOverlapMode === 'SPLIT' && hasOverlap;

            return {
                id: gf.id || gf.name,
                rawGfId: gf.id,
                name: gf.name,
                latitude: gf.latitude,
                longitude: gf.longitude,
                radius: gf.radius,
                arrivalTime,
                leavingTime,
                spendingMins,
                pingsCount: effectivePings.length,
                exclusivePingsCount: exclusivePings.length,
                overlappingSites: otherInsideSites,
                hasOverlap,
                isOverlapResolved,
                isSplitOverlap,
                overlapSplitFactor: otherInsideSites.length + 1,
                visits: processedVisits,
                visitsCount: processedVisits.length,
                isMultiVisit: processedVisits.length > 1
            };
        }).filter(Boolean);

        // Deduplicated inside time resolver equals exact sum of exclusive site durations
        const totalInsideMins = visitedGeofences.reduce((acc, v) => acc + (v.spendingMins || 0), 0);
        const totalMins = totalTimeMs > 0 ? Math.max(totalTimeMs > 0 ? Math.round(totalTimeMs / 60000) : 0, totalInsideMins) : totalInsideMins || 1;
        const sessionsOutsideMins = outsideSessions.reduce((acc, s) => acc + s.durationMins, 0);
        // Only calculate gap outside mins if there were actual confirmed outside pings
        const calculatedGapOutsideMins = outsidePings.length > 0 ? Math.max(0, totalMins - totalInsideMins) : 0;
        const totalOutsideMins = Math.max(sessionsOutsideMins, calculatedGapOutsideMins);
        const insidePercent = totalMins > 0 ? Math.min(100, Math.round((totalInsideMins / totalMins) * 100)) : 100;
        const outsidePercent = Math.max(0, 100 - insidePercent);

        return {
            hasData: true,
            gpsLogs: annotatedLogs,
            metrics: {
                insideTime: totalInsideMins,
                outsideTime: totalOutsideMins,
                totalTime: totalMins,
                insidePercentage: insidePercent,
                outsidePercentage: outsidePercent
            },
            visitedGeofences,
            insidePings,
            outsidePings,
            outsideSessions
        };
    };

    const handleCalculate = async () => {
        if (!selectedEmp) {
            alert('Please select an employee.');
            return;
        }

        let datesToProcess = [];
        if (dateMode === 'SINGLE') {
            if (!selectedDate) {
                alert('Please select a date.');
                return;
            }
            datesToProcess = [selectedDate];
        } else {
            if (!fromDate || !toDate) {
                alert('Please select both From Date and To Date.');
                return;
            }
            datesToProcess = getDatesInRange(fromDate, toDate);
        }

        setIsAnalyzing(true);
        setSearchPerformed(true);
        outsideMarkersRef.current = {};
        if (layersGroupRef.current) {
            layersGroupRef.current.clearLayers();
        }

        try {
            let combinedLogs = [];
            let combinedVisited = [];
            let combinedInsidePings = [];
            let combinedOutsidePings = [];
            let combinedOutsideSessions = [];
            let accInsideMins = 0;
            let accOutsideMins = 0;
            let accTotalMins = 0;

            const parsedGeofences = geofences.map(gf => ({
                ...gf,
                radius: parseFloat(gf.radius || 100),
                latitude: parseFloat(gf.latitude),
                longitude: parseFloat(gf.longitude)
            }));

            for (let d = 0; d < datesToProcess.length; d++) {
                const currDate = datesToProcess[d];
                const res = await analyzeSingleEmployee(selectedEmp, currDate, geofences);
                
                if (res.hasData) {
                    combinedLogs = combinedLogs.concat(res.gpsLogs);
                    combinedInsidePings = combinedInsidePings.concat(res.insidePings || []);
                    combinedOutsidePings = combinedOutsidePings.concat(res.outsidePings);
                    combinedOutsideSessions = combinedOutsideSessions.concat(res.outsideSessions);
                    accInsideMins += res.metrics.insideTime;
                    accOutsideMins += res.metrics.outsideTime;
                    accTotalMins += res.metrics.totalTime;

                    res.visitedGeofences.forEach(v => {
                        combinedVisited.push({
                            ...v,
                            id: `${v.id}_${currDate}`,
                            date: currDate
                        });
                    });
                }
            }

            setLogs(combinedLogs);
            setInsidePings(combinedInsidePings);
            setOutsidePings(combinedOutsidePings);
            setOutsideSessions(combinedOutsideSessions);

            const insidePercentage = accTotalMins > 0 ? Math.min(100, Math.round((accInsideMins / accTotalMins) * 100)) : 0;
            const outsidePercentage = 100 - insidePercentage;

            setMetrics({
                insideTime: accInsideMins,
                outsideTime: accOutsideMins,
                totalTime: accTotalMins,
                insidePercentage,
                outsidePercentage
            });

            setVisitedGeofences(combinedVisited);

            // ---------------------------------------------------------
            // Map Plotting: Draw Geofences, Path & Red Outside Markers
            // ---------------------------------------------------------
            parsedGeofences.forEach(gf => {
                const visitsForGf = combinedVisited.filter(v => 
                    String(v.rawGfId || v.name) === String(gf.id || gf.name) || v.name === gf.name
                );

                const isVisited = visitsForGf.length > 0;
                const circleColor = isVisited ? '#10b981' : '#3b82f6';

                let hoverTooltipText = `<b>🏢 ${gf.name}</b><br/>Status: ${isVisited ? '<span style="color:#10b981;font-weight:bold;">Visited ✅</span>' : '<span style="color:#64748b;">Not Visited</span>'}<br/>Radius: ${gf.radius}m`;

                if (isVisited) {
                    const lastV = visitsForGf[visitsForGf.length - 1];
                    if (lastV.isMultiVisit) {
                        hoverTooltipText += `<br/><b>🔁 ${lastV.visitsCount} In & Out Visits</b><br/>First In: ${lastV.arrivalTime} • Last Out: ${lastV.leavingTime}<br/><span style="color:#10b981;font-weight:bold;">Net Time Inside: ${formatMinutes(siteInfoSpending(lastV))}</span>`;
                    } else {
                        hoverTooltipText += `<br/>Time Spent: <b>${formatMinutes(siteInfoSpending(lastV))}</b><br/>Arrival: ${lastV.arrivalTime} | Exit: ${lastV.leavingTime}`;
                    }
                }

                const circle = window.L.circle([gf.latitude, gf.longitude], {
                    color: circleColor,
                    fillColor: circleColor,
                    fillOpacity: isVisited ? 0.25 : 0.1,
                    radius: gf.radius,
                    weight: isVisited ? 3 : 1.5
                });

                circle.bindTooltip(hoverTooltipText, { sticky: true, opacity: 0.95 });

                if (isVisited) {
                    const lastV = visitsForGf[visitsForGf.length - 1];
                    const popupContent = `
                        <div style="font-family: sans-serif; padding: 4px; font-size: 13px; color: #333;">
                            <h4 style="margin: 0 0 8px 0; font-size: 15px; color: #0f172a; display: flex; align-items: center; gap: 6px;">🏢 ${gf.name}</h4>
                            <div style="margin-bottom: 8px; color: #10b981; font-weight: 700; font-size: 12px;">
                                Date: <b>${lastV.date}</b>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                ${lastV.isMultiVisit ? `
                                    <div style="padding: 8px 10px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.3); margin-bottom: 4px;">
                                        <div style="font-weight: 800; color: #059669; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                            🔁 Multi-Visit: ${lastV.visitsCount} In & Out Sessions
                                        </div>
                                        <div style="font-size: 11px; color: #334155; margin-top: 3px;">
                                            First In: <b>${lastV.arrivalTime}</b> • Last Out: <b>${lastV.leavingTime}</b>
                                        </div>
                                        <div style="font-size: 11px; color: #059669; font-weight: 700; margin-top: 2px;">
                                            Net Spent Inside: <b>${formatMinutes(siteInfoSpending(lastV))}</b>
                                        </div>
                                    </div>
                                    <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-top: 2px;">In & Out Sessions Breakdown:</div>
                                    <div style="max-height: 130px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
                                        ${(lastV.visits || []).map((v, i) => `
                                            <div style="padding: 4px 6px; background: #f8fafc; border-radius: 4px; font-size: 11px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                                                <span><b>#${i+1}:</b> ${v.startTime}${v.startTime !== v.endTime ? ` ➔ ${v.endTime}` : ''}</span>
                                                <b style="color: #059669;">${v.durationMins}m (${v.pingsCount}p)</b>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : `
                                    <div>⏰ <span style="color: #666;">Arrival:</span> <b>${lastV.arrivalTime}</b></div>
                                    <div>🚪 <span style="color: #666;">Leaving:</span> <b>${lastV.leavingTime}</b></div>
                                    <div>⏳ <span style="color: #666;">Spent:</span> <b style="color: #2563eb;">${formatMinutes(siteInfoSpending(lastV))}</b></div>
                                `}
                                <div style="margin-top: 4px;">📍 <span style="color: #666;">Total Inside Pings:</span> <b>${lastV.pingsCount}</b></div>
                            </div>
                        </div>
                    `;
                    circle.bindPopup(popupContent, { minWidth: 240 });
                }

                circle.addTo(layersGroupRef.current);
                if (gf.id) circleLayersRef.current[gf.id] = circle;
                if (gf.name) circleLayersRef.current[gf.name] = circle;
            });

            // Draw Segmented Trajectory Path (Green for Inside, Red for Outside)
            if (combinedLogs.length > 0) {
                for (let i = 0; i < combinedLogs.length - 1; i++) {
                    const p1 = combinedLogs[i];
                    const p2 = combinedLogs[i + 1];
                    const isOutside = !p1.isInside || !p2.isInside;

                    window.L.polyline([[p1.latitude, p1.longitude], [p2.latitude, p2.longitude]], {
                        color: isOutside ? '#ef4444' : '#10b981',
                        weight: isOutside ? 4 : 3,
                        opacity: 0.85,
                        dashArray: isOutside ? '6, 6' : null
                    }).addTo(layersGroupRef.current);
                }

                // Drop Red Pins for Outside Pings
                combinedOutsidePings.forEach((ping, pIdx) => {
                    const pingKey = `outside_${ping.date}_${ping.index}`;
                    const redMarker = window.L.marker([ping.latitude, ping.longitude], {
                        icon: window.L.divIcon({
                            className: 'custom-outside-marker',
                            html: `<div style="background-color: #ef4444; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(239,68,68,0.8); cursor: pointer;"></div>`,
                            iconSize: [14, 14],
                            iconAnchor: [7, 7]
                        })
                    }).addTo(layersGroupRef.current);

                    const popupContent = `
                        <div style="font-family: sans-serif; padding: 4px; font-size: 13px; color: #1e293b;">
                            <h4 style="margin: 0 0 6px 0; font-size: 14px; color: #ef4444; display: flex; align-items: center; gap: 6px;">
                                🚨 Outside Geofence Ping
                            </h4>
                            <div style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569;">
                                <div><b>Time:</b> ${ping.timeString}</div>
                                <div><b>Date:</b> ${ping.date}</div>
                                <div><b>Distance:</b> ${ping.minDistanceMeters}m from ${ping.nearestGfName}</div>
                                <div><b>Coords:</b> ${ping.latitude.toFixed(6)}, ${ping.longitude.toFixed(6)}</div>
                            </div>
                        </div>
                    `;

                    redMarker.bindPopup(popupContent, { minWidth: 220 });
                    outsideMarkersRef.current[pingKey] = redMarker;
                });

                const start = combinedLogs[0];
                const end = combinedLogs[combinedLogs.length - 1];

                const startMarker = window.L.marker([start.latitude, start.longitude], {
                    icon: window.L.divIcon({
                        className: 'custom-start-marker',
                        html: `<div style="background-color: #10b981; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.3);"></div>`
                    })
                });
                startMarker.bindTooltip('<b>🟢 Tracking Start Point</b><br/>Time: ' + start.timeString, { sticky: true });
                startMarker.addTo(layersGroupRef.current);

                const endMarker = window.L.marker([end.latitude, end.longitude], {
                    icon: window.L.divIcon({
                        className: 'custom-end-marker',
                        html: `<div style="background-color: #3b82f6; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.3);"></div>`
                    })
                });
                endMarker.bindTooltip('<b>🔵 Last Known GPS Location</b><br/>Time: ' + end.timeString, { sticky: true });
                endMarker.addTo(layersGroupRef.current);

                // Fit bounds to employee tracking path & visited sites ONLY (keeps map focused on active region)
                const focusedPoints = combinedLogs.map(log => [log.latitude, log.longitude]);
                combinedVisited.forEach(v => {
                    if (v.latitude && v.longitude) {
                        focusedPoints.push([v.latitude, v.longitude]);
                    }
                });
                if (focusedPoints.length > 0) {
                    mapInstance.current.fitBounds(window.L.latLngBounds(focusedPoints), { padding: [40, 40] });
                }
            } else if (parsedGeofences.length > 0) {
                const bounds = window.L.featureGroup(
                    parsedGeofences.map(gf => window.L.circle([gf.latitude, gf.longitude], { radius: gf.radius }))
                ).getBounds();
                mapInstance.current.fitBounds(bounds, { padding: [40, 40] });
            }
        } catch (error) {
            console.error('Calculation error:', error);
            alert('Failed to analyze footprints.');
        } finally {
            setTimeout(() => setIsAnalyzing(false), 300);
        }
    };

    const siteInfoSpending = (v) => v ? v.spendingMins : 0;

    // Fly to specific outside ping on map
    const handleFocusOutsidePingOnMap = (ping) => {
        setShowOutsideModal(false);
        if (!mapInstance.current) return;
        
        const lat = parseFloat(ping.latitude);
        const lng = parseFloat(ping.longitude);

        if (!isNaN(lat) && !isNaN(lng)) {
            mapInstance.current.flyTo([lat, lng], 17, { duration: 1.2 });
            const pingKey = `outside_${ping.date}_${ping.index}`;
            const marker = outsideMarkersRef.current[pingKey];
            if (marker) {
                setTimeout(() => {
                    marker.openPopup();
                }, 450);
            }
        }
    };

    // Fly to specific inside ping on map
    const handleFocusInsidePingOnMap = (ping) => {
        setShowInsideModal(false);
        if (!mapInstance.current) return;
        
        const lat = parseFloat(ping.latitude);
        const lng = parseFloat(ping.longitude);

        if (!isNaN(lat) && !isNaN(lng)) {
            mapInstance.current.flyTo([lat, lng], 17, { duration: 1.2 });
            const key = ping.assignedGfName || ping.nearestGfName;
            const circle = circleLayersRef.current[key];
            if (circle) {
                setTimeout(() => {
                    circle.openPopup();
                }, 450);
            }
        }
    };

    // Excel Export Generator
    const handleExportExcel = async (exportScope) => {
        let targetDates = [];
        if (dateMode === 'SINGLE') {
            if (!selectedDate) {
                alert('Please select a date for Excel export.');
                return;
            }
            targetDates = [selectedDate];
        } else {
            if (!fromDate || !toDate) {
                alert('Please select both From Date and To Date for Excel export.');
                return;
            }
            targetDates = getDatesInRange(fromDate, toDate);
        }

        setShowExportMenu(false);
        setExporting(true);

        try {
            let targetEmps = [];

            if (exportScope === 'SINGLE') {
                if (!selectedEmp) {
                    alert('Please select an employee to export single employee report.');
                    setExporting(false);
                    return;
                }
                const empObj = employees.find(e => String(e.id) === String(selectedEmp));
                if (empObj) targetEmps = [empObj];
            } else if (exportScope === 'OFFICE') {
                targetEmps = employees.filter(e => e.role !== 'ADMIN' && (e.designation || 'OFFICE').toUpperCase() === 'OFFICE');
            } else if (exportScope === 'FIELD') {
                targetEmps = employees.filter(e => e.role !== 'ADMIN' && (e.designation || '').toUpperCase() === 'FIELD');
            } else {
                targetEmps = employees.filter(e => e.role !== 'ADMIN');
            }

            if (targetEmps.length === 0) {
                alert('No matching employees found for export.');
                setExporting(false);
                return;
            }

            // Dynamic import — ExcelJS only loads when user clicks Export
            const { default: ExcelJS } = await import('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'HRMS System';
            workbook.lastModifiedBy = 'Admin';
            workbook.created = new Date();

            const sheet = workbook.addWorksheet('Site Visit Analytics');

            sheet.mergeCells('A1:N1');
            const titleCell = sheet.getCell('A1');
            titleCell.value = 'SITE VISITS & GEOFENCE COMPLIANCE MASTER REPORT';
            titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFF' } };
            titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
            sheet.getRow(1).height = 30;

            const dateRangeLabel = dateMode === 'SINGLE' ? selectedDate : `${fromDate} to ${toDate}`;
            sheet.mergeCells('A2:N2');
            const metaCell = sheet.getCell('A2');
            metaCell.value = `Date Range: ${dateRangeLabel}  |  Export Scope: ${exportScope}  |  Total Staff Analyzed: ${targetEmps.length}  |  Generated At: ${new Date().toLocaleString()}`;
            metaCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: '475569' } };
            metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
            sheet.getRow(2).height = 20;

            const headers = [
                'Emp Code',
                'Employee Name',
                'Work Mode',
                'Designation',
                'Date',
                'Month',
                'Year',
                'Total Sites Visited',
                'Names of All Sites Visited',
                'Site Visit Timelines & Details',
                'Time Inside Geofence',
                'Time Outside Geofence',
                'Total Tracked Duration',
                'Compliance Rate (%)'
            ];

            const headerRow = sheet.addRow(headers);
            headerRow.height = 25;
            headerRow.eachCell((cell) => {
                cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });

            for (let i = 0; i < targetEmps.length; i++) {
                const emp = targetEmps[i];
                const empCode = emp.employeeId || emp.empCode || `EMP${emp.id}`;
                const modeStr = (emp.designation || 'OFFICE').toUpperCase() === 'FIELD' ? 'FIELD' : 'OFFICE';
                
                for (let d = 0; d < targetDates.length; d++) {
                    const currDateStr = targetDates[d];
                    const dateInfo = getMonthYearFromDate(currDateStr);

                    const res = await analyzeSingleEmployee(emp.id, currDateStr, geofences);
                    
                    const totalSitesCount = res.visitedGeofences.length;
                    const siteNamesList = totalSitesCount > 0 
                        ? res.visitedGeofences.map(s => s.name).join(', ') 
                        : 'No Office Sites Visited';
                        
                    const siteTimelines = totalSitesCount > 0
                        ? res.visitedGeofences.map(s => `[${s.name}: ${s.arrivalTime} - ${s.leavingTime} (${formatMinutes(s.spendingMins)})]`).join(' | ')
                        : 'N/A';

                    const row = sheet.addRow([
                        empCode,
                        emp.name,
                        modeStr,
                        emp.designation || 'Staff',
                        dateInfo.date,
                        dateInfo.month,
                        dateInfo.year,
                        totalSitesCount,
                        siteNamesList,
                        siteTimelines,
                        formatMinutes(res.metrics.insideTime),
                        formatMinutes(res.metrics.outsideTime),
                        formatMinutes(res.metrics.totalTime),
                        `${res.metrics.insidePercentage}%`
                    ]);

                    row.height = 24;
                    row.eachCell((cell, colNum) => {
                        cell.font = { name: 'Arial', size: 10 };
                        cell.alignment = { vertical: 'middle', horizontal: colNum >= 5 && colNum !== 9 && colNum !== 10 ? 'center' : 'left' };
                        if (colNum === 14) {
                            cell.font = { bold: true, color: { argb: res.metrics.insidePercentage >= 50 ? '059669' : 'DC2626' } };
                        }
                    });
                }
            }

            sheet.columns.forEach(column => {
                let maxLength = 12;
                column.eachCell({ includeEmpty: true }, cell => {
                    const columnLength = cell.value ? String(cell.value).length : 10;
                    if (columnLength > maxLength) {
                        maxLength = columnLength;
                    }
                });
                column.width = Math.min(35, maxLength + 4);
            });

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Site_Info_Analytics_${exportScope}_${dateRangeLabel.replace(/ /g, '_')}.xlsx`;
            a.click();
            window.URL.revokeObjectURL(url);

        } catch (err) {
            console.error('Excel Export Error:', err);
            alert('Failed to generate Excel report.');
        } finally {
            setExporting(false);
        }
    };

    // Resolve clean real-world state name from site coordinates, name, address & state property
    const resolveSiteState = (g) => {
        if (!g) return null;
        if (g.state && typeof g.state === 'string' && isNaN(Number(g.state))) return g.state.trim();

        const name = String(g.name || '').toLowerCase();
        const address = String(g.address || '').toLowerCase();
        const text = name + ' ' + address;

        if (text.includes('madhya pradesh') || text.includes('bhopal') || text.includes('indore') || text.includes('jabalpur') || text.includes('gwalior')) return 'Madhya Pradesh';
        if (text.includes('himachal') || text.includes('sirmaur') || text.includes('solan') || text.includes('shimla') || text.includes('paonta') || text.includes('rajban') || text.includes('renuka') || text.includes('nahan') || text.includes('baru saib')) return 'Himachal Pradesh';
        if (text.includes('punjab') || text.includes('amritsar') || text.includes('tarn taran') || text.includes('ludhiana') || text.includes('jalandhar') || text.includes('patiala') || text.includes('machhike') || text.includes('mirankot')) return 'Punjab';
        if (text.includes('tamil nadu') || text.includes('chennai') || text.includes('madurai') || text.includes('coimbatore')) return 'Tamil Nadu';
        if (text.includes('haryana') || text.includes('gurugram') || text.includes('faridabad') || text.includes('karnal') || text.includes('panipat')) return 'Haryana';
        if (text.includes('uttar pradesh') || text.includes('noida') || text.includes('ghaziabad') || text.includes('lucknow') || text.includes('kanpur') || text.includes('varanasi') || text.includes('ballia')) return 'Uttar Pradesh';
        if (text.includes('delhi')) return 'Delhi / NCR';

        const lat = parseFloat(g.latitude);
        const lng = parseFloat(g.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
            if (lat >= 30.3 && lat <= 32.5 && lng >= 76.5 && lng <= 79.0) return 'Himachal Pradesh';
            if (lat >= 30.8 && lat <= 32.5 && lng >= 74.0 && lng <= 76.5) return 'Punjab';
            if (lat >= 21.0 && lat <= 26.9 && lng >= 74.0 && lng <= 82.8) return 'Madhya Pradesh';
            if (lat >= 8.0 && lat <= 13.5 && lng >= 76.0 && lng <= 80.5) return 'Tamil Nadu';
            if (lat >= 27.5 && lat <= 30.8 && lng >= 74.5 && lng <= 77.5) return 'Haryana';
            if (lat >= 24.0 && lat <= 30.5 && lng >= 77.0 && lng <= 84.5) return 'Uttar Pradesh';
        }

        return null;
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

        // Known onboarding assignment for field staff
        const empId = String(emp.id || emp.employeeId || '');
        if (['EMP0129', 'EMP0125', 'EMP0130'].includes(empId)) return 'Himachal Pradesh';
        if (['EMP0126', 'EMP0127', 'EMP0128', 'EMP0131', 'EMP0132', 'EMP0133', 'EMP0134', 'EMP0135', 'EMP0136'].includes(empId)) return 'Punjab';
        if (['EMP0010', 'EMP0022', 'HMPL65'].includes(empId)) return 'Tamil Nadu';
        if (['EMP0124', 'EMP0018', 'EMP0019', 'hmpl001', 'EMP0021', 'EMP0020'].includes(empId)) return 'Uttar Pradesh';

        return 'Uttar Pradesh';
    };

    // Extract unique dynamic states from sites and employees
    const availableStates = Array.from(new Set([
        ...(geofences || []).map(resolveSiteState).filter(Boolean),
        ...(employees || []).map(resolveEmpOnboardingState).filter(Boolean)
    ])).sort();

    const filteredEmployees = employees.filter(emp => {
        const matchesMode = (emp.designation || 'OFFICE').toUpperCase() === workMode;
        const isNotAdmin = emp.role !== 'ADMIN';
        if (!matchesMode || !isNotAdmin) return false;

        if (selectedState === 'ALL') return true;

        const targetState = selectedState.toLowerCase();
        const empState = resolveEmpOnboardingState(emp).toLowerCase();

        return empState.includes(targetState) || targetState.includes(empState);
    });

    const filteredOutsidePings = outsidePings.filter(p => {
        if (!outsideSearchTerm) return true;
        const term = outsideSearchTerm.toLowerCase();
        return p.timeString.toLowerCase().includes(term) ||
               p.nearestGfName.toLowerCase().includes(term) ||
               (p.date && p.date.includes(term));
    });

    const filteredInsidePings = insidePings.filter(p => {
        if (!insideSearchTerm) return true;
        const term = insideSearchTerm.toLowerCase();
        return (p.timeString && p.timeString.toLowerCase().includes(term)) ||
               (p.assignedGfName && p.assignedGfName.toLowerCase().includes(term)) ||
               (p.nearestGfName && p.nearestGfName.toLowerCase().includes(term)) ||
               (p.date && p.date.includes(term));
    });

    return (
        <div id="site-info-view" className="view active" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: 'calc(100vh - 120px)' }}>
            
            {/* Filter Section */}
            <div className="glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                
                {/* Work Mode Filter */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>Work Mode</label>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', height: '42px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', color: 'var(--text-primary)' }}>
                            <input 
                                type="radio" 
                                name="workMode" 
                                value="OFFICE" 
                                checked={workMode === 'OFFICE'} 
                                onChange={() => {
                                    setWorkMode('OFFICE');
                                    setSelectedEmp('');
                                }}
                                style={{ accentColor: 'var(--primary-color)', width: '16px', height: '16px' }}
                            />
                            Office Person
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', color: 'var(--text-primary)' }}>
                            <input 
                                type="radio" 
                                name="workMode" 
                                value="FIELD" 
                                checked={workMode === 'FIELD'} 
                                onChange={() => {
                                    setWorkMode('FIELD');
                                    setSelectedEmp('');
                                }}
                                style={{ accentColor: 'var(--primary-color)', width: '16px', height: '16px' }}
                            />
                            Field Person
                        </label>
                    </div>
                </div>

                {/* Filter by State */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>Filter by State</label>
                    <select 
                        value={selectedState} 
                        onChange={(e) => {
                            const newSt = e.target.value;
                            setSelectedState(newSt);
                            setSelectedEmp('');
                        }}
                        style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', width: '200px', fontWeight: '600' }}
                    >
                        <option value="ALL">All States ({availableStates.length})</option>
                        {availableStates.map(st => (
                            <option key={st} value={st}>📍 {st}</option>
                        ))}
                    </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>Select Employee</label>
                    <select 
                        value={selectedEmp} 
                        onChange={(e) => setSelectedEmp(e.target.value)}
                        style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', width: '220px', fontWeight: '600' }}
                    >
                        <option value="">-- Select Employee --</option>
                        {filteredEmployees.map(emp => (
                            <option key={emp.id} value={emp.id}>{emp.name} ({emp.empCode || emp.employeeId || emp.id})</option>
                        ))}
                    </select>
                </div>

                {/* Date Selection Mode Toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>Date Filter Mode</label>
                    <select 
                        value={dateMode}
                        onChange={(e) => setDateMode(e.target.value)}
                        style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', width: '170px', fontWeight: '600' }}
                    >
                        <option value="SINGLE">Single Date</option>
                        <option value="RANGE">Custom Date Range</option>
                    </select>
                </div>

                {/* Date Input(s) */}
                {dateMode === 'SINGLE' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>Select Date</label>
                        <input 
                            type="date" 
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', width: '170px', fontWeight: '600' }}
                        />
                    </div>
                ) : (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>From Date</label>
                            <input 
                                type="date" 
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                                style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', width: '160px', fontWeight: '600' }}
                            />
                        </div>
                        <span style={{ marginTop: '22px', fontWeight: '700', color: 'var(--text-muted)' }}>➔</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>To Date</label>
                            <input 
                                type="date" 
                                value={toDate}
                                onChange={(e) => setToDate(e.target.value)}
                                style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', width: '160px', fontWeight: '600' }}
                            />
                        </div>
                    </div>
                )}

                {/* Overlap Boundary Handling Mode */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                        <i className="fa-solid fa-layer-group" style={{ marginRight: '5px', color: 'var(--primary-color)' }}></i>
                        Overlap Handling
                    </label>
                    <select 
                        value={overlapMode} 
                        onChange={(e) => setOverlapMode(e.target.value)}
                        style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', width: '235px', fontWeight: '600' }}
                        title="Choose how to resolve GPS pings that fall inside overlapping geofence boundaries"
                    >
                        <option value="CLOSEST">🎯 Closest Site Only (Single Site)</option>
                        <option value="SPLIT">⚖️ 50/50 Equal Time Split</option>
                    </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '22px' }}>
                    <button 
                        onClick={handleCalculate}
                        disabled={isAnalyzing || exporting}
                        style={{ padding: '10px 24px', borderRadius: '8px', background: 'var(--primary-color)', color: 'white', border: 'none', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'opacity 0.2s' }}
                    >
                        {isAnalyzing ? (
                            <>
                                <i className="fa-solid fa-spinner fa-spin"></i> Analyzing...
                            </>
                        ) : (
                            <>
                                <i className="fa-solid fa-calculator"></i> Calculate Analytics
                            </>
                        )}
                    </button>

                    {/* Excel Export Button */}
                    <div style={{ position: 'relative' }} ref={exportMenuRef}>
                        <button
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            disabled={exporting}
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                background: '#10b981',
                                color: 'white',
                                border: 'none',
                                fontWeight: '700',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                                transition: 'all 0.2s'
                            }}
                        >
                            {exporting ? (
                                <><i className="fa-solid fa-spinner fa-spin"></i> Exporting Excel...</>
                            ) : (
                                <>
                                    <i className="fa-solid fa-file-excel"></i> Export Excel <i className="fa-solid fa-chevron-down" style={{ fontSize: '11px', marginLeft: '4px' }}></i>
                                </>
                            )}
                        </button>

                        {showExportMenu && (
                            <div style={{
                                position: 'absolute',
                                top: '100%',
                                right: 0,
                                marginTop: '6px',
                                background: 'var(--bg-panel, #1e293b)',
                                border: '1px solid var(--border-glass, #334155)',
                                borderRadius: '10px',
                                boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                                zIndex: 9999,
                                width: '250px',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column'
                            }}>
                                <button
                                    onClick={() => handleExportExcel('SINGLE')}
                                    style={{
                                        padding: '12px 16px',
                                        background: 'transparent',
                                        border: 'none',
                                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                                        color: 'var(--text-primary, #fff)',
                                        textAlign: 'left',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px'
                                    }}
                                    className="export-option-btn"
                                >
                                    <i className="fa-solid fa-user" style={{ color: '#3b82f6' }}></i> Selected Employee Report
                                </button>

                                <button
                                    onClick={() => handleExportExcel('OFFICE')}
                                    style={{
                                        padding: '12px 16px',
                                        background: 'transparent',
                                        border: 'none',
                                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                                        color: 'var(--text-primary, #fff)',
                                        textAlign: 'left',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px'
                                    }}
                                    className="export-option-btn"
                                >
                                    <i className="fa-solid fa-building" style={{ color: '#10b981' }}></i> All Office Staff Report
                                </button>

                                <button
                                    onClick={() => handleExportExcel('FIELD')}
                                    style={{
                                        padding: '12px 16px',
                                        background: 'transparent',
                                        border: 'none',
                                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                                        color: 'var(--text-primary, #fff)',
                                        textAlign: 'left',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px'
                                    }}
                                    className="export-option-btn"
                                >
                                    <i className="fa-solid fa-person-walking" style={{ color: '#f59e0b' }}></i> All Field Workers Report
                                </button>

                                <button
                                    onClick={() => handleExportExcel('ALL')}
                                    style={{
                                        padding: '12px 16px',
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--text-primary, #fff)',
                                        textAlign: 'left',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px'
                                    }}
                                    className="export-option-btn"
                                >
                                    <i className="fa-solid fa-users" style={{ color: '#8b5cf6' }}></i> All Staff Master Report
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Split Analytics View */}
            <div className="site-info-split-grid" style={{ flex: 1, minHeight: 0 }}>
                
                {/* Left Side: Summary and Visited Geofences */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', paddingRight: '4px' }}>
                    
                    {/* Summary Metrics Cards */}
                    <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>GPS Geofence Summary</h3>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                            
                            {/* Inside Geofence Card (Interactive Clickable) */}
                            {(() => {
                                const canInspectInside = metrics.insideTime > 0 || insidePings.length > 0;
                                return (
                                    <div 
                                        onClick={() => {
                                            if (canInspectInside) setShowInsideModal(true);
                                        }}
                                        style={{ 
                                            padding: '14px', 
                                            borderRadius: '10px', 
                                            background: 'rgba(16, 185, 129, 0.08)', 
                                            border: '1px solid rgba(16, 185, 129, 0.3)',
                                            cursor: canInspectInside ? 'pointer' : 'default',
                                            transition: 'all 0.2s',
                                            position: 'relative'
                                        }}
                                        title={canInspectInside ? "Click to view detailed inside geofence pings, visits and durations" : "No inside geofence duration recorded"}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>Inside Geofence</span>
                                            {insidePings.length > 0 ? (
                                                <span style={{ background: '#10b981', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '10px' }}>
                                                    {insidePings.length} pings ➔
                                                </span>
                                            ) : null}
                                        </div>
                                        <h4 style={{ margin: '6px 0 0 0', fontSize: '20px', fontWeight: '800', color: '#10b981' }}>{formatMinutes(metrics.insideTime)}</h4>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                ({metrics.insidePercentage}%{visitedGeofences.length > 0 ? ` • ${visitedGeofences.reduce((acc, v) => acc + (v.visitsCount || 1), 0)} visits` : ''})
                                            </span>
                                            {canInspectInside && (
                                                <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 600, textDecoration: 'underline' }}>
                                                    Click to inspect 📍
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Outside Geofence Card (Interactive Clickable) */}
                            {(() => {
                                const canInspectOutside = metrics.outsideTime > 0 || outsidePings.length > 0;
                                return (
                                    <div 
                                        onClick={() => {
                                            if (canInspectOutside) setShowOutsideModal(true);
                                        }}
                                        style={{ 
                                            padding: '14px', 
                                            borderRadius: '10px', 
                                            background: 'rgba(239, 68, 68, 0.08)', 
                                            border: '1px solid rgba(239, 68, 68, 0.3)',
                                            cursor: canInspectOutside ? 'pointer' : 'default',
                                            transition: 'all 0.2s',
                                            position: 'relative'
                                        }}
                                        title={canInspectOutside ? "Click to view detailed outside pings and exit timelines" : "No outside geofence duration recorded"}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: '700' }}>Outside Geofence</span>
                                            {outsidePings.length > 0 ? (
                                                <span style={{ background: '#ef4444', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '10px' }}>
                                                    {outsidePings.length} pings ➔
                                                </span>
                                            ) : canInspectOutside ? (
                                                <span style={{ background: '#f59e0b', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '10px' }}>
                                                    Shift gap ➔
                                                </span>
                                            ) : null}
                                        </div>
                                        <h4 style={{ margin: '6px 0 0 0', fontSize: '20px', fontWeight: '800', color: '#ef4444' }}>{formatMinutes(metrics.outsideTime)}</h4>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({metrics.outsidePercentage}%)</span>
                                            {canInspectOutside && (
                                                <span style={{ fontSize: '10px', color: '#ef4444', fontWeight: 600, textDecoration: 'underline' }}>
                                                    Click to inspect 🚨
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Progress Bar representation */}
                        <div style={{ width: '100%', height: '8px', borderRadius: '4px', background: '#ef4444', overflow: 'hidden', display: 'flex' }}>
                            <div style={{ width: `${metrics.insidePercentage}%`, height: '100%', background: '#10b981' }}></div>
                        </div>

                        {/* Overlap Explanation Callout Banner */}
                        {visitedGeofences.some(v => v.hasOverlap || v.isOverlapResolved || v.isSplitOverlap) && (
                            <div style={{ 
                                padding: '10px 14px', 
                                background: overlapMode === 'CLOSEST' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(37, 99, 235, 0.08)', 
                                borderRadius: '8px', 
                                border: `1px solid ${overlapMode === 'CLOSEST' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(37, 99, 235, 0.3)'}`, 
                                fontSize: '11px', 
                                color: overlapMode === 'CLOSEST' ? '#059669' : '#1e40af', 
                                lineHeight: 1.4, 
                                display: 'flex', 
                                alignItems: 'flex-start', 
                                gap: '8px' 
                            }}>
                                <i className={overlapMode === 'CLOSEST' ? "fa-solid fa-circle-check" : "fa-solid fa-scale-balanced"} style={{ fontSize: '14px', color: overlapMode === 'CLOSEST' ? '#10b981' : '#2563eb', marginTop: '2px' }}></i>
                                <div>
                                    {overlapMode === 'CLOSEST' ? (
                                        <>
                                            <strong>Geofence Boundary Overlap Conflict Resolved:</strong> Coordinates falling inside overlapping radii were exclusively attributed to the closest site center. Secondary overlapping site cards have been removed to prevent duplicate visits.
                                        </>
                                    ) : (
                                        <>
                                            <strong>Geofence Boundary 50/50 Split Active:</strong> Coordinates falling within multiple overlapping site boundaries have their dwell time distributed equally across both sites to prevent double-counting.
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Visited Geofences List */}
                    <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0 }}>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>Visited Office Sites</h3>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
                            {!searchPerformed ? (
                                <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', margin: '40px 0' }}>Select criteria and click Calculate to view visited sites.</p>
                            ) : visitedGeofences.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                                    <div style={{ fontSize: '32px', marginBottom: '8px' }}>📍</div>
                                    <p style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>No Sites Visited</p>
                                    <p style={{ margin: 0, fontSize: '12px' }}>The user did not enter any configured office geofences on this date.</p>
                                </div>
                            ) : (
                                visitedGeofences.map((site, index) => (
                                    <div 
                                        key={`${site.id}_${index}`} 
                                        onClick={() => handleSiteCardClick(site)}
                                        title="Click to zoom to geofence on map"
                                        style={{ 
                                            padding: '14px', 
                                            borderRadius: '10px', 
                                            background: 'var(--bg-dark)', 
                                            border: '1px solid var(--border-glass)', 
                                            display: 'flex', 
                                            justify: 'space-between', 
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = '#2563eb';
                                            e.currentTarget.style.background = 'rgba(37, 99, 235, 0.08)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = 'var(--border-glass)';
                                            e.currentTarget.style.background = 'var(--bg-dark)';
                                        }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <span style={{ fontWeight: '700', fontSize: '14px', color: 'var(--text-primary)' }}>🏢 {site.name}</span>
                                                {site.date && (
                                                    <span style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '600' }}>{site.date}</span>
                                                )}
                                                {site.isMultiVisit ? (
                                                    <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '800' }}>
                                                        🔁 {site.visitsCount} Visits (Come & Go)
                                                    </span>
                                                ) : (
                                                    <span style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '700' }}>
                                                        1 Visit
                                                    </span>
                                                )}
                                                {site.isOverlapResolved && (
                                                    <span style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <i className="fa-solid fa-bullseye"></i> Nearest Site (Resolved Overlap with {site.overlappingSites.join(', ')})
                                                    </span>
                                                )}
                                                {site.isSplitOverlap && (
                                                    <span style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <i className="fa-solid fa-scale-balanced"></i> {Math.round(100 / (site.overlapSplitFactor || 2))}% Split ({site.overlappingSites.join(', ')})
                                                    </span>
                                                )}
                                                {!site.isOverlapResolved && !site.isSplitOverlap && site.hasOverlap && (
                                                    <span style={{ background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a', padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <i className="fa-solid fa-layer-group"></i> Overlaps with {site.overlappingSites.join(', ')}
                                                    </span>
                                                )}
                                            </div>
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                {site.isMultiVisit ? (
                                                    <>
                                                        First In: <b>{site.arrivalTime}</b> • Last Out: <b>{site.leavingTime}</b>{' '}
                                                        <span style={{ color: '#10b981', fontWeight: '700' }}>
                                                            ({site.visitsCount} entries & exits • {formatMinutes(siteInfoSpending(site))} net spent)
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        Arrival: <b>{site.arrivalTime}</b> • Left: <b>{site.leavingTime}</b> (1 continuous visit)
                                                    </>
                                                )}
                                            </span>
                                            {site.isMultiVisit && (
                                                <span 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setShowInsideModal(true);
                                                    }}
                                                    style={{ fontSize: '11px', color: '#10b981', fontWeight: '700', textDecoration: 'underline', marginTop: '2px', cursor: 'pointer', display: 'inline-block' }}
                                                >
                                                    🔍 View All {site.visitsCount} In & Out Sessions ➔
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                            <span style={{ background: 'rgba(37, 99, 235, 0.1)', color: '#2563eb', padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>
                                                {formatMinutes(siteInfoSpending(site))} spent
                                            </span>
                                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({site.pingsCount} pings) • 📍 View on map</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Side: Leaflet Map */}
                <div className="glass" style={{ padding: '8px', position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: '12px', zIndex: 1 }} />
                </div>
            </div>

            {/* ---------------------------------------------------------------------- */}
            {/* OUTSIDE GEOFENCE DETAILED BREAKDOWN MODAL */}
            {/* ---------------------------------------------------------------------- */}
            {showOutsideModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0, 0, 0, 0.8)',
                    backdropFilter: 'blur(5px)',
                    zIndex: 99999,
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'center',
                    padding: '20px'
                }}>
                    <div className="glass" style={{
                        width: '100%',
                        maxWidth: '850px',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                        background: 'var(--bg-panel, #0f172a)',
                        border: '1px solid rgba(239, 68, 68, 0.3)'
                    }}>
                        {/* Modal Header */}
                        <div style={{
                            padding: '20px 24px',
                            borderBottom: '1px solid var(--border-glass, #1e293b)',
                            display: 'flex',
                            justify: 'space-between',
                            alignItems: 'center',
                            background: 'rgba(239, 68, 68, 0.05)'
                        }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <i className="fa-solid fa-triangle-exclamation"></i>
                                    Outside Geofence Detailed Breakdown ({outsidePings.length} Pings • {formatMinutes(metrics.outsideTime)})
                                </h3>
                                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                                    Detailed timestamps, exit durations, and location pings when employee was outside geofence boundaries.
                                </p>
                            </div>
                            <button 
                                onClick={() => setShowOutsideModal(false)}
                                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '24px', cursor: 'pointer' }}
                            >
                                &times;
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            
                            {/* Summary Cards Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}>
                                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Total Outside Duration</span>
                                    <h4 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: '#ef4444' }}>{formatMinutes(metrics.outsideTime)}</h4>
                                </div>
                                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}>
                                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Outside Pings Count</span>
                                    <h4 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: '#f59e0b' }}>{outsidePings.length} Pings</h4>
                                </div>
                                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}>
                                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Outside Excursion Sessions</span>
                                    <h4 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: '#3b82f6' }}>{outsideSessions.length} Sessions</h4>
                                </div>
                            </div>

                            {/* Informational Banner if outsideTime > 0 but 0 explicit outside GPS pings */}
                            {outsidePings.length === 0 && metrics.outsideTime > 0 && (
                                <div style={{ padding: '14px 18px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', display: 'flex', alignItems: 'center', gap: '14px' }}>
                                    <div style={{ fontSize: '24px' }}>⏱️</div>
                                    <div>
                                        <h5 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#f59e0b' }}>Shift Arrival Time-Gap Breakdown</h5>
                                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#cbd5e1', lineHeight: '1.5' }}>
                                            An outside geofence duration of <b>{formatMinutes(metrics.outsideTime)}</b> was recorded between the employee's shift check-in timestamp and their initial geofence entry ping. All <b>{logs.length}</b> recorded shift pings were verified inside office geofence boundaries via high-precision GPS (cellular data strictly excluded).
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Outside Sessions Timeline */}
                            {outsideSessions.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        🚪 Outside Excursion Sessions Summary
                                    </h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {outsideSessions.map((session, idx) => (
                                            <div key={idx} style={{ padding: '12px 16px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444' }}>
                                                        Session #{idx + 1} ({session.date})
                                                        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                                                            Exited at <b>{session.startTime}</b> ➔ Re-entered at <b>{session.endTime}</b>
                                                        </div>
                                                        {session.maxDistMeters > 0 && (
                                                            <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', fontWeight: 600 }}>
                                                                📍 Distance: <b>{session.maxDistMeters}m away</b> from {session.nearestGfName}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <span style={{ background: '#ef4444', color: '#fff', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 }}>
                                                        {formatDurationSecs(session.durationSecs)} outside
                                                    </span>
                                                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                                                        ({session.pings.length} pings)
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Ping-by-Ping Detailed Log Table */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        📍 Ping-by-Ping Location Log
                                    </h4>

                                    <input 
                                        type="text" 
                                        placeholder="Filter pings by time or site..."
                                        value={outsideSearchTerm}
                                        onChange={e => setOutsideSearchTerm(e.target.value)}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-glass, #334155)',
                                            background: 'rgba(0,0,0,0.2)',
                                            color: 'var(--text-primary)',
                                            fontSize: '12px',
                                            outline: 'none',
                                            width: '200px'
                                        }}
                                    />
                                </div>

                                <div style={{ borderRadius: '8px', border: '1px solid var(--border-glass, #334155)', overflow: 'hidden' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                                        <thead>
                                            <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                                                <th style={{ padding: '10px' }}>#</th>
                                                <th style={{ padding: '10px' }}>Time</th>
                                                <th style={{ padding: '10px' }}>Coordinates</th>
                                                <th style={{ padding: '10px' }}>Distance from Geofence</th>
                                                <th style={{ padding: '10px', textAlign: 'right' }}>Map Focus</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredOutsidePings.map((ping, idx) => (
                                                <tr key={idx} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                                    <td style={{ padding: '10px', color: '#64748b' }}>{idx + 1}</td>
                                                    <td style={{ padding: '10px', fontWeight: 700, color: '#ef4444' }}>{ping.timeString}</td>
                                                    <td style={{ padding: '10px', fontFamily: 'monospace', color: '#94a3b8' }}>
                                                        {ping.latitude.toFixed(6)}, {ping.longitude.toFixed(6)}
                                                    </td>
                                                    <td style={{ padding: '10px' }}>
                                                        <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                                                            {ping.minDistanceMeters}m away
                                                        </span> from {ping.nearestGfName}
                                                    </td>
                                                    <td style={{ padding: '10px', textAlign: 'right' }}>
                                                        <button 
                                                            className="btn btn-outline"
                                                            style={{ margin: 0, padding: '4px 10px', fontSize: '11px', borderColor: '#ef4444', color: '#ef4444' }}
                                                            onClick={() => handleFocusOutsidePingOnMap(ping)}
                                                        >
                                                            <i className="fa-solid fa-location-crosshairs"></i> Focus on Map
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div style={{
                            padding: '16px 24px',
                            borderTop: '1px solid var(--border-glass, #1e293b)',
                            display: 'flex',
                            justify: 'flex-end',
                            background: 'rgba(0,0,0,0.2)'
                        }}>
                            <button 
                                className="btn btn-primary" 
                                onClick={() => setShowOutsideModal(false)}
                                style={{ margin: 0, padding: '8px 24px', fontSize: '13px' }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ---------------------------------------------------------------------- */}
            {/* INSIDE GEOFENCE DETAILED BREAKDOWN MODAL */}
            {/* ---------------------------------------------------------------------- */}
            {showInsideModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0, 0, 0, 0.8)',
                    backdropFilter: 'blur(5px)',
                    zIndex: 99999,
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'center',
                    padding: '20px'
                }}>
                    <div className="glass" style={{
                        width: '100%',
                        maxWidth: '900px',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                        background: 'var(--bg-panel, #0f172a)',
                        border: '1px solid rgba(16, 185, 129, 0.3)'
                    }}>
                        {/* Modal Header */}
                        <div style={{
                            padding: '20px 24px',
                            borderBottom: '1px solid var(--border-glass, #1e293b)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: 'rgba(16, 185, 129, 0.05)'
                        }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <i className="fa-solid fa-circle-check"></i>
                                    Inside Geofence Detailed Breakdown ({insidePings.length} Pings • {formatMinutes(metrics.insideTime)})
                                </h3>
                                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                                    Detailed visit sessions, arrival & exit timestamps, and location pings recorded inside office geofences.
                                </p>
                            </div>
                            <button 
                                onClick={() => setShowInsideModal(false)}
                                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '24px', cursor: 'pointer' }}
                            >
                                &times;
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            
                            {/* Summary Cards Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}>
                                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Total Inside Duration</span>
                                    <h4 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: '#10b981' }}>{formatMinutes(metrics.insideTime)}</h4>
                                </div>
                                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}>
                                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Inside Pings Count</span>
                                    <h4 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: '#3b82f6' }}>{insidePings.length} Pings</h4>
                                </div>
                                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}>
                                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Visited Office Sites</span>
                                    <h4 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: '#f59e0b' }}>{visitedGeofences.length} Sites</h4>
                                </div>
                                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}>
                                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Total Visit Sessions</span>
                                    <h4 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: '#a855f7' }}>
                                        {visitedGeofences.reduce((acc, v) => acc + (v.visitsCount || 1), 0)} Sessions
                                    </h4>
                                </div>
                            </div>

                            {/* Visited Sites & Multi-Visit Sessions Breakdown */}
                            {visitedGeofences.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <i className="fa-solid fa-building-circle-check" style={{ color: '#10b981' }}></i>
                                        Office Sites & Visit Sessions Breakdown
                                    </h4>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {visitedGeofences.map((site, sIdx) => (
                                            <div key={sIdx} style={{ padding: '14px 16px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                                    <div>
                                                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                            🏢 {site.name}
                                                        </span>
                                                        {site.date && (
                                                            <span style={{ marginLeft: '8px', background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>
                                                                {site.date}
                                                            </span>
                                                        )}
                                                        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                                                            {site.isMultiVisit ? (
                                                                <span>
                                                                    First In: <b>{site.arrivalTime}</b> • Last Out: <b>{site.leavingTime}</b>{' '}
                                                                    <span style={{ color: '#10b981', fontWeight: 700 }}>
                                                                        ({site.visitsCount} visits, {formatMinutes(siteInfoSpending(site))} net spent)
                                                                    </span>
                                                                </span>
                                                            ) : (
                                                                <span>
                                                                    Arrival: <b>{site.arrivalTime}</b> • Left: <b>{site.leavingTime}</b> (1 continuous visit)
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ background: '#10b981', color: '#fff', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 }}>
                                                            {formatMinutes(siteInfoSpending(site))} spent
                                                        </span>
                                                        <span style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>
                                                            {site.pingsCount} pings
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Discrete Visits Timeline List */}
                                                {site.visits && site.visits.length > 0 && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                            Detailed Visits Timeline ({site.visits.length} Visit{site.visits.length > 1 ? 's' : ''}):
                                                        </span>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px' }}>
                                                            {site.visits.map((v, vIdx) => (
                                                                <div key={vIdx} style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(16, 185, 129, 0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                    <div>
                                                                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#10b981' }}>
                                                                            Visit #{v.visitNumber || vIdx + 1}
                                                                        </div>
                                                                        <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '1px' }}>
                                                                            {v.startTime === v.endTime ? (
                                                                                <span>At <b>{v.startTime}</b></span>
                                                                            ) : (
                                                                                <span><b>{v.startTime}</b> ➔ <b>{v.endTime}</b></span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div style={{ textAlign: 'right' }}>
                                                                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#10b981' }}>
                                                                            {formatMinutes(v.durationMins)}
                                                                        </span>
                                                                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                                                                            {v.pingsCount} ping{v.pingsCount > 1 ? 's' : ''}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Ping-by-Ping Detailed Log Table */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        📍 Inside Geofence Ping-by-Ping Location Log
                                    </h4>

                                    <input 
                                        type="text" 
                                        placeholder="Filter by time or site..."
                                        value={insideSearchTerm}
                                        onChange={e => setInsideSearchTerm(e.target.value)}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-glass, #334155)',
                                            background: 'rgba(0,0,0,0.2)',
                                            color: 'var(--text-primary)',
                                            fontSize: '12px',
                                            outline: 'none',
                                            width: '200px'
                                        }}
                                    />
                                </div>

                                <div style={{ borderRadius: '8px', border: '1px solid var(--border-glass, #334155)', overflow: 'hidden' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                                        <thead>
                                            <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                                                <th style={{ padding: '10px' }}>#</th>
                                                <th style={{ padding: '10px' }}>Time</th>
                                                <th style={{ padding: '10px' }}>Site / Geofence</th>
                                                <th style={{ padding: '10px' }}>Coordinates</th>
                                                <th style={{ padding: '10px' }}>Distance from Centroid</th>
                                                <th style={{ padding: '10px', textAlign: 'right' }}>Map Focus</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredInsidePings.length === 0 ? (
                                                <tr>
                                                    <td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                                                        No inside pings matched your filter.
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredInsidePings.map((ping, idx) => (
                                                    <tr key={idx} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                                        <td style={{ padding: '10px', color: '#64748b' }}>{idx + 1}</td>
                                                        <td style={{ padding: '10px', fontWeight: 700, color: '#10b981' }}>{ping.timeString}</td>
                                                        <td style={{ padding: '10px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                            🏢 {ping.assignedGfName || ping.nearestGfName || 'Geofence'}
                                                        </td>
                                                        <td style={{ padding: '10px', fontFamily: 'monospace', color: '#94a3b8' }}>
                                                            {ping.latitude.toFixed(6)}, {ping.longitude.toFixed(6)}
                                                        </td>
                                                        <td style={{ padding: '10px' }}>
                                                            <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                                                                {ping.minDistanceMeters}m from center
                                                            </span>
                                                        </td>
                                                        <td style={{ padding: '10px', textAlign: 'right' }}>
                                                            <button 
                                                                className="btn btn-outline"
                                                                style={{ margin: 0, padding: '4px 10px', fontSize: '11px', borderColor: '#10b981', color: '#10b981' }}
                                                                onClick={() => handleFocusInsidePingOnMap(ping)}
                                                            >
                                                                <i className="fa-solid fa-location-crosshairs"></i> Focus on Map
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div style={{
                            padding: '16px 24px',
                            borderTop: '1px solid var(--border-glass, #1e293b)',
                            display: 'flex',
                            justifyContent: 'flex-end',
                            background: 'rgba(0,0,0,0.2)'
                        }}>
                            <button 
                                className="btn btn-primary" 
                                onClick={() => setShowInsideModal(false)}
                                style={{ margin: 0, padding: '8px 24px', fontSize: '13px' }}
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
