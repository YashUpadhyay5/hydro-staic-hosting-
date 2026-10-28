import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { formatDate, getFullUrl, forceDownload, isActiveEmployee } from '../../utils/helpers';

export default function DocumentsView({ employees, adminUser }) {
    const [title, setTitle] = useState('');
    const [target, setTarget] = useState('ALL');
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    
    const userIdParam = adminUser && adminUser.role !== 'ADMIN' ? (adminUser.id || adminUser._id) : undefined;
    const cacheEndpoint = userIdParam ? `/hrms-documents?userId=${userIdParam}` : '/hrms-documents';
    const cachedDocs = api.getCached(cacheEndpoint);
    const [docs, setDocs] = useState(() => Array.isArray(cachedDocs) ? cachedDocs : []);
    const [tab, setTab] = useState('all'); // 'all', 'employees', or 'admin'
    const [loading, setLoading] = useState(() => !cachedDocs);
    const [error, setError] = useState(false);
    const [modalDoc, setModalDoc] = useState(null); // State for document modal

    // Collapsible & Filter States
    const [showUploadForm, setShowUploadForm] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;
    const [isZipping, setIsZipping] = useState(false);

    const fetchDocuments = async () => {
        if (!docs.length) setLoading(true);
        try {
            const userIdParam = adminUser && adminUser.role !== 'ADMIN' ? (adminUser.id || adminUser._id) : undefined;
            const data = await api.getDocuments(userIdParam);
            setDocs(data);
        } catch (err) {
            console.error(err);
            setError(true);
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadZip = async () => {
        if (!filtered || !filtered.length) {
            alert('No documents available to download.');
            return;
        }
        try {
            setIsZipping(true);
            const docIds = filtered.map(d => d.id);
            const userIdParam = adminUser && adminUser.role !== 'ADMIN' ? (adminUser.id || adminUser._id) : undefined;
            await api.downloadDocumentsZip(userIdParam, docIds);
        } catch (err) {
            console.error('ZIP download error:', err);
            alert('Failed to generate ZIP: ' + (err.message || 'Error'));
        } finally {
            setIsZipping(false);
        }
    };

    useEffect(() => {
        fetchDocuments();
    }, []);

    // Reset pagination when search, filter or tab changes
    useEffect(() => {
        setCurrentPage(1);
    }, [tab, searchQuery, fromDate, toDate]);

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!file) return alert('Please select a file');

        // Validation: Only allow image and PDF files for uploads
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            return alert('Only Image files (JPEG, PNG, GIF, WEBP) and PDFs are allowed to be shared.');
        }

        const isEmployee = adminUser && adminUser.role !== 'ADMIN';
        const formData = new FormData();
        formData.append('title', title);
        formData.append('uploaderId', isEmployee ? (adminUser.id || adminUser._id) : 'admin');
        formData.append('uploaderName', adminUser?.name || 'User');
        
        if (isEmployee) {
            formData.append('targetType', 'ADMIN');
        } else {
            if (target === 'ALL') {
                formData.append('targetType', 'ALL');
            } else {
                formData.append('targetType', 'INDIVIDUAL');
                formData.append('targetUserId', target);
                const emp = employees.find(e => e.id === target);
                formData.append('targetUserName', emp ? emp.name : '');
            }
        }

        formData.append('file', file);

        setUploading(true);
        try {
            await api.uploadDocument(formData);
            alert('Document uploaded successfully!');
            setTitle('');
            setTarget(isEmployee ? 'ADMIN' : 'ALL');
            setFile(null);
            e.target.reset();
            setShowUploadForm(false); // Auto close on success
            fetchDocuments();
        } catch (err) {
            alert('Upload failed: ' + err.message);
        } finally {
            setUploading(false);
        }
    };

    // 1. Tab filtering
    let filtered = docs.filter(doc => {
        if (tab === 'employees') return doc.uploaderId !== 'admin';
        if (tab === 'admin') return doc.uploaderId === 'admin';
        return true; // 'all'
    });

    // 2. Date Range filtering (using doc.uploadedAt)
    if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        filtered = filtered.filter(doc => {
            if (!doc.uploadedAt) return false;
            const docDate = new Date(doc.uploadedAt);
            if (isNaN(docDate.getTime()) && !isNaN(Number(doc.uploadedAt))) {
                return new Date(Number(doc.uploadedAt)) >= from;
            }
            return docDate >= from;
        });
    }
    if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        filtered = filtered.filter(doc => {
            if (!doc.uploadedAt) return false;
            const docDate = new Date(doc.uploadedAt);
            if (isNaN(docDate.getTime()) && !isNaN(Number(doc.uploadedAt))) {
                return new Date(Number(doc.uploadedAt)) <= to;
            }
            return docDate <= to;
        });
    }

    // 3. Search query filtering (by Employee Name or Document Title)
    if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(doc => {
            const titleMatch = doc.title && doc.title.toLowerCase().includes(query);
            const uploaderMatch = doc.uploaderName && doc.uploaderName.toLowerCase().includes(query);
            const targetUserMatch = doc.targetUserName && doc.targetUserName.toLowerCase().includes(query);
            return titleMatch || uploaderMatch || targetUserMatch;
        });
    }

    // 4. Paginate
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginatedDocs = filtered.slice(startIndex, endIndex);

    return (
        <div id="documents-view" className="view active" style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
            
            {/* Header with Share Document + Toggle */}
            <div className="glass" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <h3 style={{ margin: 0 }}>Document Repository</h3>
                <button 
                    className="btn btn-primary"
                    onClick={() => setShowUploadForm(!showUploadForm)}
                    style={{ 
                        borderRadius: '50%', 
                        width: '40px', 
                        height: '40px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontSize: '22px', 
                        lineHeight: 0,
                        padding: 0,
                        transition: 'transform 0.2s ease-in-out',
                        transform: showUploadForm ? 'rotate(45deg)' : 'rotate(0deg)'
                    }}
                    title={showUploadForm ? "Close Form" : "Share a Document"}
                >
                    +
                </button>
            </div>

            {/* Collapsible Share Document Form */}
            {showUploadForm && (
                <div className="glass" style={{ padding: '20px' }}>
                    <h3 style={{ marginBottom: '15px' }}>Share a Document</h3>
                    <form id="upload-doc-form" onSubmit={handleUpload}>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Document Title</label>
                                <input 
                                    type="text" 
                                    required
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                />
                            </div>
                            {(!adminUser || adminUser.role === 'ADMIN') && (
                                <div className="form-group">
                                    <label>Target Audience</label>
                                    <select 
                                        value={target}
                                        onChange={(e) => setTarget(e.target.value)}
                                        required
                                    >
                                        <option value="ALL">All Employees</option>
                                        {employees.filter(isActiveEmployee).map(emp => (
                                            <option key={emp.id} value={emp.id}>{emp.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>File (PDF, Image Only) - Max 25MB</label>
                                <input 
                                    type="file" 
                                    required
                                    accept="image/*,application/pdf"
                                    onChange={(e) => setFile(e.target.files[0])}
                                />
                            </div>
                            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                                <button type="submit" className="btn btn-primary" id="btn-upload-doc" disabled={uploading}>
                                    {uploading ? 'Uploading...' : 'Upload Document'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            )}

            {/* Toolbar: Tabs, Date Range & Search Input */}
            <div className="glass" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <button 
                        className={`btn ${tab === 'all' ? 'btn-primary' : ''}`}
                        onClick={() => setTab('all')}
                        style={{ height: '38px', padding: '0 16px', borderRadius: '6px', fontSize: '0.875rem', background: tab !== 'all' ? 'var(--input-bg, #f3f4f6)' : undefined, color: tab !== 'all' ? 'var(--text-primary, #374151)' : undefined }}
                    >
                        All Documents
                    </button>
                    <button 
                        className={`btn ${tab === 'employees' ? 'btn-primary' : ''}`}
                        onClick={() => setTab('employees')}
                        style={{ height: '38px', padding: '0 16px', borderRadius: '6px', fontSize: '0.875rem', background: tab !== 'employees' ? 'var(--input-bg, #f3f4f6)' : undefined, color: tab !== 'employees' ? 'var(--text-primary, #374151)' : undefined }}
                    >
                        Employee Uploads
                    </button>
                    <button 
                        className={`btn ${tab === 'admin' ? 'btn-primary' : ''}`}
                        onClick={() => setTab('admin')}
                        style={{ height: '38px', padding: '0 16px', borderRadius: '6px', fontSize: '0.875rem', background: tab !== 'admin' ? 'var(--input-bg, #f3f4f6)' : undefined, color: tab !== 'admin' ? 'var(--text-primary, #374151)' : undefined }}
                    >
                        Admin Shared
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#4b5563' }}>From Date</span>
                            <input 
                                type="date" 
                                value={fromDate} 
                                onChange={(e) => setFromDate(e.target.value)}
                                style={{
                                    height: '38px',
                                    padding: '0 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #e5e7eb',
                                    fontSize: '0.9rem',
                                    outline: 'none',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#4b5563' }}>To Date</span>
                            <input 
                                type="date" 
                                value={toDate} 
                                onChange={(e) => setToDate(e.target.value)}
                                style={{
                                    height: '38px',
                                    padding: '0 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #e5e7eb',
                                    fontSize: '0.9rem',
                                    outline: 'none',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                        {(fromDate || toDate) && (
                            <button 
                                className="btn"
                                onClick={() => { setFromDate(''); setToDate(''); }}
                                style={{ background: '#ef4444', color: 'white', padding: '0 12px', borderRadius: '6px', cursor: 'pointer', height: '38px', display: 'flex', alignItems: 'center' }}
                            >
                                Clear Range
                            </button>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ margin: 0, minWidth: '280px' }}>
                        <input 
                            type="text" 
                            placeholder="Search by Employee or Title..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{
                                width: '100%',
                                height: '38px',
                                padding: '0 16px',
                                borderRadius: '8px',
                                border: '1px solid #e5e7eb',
                                fontSize: '0.95rem',
                                outline: 'none',
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>
                    <button
                        type="button"
                        className="btn btn-outline"
                        onClick={handleDownloadZip}
                        disabled={isZipping || !filtered.length}
                        style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, background: '#f8fafc', borderColor: '#cbd5e1' }}
                        title="Download all filtered documents in a single high-compression ZIP stream"
                    >
                        <i className={`fa-solid ${isZipping ? 'fa-spinner fa-spin' : 'fa-file-zipper'}`}></i>
                        {isZipping ? 'Compressing ZIP...' : 'Download ZIP'}
                    </button>
                </div>
            </div>

            <div className="table-container glass custom-scrollbar" style={{ padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', borderRadius: '16px' }}>
                <table id="documents-table">
                    <thead>
                        <tr>
                            <th>Uploaded At</th>
                            <th>Title</th>
                            <th>Uploader</th>
                            <th>Shared With</th>
                            <th>File Type</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="6" style={{ padding: "40px 0" }}><LoadingSpinner message="Accessing Document Vault..." minHeight="180px" /></td></tr>
                        ) : error ? (
                            <tr><td colSpan="6" className="error-text">Failed to load documents</td></tr>
                        ) : paginatedDocs.length === 0 ? (
                            <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>No documents found.</td></tr>
                        ) : (
                            paginatedDocs.map(doc => (
                                <tr key={doc.id}>
                                    <td>{formatDate(doc.uploadedAt, true)}</td>
                                    <td>{doc.title}</td>
                                    <td>{doc.uploaderName}</td>
                                    <td>{doc.targetType === 'ALL' ? 'All Employees' : doc.targetUserName || '-'}</td>
                                    <td>{doc.fileType ? doc.fileType.toUpperCase() : 'UNKNOWN'}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button 
                                                onClick={() => setModalDoc(doc)} 
                                                className="btn btn-primary" 
                                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                                title="Open"
                                            >
                                                Open
                                            </button>
                                            <button 
                                                onClick={() => forceDownload(doc.cloudinaryUrl || getFullUrl(doc.filePath), `document_${doc.id}`)} 
                                                className="btn btn-outline" 
                                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                                title="Download"
                                            >
                                                <i className="fa-solid fa-download"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
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

            {modalDoc && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 9999
                    }}
                    onClick={() => setModalDoc(null)}
                >
                    <div 
                        style={{ position: 'relative', width: '90%', height: '90%', backgroundColor: '#f0f0f0', borderRadius: '8px', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <button 
                            onClick={() => setModalDoc(null)}
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
                        {['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(modalDoc.fileType?.toLowerCase()) ? (
                            <img loading="lazy" 
                                src={modalDoc.cloudinaryUrl || getFullUrl(modalDoc.filePath)} 
                                alt="Document" 
                                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} 
                            />
                        ) : (
                            <iframe 
                                src={modalDoc.cloudinaryUrl || getFullUrl(modalDoc.filePath)} 
                                title="Document Viewer"
                                style={{ width: '100%', height: '100%', border: 'none' }} 
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
