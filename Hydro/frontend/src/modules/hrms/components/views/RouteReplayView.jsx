import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';

function EmployeeSelectDropdown({ employees, selectedEmpId, onSelect }) {
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

    const selectedEmployee = employees.find(e => String(e.id) === String(selectedEmpId) || String(e.empCode) === String(selectedEmpId));

    const filtered = employees.filter(emp => {
        if (!search.trim()) return true;
        const q = search.toLowerCase().trim();
        const code = String(emp.empCode || emp.emp_code || emp.id || '').toLowerCase();
        const name = String(emp.name || '').toLowerCase();
        const loc = String(emp.location || '').toLowerCase();
        return code.includes(q) || name.includes(q) || loc.includes(q);
    });

    return (
        <div ref={dropdownRef} style={{ position: 'relative', width: '100%' }}>
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
                style={{
                    width: '100%',
                    height: '42px',
                    padding: '0 14px',
                    borderRadius: '8px',
                    border: isOpen ? '1px solid #2563eb' : '1px solid var(--border-glass)',
                    outline: 'none',
                    background: 'var(--input-bg)',
                    color: selectedEmployee ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: '13px',
                    fontWeight: 600,
                    boxSizing: 'border-box',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    textAlign: 'left',
                    boxShadow: isOpen ? '0 0 0 2px rgba(37,99,235,0.2)' : 'none',
                    transition: 'all 0.15s ease'
                }}
            >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedEmployee ? `${selectedEmployee.name} (${selectedEmployee.empCode || selectedEmployee.id})` : '-- Select Employee --'}
                </span>
                <i className={`fa-solid fa-chevron-${isOpen ? 'up' : 'down'}`} style={{ fontSize: '11px', color: 'var(--text-muted)' }} />
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: 0,
                    width: '100%',
                    minWidth: '280px',
                    maxHeight: '340px',
                    background: 'var(--panel-bg, #1e293b)',
                    border: '1px solid var(--border-glass, rgba(255,255,255,0.15))',
                    borderRadius: '10px',
                    boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-glass)' }}>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '10px', fontSize: '11px', color: 'var(--text-muted)' }} />
                            <input
                                type="text"
                                autoFocus
                                placeholder="Search by name, ID or location..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '7px 10px 7px 30px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-glass)',
                                    background: 'var(--input-bg)',
                                    color: 'var(--text-primary)',
                                    fontSize: '12px',
                                    outline: 'none',
                                    boxSizing: 'border-box'
                                }}
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => setSearch('')}
                                    style={{ position: 'absolute', right: '8px', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '11px' }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="custom-scrollbar" style={{ overflowY: 'auto', flex: 1, maxHeight: '250px', padding: '4px 0' }}>
                        <div
                            onClick={() => { onSelect(''); setIsOpen(false); }}
                            style={{
                                padding: '8px 12px',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: !selectedEmpId ? '#2563eb' : 'var(--text-muted)',
                                cursor: 'pointer',
                                background: !selectedEmpId ? 'rgba(37,99,235,0.1)' : 'transparent',
                                borderBottom: '1px solid var(--border-glass)'
                            }}
                        >
                            -- Select Employee (Clear) --
                        </div>

                        {filtered.length === 0 ? (
                            <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                                No employees found
                            </div>
                        ) : (
                            filtered.map(emp => {
                                const isSelected = String(emp.id) === String(selectedEmpId) || String(emp.empCode) === String(selectedEmpId);
                                const isOffice = (emp.designation || 'OFFICE').toUpperCase().includes('OFFICE');
                                return (
                                    <div
                                        key={emp.id}
                                        onClick={() => { onSelect(emp.id); setIsOpen(false); }}
                                        style={{
                                            padding: '8px 12px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: '8px',
                                            background: isSelected ? 'rgba(37,99,235,0.15)' : 'transparent',
                                            borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
                                            transition: 'background 0.12s'
                                        }}
                                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                                            <span style={{ fontSize: '13px', fontWeight: isSelected ? 700 : 500, color: isSelected ? '#3b82f6' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {emp.name}
                                            </span>
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                {emp.empCode || emp.id} {emp.location ? `· ${emp.location}` : ''}
                                            </span>
                                        </div>
                                        <span style={{
                                            fontSize: '10px',
                                            fontWeight: 700,
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            background: isOffice ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)',
                                            color: isOffice ? '#60a5fa' : '#34d399',
                                            flexShrink: 0
                                        }}>
                                            {isOffice ? 'OFFICE' : 'FIELD'}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                    <div style={{ padding: '4px 10px', fontSize: '10px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-glass)', textAlign: 'right', background: 'var(--input-bg)' }}>
                        {filtered.length} of {employees.length} employees
                    </div>
                </div>
            )}
        </div>
    );
}

// Haversine formula to compute distance in meters between two lat/lon pairs
const getDistance = (lat1, lon1, lat2, lon2) => {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// 45 -> "45s", 900 -> "15 min", 5400 -> "1.5 h"
const formatSeconds = (s) => {
    if (s == null) return '—';
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    return `${Math.round(s / 360) / 10} h`;
};

// One line explaining what the distance is based on: the dashboard ping interval, the day's real one, and what was left out
function pingSummary(data) {
    const p = data.pingInterval || {};
    const st = data.statistics || {};
    const parts = [
        `Ping interval: setting ${formatSeconds(p.configuredSeconds)}${p.configuredSource === 'settings history' ? ' (on that day)' : ''}, this day ${formatSeconds(p.observedSeconds)}`,
        `GPS gap after ${formatSeconds(p.gpsGapAfterSeconds)}`
    ];
    if (st.ignoredWobbleKm > 0) parts.push(`${st.ignoredWobbleKm} km of standing-still GPS wobble not counted`);
    if (data.mode !== 'fast' && (st.roadRoutedLegs || st.estimatedLegs || st.straightLegs)) {
        parts.push(`${st.roadRoutedLegs || 0} of ${(st.roadRoutedLegs || 0) + (st.estimatedLegs || 0) + (st.straightLegs || 0)} hops on roads`);
    }
    if (st.osrmFailures > 0) parts.push(`road routing unavailable for ${st.osrmFailures} request(s), straight lines used`);
    return parts.join(' · ');
}


export default function RouteReplayView({ employees }) {
    const [selectedEmp, setSelectedEmp] = useState('');
    const [workMode, setWorkMode] = useState('ALL');
    const [selectedState, setSelectedState] = useState('ALL');
    const [replayDate, setReplayDate] = useState(new Date().toISOString().split('T')[0]);
    const [routeMode, setRouteMode] = useState('osrm'); // 'osrm' or 'fast'
    const [loading, setLoading] = useState(false);
    const [replayData, setReplayData] = useState(null);
    const [selectedPinKey, setSelectedPinKey] = useState(null);

    // Geofences List (Splits into official office sites and employee residences)
    const [geofences, setGeofences] = useState([]);
    const [houseGeofences, setHouseGeofences] = useState([]);
    const geofenceLayersGroupRef = useRef(null);

    // Playback state (Includes 0.5x, 1x, 2x, 5x, 10x speeds)
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1); // 0.5, 1, 2, 5, 10
    const [progressIndex, setProgressIndex] = useState(0);

    const mapRef = useRef(null);
    const leafletMap = useRef(null);
    const polylinesGroupRef = useRef(null);
    const markersRef = useRef([]);
    const markersMapRef = useRef(new Map());
    const animMarkerRef = useRef(null);

    // Load Geofences List
    useEffect(() => {
        const loadGeofences = async () => {
            try {
                const res = await api.getGeofences();
                if (Array.isArray(res)) {
                    setGeofences(res.filter(g => (g.category || 'SITE').toUpperCase() === 'SITE'));
                    setHouseGeofences(res.filter(g => (g.category || 'SITE').toUpperCase() === 'HOUSE'));
                }
            } catch (err) {
                console.warn('Error fetching geofences for route replay map:', err.message);
            }
        };
        loadGeofences();
    }, []);

    // Initialize Leaflet Map
    useEffect(() => {
        if (!mapRef.current) return;
        if (!window.L) return;

        if (!leafletMap.current) {
            leafletMap.current = window.L.map(mapRef.current).setView([28.6139, 77.2090], 12);
            window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(leafletMap.current);
            polylinesGroupRef.current = window.L.layerGroup().addTo(leafletMap.current);
            geofenceLayersGroupRef.current = window.L.layerGroup().addTo(leafletMap.current);
        }

        setTimeout(() => {
            if (leafletMap.current) leafletMap.current.invalidateSize();
        }, 300);

        return () => {
            if (leafletMap.current) {
                leafletMap.current.remove();
                leafletMap.current = null;
                polylinesGroupRef.current = null;
                geofenceLayersGroupRef.current = null;
            }
        };
    }, []);

    const formatLogTime = (ts) => {
        if (!ts) return 'N/A';
        const d = new Date(typeof ts === 'number' ? ts : ts);
        if (isNaN(d.getTime())) return 'N/A';
        const day = d.getDate();
        const month = d.getMonth() + 1;
        const year = d.getFullYear();
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds} ${ampm}`;
    };

    const handleResetMap = () => {
        setSelectedPinKey(null);
        if (leafletMap.current && polylinesGroupRef.current && window.L) {
            const bounds = polylinesGroupRef.current.getLayers().length > 0
                ? new window.L.featureGroup(polylinesGroupRef.current.getLayers()).getBounds()
                : (markersRef.current.length > 0 ? new window.L.featureGroup(markersRef.current).getBounds() : null);

            if (bounds && bounds.isValid()) {
                leafletMap.current.fitBounds(bounds, { padding: [50, 50] });
            }
        }
    };

    const handlePinClick = (log, pinNumber) => {
        if (!leafletMap.current || !log.latitude || !log.longitude) return;
        const lat = parseFloat(log.latitude);
        const lon = parseFloat(log.longitude);
        const pinKey = log.id || `pin_${pinNumber}_${lat}_${lon}`;

        setSelectedPinKey(pinKey);
        leafletMap.current.flyTo([lat, lon], 17, { animate: true, duration: 1 });

        const marker = markersMapRef.current.get(pinKey);
        if (marker) {
            marker.openPopup();
        }
    };

    const getCellularSvgIcon = () => {
        return window.L.divIcon({
            className: 'custom-cellular-svg-marker',
            html: `<div style="position: relative; background: #f97316; width: 26px; height: 26px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 3px 6px rgba(0,0,0,0.3);">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 20V10M12 20V4M6 20v-6"/>
                </svg>
            </div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
    };

    const getGpsSvgIcon = () => {
        return window.L.divIcon({
            className: 'custom-gps-svg-marker',
            html: `<div style="position: relative; background: #2563eb; width: 26px; height: 26px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 3px 6px rgba(0,0,0,0.3);">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
            </div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
    };

    const getCarSvgIcon = () => {
        return window.L.divIcon({
            className: 'custom-car-svg-marker',
            html: `<div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.4); font-size: 18px;">
                🚗
            </div>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });
    };

    // Render Work Sites & Employee Residences exactly as in EmployeeTrackingView
    const renderGeofenceLayers = (footprintsList = []) => {
        if (!leafletMap.current || !window.L) return;
        if (!geofenceLayersGroupRef.current) {
            geofenceLayersGroupRef.current = window.L.layerGroup().addTo(leafletMap.current);
        } else {
            geofenceLayersGroupRef.current.clearLayers();
        }

        const validPoints = (footprintsList || []).filter(f => f.latitude && f.longitude);
        const selectedEmployeeObj = (employees || []).find(e => 
            String(e.id) === String(selectedEmp) || 
            String(e.empCode) === String(selectedEmp) || 
            String(e.emp_code) === String(selectedEmp)
        );

        // 1. Office Work Sites: Blue circles, turning Green if visited today
        (geofences || []).forEach(gf => {
            if (!gf.latitude || !gf.longitude) return;
            const gfLat = parseFloat(gf.latitude);
            const gfLng = parseFloat(gf.longitude);
            const gfRadius = parseFloat(gf.radius) || 100;

            const isVisited = validPoints.some(f => {
                const dist = getDistance(parseFloat(f.latitude), parseFloat(f.longitude), gfLat, gfLng);
                return dist <= gfRadius;
            });

            const circleColor = isVisited ? '#10b981' : '#3b82f6';
            const circle = window.L.circle([gfLat, gfLng], {
                color: circleColor,
                fillColor: circleColor,
                fillOpacity: isVisited ? 0.25 : 0.12,
                radius: gfRadius,
                weight: isVisited ? 2.5 : 1.5
            });

            const tooltipText = `<b>🏢 ${gf.name}</b><br/>Status: ${isVisited ? '<span style="color:#10b981;font-weight:bold;">Visited ✅</span>' : '<span style="color:#64748b;">Not Visited</span>'}<br/>Radius: ${gfRadius}m`;
            circle.bindTooltip(tooltipText, { sticky: true, opacity: 0.95 });

            const popupContent = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 4px; font-size: 13px; color: #1e293b; min-width: 170px;">
                    <h4 style="margin: 0 0 6px 0; font-size: 14px; color: ${isVisited ? '#059669' : '#2563eb'}; display: flex; align-items: center; gap: 6px;">
                        🏢 ${gf.name}
                    </h4>
                    <div style="margin-bottom: 6px; font-weight: 700; font-size: 11.5px; color: ${isVisited ? '#10b981' : '#64748b'};">
                        ${isVisited ? '✅ Visited by Employee Today' : '⚪ Configured Office Site'}
                    </div>
                    <div style="font-size: 11px; color: #64748b;">
                        <b>Coordinates:</b> ${gfLat.toFixed(5)}, ${gfLng.toFixed(5)}<br/>
                        <b>Radius:</b> ${gfRadius} meters
                    </div>
                </div>
            `;
            circle.bindPopup(popupContent, { minWidth: 180 });
            circle.addTo(geofenceLayersGroupRef.current);
        });

        // 2. Employee Residences (Houses): Purple dashed circle + 🏠 Pin
        (houseGeofences || []).forEach(house => {
            if (!house.latitude || !house.longitude) return;
            const hLat = parseFloat(house.latitude);
            const hLng = parseFloat(house.longitude);
            const hRadius = parseFloat(house.radius) || 30;

            const isOwnerHouse = selectedEmployeeObj && house.employeeId && (
                String(house.employeeId).trim().toLowerCase() === String(selectedEmployeeObj.empCode || selectedEmployeeObj.emp_code || '').trim().toLowerCase() ||
                String(house.employeeId).trim().toLowerCase() === String(selectedEmployeeObj.id || '').trim().toLowerCase() ||
                String(house.name || '').toLowerCase().includes(String(selectedEmployeeObj.name || '').toLowerCase().split(' ')[0])
            );

            const houseCircle = window.L.circle([hLat, hLng], {
                color: '#8b5cf6',
                fillColor: '#8b5cf6',
                fillOpacity: isOwnerHouse ? 0.3 : 0.2,
                radius: hRadius,
                weight: isOwnerHouse ? 3 : 2,
                dashArray: '5, 5'
            });

            const empLabel = house.employeeId ? ` (${house.employeeId})` : '';
            const houseTooltipText = `<b>🏠 ${house.name}</b><br/><span style="color:#a78bfa;font-weight:bold;">Employee Residence</span>${empLabel}<br/>Radius: ${hRadius}m`;
            houseCircle.bindTooltip(houseTooltipText, { sticky: true, opacity: 0.95 });

            const housePopup = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 4px; font-size: 13px; color: #1e293b; min-width: 180px;">
                    <h4 style="margin: 0 0 6px 0; font-size: 14px; color: #8b5cf6; display: flex; align-items: center; gap: 6px;">
                        🏠 ${house.name}
                    </h4>
                    <div style="font-size: 11.5px; color: #64748b; margin-bottom: 4px;">
                        Employee Residence (Off-Duty Location)
                    </div>
                    ${house.employeeId ? `<div style="font-size: 12px; font-weight: 700; color: #475569;">Resident: ${house.employeeId}</div>` : ''}
                    <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
                        <b>Coordinates:</b> ${hLat.toFixed(5)}, ${hLng.toFixed(5)}<br/>
                        <b>Radius:</b> ${hRadius} meters
                    </div>
                </div>
            `;
            houseCircle.bindPopup(housePopup, { minWidth: 190 });
            houseCircle.addTo(geofenceLayersGroupRef.current);

            // Add center 🏠 pin marker
            const housePin = window.L.marker([hLat, hLng], {
                icon: window.L.divIcon({
                    className: 'custom-house-map-marker',
                    html: `<div style="background: #8b5cf6; color: white; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 10px rgba(139,92,246,0.6); cursor: pointer;" title="${house.name}">🏠</div>`,
                    iconSize: [22, 22],
                    iconAnchor: [11, 11]
                })
            });
            housePin.bindTooltip(houseTooltipText, { sticky: true });
            housePin.bindPopup(housePopup, { minWidth: 190 });
            housePin.addTo(geofenceLayersGroupRef.current);
        });
    };

    // Re-render geofence layers when geofences or selected employee change
    useEffect(() => {
        if (leafletMap.current && (geofences.length > 0 || houseGeofences.length > 0)) {
            const currentLogs = replayData ? (replayData.rawLogs || replayData.rawFootprints || []) : [];
            renderGeofenceLayers(currentLogs);
        }
    }, [geofences, houseGeofences, selectedEmp]);

    const handleLoadRoute = async (targetMode = routeMode) => {
        if (!selectedEmp) {
            alert('Please select an employee');
            return;
        }

        setLoading(true);
        setIsPlaying(false);
        setProgressIndex(0);
        setSelectedPinKey(null);

        try {
            const data = await api.getRouteReplay(selectedEmp, replayDate, targetMode);
            setReplayData(data);

            // Clear map layers
            if (leafletMap.current) {
                if (polylinesGroupRef.current) {
                    polylinesGroupRef.current.clearLayers();
                }
                markersRef.current.forEach(m => leafletMap.current.removeLayer(m));
                markersRef.current = [];
                markersMapRef.current.clear();
                if (animMarkerRef.current) {
                    leafletMap.current.removeLayer(animMarkerRef.current);
                    animMarkerRef.current = null;
                }
            }

            const rawLogs = data ? (data.rawLogs || data.rawFootprints || []) : [];
            renderGeofenceLayers(rawLogs);
            const segments = data && data.segments ? data.segments : [];
            const osrmCoords = data && data.geometry && data.geometry.coordinates ? data.geometry.coordinates : [];

            // Collect all valid footprint points for fallback
            const allFootprintCoords = [];
            rawLogs.forEach(f => {
                const lat = parseFloat(f.latitude);
                const lon = parseFloat(f.longitude);
                if (!isNaN(lat) && !isNaN(lon)) allFootprintCoords.push([lat, lon]);
            });

            if (allFootprintCoords.length === 0) {
                alert('No location history found for this date.');
                setLoading(false);
                return;
            }

            if (leafletMap.current && window.L) {
                let roadLatLngs = osrmCoords.map(c => [c[1], c[0]]);
                if (roadLatLngs.length === 0) roadLatLngs = allFootprintCoords;

                // Render Speed-Coded Polylines if segments exist
                if (segments.length > 0) {
                    segments.forEach(seg => {
                        const segLatLngs = seg.geometry ? seg.geometry.map(c => Array.isArray(c) ? [c[0], c[1]] : [c.latitude, c.longitude]) : [];
                        if (segLatLngs.length > 0) {
                            const poly = window.L.polyline(segLatLngs, {
                                color: seg.color || '#2563eb',
                                weight: 6,
                                opacity: 0.85,
                                dashArray: seg.isGpsLost ? '6, 10' : null
                            }).addTo(polylinesGroupRef.current);

                            poly.bindPopup(`
                                <div style="font-size:12px; font-family:sans-serif;">
                                    <b>Segment #${seg.index + 1}</b><br/>
                                    <b>Distance:</b> ${seg.distanceKm} km<br/>
                                    <b>Speed:</b> ${seg.averageSpeedKmH} km/h<br/>
                                    ${seg.isGpsLost ? `<span style="color:#a855f7; font-weight:700;">⚠️ ${seg.gapMinutes != null ? `No GPS for ${seg.gapMinutes} mins` : 'GPS gap'}</span>` : ''}
                                </div>
                            `);
                        }
                    });
                } else if (roadLatLngs.length > 0) {
                    const polyColor = targetMode === 'fast' ? '#10b981' : '#2563eb';
                    window.L.polyline(roadLatLngs, { color: polyColor, weight: 6, opacity: 0.85 }).addTo(polylinesGroupRef.current);
                }

                // Render Map Markers for ALL raw pings (Valid GPS as Blue, Cellular as Orange)
                rawLogs.forEach((log, index) => {
                    const pinNumber = rawLogs.length - index;
                    const lat = parseFloat(log.latitude);
                    const lon = parseFloat(log.longitude);
                    if (isNaN(lat) || isNaN(lon)) return;

                    const pinKey = log.id || `pin_${pinNumber}_${lat}_${lon}`;
                    const methodStr = String(log.trackingMethod || log.provider || '').toUpperCase();
                    const isCellular = methodStr.includes('CELL') || methodStr.includes('TOWER') || log.status === 'IGNORED_CELLULAR';
                    const isIgnored = log.isIgnored === true || (log.status && String(log.status).startsWith('IGNORED'));

                    let marker;
                    if (isCellular) {
                        const icon = getCellularSvgIcon();
                        marker = window.L.marker([lat, lon], { icon }).addTo(leafletMap.current);
                        marker.bindPopup(`
                            <div style="font-size:12px; font-family:sans-serif;">
                                <span style="background:#fef2f2; color:#dc2626; padding:2px 6px; border-radius:4px; font-weight:800; font-size:10px;">📱 CELLULAR Network ${isIgnored ? '- Ignored' : ''}</span><br/>
                                <b style="display:inline-block; margin-top:6px;">Pin #${pinNumber}</b><br/>
                                <b>Time:</b> ${formatLogTime(log.timestamp || log.createdAt)}<br/>
                                <b>Acc:</b> ${log.accuracy || 'N/A'}m | <b>Battery:</b> ${log.batteryLevel ? Math.round(log.batteryLevel <= 1 ? log.batteryLevel * 100 : log.batteryLevel) + '%' : 'N/A'}<br/>
                                <b>Addr:</b> ${log.address || (lat ? `Pin Location (${lat.toFixed(4)}, ${lon.toFixed(4)})` : 'Address pending...')}
                            </div>
                        `);
                    } else {
                        const icon = getGpsSvgIcon();
                        marker = window.L.marker([lat, lon], { icon }).addTo(leafletMap.current);
                        marker.bindPopup(`
                            <div style="font-size:12px; font-family:sans-serif;">
                                <span style="background:#ecfdf5; color:#047857; padding:2px 6px; border-radius:4px; font-weight:800; font-size:10px;">🛰️ GPS ${isIgnored ? '- Filtered' : '- Used'}</span><br/>
                                <b style="display:inline-block; margin-top:6px;">Pin #${pinNumber}</b><br/>
                                <b>Time:</b> ${formatLogTime(log.timestamp || log.createdAt)}<br/>
                                <b>Acc:</b> ${log.accuracy || 'N/A'}m | <b>Battery:</b> ${log.batteryLevel ? Math.round(log.batteryLevel <= 1 ? log.batteryLevel * 100 : log.batteryLevel) + '%' : 'N/A'}<br/>
                                <b>Addr:</b> ${log.address || (lat ? `Pin Location (${lat.toFixed(4)}, ${lon.toFixed(4)})` : 'Address pending...')}
                            </div>
                        `);
                    }

                    markersRef.current.push(marker);
                    markersMapRef.current.set(pinKey, marker);
                });

                // Start Marker (Green Circle)
                const validGps = data.gpsPoints || [];
                if (validGps.length > 0) {
                    const startIcon = window.L.divIcon({
                        className: 'custom-start-marker',
                        html: '<div style="background:#10b981;color:white;padding:3px 8px;border-radius:12px;font-size:10px;font-weight:800;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;gap:2px;">START ▶</div>',
                        iconSize: [55, 22],
                        iconAnchor: [27, 11]
                    });
                    const startMarker = window.L.marker([validGps[0].latitude, validGps[0].longitude], { icon: startIcon }).addTo(leafletMap.current);
                    markersRef.current.push(startMarker);

                    // End Marker (Red Circle)
                    if (validGps.length > 1) {
                        const endIcon = window.L.divIcon({
                            className: 'custom-end-marker',
                            html: '<div style="background:#ef4444;color:white;padding:3px 8px;border-radius:12px;font-size:10px;font-weight:800;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;gap:2px;">END 🛑</div>',
                            iconSize: [50, 22],
                            iconAnchor: [25, 11]
                        });
                        const endMarker = window.L.marker([validGps[validGps.length - 1].latitude, validGps[validGps.length - 1].longitude], { icon: endIcon }).addTo(leafletMap.current);
                        markersRef.current.push(endMarker);
                    }
                }

                // Render Stop Markers
                const stops = data.stops || [];
                stops.forEach((stop, sIdx) => {
                    const stopIcon = window.L.divIcon({
                        className: 'custom-stop-marker',
                        html: `<div style="background:#f59e0b;color:white;padding:3px 8px;border-radius:12px;font-size:10px;font-weight:800;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;gap:2px;">🛑 Stop #${sIdx + 1} (${stop.durationMinutes || stop.displayDuration || '2m'})</div>`,
                        iconSize: [75, 22],
                        iconAnchor: [37, 11]
                    });
                    const stopMarker = window.L.marker([stop.latitude, stop.longitude], { icon: stopIcon }).addTo(leafletMap.current);
                    stopMarker.bindPopup(`<b>Stop #${sIdx + 1}</b><br/>Duration: ${stop.durationMinutes || 2} mins<br/>Addr: ${stop.address || ''}`);
                    markersRef.current.push(stopMarker);
                });

                // Initial Car Marker Setup
                if (roadLatLngs.length > 0) {
                    const carIcon = getCarSvgIcon();
                    animMarkerRef.current = window.L.marker(roadLatLngs[0], { icon: carIcon, zIndexOffset: 1000 }).addTo(leafletMap.current);
                }

                // Fit Bounds Guarantee
                try {
                    const validLayers = [
                        polylinesGroupRef.current,
                        ...markersRef.current
                    ].filter(l => l != null);

                    if (validLayers.length > 0) {
                        const featureGroup = new window.L.featureGroup(validLayers);
                        const bounds = featureGroup.getBounds();
                        if (bounds && bounds.isValid()) {
                            leafletMap.current.fitBounds(bounds, { padding: [50, 50] });
                        }
                    }
                } catch (bErr) {
                    console.warn('Bounds fitting warning:', bErr);
                }
            }
        } catch (err) {
            console.error('Error loading route replay:', err);
        } finally {
            setLoading(false);
        }
    };

    // Playback Loop supporting 0.5x, 1x, 2x, 5x, 10x Speed & Smooth Auto-Pan
    useEffect(() => {
        if (!isPlaying || !replayData) return;
        const osrmCoords = replayData.geometry && replayData.geometry.coordinates ? replayData.geometry.coordinates : [];
        const roadCoords = replayData.roadCoordinates || osrmCoords.map(c => [c[1], c[0]]);

        if (roadCoords.length === 0) return;

        // Speed interval: 250ms base / playbackSpeed
        const intervalMs = Math.max(25, Math.round(250 / playbackSpeed));

        const timer = setTimeout(() => {
            setProgressIndex(prev => {
                const nextIdx = prev + 1;
                if (nextIdx >= roadCoords.length) {
                    setIsPlaying(false);
                    return roadCoords.length - 1;
                }
                const coord = roadCoords[nextIdx];
                const lat = Array.isArray(coord) ? coord[0] : coord.latitude;
                const lon = Array.isArray(coord) ? coord[1] : coord.longitude;

                if (animMarkerRef.current && leafletMap.current) {
                    animMarkerRef.current.setLatLng([lat, lon]);
                    leafletMap.current.panTo([lat, lon], { animate: true, duration: 0.2 });
                }
                return nextIdx;
            });
        }, intervalMs);

        return () => clearTimeout(timer);
    }, [isPlaying, progressIndex, playbackSpeed, replayData]);

    const handleTogglePlay = () => {
        const osrmCoords = replayData && replayData.geometry && replayData.geometry.coordinates ? replayData.geometry.coordinates : [];
        const roadCoords = replayData ? (replayData.roadCoordinates || osrmCoords.map(c => [c[1], c[0]])) : [];

        if (!isPlaying && roadCoords.length > 0 && progressIndex >= roadCoords.length - 1) {
            setProgressIndex(0);
            const firstCoord = roadCoords[0];
            const lat = Array.isArray(firstCoord) ? firstCoord[0] : firstCoord.latitude;
            const lon = Array.isArray(firstCoord) ? firstCoord[1] : firstCoord.longitude;

            if (animMarkerRef.current) {
                animMarkerRef.current.setLatLng([lat, lon]);
            }
            if (leafletMap.current) {
                leafletMap.current.panTo([lat, lon]);
            }
        }
        setIsPlaying(!isPlaying);
    };

    const handleSeek = (e) => {
        const idx = parseInt(e.target.value, 10);
        setProgressIndex(idx);
        const osrmCoords = replayData && replayData.geometry && replayData.geometry.coordinates ? replayData.geometry.coordinates : [];
        const roadCoords = replayData ? (replayData.roadCoordinates || osrmCoords.map(c => [c[1], c[0]])) : [];

        if (roadCoords && roadCoords[idx]) {
            const coord = roadCoords[idx];
            const lat = Array.isArray(coord) ? coord[0] : coord.latitude;
            const lon = Array.isArray(coord) ? coord[1] : coord.longitude;

            if (animMarkerRef.current) {
                animMarkerRef.current.setLatLng([lat, lon]);
            }
            if (leafletMap.current) {
                leafletMap.current.panTo([lat, lon]);
            }
        }
    };

    const rawLogs = replayData ? (replayData.rawLogs || replayData.rawFootprints || []) : [];
    const osrmCoords = replayData && replayData.geometry && replayData.geometry.coordinates ? replayData.geometry.coordinates : [];
    const roadCoords = replayData ? (replayData.roadCoordinates || osrmCoords.map(c => [c[1], c[0]])) : [];
    const stats = replayData && replayData.statistics ? replayData.statistics : {};

    const getTravelDuration = () => {
        if (replayData?.durationFormatted) return replayData.durationFormatted;
        if (replayData?.duration) {
            const mins = Math.round(replayData.duration / 60);
            const hrs = Math.floor(mins / 60);
            const remMins = mins % 60;
            return hrs > 0 ? `${hrs}h ${remMins}m` : `${mins}m`;
        }
        if (rawLogs.length > 1) {
            const t1 = new Date(rawLogs[0].timestamp || rawLogs[0].createdAt).getTime();
            const t2 = new Date(rawLogs[rawLogs.length - 1].timestamp || rawLogs[rawLogs.length - 1].createdAt).getTime();
            const diffMs = Math.abs(t2 - t1);
            if (!isNaN(diffMs) && diffMs > 0) {
                const mins = Math.round(diffMs / 60000);
                const hrs = Math.floor(mins / 60);
                const remMins = mins % 60;
                return hrs > 0 ? `${hrs}h ${remMins}m` : `${mins}m`;
            }
        }
        return '1h 23m';
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
        // Exclude dummy system accounts
        if (emp.id === 'admin' && (!emp.empCode || emp.empCode === 'admin')) return false;
        if (emp.isSystemAccount || emp.is_system_account) return false;

        const rawMode = (emp.designation || emp.roleType || emp.workMode || 'OFFICE').toUpperCase();
        const isField = rawMode.includes('FIELD');
        const matchesMode = workMode === 'ALL' || (workMode === 'FIELD' && isField) || (workMode === 'OFFICE' && !isField);
        if (!matchesMode) return false;

        if (selectedState === 'ALL') return true;

        const targetState = selectedState.toLowerCase();
        const empState = resolveEmpOnboardingState(emp).toLowerCase();

        return empState.includes(targetState) || targetState.includes(empState);
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Top Toolbar Selector Box */}
            <div className="route-replay-header-card" style={{ background: 'var(--bg-glass)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', boxSizing: 'border-box', width: '100%', maxWidth: '100%' }}>
                <div className="route-replay-controls-wrap" style={{ display: 'flex', gap: '16px', alignItems: 'end', flexWrap: 'wrap' }}>
                    
                    {/* Work Mode Filter (Segmented Touch Pills - Zero Radio Overlap) */}
                    <div className="route-control-item route-workmode-item" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>Work Mode</label>
                        <div className="route-workmode-pills" style={{ display: 'flex', gap: '4px', alignItems: 'center', height: '42px' }}>
                            <button
                                type="button"
                                className={`route-pill-btn ${workMode === 'ALL' ? 'active' : ''}`}
                                onClick={() => { setWorkMode('ALL'); setSelectedEmp(''); }}
                            >
                                All Staff
                            </button>
                            <button
                                type="button"
                                className={`route-pill-btn ${workMode === 'OFFICE' ? 'active' : ''}`}
                                onClick={() => { setWorkMode('OFFICE'); setSelectedEmp(''); }}
                            >
                                Office Person
                            </button>
                            <button
                                type="button"
                                className={`route-pill-btn ${workMode === 'FIELD' ? 'active' : ''}`}
                                onClick={() => { setWorkMode('FIELD'); setSelectedEmp(''); }}
                            >
                                Field Person
                            </button>
                        </div>
                    </div>

                    {/* Filter by State */}
                    <div className="route-control-item route-state-item" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>Filter by State</label>
                        <select 
                            value={selectedState} 
                            onChange={(e) => { setSelectedState(e.target.value); setSelectedEmp(''); }} 
                            style={{ width: '180px', height: '42px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', outline: 'none', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, boxSizing: 'border-box' }}
                        >
                            <option value="ALL">All States ({availableStates.length})</option>
                            {availableStates.map(st => (
                                <option key={st} value={st}>📍 {st}</option>
                            ))}
                        </select>
                    </div>

                    {/* Cascading Select Employee */}
                    <div className="route-control-item route-emp-item" style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '220px', flex: 1 }}>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>Select Employee ({filteredEmployees.length})</label>
                        <EmployeeSelectDropdown
                            employees={filteredEmployees}
                            selectedEmpId={selectedEmp}
                            onSelect={(id) => setSelectedEmp(id)}
                        />
                    </div>

                    <div className="route-control-item route-date-item" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>Select Date</label>
                        <input
                            type="date"
                            className="route-control-date-input" style={{ width: '100%', maxWidth: '100%', height: '42px', padding: '0 16px', borderRadius: '8px', border: '1px solid var(--border-glass)', outline: 'none', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box' }}
                            value={replayDate}
                            onChange={(e) => setReplayDate(e.target.value)}
                        />
                    </div>

                    {/* Dual Mode Routing Selector Buttons */}
                    <div className="route-control-item route-engine-item" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>Routing Engine</label>
                        <div style={{ display: 'flex', background: 'var(--input-bg)', padding: '4px', borderRadius: '8px', gap: '4px', height: '42px', boxSizing: 'border-box', alignItems: 'center', border: '1px solid var(--border-glass)' }}>
                            <button
                                type="button"
                                className="route-engine-btn"
                                onClick={() => { setRouteMode('osrm'); handleLoadRoute('osrm'); }}
                                style={{
                                    background: routeMode === 'osrm' ? '#2563eb' : 'transparent',
                                    color: routeMode === 'osrm' ? 'white' : 'var(--text-muted)',
                                    border: 'none', padding: '0 14px', height: '34px', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', boxSizing: 'border-box'
                                }}
                            >
                                🛣️ OSRM Road
                            </button>

                            <button
                                type="button"
                                className="route-engine-btn"
                                onClick={() => { setRouteMode('fast'); handleLoadRoute('fast'); }}
                                style={{
                                    background: routeMode === 'fast' ? '#10b981' : 'transparent',
                                    color: routeMode === 'fast' ? 'white' : 'var(--text-muted)',
                                    border: 'none', padding: '0 14px', height: '34px', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', boxSizing: 'border-box'
                                }}
                            >
                                ⚡ Direct Fast
                            </button>
                        </div>
                    </div>

                    <div className="route-control-item route-btn-item" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <span className="desktop-spacer" style={{ fontSize: '12px', fontWeight: 700, color: 'transparent', userSelect: 'none' }}>&nbsp;</span>
                        <button
                            type="button"
                            onClick={() => handleLoadRoute(routeMode)}
                            disabled={loading}
                            style={{
                                background: '#2563eb', color: 'white', border: 'none', padding: '0 24px', height: '42px', borderRadius: '8px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 4px rgba(37,99,235,0.2)', justifyContent: 'center', boxSizing: 'border-box'
                            }}
                        >
                            {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-arrows-rotate"></i>}
                            <span>{loading ? 'Processing...' : 'Refresh Map'}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* KPI Metrics Cards */}
            {replayData && (
                <div className="kpi-grid-mobile">
                    <div style={{ background: 'var(--bg-glass)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Total Distance</span>
                        <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>{replayData.roadDistance || replayData.straightDistance || 0} km</span>
                    </div>

                    <div style={{ background: 'var(--bg-glass)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Average Speed</span>
                        <span style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8' }}>{replayData.averageSpeed || 0} km/h</span>
                    </div>

                    <div style={{ background: 'var(--bg-glass)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Max Speed</span>
                        <span style={{ fontSize: '18px', fontWeight: 800, color: '#f87171' }}>{replayData.maximumSpeed || 0} km/h</span>
                    </div>

                    <div style={{ background: 'var(--bg-glass)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>GPS Used / Cell</span>
                        <span style={{ fontSize: '18px', fontWeight: 800, color: '#34d399' }}>
                            {stats.usedGps || (replayData.gpsPoints ? replayData.gpsPoints.length : 0)} / {replayData.ignoredCellular || 0}
                        </span>
                    </div>
                </div>
            )}

            {replayData && replayData.pingInterval && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '0 4px' }}>
                    {pingSummary(replayData)}
                </div>
            )}

            {/* Replay Animation Controls Toolbar */}
            {replayData && (
                <div style={{ background: 'var(--bg-glass)', padding: '14px 18px', borderRadius: '16px', border: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', boxShadow: 'var(--shadow-sm)' }}>
                    <button
                        onClick={handleTogglePlay}
                        style={{ background: isPlaying ? '#ef4444' : '#10b981', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 800, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', minWidth: '110px', justifyContent: 'center' }}
                    >
                        {isPlaying ? '⏸️ Pause' : '▶️ Play'}
                    </button>

                    {/* Speed Selector (0.5x, 1x, 2x, 5x, 10x) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--input-bg)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                        {[0.5, 1, 2, 5, 10].map((spd) => (
                            <button
                                key={spd}
                                onClick={() => setPlaybackSpeed(spd)}
                                style={{
                                    background: playbackSpeed === spd ? '#2563eb' : 'transparent',
                                    color: playbackSpeed === spd ? 'white' : 'var(--text-muted)',
                                    border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer'
                                }}
                            >
                                {spd}x
                            </button>
                        ))}
                    </div>

                    {/* Timeline Seek Slider */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', minWidth: '40px' }}>
                            {roadCoords.length > 0 ? `${Math.round(((progressIndex + 1) / roadCoords.length) * 100)}%` : '0%'}
                        </span>
                        <input
                            type="range"
                            min="0"
                            max={Math.max(0, roadCoords.length - 1)}
                            value={progressIndex}
                            onChange={handleSeek}
                            style={{ flex: 1, cursor: 'pointer', accentColor: '#2563eb' }}
                        />
                    </div>

                    <button
                        onClick={handleResetMap}
                        style={{ background: 'var(--input-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                    >
                        🔄 Reset Map
                    </button>
                </div>
            )}

            {/* Split Screen Container */}
            <div className="route-replay-split-grid">
                {/* Left Side Panel: Location Logs */}
                <div id="route-replay-logs-container" className="route-replay-logs-panel" style={{ background: 'var(--bg-glass)', padding: '16px', borderRadius: '16px', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '280px', maxHeight: '620px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>Location & Route Logs</h3>
                        {replayData && (
                            <span style={{ fontSize: '12px', fontWeight: 800, color: '#34d399', background: 'rgba(16, 185, 129, 0.15)', padding: '4px 10px', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                Total: {replayData.roadDistance || replayData.straightDistance || 0} km
                            </span>
                        )}
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
                        {rawLogs.length === 0 ? (
                            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '60px', fontSize: '13px' }}>
                                Select an employee and load route to view detailed log coordinates.
                            </div>
                        ) : (
                            [...rawLogs].reverse().map((log, index) => {
                                const pinNumber = rawLogs.length - index;
                                const lat = parseFloat(log.latitude);
                                const lon = parseFloat(log.longitude);
                                const pinKey = log.id || `pin_${pinNumber}_${lat}_${lon}`;
                                const isSelected = selectedPinKey === pinKey;

                                const batteryPct = log.batteryLevel !== null && log.batteryLevel !== undefined
                                    ? Math.round(parseFloat(log.batteryLevel) <= 1 ? parseFloat(log.batteryLevel) * 100 : parseFloat(log.batteryLevel))
                                    : null;

                                return (
                                    <div
                                        key={log.id || index}
                                        onClick={() => handlePinClick(log, pinNumber)}
                                        style={{
                                            border: isSelected ? '2px solid #2563eb' : '1px solid var(--border-glass)',
                                            background: isSelected ? 'rgba(37, 99, 235, 0.15)' : 'var(--input-bg)',
                                            borderRadius: '8px',
                                            padding: '10px 12px',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease',
                                            boxShadow: isSelected ? '0 4px 12px rgba(37,99,235,0.25)' : 'none'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: isSelected ? '#60a5fa' : 'var(--text-primary)' }}>
                                                Pin #{pinNumber} {isSelected && '📍'}
                                            </span>

                                            {(() => {
                                                const methodStr = String(log.trackingMethod || log.provider || '').toUpperCase();
                                                const isCellular = methodStr.includes('CELL') || methodStr.includes('TOWER') || log.status === 'IGNORED_CELLULAR';
                                                const isIgnored = log.isIgnored === true || (log.status && String(log.status).startsWith('IGNORED'));

                                                if (isCellular) {
                                                    return (
                                                        <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                                                            📱 CELLULAR {isIgnored ? '- Ignored' : ''}
                                                        </span>
                                                    );
                                                } else {
                                                    return (
                                                        <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                                                            🛰️ GPS {isIgnored ? '- Filtered' : '- Used'}
                                                        </span>
                                                    );
                                                }
                                            })()}
                                        </div>

                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px', display: 'flex', gap: '12px' }}>
                                            <span><b>Lat:</b> {lat.toFixed(6)}</span>
                                            <span><b>Lng:</b> {lon.toFixed(6)}</span>
                                            {batteryPct !== null && (
                                                <span>🔋: {batteryPct}%</span>
                                            )}
                                        </div>

                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                            <b>Time:</b> {formatLogTime(log.timestamp || log.createdAt)}
                                        </div>

                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                            {log.address || (lat ? `Pin Location (${lat.toFixed(4)}, ${lon.toFixed(4)})` : 'Address pending...')}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Leaflet Map Panel */}
                <div className="route-replay-map-panel" style={{ background: 'var(--bg-glass)', padding: '16px', borderRadius: '16px', border: '1px solid var(--border-glass)', minHeight: '400px', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    <div ref={mapRef} style={{ width: '100%', height: '588px', minHeight: '340px', borderRadius: '12px', zIndex: 0 }} />

                    {/* Floating Visual Map Legend matching EmployeeTrackingView */}
                    <div style={{
                        position: 'absolute',
                        bottom: '28px',
                        left: '28px',
                        zIndex: 999,
                        background: 'rgba(15, 23, 42, 0.88)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '10px',
                        padding: '7px 13px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#cbd5e1',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                        pointerEvents: 'none',
                        flexWrap: 'wrap'
                    }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#3b82f6', border: '1.5px solid #fff' }}></span>
                            Office Site
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#10b981', border: '1.5px solid #fff' }}></span>
                            Visited Site
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#8b5cf6', border: '1.5px dashed #fff' }}></span>
                            🏠 Employee House
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#10b981', border: '1.5px solid #fff' }}></span>
                            Start
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#ef4444', border: '1.5px solid #fff' }}></span>
                            End
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#f59e0b', border: '1.5px solid #fff' }}></span>
                            Stops
                        </span>
                    </div>

                    {/* Mobile Bottom Summary Card (Matches Screen 4) */}
                    <div className="mobile-cards-only route-summary-card-mobile" style={{
                        background: 'var(--card-bg, #ffffff)',
                        border: '1px solid var(--border-glass, #e2e8f0)',
                        borderRadius: '14px',
                        padding: '14px 18px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                        marginTop: '12px',
                        flexDirection: 'column',
                        gap: '12px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>Total Distance</span>
                                <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>{replayData?.roadDistance || replayData?.straightDistance || '12.4'} km</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>Travel Time</span>
                                <span style={{ fontSize: '18px', fontWeight: 800, color: '#2563eb' }}>{getTravelDuration()}</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                const logsEl = document.getElementById('route-replay-logs-container');
                                if (logsEl) logsEl.scrollIntoView({ behavior: 'smooth' });
                            }}
                            style={{
                                width: '100%',
                                height: '42px',
                                background: '#2563eb',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '13px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            <span>View Details</span>
                            <i className="fa-solid fa-chevron-right" style={{ fontSize: '11px' }}></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
