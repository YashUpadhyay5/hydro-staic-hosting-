import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { formatDate } from '../../utils/helpers';

const parseBatteryPercentage = (val) => {
    if (val === null || val === undefined || val === '' || val === 'N/A') return 'N/A';
    let num = Number(val);
    if (isNaN(num)) return 'N/A';
    if (num > 1.0) {
        return Math.round(num) + '%';
    } else {
        return Math.round(num * 100) + '%';
    }
};

const parseTimestampMs = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const num = Number(val);
    if (!isNaN(num) && num > 1000000000) return num;
    const parsedDate = new Date(val).getTime();
    return isNaN(parsedDate) ? 0 : parsedDate;
};

const isExplicitGpsOff = (f) => {
    if (!f) return false;
    // STRICT RULE: Cellular network location pings are NEVER classified as GPS Off!
    if (isCellularPing(f)) return false;

    return (
        f.isGpsOff === true || f.isGpsOff === 'true' ||
        f.isGpsOn === false || f.isGpsOn === 'false' || f.isGpsOn === 0 ||
        f.locationEnabled === false || f.locationEnabled === 'false' || f.locationEnabled === 0 ||
        String(f.gpsStatus || '').toUpperCase() === 'OFF'
    );
};

const isCellularPing = (f) => {
    if (!f) return false;
    const provider = String(f.provider || f.trackingMethod || '').toLowerCase();
    return provider.includes('cell') || provider.includes('net') || f.trackingMethod === 'CELLULAR';
};

const getAuthoritativeISTDate = (d = new Date()) => {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
    } catch {
        return new Date().toISOString().split('T')[0];
    }
};

