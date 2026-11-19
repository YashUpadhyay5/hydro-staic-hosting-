import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { api } from '../../services/api';

export default function GeofenceView({ employees = [] }) {
    const cachedGeofences = api.getCached('/geofence');
    const [geofences, setGeofences] = useState(() => Array.isArray(cachedGeofences) ? cachedGeofences : []);
    
    // Active Tab: 'SITES' (Work & Office Sites) or 'HOUSES' (Employee Residences)
    const [activeTab, setActiveTab] = useState('SITES');

    // Form fields
    const [name, setName] = useState('');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const [radius, setRadius] = useState('100');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
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

    // Map & Layer References
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const siteLayersGroupRef = useRef(null);
    const activePreviewGroupRef = useRef(null);
    const geofenceLayersRef = useRef({});
    const prevSelectedIdRef = useRef(null);

    // Create custom pin icon helper for Leaflet
    const createSitePinIcon = (siteName, isSelected = false, isHouse = false) => {
        if (!window.L) return null;
        let bg = isSelected ? '#f97316' : (isHouse ? '#8b5cf6' : '#2563eb');
        const iconSymbol = isHouse ? '🏠' : '📍';

        return window.L.divIcon({
            className: 'custom-geofence-pin-icon',
            html: `
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    background: ${bg};
                    color: #ffffff;
                    padding: 4px 9px;
                    border-radius: 20px;
                    font-size: 11px;
                    font-weight: 700;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    border: 2px solid #ffffff;
                    white-space: nowrap;
                    cursor: pointer;
                    transform: translate(-50%, -50%);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                ">
                    <span style="font-size: 12px;">${iconSymbol}</span>
                    <span>${siteName}</span>
                </div>
            `,
            iconSize: [110, 30],
            iconAnchor: [55, 15]
        });
    };

    // Load all geofences
    const loadGeofences = async () => {
        try {
            const res = await api.getGeofences();
            if (Array.isArray(res)) {
                setGeofences(res);
            } else if (res) {
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

    // Split geofences by category
    const workSites = useMemo(() => {
        return geofences.filter(g => (g.category || 'SITE').toUpperCase() === 'SITE');
    }, [geofences]);

    const houseSites = useMemo(() => {
        return geofences.filter(g => (g.category || 'SITE').toUpperCase() === 'HOUSE');
    }, [geofences]);

    // Current category active items
    const currentList = activeTab === 'HOUSES' ? houseSites : workSites;

    // Filter by search term
    const filteredGeofences = useMemo(() => {
        if (!searchTerm.trim()) return currentList;
        const term = searchTerm.toLowerCase();
        return currentList.filter(gf => {
            const nameMatch = gf.name && gf.name.toLowerCase().includes(term);
            const latMatch = gf.latitude && gf.latitude.toString().includes(term);
            const lngMatch = gf.longitude && gf.longitude.toString().includes(term);
            const empMatch = gf.employeeId && gf.employeeId.toLowerCase().includes(term);
            return nameMatch || latMatch || lngMatch || empMatch;
        });
    }, [currentList, searchTerm]);

    // Helper to resolve employee name by ID or empCode
    const resolveEmployeeName = (empId) => {
        if (!empId) return null;
        const emp = (employees || []).find(e => 
            String(e.id || '').toLowerCase() === String(empId).toLowerCase() ||
            String(e.empCode || '').toLowerCase() === String(empId).toLowerCase()
        );
        return emp ? `${emp.name} (${emp.empCode || emp.id})` : empId;
    };

    // 1. Initialize map with proper unmount cleanup (prevents OOM crashes)
    useEffect(() => {
        if (!mapInstance.current && mapRef.current && window.L) {
            mapInstance.current = window.L.map(mapRef.current, {
                center: [31.50, 74.80],
                zoom: 10,
                zoomControl: true
            });

            window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_2ae4_1_8e228ec653d025bb97ea2305', {
                attribution: '&copy; OpenStreetMap &copy; CARTO'
            }).addTo(mapInstance.current);

            // Layer groups to avoid individual layer leaks
            siteLayersGroupRef.current = window.L.layerGroup().addTo(mapInstance.current);
            activePreviewGroupRef.current = window.L.layerGroup().addTo(mapInstance.current);

            // Handle map clicks to place/update coordinates
            mapInstance.current.on('click', (e) => {
                const { lat, lng } = e.latlng;
                setLatitude(lat.toFixed(6));
                setLongitude(lng.toFixed(6));
            });
        }

        // Cleanup on component unmount to prevent zombie maps and memory leaks
        return () => {
            if (mapInstance.current) {
                mapInstance.current.off();
                mapInstance.current.remove();
                mapInstance.current = null;
                siteLayersGroupRef.current = null;
                activePreviewGroupRef.current = null;
                geofenceLayersRef.current = {};
            }
        };
    }, []);

    // 2. Render active category geofence pins and circles onto the map
    useEffect(() => {
        if (!mapInstance.current || !siteLayersGroupRef.current || !window.L) return;

        // Clean existing layers in single atomic operation
        siteLayersGroupRef.current.clearLayers();
        geofenceLayersRef.current = {};

        const bounds = window.L.latLngBounds();
        let validPointsCount = 0;
        const isHouseTab = activeTab === 'HOUSES';

        currentList.forEach(gf => {
            if (gf.latitude && gf.longitude && gf.id !== editingId) {
                const lat = parseFloat(gf.latitude);
                const lng = parseFloat(gf.longitude);
                const r = parseFloat(gf.radius) || (isHouseTab ? 30 : 200);
                const isSelected = selectedGeofenceId === gf.id;

                const circleColor = isSelected ? '#f97316' : (isHouseTab ? '#8b5cf6' : '#2563eb');

                const circle = window.L.circle([lat, lng], {
                    color: circleColor,
                    fillColor: circleColor,
                    fillOpacity: isSelected ? 0.35 : 0.15,
                    radius: r,
                    weight: isSelected ? 3 : 1.5
                });

                const popupContent = `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 4px; color: #1e293b; min-width: 180px;">
                        <h4 style="margin: 0 0 4px 0; font-size: 13px; color: #0f172a; display: flex; align-items: center; gap: 4px;">
                            ${isHouseTab ? '🏠' : '📍'} ${gf.name || 'Geofence'}
                        </h4>
                        ${isHouseTab && gf.employeeId ? `
                            <div style="font-size: 11px; color: #8b5cf6; font-weight: 700; margin-bottom: 4px;">
                                Resident: ${resolveEmployeeName(gf.employeeId)}
                            </div>
                        ` : ''}
                        <div style="font-size: 11px; color: #64748b; display: flex; flex-direction: column; gap: 2px;">
                            <div><b>Coordinates:</b> ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
                            <div><b>Radius:</b> ${r} meters</div>
                        </div>
                    </div>
                `;

                circle.bindPopup(popupContent, { minWidth: 190 });

                const marker = window.L.marker([lat, lng], {
                    icon: createSitePinIcon(gf.name || 'Geofence', isSelected, isHouseTab)
                });
                marker.bindPopup(popupContent, { minWidth: 190 });

                marker.on('click', () => {
                    setSelectedGeofenceId(gf.id);
                });

                siteLayersGroupRef.current.addLayer(circle);
                siteLayersGroupRef.current.addLayer(marker);

                geofenceLayersRef.current[gf.id] = { circle, marker, lat, lng, name: gf.name || 'Geofence' };
                bounds.extend([lat, lng]);
                validPointsCount++;
            }
        });

        // Auto-fit bounds on tab change or list load
        if (validPointsCount > 0 && !editingId && !latitude && !longitude) {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    if (mapInstance.current) {
                        mapInstance.current.invalidateSize();
                        mapInstance.current.fitBounds(bounds, { padding: [40, 40], maxZoom: isHouseTab ? 14 : 12 });
                    }
                }, 100);
            });
        }
    }, [currentList, activeTab, editingId]);

    // 2b. Efficiently highlight active selection without destroying and re-rendering all map layers (Prevents OOM)
    useEffect(() => {
        const prevId = prevSelectedIdRef.current;
        const currentId = selectedGeofenceId;
        prevSelectedIdRef.current = currentId;

        const isHouseTab = activeTab === 'HOUSES';

        // Reset previous selected layer
        if (prevId && geofenceLayersRef.current[prevId]) {
            const { circle, marker, name: sName } = geofenceLayersRef.current[prevId];
            const normalColor = isHouseTab ? '#8b5cf6' : '#2563eb';
            if (circle) circle.setStyle({ color: normalColor, fillColor: normalColor, fillOpacity: 0.15, weight: 1.5 });
            if (marker) marker.setIcon(createSitePinIcon(sName, false, isHouseTab));
        }

        // Highlight newly selected layer
        if (currentId && geofenceLayersRef.current[currentId]) {
            const { circle, marker, name: sName } = geofenceLayersRef.current[currentId];
            if (circle) circle.setStyle({ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.35, weight: 3 });
            if (marker) marker.setIcon(createSitePinIcon(sName, true, isHouseTab));
        }
    }, [selectedGeofenceId, activeTab]);

    // 3. Active editing / creation preview marker & circle
    useEffect(() => {
        if (!mapInstance.current || !activePreviewGroupRef.current || !window.L) return;

        activePreviewGroupRef.current.clearLayers();

        const latVal = parseFloat(latitude);
        const lngVal = parseFloat(longitude);
        const radVal = parseFloat(radius) || (activeTab === 'HOUSES' ? 30 : 100);

        if (!isNaN(latVal) && !isNaN(lngVal)) {
            const previewCircle = window.L.circle([latVal, lngVal], {
                color: '#f97316',
                fillColor: '#f97316',
                fillOpacity: 0.25,
                radius: radVal
            });

            const previewMarker = window.L.marker([latVal, lngVal], {
                draggable: true
            });

            previewMarker.on('dragend', (e) => {
                const position = e.target.getLatLng();
                setLatitude(position.lat.toFixed(6));
                setLongitude(position.lng.toFixed(6));
            });

            activePreviewGroupRef.current.addLayer(previewCircle);
            activePreviewGroupRef.current.addLayer(previewMarker);

            mapInstance.current.setView([latVal, lngVal], 15);
        }
    }, [latitude, longitude, radius, activeTab]);

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

    // Auto-Fit map to show all geofences in active tab
    const handleFitAllBounds = () => {
        if (!mapInstance.current || currentList.length === 0 || !window.L) return;
        const bounds = window.L.latLngBounds();
        let validCount = 0;
        currentList.forEach(gf => {
            if (gf.latitude && gf.longitude) {
                bounds.extend([parseFloat(gf.latitude), parseFloat(gf.longitude)]);
                validCount++;
            }
        });
        if (validCount > 0) {
            mapInstance.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
            setSelectedGeofenceId(null);
        }
    };

    // Reset Form Fields
    const resetForm = () => {
        setEditingId(null);
        setName('');
        setLatitude('');
        setLongitude('');
        setRadius(activeTab === 'HOUSES' ? '30' : '100');
        setSelectedEmployeeId('');
        setSelectedGeofenceId(null);
    };

    // Switch tab handler
    const handleTabChange = (newTab) => {
        setActiveTab(newTab);
        resetForm();
        setSearchTerm('');
        setSelectedGeofenceId(null);
    };

    // Handle Form Submit (Create / Update single)
    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        setSuccessMsg('');

        const isHouse = activeTab === 'HOUSES';
        const defaultName = isHouse ? 'Employee House' : 'Office Geofence';

        const payload = {
            name: name.trim() || defaultName,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            radius: parseFloat(radius) || (isHouse ? 30 : 100),
            category: isHouse ? 'HOUSE' : 'SITE',
            employeeId: isHouse ? (selectedEmployeeId || null) : null
        };

        if (isNaN(payload.latitude) || isNaN(payload.longitude) || isNaN(payload.radius)) {
            setErrorMsg("Please provide valid coordinates and radius.");
            return;
        }

        try {
            if (editingId) {
                await api.updateGeofence(editingId, payload);
                setSuccessMsg(`${isHouse ? 'House Geofence' : 'Site Geofence'} "${payload.name}" updated successfully!`);
            } else {
                await api.createGeofence(payload);
                setSuccessMsg(`${isHouse ? 'House Geofence' : 'Site Geofence'} "${payload.name}" created successfully!`);
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
        setRadius(gf.radius ? gf.radius.toString() : (activeTab === 'HOUSES' ? '30' : '100'));
        setSelectedEmployeeId(gf.employeeId || '');
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

    // Download Sample Excel Template
    const handleDownloadTemplate = async () => {
        try {
            const { default: ExcelJS } = await import('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'HRMS Admin';
            const sheet = workbook.addWorksheet('Geofence Sites');

            sheet.mergeCells('A1:D1');
            const titleCell = sheet.getCell('A1');
            titleCell.value = 'OFFICE SITES & GEOFENCES BULK IMPORT TEMPLATE';
            titleCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFF' } };
            titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
            sheet.getRow(1).height = 28;

            const headers = ['Site Name', 'Latitude', 'Longitude', 'Radius (meters)'];
            const headerRow = sheet.addRow(headers);
            headerRow.height = 22;
            headerRow.eachCell((cell) => {
                cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2563EB' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });

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
                radius: s.radius,
                category: 'SITE'
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

    return (
        <div id="geofence-view" className="view active geofence-split-grid" style={{ height: '100%', minHeight: 0 }}>
            
            {/* Hidden File Input for Excel Import */}
            <input 
                type="file" 
                ref={fileInputRef}
                accept=".xlsx, .xls, .csv" 
                onChange={handleFileSelect} 
                style={{ display: 'none' }} 
            />

            {/* Left Column: Segmented Tabs, List and Map */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', paddingRight: '5px' }}>
                
                {/* Segmented Category Tabs (Work Sites vs Employee Houses) */}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                        type="button"
                        onClick={() => handleTabChange('SITES')}
                        style={{
                            flex: 1,
                            padding: '10px 16px',
                            borderRadius: '10px',
                            border: activeTab === 'SITES' ? '2px solid #2563eb' : '1px solid var(--border-glass)',
                            background: activeTab === 'SITES' ? 'rgba(37, 99, 235, 0.15)' : 'var(--bg-glass)',
                            color: activeTab === 'SITES' ? '#3b82f6' : 'var(--text-secondary)',
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            transition: 'all 0.15s'
                        }}
                    >
                        <i className="fa-solid fa-building" style={{ fontSize: '13px' }}></i>
                        <span>Work & Office Sites ({workSites.length})</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleTabChange('HOUSES')}
                        style={{
                            flex: 1,
                            padding: '10px 16px',
                            borderRadius: '10px',
                            border: activeTab === 'HOUSES' ? '2px solid #8b5cf6' : '1px solid var(--border-glass)',
                            background: activeTab === 'HOUSES' ? 'rgba(139, 92, 246, 0.15)' : 'var(--bg-glass)',
                            color: activeTab === 'HOUSES' ? '#a78bfa' : 'var(--text-secondary)',
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            transition: 'all 0.15s'
                        }}
                    >
                        <i className="fa-solid fa-house-user" style={{ fontSize: '13px' }}></i>
                        <span>Employee Residences ({houseSites.length})</span>
                    </button>
                </div>

                {/* Geofence List Header & Search */}
                <div className="glass" style={{ padding: '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {activeTab === 'HOUSES' ? `Employee House Geofences (${houseSites.length})` : `Office Geofences (${workSites.length})`}
                        </h3>

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button 
                                type="button"
                                className="btn btn-outline" 
                                style={{ margin: 0, padding: '5px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', borderColor: '#3b82f6', color: '#3b82f6' }}
                                onClick={handleFitAllBounds}
                                title="Auto-zoom map to show all locations"
                            >
                                <i className="fa-solid fa-earth-americas"></i> Fit All
                            </button>

                            {activeTab === 'SITES' && (
                                <>
                                    <button 
                                        type="button"
                                        className="btn btn-outline" 
                                        style={{ margin: 0, padding: '5px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', borderColor: '#10b981', color: '#10b981' }}
                                        onClick={() => fileInputRef.current && fileInputRef.current.click()}
                                    >
                                        <i className="fa-solid fa-file-excel"></i> Bulk Import
                                    </button>

                                    <button 
                                        type="button"
                                        className="btn btn-outline" 
                                        style={{ margin: 0, padding: '5px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                                        onClick={handleDownloadTemplate}
                                        title="Download Sample Excel Sheet Template"
                                    >
                                        <i className="fa-solid fa-download"></i> Template
                                    </button>
                                </>
                            )}

                            {editingId && (
                                <button className="btn btn-outline" style={{ margin: 0, padding: '5px 10px', fontSize: '0.8rem' }} onClick={resetForm}>
                                    + New Geofence
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Search Bar Input */}
                    <div style={{ marginBottom: '10px', position: 'relative' }}>
                        <input 
                            type="text" 
                            placeholder={activeTab === 'HOUSES' ? "🔍 Search house by employee or name..." : "🔍 Search site by name or coordinates..."}
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
                    <div className="desktop-table-view" style={{ maxHeight: '180px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', textAlign: 'left' }}>
                            <thead style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0, zIndex: 10 }}>
                                <tr>
                                    <th style={{ padding: '8px 10px' }}>Name</th>
                                    {activeTab === 'HOUSES' && <th style={{ padding: '8px 10px' }}>Assigned Employee</th>}
                                    <th style={{ padding: '8px 10px' }}>Coordinates</th>
                                    <th style={{ padding: '8px 10px' }}>Radius</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredGeofences.length === 0 ? (
                                    <tr>
                                        <td colSpan={activeTab === 'HOUSES' ? 5 : 4} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                                            {activeTab === 'HOUSES' ? 'No employee house geofences found.' : 'No matching office geofences found.'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredGeofences.map(gf => {
                                        const isSelected = selectedGeofenceId === gf.id;
                                        const isHouse = (gf.category || 'SITE').toUpperCase() === 'HOUSE';
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
                                                <td style={{ padding: '8px 10px', fontWeight: 600, color: isSelected ? '#f97316' : 'inherit' }}>
                                                    {isHouse ? '🏠' : '📍'} {gf.name} {isSelected && <span style={{ fontSize: '11px', color: '#f97316', marginLeft: '4px' }}>● Active</span>}
                                                </td>
                                                {activeTab === 'HOUSES' && (
                                                    <td style={{ padding: '8px 10px', color: '#a78bfa', fontSize: '0.8rem', fontWeight: 600 }}>
                                                        {gf.employeeId ? resolveEmployeeName(gf.employeeId) : <span style={{ color: '#64748b' }}>Unassigned</span>}
                                                    </td>
                                                )}
                                                <td style={{ padding: '8px 10px', color: '#64748b', fontSize: '0.82rem' }}>
                                                    {parseFloat(gf.latitude).toFixed(5)}, {parseFloat(gf.longitude).toFixed(5)}
                                                </td>
                                                <td style={{ padding: '8px 10px' }}>{gf.radius}m</td>
                                                <td style={{ padding: '8px 10px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                                                    <button 
                                                        className="btn btn-outline" 
                                                        style={{ margin: 0, padding: '3px 8px', fontSize: '0.72rem', borderColor: '#3b82f6', color: '#3b82f6', background: 'var(--input-bg)' }}
                                                        onClick={() => handleFocusOnMap(gf)}
                                                        title="Focus map on location"
                                                    >
                                                        <i className="fa-solid fa-eye"></i> View
                                                    </button>
                                                    <button 
                                                        className="btn btn-outline" 
                                                        style={{ margin: 0, padding: '3px 8px', fontSize: '0.72rem', borderColor: 'var(--primary)', background: 'var(--input-bg)' }}
                                                        onClick={() => handleEdit(gf)}
                                                    >
                                                        <i className="fa-solid fa-pen"></i> Edit
                                                    </button>
                                                    <button 
                                                        className="btn btn-outline" 
                                                        style={{ margin: 0, padding: '3px 8px', fontSize: '0.72rem', borderColor: '#ef4444', color: '#ef4444', background: 'var(--input-bg)' }}
                                                        onClick={() => handleDelete(gf.id)}
                                                    >
                                                        <i className="fa-solid fa-trash"></i>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Cards View (Visible only on mobile screens <= 768px via CSS to save desktop memory) */}
                    <div className="mobile-cards-only" style={{ flexDirection: 'column', gap: '8px' }}>
                        {filteredGeofences.length === 0 ? (
                            <div style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>
                                No geofences found.
                            </div>
                        ) : (
                            filteredGeofences.map(gf => {
                                const isSelected = selectedGeofenceId === gf.id;
                                const isHouse = (gf.category || 'SITE').toUpperCase() === 'HOUSE';
                                return (
                                    <div 
                                        key={gf.id}
                                        onClick={() => handleFocusOnMap(gf)}
                                        style={{
                                            background: '#ffffff',
                                            border: isSelected ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                                            borderRadius: '12px',
                                            padding: '12px 14px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    {isHouse ? '🏠' : '📍'} {gf.name}
                                                </h4>
                                                {isHouse && gf.employeeId && (
                                                    <span style={{ fontSize: '11px', color: '#8b5cf6', fontWeight: 600, marginTop: '2px', display: 'block' }}>
                                                        Resident: {resolveEmployeeName(gf.employeeId)}
                                                    </span>
                                                )}
                                                <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'block' }}>
                                                    {parseFloat(gf.latitude).toFixed(5)}, {parseFloat(gf.longitude).toFixed(5)}
                                                </span>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block' }}>Radius</span>
                                                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>{gf.radius}m</span>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '6px', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }} onClick={e => e.stopPropagation()}>
                                            <button
                                                type="button"
                                                onClick={() => handleFocusOnMap(gf)}
                                                style={{ flex: 1, height: '30px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                                            >
                                                View Map
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleEdit(gf)}
                                                style={{ flex: 1, height: '30px', background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(gf.id)}
                                                style={{ height: '30px', padding: '0 10px', background: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                                            >
                                                <i className="fa-solid fa-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Leaflet Map Card (Strictly bounded container prevents OOM resize loops) */}
                <div className="glass" style={{ height: '320px', minHeight: '320px', position: 'relative', borderRadius: '12px', overflow: 'hidden' }}>
                    <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '10px',
                        left: '10px',
                        zIndex: 1000,
                        background: 'var(--bg-glass, #ffffff)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-glass, #e2e8f0)',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        boxShadow: 'var(--shadow-md)',
                        pointerEvents: 'none'
                    }}>
                        {activeTab === 'HOUSES' ? '🏠 Viewing Employee Residences' : '📍 Viewing Work & Office Sites'}
                    </div>
                </div>

                {/* Legend Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', padding: '0 4px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: activeTab === 'HOUSES' ? '#8b5cf6' : '#2563eb' }}></span>
                        {activeTab === 'HOUSES' ? 'Employee Residence' : 'Work Geofence'}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f97316' }}></span>
                        Active Selection / Preview
                    </span>
                </div>
            </div>

            {/* Right Column: Add/Edit Form */}
            <div className="glass" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px', height: 'fit-content' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {editingId ? `Edit ${activeTab === 'HOUSES' ? 'House' : 'Site'} Geofence` : `Add ${activeTab === 'HOUSES' ? 'Employee House Geofence' : 'Office Geofence'}`}
                    </h3>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {activeTab === 'HOUSES' 
                        ? 'Define an employee residence boundary for off-duty rest tracking.' 
                        : 'Define the boundary inside which employees can register work attendance.'}
                </p>

                {/* Excel Quick Upload Box (Only for Work Sites) */}
                {activeTab === 'SITES' && (
                    <div 
                        onClick={() => fileInputRef.current && fileInputRef.current.click()}
                        style={{
                            border: '2px dashed var(--border-glass, #334155)',
                            borderRadius: '10px',
                            padding: '12px',
                            textAlign: 'center',
                            background: 'rgba(255,255,255,0.02)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '4px'
                        }}
                    >
                        <div style={{ fontSize: '20px', color: '#10b981' }}>
                            <i className="fa-solid fa-file-excel"></i>
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
                            Have an Excel file with multiple sites?
                        </div>
                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                            Click to bulk upload <b>.xlsx, .xls, or .csv</b>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '2px' }}>
                    
                    {/* Employee Selector for House Geofences */}
                    {activeTab === 'HOUSES' && (
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Link to Employee
                            </label>
                            <select
                                value={selectedEmployeeId}
                                onChange={(e) => {
                                    const empId = e.target.value;
                                    setSelectedEmployeeId(empId);
                                    if (empId && !name) {
                                        const emp = (employees || []).find(x => String(x.id) === String(empId) || String(x.empCode) === String(empId));
                                        if (emp) setName(`${emp.name} House`);
                                    }
                                }}
                                style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                            >
                                <option value="">-- Select Employee (Optional) --</option>
                                {(employees || []).map(emp => (
                                    <option key={emp.id} value={emp.empCode || emp.id}>
                                        {emp.name} ({emp.empCode || emp.id})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {activeTab === 'HOUSES' ? 'House / Residence Name' : 'Geofence Name'}
                        </label>
                        <input 
                            type="text" 
                            placeholder={activeTab === 'HOUSES' ? "e.g. Mandeep Singh House" : "e.g. Headquarters, Noida Branch"}
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            style={{ padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                        />
                    </div>

                    <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Latitude</label>
                            <input 
                                type="number" 
                                step="any" 
                                required
                                placeholder="e.g. 31.781619"
                                value={latitude}
                                onChange={(e) => setLatitude(e.target.value)}
                                style={{ padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                            />
                        </div>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Longitude</label>
                            <input 
                                type="number" 
                                step="any" 
                                required
                                placeholder="e.g. 74.801195"
                                value={longitude}
                                onChange={(e) => setLongitude(e.target.value)}
                                style={{ padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                            />
                        </div>
                    </div>

                    <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Radius (meters) {activeTab === 'HOUSES' && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>(Standard: 30m)</span>}
                        </label>
                        <input 
                            type="number" 
                            step="any" 
                            required
                            placeholder={activeTab === 'HOUSES' ? "30" : "200"}
                            value={radius}
                            onChange={(e) => setRadius(e.target.value)}
                            style={{ padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                        />
                    </div>

                    <button 
                        type="button" 
                        className="btn btn-outline" 
                        onClick={handleUseMyLocation}
                        disabled={locating}
                        style={{ alignSelf: 'flex-start', margin: 0, padding: '7px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        {locating ? (
                            <><i className="fa-solid fa-spinner fa-spin"></i> Locating...</>
                        ) : (
                            <><i className="fa-solid fa-location-crosshairs"></i> Use Current Location</>
                        )}
                    </button>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                        <button type="submit" className="btn btn-primary" style={{ flex: 1, margin: 0, height: '36px', fontSize: '0.85rem' }}>
                            {editingId ? 'Save Changes' : (activeTab === 'HOUSES' ? 'Add House Geofence' : 'Add Office Geofence')}
                        </button>
                        {editingId && (
                            <button type="button" className="btn btn-outline" onClick={resetForm} style={{ flex: 1, margin: 0, height: '36px', fontSize: '0.85rem' }}>
                                Cancel
                            </button>
                        )}
                    </div>
                </form>

                {successMsg && (
                    <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <i className="fa-solid fa-circle-check"></i> {successMsg}
                    </div>
                )}

                {errorMsg && (
                    <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <i className="fa-solid fa-circle-exclamation"></i> {errorMsg}
                    </div>
                )}
            </div>

            {/* Bulk Upload Modal */}
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
                    justifyContent: 'center',
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
                        <div style={{
                            padding: '18px 22px',
                            borderBottom: '1px solid var(--border-glass, #1e293b)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    <i className="fa-solid fa-file-excel" style={{ color: '#10b981', marginRight: '8px' }}></i>
                                    Preview Sites from Excel ({parsedSites.filter(s => s.isValid).length} Valid Sites)
                                </h3>
                                <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#64748b' }}>
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

                        <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                                        <th style={{ padding: '8px' }}>#</th>
                                        <th style={{ padding: '8px' }}>Site Name</th>
                                        <th style={{ padding: '8px' }}>Latitude</th>
                                        <th style={{ padding: '8px' }}>Longitude</th>
                                        <th style={{ padding: '8px' }}>Radius</th>
                                        <th style={{ padding: '8px' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parsedSites.map((site) => (
                                        <tr key={site.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '8px', color: '#64748b' }}>{site.id}</td>
                                            <td style={{ padding: '8px', fontWeight: 600 }}>{site.name}</td>
                                            <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                                                {site.latitude !== null ? site.latitude : <span style={{ color: '#ef4444' }}>Missing</span>}
                                            </td>
                                            <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                                                {site.longitude !== null ? site.longitude : <span style={{ color: '#ef4444' }}>Missing</span>}
                                            </td>
                                            <td style={{ padding: '8px' }}>{site.radius}m</td>
                                            <td style={{ padding: '8px' }}>
                                                {site.isValid ? (
                                                    <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e', fontSize: '10.5px', fontWeight: 700 }}>
                                                        Ready ✅
                                                    </span>
                                                ) : (
                                                    <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', fontSize: '10.5px', fontWeight: 700 }}>
                                                        Invalid ❌
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div style={{
                            padding: '14px 20px',
                            borderTop: '1px solid var(--border-glass, #1e293b)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: 'rgba(0,0,0,0.2)'
                        }}>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                                Non-valid sites will be skipped automatically during import.
                            </span>

                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button 
                                    className="btn btn-outline" 
                                    onClick={() => setShowUploadModal(false)}
                                    disabled={importing}
                                    style={{ margin: 0, padding: '6px 14px', fontSize: '12px' }}
                                >
                                    Cancel
                                </button>

                                <button 
                                    className="btn btn-primary" 
                                    onClick={handleConfirmBulkImport}
                                    disabled={importing || parsedSites.filter(s => s.isValid).length === 0}
                                    style={{ margin: 0, padding: '6px 16px', fontSize: '12px', background: '#10b981', borderColor: '#10b981' }}
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
