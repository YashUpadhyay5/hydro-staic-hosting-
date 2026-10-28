import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useState, useRef } from 'react';
import { api } from '../../services/api';
import { formatDate, getFullUrl, downloadWithWatermark } from '../../utils/helpers';

export default function MediaView({ employees = [] }) {
    // Helper to resolve up-to-date employee ID (empCode) and Employee Name
    const getEmployeeDisplayInfo = (m) => {
        if (!m) return { empCode: '-', empName: 'Unknown' };
        const emp = (employees || []).find(e => 
            (e.id && String(e.id).toLowerCase() === String(m.userId || '').toLowerCase()) ||
            (e.empCode && String(e.empCode).toLowerCase() === String(m.userId || '').toLowerCase()) ||
            (e.empCode && String(e.empCode).toLowerCase() === String(m.empCode || '').toLowerCase()) ||
            (e.name && String(e.name).toLowerCase() === String(m.userName || '').toLowerCase())
        );
        const empCode = emp?.empCode || m.empCode || m.userId || '-';
        const empName = emp?.name || m.userName || 'Unknown';
        return { empCode, empName };
    };

    const cachedMedia = api.getCached('/media');
    const [media, setMedia] = useState(() => Array.isArray(cachedMedia) ? cachedMedia : []);
    const [clusters, setClusters] = useState(() => api.getCached('/clusters') || []);
    const [clusterRadius, setClusterRadius] = useState(500);
    const [loading, setLoading] = useState(() => !cachedMedia);
    const [error, setError] = useState(false);
    
    // Tab Control
    const [activeTab, setActiveTab] = useState('photos'); // 'photos' or 'clusters'
    
    // Photo Viewer Modal
    const [selectedPhoto, setSelectedPhoto] = useState(null);

    // Search & Filter States
    const [searchQuery, setSearchQuery] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [selectedClusterId, setSelectedClusterId] = useState('');

    // Pagination States
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    // Radius Settings Save Loading
    const [settingsLoading, setSettingsLoading] = useState(false);

    // Cluster Renaming States
    const [editingClusterId, setEditingClusterId] = useState(null);
    const [editingClusterName, setEditingClusterName] = useState('');
    const [renameLoading, setRenameLoading] = useState(false);

    // Map Refs
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const clusterLayersRef = useRef({});

    // Fetch clusters, settings, and media
    const fetchClustersAndSettings = async () => {
        try {
            const [clusterList, settingData] = await Promise.all([
                api.getClusters(),
                api.getClusterSettings()
            ]);
            setClusters(clusterList);
            if (settingData && settingData.clusterRadius) {
                setClusterRadius(settingData.clusterRadius);
            }
        } catch (err) {
            console.error('Error fetching cluster data:', err);
        }
    };

    const fetchMedia = async () => {
        if (!media.length) setLoading(true);
        try {
            // Fetch filtered media by cluster from backend
            const data = await api.getMedia('', selectedClusterId);
            if (Array.isArray(data)) {
                setMedia(data);
                setError(false);
            }
        } catch (err) {
            console.error('Error fetching media:', err);
            if (!media.length) setError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchClustersAndSettings();
    }, []);

    useEffect(() => {
        fetchMedia();
    }, [selectedClusterId]);

    // Reset pagination when filter or search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, fromDate, toDate, selectedClusterId]);

    // Initialize Map for Clusters Visualization
    useEffect(() => {
        if (activeTab === 'clusters' && mapRef.current && !mapInstance.current && window.L) {
            // Default center Delhi / NCR
            mapInstance.current = window.L.map(mapRef.current).setView([28.6692, 77.4538], 11);
            window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_2ae4_1_8e228ec653d025bb97ea2305', {
                attribution: '&copy; OpenStreetMap &copy; CARTO'
            }).addTo(mapInstance.current);
        }

        // Adjust layout after map renders
        if (activeTab === 'clusters' && mapInstance.current) {
            setTimeout(() => {
                mapInstance.current.invalidateSize();
            }, 300);
        }

        return () => {
            if (activeTab !== 'clusters' && mapInstance.current) {
                mapInstance.current.remove();
                mapInstance.current = null;
                clusterLayersRef.current = {};
            }
        };
    }, [activeTab]);

    // Render active clusters on Leaflet Map
    useEffect(() => {
        if (!mapInstance.current || !window.L) return;

        // Clear existing map circles
        Object.keys(clusterLayersRef.current).forEach(id => {
            if (clusterLayersRef.current[id]) {
                mapInstance.current.removeLayer(clusterLayersRef.current[id]);
            }
        });
        clusterLayersRef.current = {};

        // Draw new circles for each cluster
        clusters.forEach(cl => {
            const circle = window.L.circle([cl.centerLatitude, cl.centerLongitude], {
                radius: cl.radius,
                color: '#4f46e5',
                fillColor: '#818cf8',
                fillOpacity: 0.35
            }).addTo(mapInstance.current);

            // Bind premium popup info
            circle.bindPopup(`
                <div style="font-family: sans-serif; font-size: 13px;">
                    <strong style="color: #4f46e5; font-size: 14px;">${cl.name}</strong><br/>
                    <span style="color: var(--text-primary);">Geofence Radius: ${cl.radius}m</span><br/>
                    <span style="color: #10b981; font-weight: 600;">Photos Count: ${cl.media ? cl.media.length : 0}</span>
                </div>
            `);

            clusterLayersRef.current[cl.id] = circle;
        });

        // Fit map bounds if there are clusters
        if (clusters.length > 0) {
            const group = new window.L.featureGroup(Object.values(clusterLayersRef.current));
            mapInstance.current.fitBounds(group.getBounds().pad(0.1));
        }
    }, [clusters, activeTab]);

    // Local filters for search query & date range
    let filteredMedia = media;
    if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        filteredMedia = filteredMedia.filter(m => {
            if (!m.timestamp) return false;
            const mDate = new Date(Number(m.timestamp) || m.timestamp);
            return mDate >= from;
        });
    }
    if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        filteredMedia = filteredMedia.filter(m => {
            if (!m.timestamp) return false;
            const mDate = new Date(Number(m.timestamp) || m.timestamp);
            return mDate <= to;
        });
    }

    if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        filteredMedia = filteredMedia.filter(m => 
            m.userName && m.userName.toLowerCase().includes(query)
        );
    }

    // Paginate Results
    const totalItems = filteredMedia.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginatedMedia = filteredMedia.slice(startIndex, endIndex);

    // Save Settings
    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setSettingsLoading(true);
        try {
            await api.updateClusterSettings(clusterRadius);
            await fetchClustersAndSettings();
            await fetchMedia();
            alert('Dynamic clustering radius updated successfully! Future photo uploads will group based on this radius.');
        } catch (err) {
            console.error(err);
            alert('Failed to update cluster settings.');
        } finally {
            setSettingsLoading(false);
        }
    };

    const handleRenameCluster = async (clusterId) => {
        if (!editingClusterName.trim()) {
            alert('Cluster name cannot be empty.');
            return;
        }
        setRenameLoading(true);
        try {
            await api.updateClusterName(clusterId, editingClusterName);
            setEditingClusterId(null);
            setEditingClusterName('');
            await fetchClustersAndSettings();
            await fetchMedia();
        } catch (err) {
            console.error(err);
            alert('Failed to rename cluster.');
        } finally {
            setRenameLoading(false);
        }
    };

    const focusClusterOnMap = (cl) => {
        if (mapInstance.current) {
            mapInstance.current.setView([cl.centerLatitude, cl.centerLongitude], 14);
            if (clusterLayersRef.current[cl.id]) {
                clusterLayersRef.current[cl.id].openPopup();
            }
        }
    };

    return (
        <div id="media-view" className="view active" style={{ minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', flexShrink: 0 }}>
                <h2>Geotagged Photos & Clusters</h2>
                
                {/* Tab buttons */}
                <div className="tab-btn-group" style={{ margin: 0 }}>
                    <button 
                        className={`tab-btn ${activeTab === 'photos' ? 'active' : ''}`} 
                        onClick={() => setActiveTab('photos')}
                    >
                        <i className="fa-solid fa-images" style={{ marginRight: '6px' }}></i> Photos Gallery
                    </button>
                    <button 
                        className={`tab-btn ${activeTab === 'clusters' ? 'active' : ''}`} 
                        onClick={() => setActiveTab('clusters')}
                    >
                        <i className="fa-solid fa-circle-nodes" style={{ marginRight: '6px' }}></i> Auto-Clustering
                    </button>
                </div>
            </div>

            {activeTab === 'photos' && (
                <>
                    {/* Filters Toolbar */}
                    <div className="glass" style={{ padding: '20px', display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0 }}>
                        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>Filter by Cluster Group</span>
                                    <select
                                        value={selectedClusterId}
                                        onChange={(e) => setSelectedClusterId(e.target.value)}
                                        style={{
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-glass)',
                                            fontSize: '0.9rem',
                                            outline: 'none',
                                            background: 'var(--input-bg)',
                                            color: 'var(--text-primary)',
                                            colorScheme: 'dark',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="" style={{ background: '#1a1a1c', color: '#f9fafb' }}>All Dynamic Clusters</option>
                                        <option value="unassigned" style={{ background: '#1a1a1c', color: '#f9fafb' }}>⚠️ Unassigned / Out of bounds</option>
                                        {clusters.map(cl => (
                                            <option key={cl.id} value={cl.id} style={{ background: '#1a1a1c', color: '#f9fafb' }}>
                                                {cl.name} ({cl.media ? cl.media.length : 0} photos)
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>From Date</span>
                                    <input 
                                        type="date" 
                                        value={fromDate} 
                                        onChange={(e) => setFromDate(e.target.value)}
                                        style={{
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-glass)',
                                            fontSize: '0.9rem',
                                            outline: 'none',
                                            background: 'var(--input-bg)',
                                            color: 'var(--text-primary)',
                                            colorScheme: 'dark'
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>To Date</span>
                                    <input 
                                        type="date" 
                                        value={toDate} 
                                        onChange={(e) => setToDate(e.target.value)}
                                        style={{
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-glass)',
                                            fontSize: '0.9rem',
                                            outline: 'none',
                                            background: 'var(--input-bg)',
                                            color: 'var(--text-primary)',
                                            colorScheme: 'dark'
                                        }}
                                    />
                                </div>
                                {(fromDate || toDate || selectedClusterId) && (
                                    <button 
                                        className="btn"
                                        onClick={() => { setFromDate(''); setToDate(''); setSelectedClusterId(''); }}
                                        style={{ alignSelf: 'flex-end', background: '#ef4444', color: 'white', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', height: '36px' }}
                                    >
                                        Clear Filters
                                    </button>
                                )}
                            </div>

                            <div className="form-group" style={{ margin: 0, minWidth: '240px' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>Employee Search</span>
                                <input 
                                    type="text" 
                                    placeholder="Search by Employee Name or ID..." 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-glass)',
                                        background: 'var(--input-bg)',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.9rem',
                                        outline: 'none',
                                        marginTop: '2px'
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <LoadingSpinner message="Loading Employee Photos & Attachments..." minHeight="280px" />
                    ) : error ? (
                        <p className="error-text">Failed to load media list.</p>
                    ) : paginatedMedia.length === 0 ? (
                        <p>No photos found matching the criteria.</p>
                    ) : (
                        <div className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', paddingRight: '4px' }}>
                            <div id="media-grid-container" className="media-grid">
                                {paginatedMedia.map(m => (
                                    <div key={m.id} className="media-card" style={{ display: 'flex', flexDirection: 'column' }}>
                                        <div style={{ position: 'relative', width: '100%', height: '200px', backgroundColor: 'var(--bg-dark)' }}>
                                            <img loading="lazy" 
                                                src={m.cloudinaryUrl || getFullUrl(m.filePath)} 
                                                alt="Upload" 
                                                onClick={() => setSelectedPhoto(m)}
                                                style={{ cursor: 'pointer', width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                            {/* Dynamic Cluster Badge on Photo Card */}
                                            <span style={{
                                                position: 'absolute',
                                                top: '10px',
                                                left: '10px',
                                                fontSize: '0.75rem',
                                                fontWeight: 700,
                                                padding: '4px 8px',
                                                borderRadius: '12px',
                                                backgroundColor: m.cluster ? 'rgba(79, 70, 229, 0.9)' : 'rgba(107, 114, 128, 0.9)',
                                                color: '#ffffff',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                            }}>
                                                {m.cluster ? m.cluster.name : '⚠️ Unassigned'}
                                            </span>
                                        </div>
                                        <div className="media-card-body" style={{ padding: '12px' }}>
                                            <div className="media-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontWeight: 600 }}>{m.userName}</span>
                                                <button 
                                                    onClick={() => downloadWithWatermark(
                                                        m.cloudinaryUrl || getFullUrl(m.filePath), 
                                                        `geotagged_${m.id}.jpg`, 
                                                        [
                                                            `Uploaded by: ${m.userName}`, 
                                                            `Cluster Group: ${m.cluster ? m.cluster.name : 'Unassigned'}`,
                                                            `Date: ${formatDate(m.timestamp, true)}`, 
                                                            `Location: ${m.address || 'Unknown'}`
                                                        ]
                                                    )} 
                                                    className="btn btn-outline" 
                                                    style={{ padding: '4px 8px', fontSize: '12px' }} 
                                                    title="Download with GPS Data"
                                                >
                                                    <i className="fa-solid fa-download"></i>
                                                </button>
                                            </div>
                                            <div className="media-card-meta" style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                <i className="fa-solid fa-clock"></i> {formatDate(m.timestamp, true)}<br />
                                                <i className="fa-solid fa-location-dot" style={{ marginTop: '4px' }}></i> {m.address || 'Location unknown'}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Pagination */}
                            {totalItems > 0 && (
                                <div className="glass" style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'flex-end',
                                    padding: '14px 24px',
                                    gap: '20px',
                                    fontSize: '0.875rem',
                                    color: 'var(--text-primary)',
                                    marginTop: '10px'
                                }}>
                                    <span>
                                        {startIndex + 1}–{endIndex} of {totalItems}
                                    </span>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button 
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                            style={{
                                                border: '1px solid var(--border-glass)',
                                                background: 'var(--input-bg)',
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
                                                border: '1px solid var(--border-glass)',
                                                background: 'var(--input-bg)',
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
                    )}
                </>
            )}

            {activeTab === 'clusters' && (
                <div className="clustering-grid" style={{ flex: 1, minHeight: 0, overflow: 'hidden', height: '100%' }}>
                    {/* Left side: Cluster details list */}
                    <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', height: '100%' }}>
                        <h3>Dynamically Grouped Clusters</h3>
                        {clusters.length === 0 ? (
                            <p style={{ color: 'var(--text-secondary)' }}>No auto-created photo clusters exist. Upload geotagged photos to dynamically form spatial groups.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto', flex: 1, paddingRight: '5px' }}>
                                {clusters.map(cl => (
                                    <div key={cl.id} style={{
                                        padding: '16px',
                                        borderRadius: '8px',
                                        background: 'var(--input-bg)',
                                        border: '1px solid var(--border-glass)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '10px',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                {editingClusterId === cl.id ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                        <input 
                                                            type="text" 
                                                            value={editingClusterName}
                                                            onChange={(e) => setEditingClusterName(e.target.value)}
                                                            style={{
                                                                padding: '4px 8px',
                                                                borderRadius: '4px',
                                                                border: '1px solid var(--border-glass)',
                                                                background: 'var(--input-bg)',
                                                                color: 'var(--text-primary)',
                                                                fontSize: '0.9rem',
                                                                outline: 'none',
                                                                width: '180px'
                                                            }}
                                                            disabled={renameLoading}
                                                            autoFocus
                                                        />
                                                        <button 
                                                            onClick={() => handleRenameCluster(cl.id)}
                                                            disabled={renameLoading}
                                                            style={{
                                                                background: '#10b981',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                padding: '4px 8px',
                                                                cursor: 'pointer',
                                                                fontSize: '0.8rem'
                                                            }}
                                                        >
                                                            <i className="fa-solid fa-check"></i>
                                                        </button>
                                                        <button 
                                                            onClick={() => { setEditingClusterId(null); setEditingClusterName(''); }}
                                                            disabled={renameLoading}
                                                            style={{
                                                                background: '#ef4444',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                padding: '4px 8px',
                                                                cursor: 'pointer',
                                                                fontSize: '0.8rem'
                                                            }}
                                                        >
                                                            <i className="fa-solid fa-xmark"></i>
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <h4 style={{ margin: 0, fontWeight: 700, color: '#4f46e5' }}>{cl.name}</h4>
                                                        <button 
                                                            onClick={() => { setEditingClusterId(cl.id); setEditingClusterName(cl.name); }}
                                                            style={{
                                                                background: 'none',
                                                                border: 'none',
                                                                color: 'var(--text-secondary)',
                                                                cursor: 'pointer',
                                                                fontSize: '0.85rem',
                                                                padding: '2px 4px'
                                                            }}
                                                            title="Rename Cluster"
                                                        >
                                                            <i className="fa-solid fa-pen-to-square"></i>
                                                        </button>
                                                    </div>
                                                )}
                                                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                    Center: {cl.centerLatitude.toFixed(5)}, {cl.centerLongitude.toFixed(5)} <br/>
                                                    Radius Bounds: {cl.radius}m
                                                </p>
                                            </div>
                                            <button 
                                                onClick={() => focusClusterOnMap(cl)}
                                                className="btn btn-outline"
                                                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                            >
                                                <i className="fa-solid fa-crosshairs"></i> Focus Map
                                            </button>
                                        </div>
                                        
                                        {/* Mini photos thumbnails list within the cluster */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', borderTop: '1px solid var(--border-glass)', paddingTop: '8px' }}>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                Grouped Uploads ({cl.media ? cl.media.length : 0}):
                                            </span>
                                            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                                                {cl.media && cl.media.map(m => (
                                                    <img loading="lazy" 
                                                        key={m.id}
                                                        src={m.cloudinaryUrl || getFullUrl(m.filePath)}
                                                        alt="Thumb"
                                                        style={{ width: '45px', height: '45px', borderRadius: '4px', objectFit: 'cover', border: '1px solid var(--border-glass)', cursor: 'pointer' }}
                                                        onClick={() => setSelectedPhoto(m)}
                                                        title={`Uploaded by ${m.userName}`}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right side: Radius settings form & map circles */}
                    <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', height: '100%' }}>
                        <h3>Configuration & Map Preview</h3>
                        
                        <form onSubmit={handleSaveSettings} className="glass" style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--bg-glass)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        Auto-Clustering Radius: {clusterRadius} meters
                                    </label>
                                </div>
                                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    Control how close photos must be to join an existing group. Larger values merge more photos together.
                                </p>
                                <input 
                                    type="range" 
                                    min="100" 
                                    max="2000" 
                                    step="50" 
                                    value={clusterRadius} 
                                    onChange={(e) => setClusterRadius(parseInt(e.target.value))}
                                    style={{ width: '100%', cursor: 'pointer', marginTop: '6px' }}
                                />
                            </div>

                            <button 
                                type="submit" 
                                className="btn btn-primary" 
                                style={{ height: '38px', fontWeight: 600 }}
                                disabled={settingsLoading}
                            >
                                {settingsLoading ? 'Saving Settings...' : 'Update Clustering radius'}
                            </button>
                        </form>

                        <div style={{ flex: 1, minHeight: '320px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-glass)', position: 'relative' }}>
                            <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />
                        </div>
                    </div>
                </div>
            )}

            {selectedPhoto && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 9999
                    }}
                    onClick={() => setSelectedPhoto(null)}
                >
                    <div 
                        style={{ position: 'relative', width: '90%', maxWidth: '500px', background: 'var(--input-bg)', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <button 
                            onClick={() => setSelectedPhoto(null)}
                            style={{
                                position: 'absolute',
                                top: '10px',
                                right: '15px',
                                background: 'rgba(0,0,0,0.5)',
                                border: 'none',
                                color: 'white',
                                fontSize: '24px',
                                cursor: 'pointer',
                                borderRadius: '50%',
                                width: '36px',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 10
                            }}
                        >
                            &times;
                        </button>
                        
                        <div style={{ position: 'relative', width: '100%', height: '600px', backgroundColor: '#000' }}>
                            <img loading="lazy" 
                                src={selectedPhoto.cloudinaryUrl || getFullUrl(selectedPhoto.filePath)} 
                                alt="Document" 
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                            />
                            
                            <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                                padding: '16px',
                                display: 'flex',
                                flexDirection: 'column',
                                color: '#fff',
                                fontFamily: 'sans-serif',
                                borderBottomLeftRadius: '12px',
                                borderBottomRightRadius: '12px'
                            }}>
                                <div style={{
                                    position: 'absolute',
                                    top: '-25px',
                                    right: '10px',
                                    backgroundColor: 'rgba(0,0,0,0.8)',
                                    padding: '4px 8px',
                                    borderRadius: '6px 6px 0 0',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    color: '#facc15'
                                }}>
                                    <i className="fa-solid fa-location-dot"></i> GPS Map Camera
                                </div>
                                <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '4px' }}>
                                    {selectedPhoto.address ? selectedPhoto.address.split(',')[0] : 'Unknown'} 🇮🇳
                                </div>
                                <div style={{ fontSize: '13px', color: '#e2e8f0', marginBottom: '8px', lineHeight: '1.4' }}>
                                    {selectedPhoto.address || 'Address not available'}
                                </div>
                                <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '4px' }}>
                                    Lat {selectedPhoto.latitude ? parseFloat(selectedPhoto.latitude).toFixed(5) : 'N/A'}° Long {selectedPhoto.longitude ? parseFloat(selectedPhoto.longitude).toFixed(5) : 'N/A'}°
                                </div>
                                <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '4px' }}>
                                    {new Date(Number(selectedPhoto.timestamp)).toLocaleString('en-US', {weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute:'2-digit'})}
                                </div>
                                <div style={{ fontSize: '11px', color: '#facc15', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Uploaded by: {(() => {
                                        const { empCode, empName } = getEmployeeDisplayInfo(selectedPhoto);
                                        return `${empName} (${empCode})`;
                                    })()}</span>
                                    <span>Cluster: {selectedPhoto.cluster ? selectedPhoto.cluster.name : '⚠️ Unassigned'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
