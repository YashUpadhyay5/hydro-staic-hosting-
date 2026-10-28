import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';

export default function GeofenceView() {
    const [loading, setLoading] = useState(true);
    const cachedGeofences = api.getCached('/geofence');
    const [geofences, setGeofences] = useState(() => Array.isArray(cachedGeofences) ? cachedGeofences : []);
    const [name, setName] = useState('');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const [radius, setRadius] = useState('100');
    const [editingId, setEditingId] = useState(null);
    const [locating, setLocating] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedGeofenceId, setSelectedGeofenceId] = useState(null);

    // Bulk Excel Upload Modal State
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [parsedSites, setParsedSites] = useState([]);
    const [uploadFileName, setUploadFileName] = useState('');
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef(null);

    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const geofenceLayersRef = useRef({}); // Store circles & markers by geofence ID
    const activeMarkerRef = useRef(null); // Interactive marker for drag/drop geofencing
    const activeCircleRef = useRef(null); // Interactive circle preview

    // Create custom pin icon helper for Leaflet
    const createSitePinIcon = (siteName, isSelected = false) => {
        const bg = isSelected ? '#f97316' : '#2563eb';
        return window.L.divIcon({
            className: 'custom-geofence-pin-icon',
            html: `
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    background: ${bg};
                    color: #ffffff;
                    padding: 4px 8px;
                    border-radius: 20px;
                    font-size: 11px;
                    font-weight: 700;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    border: 2px solid #ffffff;
                    white-space: nowrap;
                    cursor: pointer;
                    transform: translate(-50%, -50%);
                ">
                    <span style="font-size: 12px;">📍</span>
                    <span>${siteName}</span>
                </div>
            `,
            iconSize: [100, 30],
            iconAnchor: [50, 15]
        });
    };

    // Load all geofences
    const loadGeofences = async () => {
        try {
            const res = await api.getGeofences();
            if (Array.isArray(res)) {
                setGeofences(res);
            } else {
                setGeofences([res]);
            }
        } catch (err) {
            console.error("Error loading geofences", err);
            setErrorMsg("Failed to load geofences list.");
        }
    };

    useEffect(() => {
        loadGeofences();
    }, []);

    // Initialize map
    useEffect(() => {
        if (!mapInstance.current && mapRef.current && window.L) {
            // Default center Noida / Delhi NCR
            mapInstance.current = window.L.map(mapRef.current).setView([28.6692, 77.4538], 11);
            window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_2ae4_1_8e228ec653d025bb97ea2305', {
                attribution: '&copy; OpenStreetMap &copy; CARTO'
            }).addTo(mapInstance.current);

            // Handle map clicks to place/update coordinates
            mapInstance.current.on('click', (e) => {
                const { lat, lng } = e.latlng;
                setLatitude(lat.toFixed(6));
                setLongitude(lng.toFixed(6));
            });
        }

        // Periodic map resize adjustment
        const timer = setTimeout(() => {
            if (mapInstance.current) {
                mapInstance.current.invalidateSize();
            }
        }, 300);

        return () => {
            clearTimeout(timer);
        };
    }, []);

    // Draw existing geofences & active editing preview on map
    useEffect(() => {
        if (!mapInstance.current || !window.L) return;

        // 1. Remove all old circles & markers
        Object.keys(geofenceLayersRef.current).forEach(id => {
            const layerGroup = geofenceLayersRef.current[id];
            if (layerGroup) {
                if (layerGroup.circle) mapInstance.current.removeLayer(layerGroup.circle);
                if (layerGroup.marker) mapInstance.current.removeLayer(layerGroup.marker);
            }
        });
        geofenceLayersRef.current = {};

        // 2. Draw active geofences
        const bounds = window.L.latLngBounds();
        let validPointsCount = 0;

        geofences.forEach(gf => {
            if (gf.latitude && gf.longitude && gf.id !== editingId) {
                const lat = parseFloat(gf.latitude);
                const lng = parseFloat(gf.longitude);
                const r = parseFloat(gf.radius) || 100;
                const isSelected = selectedGeofenceId === gf.id;

                const circleColor = isSelected ? '#f97316' : '#2563eb';

                const circle = window.L.circle([lat, lng], {
                    color: circleColor,
                    fillColor: circleColor,
                    fillOpacity: isSelected ? 0.3 : 0.15,
                    radius: r,
                    weight: isSelected ? 3 : 1.5
                })
                .addTo(mapInstance.current);

                const popupContent = `
                    <div style="font-family: sans-serif; padding: 4px; color: #1e293b;">
                        <h4 style="margin: 0 0 6px 0; font-size: 14px; color: #0f172a; display: flex; align-items: center; gap: 6px;">
                            📍 ${gf.name || 'Office Geofence'}
                        </h4>
                        <div style="font-size: 12px; color: #475569; display: flex; flex-direction: column; gap: 4px;">
                            <div><b>Latitude:</b> ${lat.toFixed(6)}</div>
                            <div><b>Longitude:</b> ${lng.toFixed(6)}</div>
                            <div><b>Radius:</b> ${r} meters</div>
                        </div>
                    </div>
                `;

                circle.bindPopup(popupContent, { minWidth: 200 });

                // Create Pin Marker at circle center
                const marker = window.L.marker([lat, lng], {
                    icon: createSitePinIcon(gf.name || 'Geofence Site', isSelected)
                })
                .addTo(mapInstance.current)
                .bindPopup(popupContent, { minWidth: 200 });

                marker.on('click', () => {
                    setSelectedGeofenceId(gf.id);
                });

                geofenceLayersRef.current[gf.id] = { circle, marker, lat, lng };
                bounds.extend([lat, lng]);
                validPointsCount++;
            }
        });

        // Initial auto-fit bounds on first load
        if (validPointsCount > 0 && !editingId && !latitude && !longitude && !selectedGeofenceId) {
            mapInstance.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
    }, [geofences, editingId, selectedGeofenceId]);

    // Update active creation/editing preview marker & circle on map
    useEffect(() => {
        if (!mapInstance.current || !window.L) return;

        // Cleanup existing active layers
        if (activeMarkerRef.current) {
            mapInstance.current.removeLayer(activeMarkerRef.current);
            activeMarkerRef.current = null;
        }
        if (activeCircleRef.current) {
            mapInstance.current.removeLayer(activeCircleRef.current);
            activeCircleRef.current = null;
        }

        const latVal = parseFloat(latitude);
        const lngVal = parseFloat(longitude);
        const radVal = parseFloat(radius) || 100;

        if (!isNaN(latVal) && !isNaN(lngVal)) {
            // Draw preview circle in orange
            activeCircleRef.current = window.L.circle([latVal, lngVal], {
                color: '#f97316',
                fillColor: '#f97316',
                fillOpacity: 0.2,
                radius: radVal
            }).addTo(mapInstance.current);

            // Draw draggable preview marker
            activeMarkerRef.current = window.L.marker([latVal, lngVal], {
                draggable: true
            }).addTo(mapInstance.current);

            activeMarkerRef.current.on('dragend', (e) => {
                const marker = e.target;
                const position = marker.getLatLng();
                setLatitude(position.lat.toFixed(6));
                setLongitude(position.lng.toFixed(6));
            });

            // Center map on preview location
            mapInstance.current.setView([latVal, lngVal], 15);
        }
    }, [latitude, longitude, radius]);

    // Click-to-Focus map navigation helper
    const handleFocusOnMap = (gf) => {
        setSelectedGeofenceId(gf.id);
        const lat = parseFloat(gf.latitude);
        const lng = parseFloat(gf.longitude);

        if (!isNaN(lat) && !isNaN(lng) && mapInstance.current) {
            mapInstance.current.flyTo([lat, lng], 16, { duration: 1.2 });
            const layerGroup = geofenceLayersRef.current[gf.id];
            if (layerGroup && layerGroup.marker) {
                setTimeout(() => {
                    layerGroup.marker.openPopup();
                }, 400);
            }
        }
    };

    // Auto-Fit map to show all geofence sites
    const handleFitAllBounds = () => {
        if (!mapInstance.current || geofences.length === 0 || !window.L) return;
        const bounds = window.L.latLngBounds();
        let validCount = 0;
        geofences.forEach(gf => {
            if (gf.latitude && gf.longitude) {
                bounds.extend([parseFloat(gf.latitude), parseFloat(gf.longitude)]);
                validCount++;
            }
        });
        if (validCount > 0) {
            mapInstance.current.fitBounds(bounds, { padding: [60, 60] });
            setSelectedGeofenceId(null);
        }
    };

    // Handle Form Submit (Create / Update single)
    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        setSuccessMsg('');

        const payload = {
            name: name.trim() || 'Office Geofence',
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            radius: parseFloat(radius)
        };

        if (isNaN(payload.latitude) || isNaN(payload.longitude) || isNaN(payload.radius)) {
            setErrorMsg("Please provide valid coordinates and radius.");
            return;
        }

        try {
            if (editingId) {
                await api.updateGeofence(editingId, payload);
                setSuccessMsg(`Geofence "${payload.name}" updated successfully!`);
            } else {
                await api.createGeofence(payload);
                setSuccessMsg(`Geofence "${payload.name}" created successfully!`);
            }
            resetForm();
            loadGeofences();
        } catch (err) {
            setErrorMsg(err.message || "Failed to save geofence.");
        }
    };

    // Populate form with geofence details for editing
    const handleEdit = (gf) => {
        setEditingId(gf.id);
        setName(gf.name || '');
        setLatitude(gf.latitude.toString());
        setLongitude(gf.longitude.toString());
        setRadius(gf.radius.toString());
        setErrorMsg('');
        setSuccessMsg('');
        handleFocusOnMap(gf);
    };

    // Handle delete geofence
    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this geofence?")) return;
        setErrorMsg('');
        setSuccessMsg('');
        try {
            await api.deleteGeofence(id);
            setSuccessMsg("Geofence deleted successfully!");
            if (editingId === id) {
                resetForm();
            }
            loadGeofences();
        } catch (err) {
            setErrorMsg(err.message || "Failed to delete geofence.");
        }
    };

    // Reset Form Fields
    const resetForm = () => {
        setEditingId(null);
        setName('');
        setLatitude('');
        setLongitude('');
        setRadius('100');
        setSelectedGeofenceId(null);
    };

    // Grab user's GPS position
    const handleUseMyLocation = () => {
        if (navigator.geolocation) {
            setLocating(true);
            setErrorMsg('');
            navigator.geolocation.getCurrentPosition((position) => {
                setLatitude(position.coords.latitude.toFixed(6));
                setLongitude(position.coords.longitude.toFixed(6));
                setLocating(false);
            }, (error) => {
                setLocating(false);
                setErrorMsg('Geolocation failed: ' + error.message);
            });
        } else {
            setErrorMsg("Geolocation is not supported by this browser.");
        }
    };

    // ----------------------------------------------------------------------
    // BULK EXCEL UPLOAD & TEMPLATE GENERATOR LOGIC
    // ----------------------------------------------------------------------

    // Download Sample Excel Template
    const handleDownloadTemplate = async () => {
        try {
            // Dynamic import — ExcelJS only loads when user clicks Download Template
            const { default: ExcelJS } = await import('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'HRMS Admin';
            const sheet = workbook.addWorksheet('Geofence Sites');

            // Header Banner
            sheet.mergeCells('A1:D1');
            const titleCell = sheet.getCell('A1');
            titleCell.value = 'OFFICE SITES & GEOFENCES BULK IMPORT TEMPLATE';
            titleCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFF' } };
            titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
            sheet.getRow(1).height = 28;

            // Columns Header
            const headers = ['Site Name', 'Latitude', 'Longitude', 'Radius (meters)'];
            const headerRow = sheet.addRow(headers);
            headerRow.height = 22;
            headerRow.eachCell((cell) => {
                cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2563EB' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });

            // Sample Data Rows
            const sampleRows = [
                ['Paraspur Site', 25.805456, 84.169584, 200],
                ['Kotwari Site', 25.810657, 83.876470, 200],
                ['Sripatipur Site', 25.739234, 84.528001, 200],
                ['Noida Sector 62 Office', 28.627100, 77.372600, 150]
            ];

            sampleRows.forEach(row => {
                const r = sheet.addRow(row);
                r.height = 20;
                r.eachCell((cell, colNum) => {
                    cell.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'left' : 'center' };
                });
            });

            sheet.columns.forEach((col, i) => {
                col.width = i === 0 ? 30 : 20;
            });

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Sample_Sites_Geofence_Template.xlsx';
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error generating template:', err);
            alert('Failed to generate template Excel file.');
        }
    };

    // Parse Excel File on Selection
    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploadFileName(file.name);
        setErrorMsg('');

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                // Dynamic import — xlsx only loads when user selects an Excel file
                const XLSX = await import('xlsx');
                const bstr = evt.target.result;
                const wb = XLSX.read(bstr, { type: 'array' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws, { defval: '' });

                if (!data || data.length === 0) {
                    alert('The selected Excel file is empty or invalid.');
                    return;
                }

                const sitesList = [];
                data.forEach((row, idx) => {
                    let siteName = '';
                    let latVal = null;
                    let lngVal = null;
                    let radVal = 200;

                    for (const key of Object.keys(row)) {
                        const cleanKey = key.trim().toLowerCase();
                        const val = row[key];

                        if (cleanKey.includes('name') || cleanKey.includes('site') || cleanKey.includes('title')) {
                            siteName = String(val).trim();
                        } else if (cleanKey.includes('lat') || cleanKey === 'latitude') {
                            latVal = parseFloat(val);
                        } else if (cleanKey.includes('lng') || cleanKey.includes('long') || cleanKey === 'longitude') {
                            lngVal = parseFloat(val);
                        } else if (cleanKey.includes('rad') || cleanKey.includes('meter')) {
                            const parsedR = parseFloat(val);
                            if (!isNaN(parsedR) && parsedR > 0) radVal = parsedR;
                        }
                    }

                    if (siteName || (latVal !== null && lngVal !== null)) {
                        const isValid = !isNaN(latVal) && !isNaN(lngVal) && latVal !== 0 && lngVal !== 0;
                        sitesList.push({
                            id: idx + 1,
                            name: siteName || `Site ${idx + 1}`,
                            latitude: latVal,
                            longitude: lngVal,
                            radius: radVal,
                            isValid
                        });
                    }
                });

                if (sitesList.length === 0) {
                    alert('Could not parse any valid site rows. Please ensure columns: Site Name, Latitude, Longitude.');
                    return;
                }

                setParsedSites(sitesList);
                setShowUploadModal(true);
            } catch (err) {
                console.error('Error parsing Excel:', err);
                alert('Error parsing Excel file: ' + err.message);
            }
        };

        reader.readAsArrayBuffer(file);
    };

    // Execute Bulk API Import
    const handleConfirmBulkImport = async () => {
        const validSites = parsedSites.filter(s => s.isValid);
        if (validSites.length === 0) {
            alert('No valid sites available for import.');
            return;
        }

        setImporting(true);
        try {
            const payload = validSites.map(s => ({
                name: s.name,
                latitude: s.latitude,
                longitude: s.longitude,
                radius: s.radius
            }));

            const res = await api.bulkCreateGeofences(payload);
            setSuccessMsg(`Successfully imported ${res.count || payload.length} site geofences from Excel!`);
            setShowUploadModal(false);
            setParsedSites([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
            loadGeofences();
        } catch (err) {
            console.error('Bulk import error:', err);
            alert('Bulk import failed: ' + (err.message || 'Server error'));
        } finally {
            setImporting(false);
        }
    };

    const filteredGeofences = geofences.filter(gf => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (gf.name && gf.name.toLowerCase().includes(term)) ||
               (gf.latitude && gf.latitude.toString().includes(term)) ||
               (gf.longitude && gf.longitude.toString().includes(term));
    });

    return (
        <div id="geofence-view" className="view active geofence-split-grid">
            
            {/* Hidden File Input for Excel Import */}
            <input 
                type="file" 
                ref={fileInputRef}
                accept=".xlsx, .xls, .csv" 
                onChange={handleFileSelect} 
                style={{ display: 'none' }} 
            />

            {/* Left Column: List and Map */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', paddingRight: '5px' }}>
                
                {/* Geofence List Header & Search */}
                <div className="glass" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                            Office Geofences ({geofences.length})
                        </h3>

                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button 
                                type="button"
                                className="btn btn-outline" 
                                style={{ margin: 0, padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', borderColor: '#3b82f6', color: '#3b82f6' }}
                                onClick={handleFitAllBounds}
                                title="Auto-zoom map to show all 58 geofences across India"
                            >
                                <i className="fa-solid fa-earth-americas"></i> Fit All Sites
                            </button>

                            <button 
                                type="button"
                                className="btn btn-outline" 
                                style={{ margin: 0, padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', borderColor: '#10b981', color: '#10b981' }}
                                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                            >
                                <i className="fa-solid fa-file-excel"></i> Bulk Import (Excel)
                            </button>

                            <button 
                                type="button"
                                className="btn btn-outline" 
                                style={{ margin: 0, padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                                onClick={handleDownloadTemplate}
                                title="Download Sample Excel Sheet Template"
                            >
                                <i className="fa-solid fa-download"></i> Sample Excel
                            </button>

                            {editingId && (
                                <button className="btn btn-outline" style={{ margin: 0, padding: '6px 10px', fontSize: '0.8rem' }} onClick={resetForm}>
                                    + New Geofence
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Search Bar Input */}
                    <div style={{ marginBottom: '12px', position: 'relative' }}>
                        <input 
                            type="text"
                            placeholder="🔍 Search site by name or coordinates..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 12px 8px 34px',
                                borderRadius: '8px',
                                border: '1px solid var(--border-glass, #334155)',
                                background: 'rgba(0,0,0,0.15)',
                                color: 'var(--text-primary)',
                                fontSize: '13px',
                                outline: 'none'
                            }}
                        />
                        <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '12px', top: '10px', color: '#64748b', fontSize: '12px' }}></i>
                    </div>
                    
                    {/* Desktop Table View */}
                    <div className="desktop-table-view" style={{ maxHeight: '200px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
                            <thead style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0, zIndex: 10 }}>
                                <tr>
                                    <th style={{ padding: '10px' }}>Name</th>
                                    <th style={{ padding: '10px' }}>Coordinates</th>
                                    <th style={{ padding: '10px' }}>Radius</th>
                                    <th style={{ padding: '10px', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredGeofences.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                                            No matching geofences found.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredGeofences.map(gf => {
                                        const isSelected = selectedGeofenceId === gf.id;
                                        return (
                                            <tr 
                                                key={gf.id} 
                                                onClick={() => handleFocusOnMap(gf)}
                                                style={{ 
                                                    borderTop: '1px solid var(--border-glass)', 
                                                    background: isSelected ? 'rgba(249, 115, 22, 0.15)' : editingId === gf.id ? 'rgba(37, 99, 235, 0.12)' : 'transparent',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.2s'
                                                }}
                                            >
                                                <td style={{ padding: '10px', fontWeight: 600, color: isSelected ? '#f97316' : 'inherit' }}>
                                                    {gf.name} {isSelected && <span style={{ fontSize: '11px', color: '#f97316', marginLeft: '4px' }}>● Active</span>}
                                                </td>
                                                <td style={{ padding: '10px', color: '#64748b', fontSize: '0.85rem' }}>
                                                    {parseFloat(gf.latitude).toFixed(5)}, {parseFloat(gf.longitude).toFixed(5)}
                                                </td>
                                                <td style={{ padding: '10px' }}>{gf.radius}m</td>
                                                <td style={{ padding: '10px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                                                    <button 
                                                        className="btn btn-outline" 
                                                        style={{ margin: 0, padding: '4px 8px', fontSize: '0.75rem', borderColor: '#3b82f6', color: '#3b82f6', background: 'var(--input-bg)' }}
                                                        onClick={() => handleFocusOnMap(gf)}
                                                        title="Focus map on site location"
                                                    >
                                                        <i className="fa-solid fa-eye"></i> View Map
                                                    </button>
                                                    <button 
                                                        className="btn btn-outline" 
                                                        style={{ margin: 0, padding: '4px 8px', fontSize: '0.75rem', borderColor: 'var(--primary)', background: 'var(--input-bg)' }}
                                                        onClick={() => handleEdit(gf)}
                                                    >
                                                        <i className="fa-solid fa-pen"></i> Edit
                                                    </button>
                                                    <button 
                                                        className="btn btn-outline" 
                                                        style={{ margin: 0, padding: '4px 8px', fontSize: '0.75rem', borderColor: '#ef4444', color: '#ef4444', background: 'var(--input-bg)' }}
                                                        onClick={() => handleDelete(gf.id)}
                                                    >
                                                        <i className="fa-solid fa-trash"></i> Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Cards View */}
                    <div className="mobile-cards-only" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {filteredGeofences.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                                No matching geofences found.
                            </div>
                        ) : (
                            filteredGeofences.map(gf => {
                                const isSelected = selectedGeofenceId === gf.id;
                                return (
                                    <div 
                                        key={gf.id}
                                        onClick={() => handleFocusOnMap(gf)}
                                        style={{
                                            background: '#ffffff',
                                            border: isSelected ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                                            borderRadius: '14px',
                                            padding: '14px 16px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '10px',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <i className="fa-solid fa-location-dot" style={{ color: '#2563eb', fontSize: '12px' }}></i>
                                                    {gf.name}
                                                </h4>
                                                <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'block' }}>
                                                    {parseFloat(gf.latitude).toFixed(5)}, {parseFloat(gf.longitude).toFixed(5)}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ textAlign: 'right' }}>
                                                    <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block' }}>Radius</span>
                                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>{gf.radius}m</span>
                                                </div>
                                                <i className="fa-solid fa-chevron-right" style={{ fontSize: '12px', color: '#94a3b8' }}></i>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '8px', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }} onClick={e => e.stopPropagation()}>
                                            <button
                                                type="button"
                                                onClick={() => handleFocusOnMap(gf)}
                                                style={{
                                                    flex: 1,
                                                    height: '34px',
                                                    background: '#2563eb',
                                                    color: '#ffffff',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '6px'
                                                }}
                                            >
                                                <i className="fa-solid fa-eye" style={{ fontSize: '11px' }}></i> View Map
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleEdit(gf)}
                                                style={{
                                                    flex: 1,
                                                    height: '34px',
                                                    background: '#ffffff',
                                                    color: '#334155',
                                                    border: '1px solid #cbd5e1',
                                                    borderRadius: '8px',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '6px'
                                                }}
                                            >
                                                <i className="fa-solid fa-pen" style={{ fontSize: '11px' }}></i> Edit
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(gf.id)}
                                                style={{
                                                    height: '34px',
                                                    padding: '0 12px',
                                                    background: '#fee2e2',
                                                    color: '#ef4444',
                                                    border: '1px solid #fca5a5',
                                                    borderRadius: '8px',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '4px'
                                                }}
                                            >
                                                <i className="fa-solid fa-trash" style={{ fontSize: '11px' }}></i>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Leaflet Map Card */}
                <div className="glass" style={{ flex: 1, minHeight: '300px', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: '300px', borderRadius: '12px', zIndex: 1 }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '10px',
                        left: '10px',
                        zIndex: 1000,
                        background: 'var(--bg-glass, #ffffff)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-glass, #e2e8f0)',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        boxShadow: 'var(--shadow-md)',
                        pointerEvents: 'none'
                    }}>
                        <i className="fa-solid fa-location-dot" style={{ marginRight: '6px', color: '#2563eb' }}></i> 
                        Click any site row in table to fly map directly onto location pin.
                    </div>
                </div>

                {/* Map Legend & Active Site Info (Matches Mobile Screen 6) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2563eb' }}></span>
                            Office Geofence
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span>
                            Employee Location
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></span>
                            Outside Geofence
                        </span>
                    </div>

                    {(() => {
                        const activeSite = geofences.find(g => g.id === selectedGeofenceId) || (geofences.length > 0 ? geofences[0] : null);
                        if (!activeSite) return null;
                        return (
                            <div 
                                onClick={() => handleFocusOnMap(activeSite)}
                                style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center', 
                                    padding: '12px 14px', 
                                    background: 'var(--bg-glass, #ffffff)', 
                                    border: '1px solid var(--border-glass, #e2e8f0)', 
                                    borderRadius: '12px',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                                    cursor: 'pointer'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <i className="fa-solid fa-building" style={{ fontSize: '14px' }}></i>
                                    </div>
                                    <div>
                                        <h5 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{activeSite.name}</h5>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Radius: {activeSite.radius || 300} m</span>
                                    </div>
                                </div>
                                <i className="fa-solid fa-chevron-right" style={{ fontSize: '12px', color: '#94a3b8' }}></i>
                            </div>
                        );
                    })()}
                </div>
            </div>

            {/* Right Column: Add/Edit Form + Excel Dropzone Banner */}
            <div className="glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {editingId ? `Edit Geofence` : `Add Office Geofence`}
                    </h3>
                </div>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Define the boundary inside which employees can register their attendance.
                </p>

                {/* Excel Quick Upload Box */}
                <div 
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    style={{
                        border: '2px dashed var(--border-glass, #334155)',
                        borderRadius: '12px',
                        padding: '16px',
                        textAlign: 'center',
                        background: 'rgba(255,255,255,0.02)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '6px'
                    }}
                >
                    <div style={{ fontSize: '24px', color: '#10b981' }}>
                        <i className="fa-solid fa-file-excel"></i>
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                        Have an Excel file with multiple sites?
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Click here to upload <b>.xlsx, .xls, or .csv</b> with Site Name, Latitude & Longitude
                    </div>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '5px' }}>
                    <div className="form-group">
                        <label style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Geofence Name</label>
                        <input 
                            type="text" 
                            placeholder="e.g. Headquarters, Noida Branch"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                        />
                    </div>

                    <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        <div className="form-group">
                            <label style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Latitude</label>
                            <input 
                                type="number" 
                                step="any" 
                                required
                                placeholder="e.g. 28.669200"
                                value={latitude}
                                onChange={(e) => setLatitude(e.target.value)}
                                style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Longitude</label>
                            <input 
                                type="number" 
                                step="any" 
                                required
                                placeholder="e.g. 77.453800"
                                value={longitude}
                                onChange={(e) => setLongitude(e.target.value)}
                                style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Radius (meters)</label>
                        <input 
                            type="number" 
                            step="any" 
                            required
                            placeholder="e.g. 200"
                            value={radius}
                            onChange={(e) => setRadius(e.target.value)}
                            style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                        />
                    </div>

                    <button 
                        type="button" 
                        className="btn btn-outline" 
                        onClick={handleUseMyLocation}
                        disabled={locating}
                        style={{ alignSelf: 'flex-start', margin: 0, padding: '8px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        {locating ? (
                            <><i className="fa-solid fa-spinner fa-spin"></i> Locating...</>
                        ) : (
                            <><i className="fa-solid fa-location-crosshairs"></i> Use My Current Location</>
                        )}
                    </button>

                    <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                        <button type="submit" className="btn btn-primary" style={{ flex: 1, margin: 0 }}>
                            {editingId ? 'Save Changes' : 'Add Geofence'}
                        </button>
                        {editingId && (
                            <button type="button" className="btn btn-outline" onClick={resetForm} style={{ flex: 1, margin: 0 }}>
                                Cancel
                            </button>
                        )}
                    </div>
                </form>

                {successMsg && (
                    <div style={{ marginTop: '10px', padding: '10px', borderRadius: '8px', background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <i className="fa-solid fa-circle-check"></i> {successMsg}
                    </div>
                )}

                {errorMsg && (
                    <div style={{ marginTop: '10px', padding: '10px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <i className="fa-solid fa-circle-exclamation"></i> {errorMsg}
                    </div>
                )}
            </div>

            {/* ---------------------------------------------------------------------- */}
            {/* BULK PARSED EXCEL SITES PREVIEW MODAL */}
            {/* ---------------------------------------------------------------------- */}
            {showUploadModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 99999,
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'center',
                    padding: '20px'
                }}>
                    <div className="glass" style={{
                        width: '100%',
                        maxWidth: '750px',
                        maxHeight: '85vh',
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                        background: 'var(--bg-panel, #0f172a)'
                    }}>
                        {/* Modal Header */}
                        <div style={{
                            padding: '20px 24px',
                            borderBottom: '1px solid var(--border-glass, #1e293b)',
                            display: 'flex',
                            justify: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    <i className="fa-solid fa-file-excel" style={{ color: '#10b981', marginRight: '8px' }}></i>
                                    Preview Sites from Excel ({parsedSites.filter(s => s.isValid).length} Valid Sites)
                                </h3>
                                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                                    Source File: <b>{uploadFileName}</b>
                                </p>
                            </div>
                            <button 
                                onClick={() => setShowUploadModal(false)}
                                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '20px', cursor: 'pointer' }}
                            >
                                &times;
                            </button>
                        </div>

                        {/* Modal Body: Table of parsed sites */}
                        <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                                        <th style={{ padding: '10px' }}>#</th>
                                        <th style={{ padding: '10px' }}>Site Name</th>
                                        <th style={{ padding: '10px' }}>Latitude</th>
                                        <th style={{ padding: '10px' }}>Longitude</th>
                                        <th style={{ padding: '10px' }}>Radius</th>
                                        <th style={{ padding: '10px' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parsedSites.map((site) => (
                                        <tr key={site.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '10px', color: '#64748b' }}>{site.id}</td>
                                            <td style={{ padding: '10px', fontWeight: 600 }}>{site.name}</td>
                                            <td style={{ padding: '10px', fontFamily: 'monospace' }}>
                                                {site.latitude !== null ? site.latitude : <span style={{ color: '#ef4444' }}>Missing</span>}
                                            </td>
                                            <td style={{ padding: '10px', fontFamily: 'monospace' }}>
                                                {site.longitude !== null ? site.longitude : <span style={{ color: '#ef4444' }}>Missing</span>}
                                            </td>
                                            <td style={{ padding: '10px' }}>{site.radius}m</td>
                                            <td style={{ padding: '10px' }}>
                                                {site.isValid ? (
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e', fontSize: '11px', fontWeight: 700 }}>
                                                        Ready ✅
                                                    </span>
                                                ) : (
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', fontSize: '11px', fontWeight: 700 }}>
                                                        Invalid Coordinates ❌
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Modal Footer */}
                        <div style={{
                            padding: '16px 24px',
                            borderTop: '1px solid var(--border-glass, #1e293b)',
                            display: 'flex',
                            justify: 'space-between',
                            alignItems: 'center',
                            background: 'rgba(0,0,0,0.2)'
                        }}>
                            <span style={{ fontSize: '12px', color: '#64748b' }}>
                                Non-valid sites will be skipped automatically during import.
                            </span>

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button 
                                    className="btn btn-outline" 
                                    onClick={() => setShowUploadModal(false)}
                                    disabled={importing}
                                    style={{ margin: 0, padding: '8px 16px', fontSize: '13px' }}
                                >
                                    Cancel
                                </button>

                                <button 
                                    className="btn btn-primary" 
                                    onClick={handleConfirmBulkImport}
                                    disabled={importing || parsedSites.filter(s => s.isValid).length === 0}
                                    style={{ margin: 0, padding: '8px 20px', fontSize: '13px', background: '#10b981', borderColor: '#10b981' }}
                                >
                                    {importing ? (
                                        <><i className="fa-solid fa-spinner fa-spin"></i> Importing...</>
                                    ) : (
                                        <><i className="fa-solid fa-cloud-arrow-up"></i> Confirm & Import {parsedSites.filter(s => s.isValid).length} Sites</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