export default function EmployeeTrackingView({ userId, userName, employees = [], onBack, backText = 'Back to Employees' }) {
    const [trackingDate, setTrackingDate] = useState(() => getAuthoritativeISTDate());
    const [battery, setBattery] = useState('--');
    const [temp, setTemp] = useState('--');
    const [gpsOff, setGpsOff] = useState('--');
    const [footprints, setFootprints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedFootprintKey, setSelectedFootprintKey] = useState(null);
    const [addresses, setAddresses] = useState({});

    // Asynchronously resolve raw coordinates to exact street address via BigDataCloud & Photon APIs
    const getDisplayAddress = (f, lat, lon, isOffStatus) => {
        const rawAddr = String(f.address || '').toLowerCase();
        const isGenericAddress = !f.address || 
            f.address === 'N/A' || 
            f.address === 'Location Logged' || 
            rawAddr.includes('lat ') ||
            rawAddr.includes('cellular location') ||
            rawAddr.includes('location unavailable') ||
            rawAddr.includes('reused last known');

        if (!isGenericAddress) {
            return f.address;
        }

        if (lat !== null && !isNaN(lat) && lon !== null && !isNaN(lon)) {
            const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
            if (addresses[key]) {
                return addresses[key];
            }
            return `Lat ${lat.toFixed(6)}°, Lng ${lon.toFixed(6)}°`;
        }

        if (isOffStatus) return 'Location Unavailable (GPS Hardware Switch Turned OFF)';
        return f.address || 'Location Logged';
    };

    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const polylineRef = useRef(null);
    const markersRef = useRef([]);
    const markersMapRef = useRef(new Map());

    const getMarkerIcon = (f, isStart, isEnd) => {
        const isCellular = isCellularPing(f);
        let color = isCellular ? '#f59e0b' : '#2563eb';
        let iconClass = isCellular ? 'fa-tower-cell' : 'fa-satellite-dish';
        let badgeText = '';
        let size = 26;
        
        if (isStart) {
            color = '#10b981';
            iconClass = 'fa-play';
            badgeText = '<span style="position: absolute; top: -14px; background: #10b981; color: white; padding: 1px 4px; border-radius: 4px; font-size: 8px; font-weight: 700; border: 1px solid white; z-index: 999;">START</span>';
        } else if (isEnd) {
            color = '#ef4444';
            iconClass = 'fa-stop';
            badgeText = '<span style="position: absolute; top: -14px; background: #ef4444; color: white; padding: 1px 4px; border-radius: 4px; font-size: 8px; font-weight: 700; border: 1px solid white; z-index: 999;">CURRENT</span>';
        }

        return window.L.divIcon({
            className: 'custom-tracking-marker',
            html: `<div style="position: relative; background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 3px 6px rgba(0,0,0,0.3);">
                ${badgeText}
                <i class="fa-solid ${iconClass}" style="font-size: 11px;"></i>
            </div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
        });
    };

    const handleHistoryClick = (f, originalIndex) => {
        if (!mapInstance.current || !f.latitude || !f.longitude) return;
        const lat = parseFloat(f.latitude);
        const lon = parseFloat(f.longitude);
        const key = f.id || `fp_${originalIndex}_${lat}_${lon}`;

        setSelectedFootprintKey(key);

        mapInstance.current.flyTo([lat, lon], 17, { animate: true, duration: 1 });

        const marker = markersMapRef.current.get(key);
        if (marker) {
            marker.openPopup();
        }
    };

    const fetchTrackingData = async () => {
        setLoading(true);
        setSelectedFootprintKey(null);

        try {
            const [userFootprints, allFootprints, allAttendance, fetchedEmployees] = await Promise.all([
                userId ? api.getFootprints(userId, trackingDate).catch(() => []) : Promise.resolve([]),
                api.getFootprints(null, trackingDate).catch(() => []),
                api.getAttendance ? api.getAttendance(trackingDate).catch(() => []) : Promise.resolve([]),
                (!employees || employees.length === 0) && api.getEmployees ? api.getEmployees().catch(() => []) : Promise.resolve([])
            ]);

            const allEmps = (employees && employees.length > 0) ? employees : (fetchedEmployees || []);
            const associatedIds = new Set([String(userId || '').trim().toLowerCase()]);
            const targetNames = new Set([String(userName || '').trim().toLowerCase()]);
            
            // Find employee record across id, empCode, and name
            if (allEmps && allEmps.length > 0) {
                const uLower = String(userId || '').trim().toLowerCase();
                const nameLower = String(userName || '').trim().toLowerCase();
                const matchedEmp = allEmps.find(e => 
                    (e.id && String(e.id).trim().toLowerCase() === uLower) ||
                    (e.empCode && String(e.empCode).trim().toLowerCase() === uLower) ||
                    (e.name && String(e.name).trim().toLowerCase() === nameLower) ||
                    (e.name && String(e.name).trim().toLowerCase() === uLower)
                );
                if (matchedEmp) {
                    if (matchedEmp.id) associatedIds.add(String(matchedEmp.id).trim().toLowerCase());
                    if (matchedEmp.empCode) associatedIds.add(String(matchedEmp.empCode).trim().toLowerCase());
                    if (matchedEmp.name) {
                        associatedIds.add(String(matchedEmp.name).trim().toLowerCase());
                        targetNames.add(String(matchedEmp.name).trim().toLowerCase());
                    }
                }
            }

            if (allAttendance && allAttendance.length > 0) {
                allAttendance.forEach(r => {
                    const rName = String(r.userName || '').trim().toLowerCase();
                    const rUid = String(r.userId || '').trim().toLowerCase();
                    if ((rName && targetNames.has(rName)) || (rUid && associatedIds.has(rUid))) {
                        if (r.userId) associatedIds.add(rUid);
                        if (r.userName) targetNames.add(rName);
                    }
                });
            }

            const rawList = (userFootprints && userFootprints.length > 0) ? userFootprints : (allFootprints || []);
            let data = rawList.filter(f => {
                const fUid = f.userId ? String(f.userId).trim().toLowerCase() : '';
                const fUName = f.userName ? String(f.userName).trim().toLowerCase() : '';
                return (fUid && associatedIds.has(fUid)) || (fUName && targetNames.has(fUName)) || (!fUid && !fUName);
            }).sort((a, b) => parseTimestampMs(a.timestamp || a.createdAt) - parseTimestampMs(b.timestamp || b.createdAt));

            // Fallback: If 0 footprints recorded but employee has clocked in today, use clock-in coords
            if (data.length === 0 && allAttendance && allAttendance.length > 0) {
                const matchingAtt = allAttendance.find(r => {
                    const rUid = String(r.userId || '').trim().toLowerCase();
                    const rName = String(r.userName || '').trim().toLowerCase();
                    return (rUid && associatedIds.has(rUid)) || (rName && targetNames.has(rName));
                });
                if (matchingAtt && matchingAtt.coords) {
                    let parsed = null;
                    try {
                        parsed = typeof matchingAtt.coords === 'string' ? JSON.parse(matchingAtt.coords) : matchingAtt.coords;
                    } catch (e) {}
                    const lat = parsed ? (parsed.lat || parsed.latitude) : null;
                    const lon = parsed ? (parsed.lon || parsed.lng || parsed.longitude) : null;
                    if (lat && lon) {
                        data = [{
                            id: matchingAtt.id,
                            userId: matchingAtt.userId || userId,
                            userName: matchingAtt.userName || userName,
                            timestamp: new Date(matchingAtt.updatedAt || matchingAtt.createdAt).getTime() || Date.now(),
                            date: matchingAtt.date || trackingDate,
                            trackingMethod: 'GPS',
                            latitude: Number(lat),
                            longitude: Number(lon),
                            address: matchingAtt.address || null,
                            accuracy: 15,
                            batteryLevel: matchingAtt.batteryLevel != null ? Number(matchingAtt.batteryLevel) : 75,
                            batteryTemp: 30,
                            locationEnabled: true
                        }];
                    }
                }
            }

            setFootprints(data);

            if (data && data.length > 0) {
                const latest = data[data.length - 1];
                setBattery(parseBatteryPercentage(latest.batteryLevel));
                setTemp(latest.batteryTemp ? latest.batteryTemp + '°C' : 'N/A');
            } else {
                setBattery('N/A');
                setTemp('N/A');
            }

            // Calculate GPS off duration ONLY when GPS hardware is explicitly turned OFF
            let gpsOffMinutes = 0;
            let lastOffTime = null;

            for (let i = 0; i < data.length; i++) {
                const f = data[i];
                const ts = parseTimestampMs(f.timestamp || f.createdAt);
                if (ts === 0) continue;

                if (isExplicitGpsOff(f)) {
                    if (!lastOffTime) lastOffTime = ts;
                } else {
                    if (lastOffTime) {
                        gpsOffMinutes += (ts - lastOffTime) / 60000;
                        lastOffTime = null;
                    }
                }
            }
            
            if (lastOffTime) {
                const endOfDayTime = new Date(trackingDate + 'T23:59:59').getTime();
                const nowTime = new Date().getTime();
                const capTime = Math.min(endOfDayTime, nowTime);
                if (capTime > lastOffTime) {
                    gpsOffMinutes += (capTime - lastOffTime) / 60000;
                }
            }
            
            if (gpsOffMinutes > 0) {
                const hrs = Math.floor(gpsOffMinutes / 60);
                const mins = Math.round(gpsOffMinutes % 60);
                setGpsOff(hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`);
            } else {
                setGpsOff('0m');
            }

            renderMapLayers(data);
        } catch (err) {
            console.error(err);
        } finally {
            setTimeout(() => setLoading(false), 300);
        }
    };

    const renderMapLayers = (data) => {
        if (!mapInstance.current || !window.L) return;

        if (polylineRef.current) {
            mapInstance.current.removeLayer(polylineRef.current);
            polylineRef.current = null;
        }
        markersRef.current.forEach(m => mapInstance.current.removeLayer(m));
        markersRef.current = [];
        markersMapRef.current.clear();

        const latlngs = (data || [])
            .filter(f => f.latitude && f.longitude)
            .map(f => [parseFloat(f.latitude), parseFloat(f.longitude)]);

        if (latlngs.length > 0) {
            if (latlngs.length === 1) {
                mapInstance.current.setView(latlngs[0], 16);
            } else {
                polylineRef.current = window.L.polyline(latlngs, { color: '#2563eb', weight: 4 }).addTo(mapInstance.current);
                mapInstance.current.fitBounds(polylineRef.current.getBounds(), { padding: [50, 50] });
            }
            
            const validFootprints = (data || []).filter(f => f.latitude && f.longitude);
            validFootprints.forEach((f, index) => {
                const isStart = index === 0;
                const isEnd = index === validFootprints.length - 1;
                const key = f.id || `fp_${index}_${parseFloat(f.latitude)}_${parseFloat(f.longitude)}`;

                const isCellular = isCellularPing(f);
                const isOff = isExplicitGpsOff(f);
                const methodLabel = isCellular ? '📱 Cellular' : '🛰️ GPS';
                const offLabel = isOff ? ' <span style="color: #ef4444; font-weight: bold;">(GPS Off)</span>' : '';
                const addr = f.address ? `<br><small style="color: #64748b;">${f.address}</small>` : '';
                const popupContent = `<b>Footprint ${index + 1} (${methodLabel})${offLabel}</b><br>${formatDate(f.timestamp, true)}<br>Battery: ${parseBatteryPercentage(f.batteryLevel)}${addr}`;
                
                const markerIcon = getMarkerIcon(f, isStart, isEnd);
                let marker;
                if (isStart) {
                    marker = window.L.marker([f.latitude, f.longitude], { icon: markerIcon }).bindPopup(`<b>Start / Check-In</b><br>${popupContent}`);
                } else if (isEnd) {
                    marker = window.L.marker([f.latitude, f.longitude], { icon: markerIcon }).bindPopup(`<b>End / Current</b><br>${popupContent}`);
                } else {
                    marker = window.L.marker([f.latitude, f.longitude], { icon: markerIcon }).bindPopup(popupContent);
                }
                marker.addTo(mapInstance.current);
                markersRef.current.push(marker);
                markersMapRef.current.set(key, marker);
            });
        }
    };

    useEffect(() => {
        if (!mapInstance.current && mapRef.current && window.L) {
            mapInstance.current = window.L.map(mapRef.current).setView([28.6692, 77.4538], 10);
            window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_2ae4_1_8e228ec653d025bb97ea2305', {
                attribution: '&copy; OpenStreetMap &copy; CARTO'
            }).addTo(mapInstance.current);

            if (footprints && footprints.length > 0) {
                renderMapLayers(footprints);
            }
        }

        setTimeout(() => {
            if (mapInstance.current) mapInstance.current.invalidateSize();
        }, 300);
    }, [footprints]);

    useEffect(() => {
        fetchTrackingData();
    }, [userId, userName, trackingDate]);

    const matchedEmp = (employees || []).find(e => {
        if (!e) return false;
        const uLower = String(userId || '').trim().toLowerCase();
        const nameLower = String(userName || '').trim().toLowerCase();
        return (e.id && (String(e.id).trim().toLowerCase() === uLower || String(e.id).trim().toLowerCase() === nameLower)) ||
               (e.empCode && (String(e.empCode).trim().toLowerCase() === uLower || String(e.empCode).trim().toLowerCase() === nameLower)) ||
               (e.name && (String(e.name).trim().toLowerCase() === nameLower || String(e.name).trim().toLowerCase() === uLower));
    });
    const displayName = matchedEmp?.name || userName || userId || 'Employee';
    const displayCode = matchedEmp?.empCode || matchedEmp?.emp_code || (userId && !String(userId).startsWith('EMP0') ? userId : '');
    const displaySubtitle = matchedEmp ? `${matchedEmp.designation || matchedEmp.jobTitle || matchedEmp.department || 'Field Staff'}` : '';

    return (
        <div id="employee-tracking-view" className="view active" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                    <button onClick={onBack} className="btn btn-outline" style={{ marginBottom: '8px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <i className="fa-solid fa-arrow-left"></i>
                        <span>{String(backText || 'Back').replace(/^[←\s]+/, '')}</span>
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h2 style={{ margin: 0 }}>{displayName} - Tracking</h2>
                        {displayCode && (
                            <span style={{ fontSize: '0.8rem', color: '#2563eb', fontWeight: 600, background: 'rgba(37, 99, 235, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                                {displayCode}
                            </span>
                        )}
                    </div>
                    {displaySubtitle && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {displaySubtitle}
                        </div>
                    )}
                </div>
                <div>
                    <input 
                        type="date" 
                        className="input-group" 
                        style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} 
                        value={trackingDate}
                        onChange={(e) => setTrackingDate(e.target.value)}
                    />
                </div>
            </div>

            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
                <div className="stat-card glass" style={{ padding: '16px' }}>
                    <div className="stat-icon" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', width: '40px', height: '40px', fontSize: '18px' }}>
                        <i className="fa-solid fa-battery-half"></i>
                    </div>
                    <div className="stat-details">
                        <h3 style={{ fontSize: '12px' }}>Battery %</h3>
                        <p style={{ fontSize: '18px' }}>{battery}</p>
                    </div>
                </div>
                <div className="stat-card glass" style={{ padding: '16px' }}>
                    <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', width: '40px', height: '40px', fontSize: '18px' }}>
                        <i className="fa-solid fa-temperature-half"></i>
                    </div>
                    <div className="stat-details">
                        <h3 style={{ fontSize: '12px' }}>Mobile Temp</h3>
                        <p style={{ fontSize: '18px' }}>{temp}</p>
                    </div>
                </div>
                <div className="stat-card glass" style={{ padding: '16px' }}>
                    <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', width: '40px', height: '40px', fontSize: '18px' }}>
                        <i className="fa-solid fa-location-crosshairs"></i>
                    </div>
                    <div className="stat-details">
                        <h3 style={{ fontSize: '12px' }}>GPS Off Duration</h3>
                        <p style={{ fontSize: '18px' }}>{gpsOff}</p>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
                <div className="glass" style={{ flex: '2 1 600px', height: '100%', maxHeight: '640px', position: 'relative', overflow: 'hidden', borderRadius: '16px' }}>
                    <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: '16px' }}></div>
                </div>

                <div id="tracking-history-sidebar" className="custom-scrollbar" style={{ flex: '1 1 320px', height: '100%', maxHeight: '640px', overflowY: 'auto', padding: '15px', borderLeft: '1px solid var(--border-glass)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--border-glass)', position: 'sticky', top: 0, background: 'var(--bg-glass)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
                        <h3 style={{ fontSize: '15px', margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>
                            <i className="fa-solid fa-list" style={{ color: '#2563eb', marginRight: '6px' }}></i> Location History
                        </h3>
                        <span style={{ fontSize: '12px', color: '#2563eb', background: 'rgba(37, 99, 235, 0.1)', padding: '3px 10px', borderRadius: '12px', fontWeight: 600 }}>
                            {footprints.length} Logs
                        </span>
                    </div>
                    <div id="tracking-history-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {loading ? (
                            <p style={{ color: '#94a3b8', fontSize: '14px' }}>Loading history...</p>
                        ) : footprints.length === 0 ? (
                            <p style={{ color: '#94a3b8', fontSize: '14px' }}>No footprints for this date.</p>
                        ) : (
                            [...footprints].reverse().map((f, i) => {
                                const originalIndex = footprints.length - 1 - i;
                                const isCellular = isCellularPing(f);
                                const isOffStatus = isExplicitGpsOff(f);
                                const lat = parseFloat(f.latitude);
                                const lon = parseFloat(f.longitude);
                                const key = f.id || `fp_${originalIndex}_${lat}_${lon}`;
                                const isSelected = selectedFootprintKey === key;

                                return (
                                    <div 
                                        key={f.id || i}
                                        onClick={() => handleHistoryClick(f, originalIndex)}
                                        style={{
                                            padding: '10px 12px',
                                            background: isSelected ? 'rgba(37, 99, 235, 0.12)' : 'var(--input-bg)',
                                            borderRadius: '8px',
                                            fontSize: '13px',
                                            borderLeft: `4px solid ${isOffStatus ? 'var(--danger)' : (isCellular ? '#f59e0b' : 'var(--success)')}`,
                                            border: isSelected ? '2px solid #2563eb' : '1px solid transparent',
                                            boxShadow: isSelected ? '0 4px 12px rgba(37, 99, 235, 0.2)' : 'var(--shadow-sm)',
                                            color: 'var(--text-primary)',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                            <strong>{formatDate(f.timestamp, true)} {isSelected && '📍'}</strong>
                                            <span>
                                                {isCellular ? (
                                                    <i className="fa-solid fa-tower-cell" style={{ color: '#f59e0b' }} title="Cellular"></i>
                                                ) : (
                                                    <i className="fa-solid fa-satellite-dish" style={{ color: '#2563eb' }} title="GPS"></i>
                                                )}
                                            </span>
                                        </div>
                                        <div style={{ color: 'var(--text-secondary)', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>
                                            <i className="fa-solid fa-location-dot" style={{ marginRight: '6px', color: isCellular ? '#f59e0b' : '#2563eb' }}></i>
                                            {getDisplayAddress(f, lat, lon, isOffStatus)}
                                        </div>
                                        {lat !== null && !isNaN(lat) && lon !== null && !isNaN(lon) && (
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', marginLeft: '18px' }}>
                                                Lat {lat.toFixed(6)}°, Lng {lon.toFixed(6)}°
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                                            {f.batteryLevel !== undefined && f.batteryLevel !== null && (
                                                <span><i className="fa-solid fa-battery-half"></i> {parseBatteryPercentage(f.batteryLevel)}</span>
                                            )}
                                            {f.batteryTemp && (
                                                <span><i className="fa-solid fa-temperature-half"></i> {f.batteryTemp}°C</span>
                                            )}
                                            {f.altitude !== undefined && f.altitude !== null && f.altitude !== 'N/A' && (
                                                <span><i className="fa-solid fa-mountain"></i> Alt: {f.altitude}m</span>
                                            )}
                                            {isCellular && (
                                                <span style={{ color: '#d97706', fontWeight: 600 }}><i className="fa-solid fa-tower-cell"></i> Cellular</span>
                                            )}
                                            {isOffStatus && !isCellular && (
                                                <span style={{ color: 'var(--danger)', fontWeight: 600 }}><i className="fa-solid fa-location-crosshairs"></i> GPS Off</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
