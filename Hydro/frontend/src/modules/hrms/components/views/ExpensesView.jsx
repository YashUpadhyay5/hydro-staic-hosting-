
import LoadingSpinner from '../LoadingSpinner';
import React, { useEffect, useState, useRef } from 'react';
import { api } from '../../services/api';
import { formatDate, getFullUrl, forceDownload, isActiveEmployee } from '../../utils/helpers';

export default function ExpensesView({ employees = [] }) {
    const cachedExpenses = api.getCached('/expenses');
    const [expenses, setExpenses] = useState(() => Array.isArray(cachedExpenses) ? cachedExpenses : []);
    const [tab, setTab] = useState('all'); // 'all', 'approved', 'pending', 'rejected', or 'history'
    const [loading, setLoading] = useState(() => !cachedExpenses);
    const [error, setError] = useState(false);
    const [modalImage, setModalImage] = useState(null); // State for image modal

    // Split-Screen Verification & Edit State
    const [selectedExpense, setSelectedExpense] = useState(null);
    const [editCategory, setEditCategory] = useState('');
    const [editCustomCategory, setEditCustomCategory] = useState('');
    const [editAmount, setEditAmount] = useState('');
    const [editBillDate, setEditBillDate] = useState('');
    const [editSiteName, setEditSiteName] = useState('');
    const [editBillNo, setEditBillNo] = useState('');
    const [editMerchantName, setEditMerchantName] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editStatus, setEditStatus] = useState('pending');
    const [editFile, setEditFile] = useState(null);
    const [saveLoading, setSaveLoading] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(100);
    const [rotation, setRotation] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
    const [baseDimensions, setBaseDimensions] = useState(null);
    const viewerContainerRef = useRef(null);
    const imgRef = useRef(null);

    // Add Expense Modal State
    const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
    const [category, setCategory] = useState('Courier expense');
    const [customCategory, setCustomCategory] = useState('');
    const [amount, setAmount] = useState('');
    const [billDate, setBillDate] = useState('');
    const [siteName, setSiteName] = useState('');
    const [billNo, setBillNo] = useState('');
    const [merchantName, setMerchantName] = useState('');
    const [description, setDescription] = useState('');
    const [invoiceFile, setInvoiceFile] = useState(null);
    const [submitLoading, setSubmitLoading] = useState(false);

    // Search & Filter States
    const [searchQuery, setSearchQuery] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    const fetchExpenses = async () => {
        if (!expenses.length) setLoading(true);
        try {
            const data = await api.getExpenses();
            setExpenses(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load expenses:', err);
            if (!expenses.length) setError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchExpenses();
    }, []);

    // Reset pagination when filter or search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [tab, searchQuery, fromDate, toDate]);

    // Helper to resolve up-to-date employee ID (empCode) and Employee Name
    const getEmployeeDisplayInfo = (exp) => {
        if (!exp) return { empCode: '-', empName: 'Unknown' };
        const emp = (employees || []).find(e => 
            (e.id && String(e.id).toLowerCase() === String(exp.userId || '').toLowerCase()) ||
            (e.empCode && String(e.empCode).toLowerCase() === String(exp.userId || '').toLowerCase()) ||
            (e.empCode && String(e.empCode).toLowerCase() === String(exp.empCode || '').toLowerCase()) ||
            (e.name && String(e.name).toLowerCase() === String(exp.userName || '').toLowerCase())
        );
        const empCode = emp?.empCode || exp.empCode || exp.userId || '-';
        const empName = emp?.name || exp.userName || 'Unknown';
        return { empCode, empName };
    };

    const handleOpenVerification = (exp) => {
        setSelectedExpense(exp);
        const standardCats = ['Courier expense', 'Food expense', 'Goods expense', 'Goods transport', 'Petrol and diesel expense', 'Other expense'];
        const isStandard = standardCats.includes(exp.category);
        setEditCategory(isStandard ? exp.category : 'Other expense');
        setEditCustomCategory(isStandard ? '' : (exp.category || ''));
        setEditAmount(exp.amount !== undefined && exp.amount !== null ? String(exp.amount) : '');
        setEditBillDate(exp.billDate || (exp.createdAt ? new Date(exp.createdAt).toISOString().split('T')[0] : ''));
        setEditSiteName(exp.siteName || '');
        setEditBillNo(exp.billNo || '');
        setEditMerchantName(exp.merchantName || '');
        setEditDescription(exp.description || '');
        setEditStatus(exp.status ? String(exp.status).toLowerCase() : 'pending');
        setEditFile(null);
        setZoomLevel(100);
        setRotation(0);
        setBaseDimensions(null);
        if (viewerContainerRef.current) {
            viewerContainerRef.current.scrollTop = 0;
            viewerContainerRef.current.scrollLeft = 0;
        }
    };

    const handleResetZoom = () => {
        setZoomLevel(100);
        setRotation(0);
        if (viewerContainerRef.current) {
            viewerContainerRef.current.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        }
    };

    const handleMouseDown = (e) => {
        if (e.button !== 0 || !viewerContainerRef.current) return;
        setIsDragging(true);
        setDragStart({
            x: e.clientX,
            y: e.clientY,
            scrollLeft: viewerContainerRef.current.scrollLeft,
            scrollTop: viewerContainerRef.current.scrollTop
        });
    };

    useEffect(() => {
        if (!isDragging) return;
        const handleMouseMove = (e) => {
            if (!viewerContainerRef.current) return;
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            viewerContainerRef.current.scrollLeft = dragStart.scrollLeft - dx;
            viewerContainerRef.current.scrollTop = dragStart.scrollTop - dy;
        };
        const handleMouseUp = () => {
            setIsDragging(false);
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragStart]);

    useEffect(() => {
        const el = viewerContainerRef.current;
        if (!el) return;
        const onWheel = (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 25 : -25;
                setZoomLevel(z => Math.max(50, Math.min(500, z + delta)));
            }
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [selectedExpense]);

    useEffect(() => {
        if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth && !baseDimensions) {
            setBaseDimensions({
                width: imgRef.current.offsetWidth || imgRef.current.naturalWidth,
                height: imgRef.current.offsetHeight || imgRef.current.naturalHeight
            });
        }
    }, [selectedExpense, baseDimensions]);

    const handleSaveVerificationDetails = async (e) => {
        if (e) e.preventDefault();
        if (!selectedExpense) return;

        const finalCat = (editCategory === 'Other expense' || editCategory === 'Other') ? editCustomCategory : editCategory;
        if (!finalCat || !finalCat.trim()) {
            alert('Please specify a category.');
            return;
        }
        const numAmount = parseFloat(editAmount);
        if (isNaN(numAmount) || numAmount <= 0) {
            alert('Please enter a valid amount greater than 0.');
            return;
        }

        setSaveLoading(true);
        try {
            const formData = new FormData();
            formData.append('category', finalCat.trim());
            formData.append('amount', numAmount);
            formData.append('billDate', editBillDate || '');
            formData.append('siteName', editSiteName || '');
            formData.append('billNo', editBillNo || '');
            formData.append('merchantName', editMerchantName || '');
            formData.append('description', editDescription || '');
            const adminName = getCurrentAdminName();
            formData.append('status', editStatus);
            if (editStatus === 'approved' || editStatus === 'rejected') {
                formData.append('actionBy', adminName);
            }
            if (editFile) {
                formData.append('file', editFile);
            }

            await api.updateExpense(selectedExpense.id, formData);
            window.dispatchEvent(new CustomEvent('hrms-badge-sync'));

            // Toast feedback
            const toast = document.createElement('div');
            toast.style.position = 'fixed';
            toast.style.bottom = '24px';
            toast.style.right = '24px';
            toast.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            toast.style.color = '#ffffff';
            toast.style.padding = '14px 24px';
            toast.style.borderRadius = '10px';
            toast.style.fontWeight = '600';
            toast.style.fontSize = '14px';
            toast.style.boxShadow = '0 10px 25px rgba(16, 185, 129, 0.4)';
            toast.style.zIndex = '99999';
            toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> Expense details verified & saved successfully!`;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.4s ease';
                setTimeout(() => toast.remove(), 400);
            }, 3000);

            // Return back to expenses list & refresh
            setSelectedExpense(null);
            fetchExpenses();
        } catch (err) {
            alert('Failed to save expense details: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaveLoading(false);
        }
    };

    // Helper to get current acting admin name
    const getCurrentAdminName = () => {
        try {
            const raw = localStorage.getItem('adminUser');
            if (raw) {
                const admin = JSON.parse(raw);
                if (admin.name && admin.name.trim()) return admin.name.trim();
                if (admin.empCode && admin.empCode.trim()) return admin.empCode.trim();
                if (admin.email && admin.email.trim()) return admin.email.split('@')[0];
            }
            const username = localStorage.getItem('username');
            if (username && username.trim()) return username.trim();
        } catch (e) {}
        return 'Admin';
    };

    const handleUpdateStatus = async (id, status) => {
        if (!confirm(`Are you sure you want to ${status} this expense?`)) return;
        const adminName = getCurrentAdminName();
        setExpenses(prev => prev.map(exp => exp.id === id ? { ...exp, status, actionBy: adminName } : exp));
        try {
            await api.updateExpenseStatus(id, status, adminName);
            window.dispatchEvent(new CustomEvent('hrms-badge-sync'));
            fetchExpenses();
        } catch (err) {
            alert('Failed to update expense status: ' + err.message);
            fetchExpenses();
        }
    };

    const handleAddExpenseSubmit = async (e) => {
        e.preventDefault();
        if (!selectedEmployeeId) {
            return alert('Please select an employee.');
        }
        const finalCategory = (category === 'Other expense' || category === 'Other') ? customCategory : category;
        if (!finalCategory || !finalCategory.trim()) {
            return alert('Please specify a category.');
        }
        if (!amount || parseFloat(amount) <= 0) {
            return alert('Please enter a valid amount greater than 0.');
        }
        if (!invoiceFile) {
            return alert('Please attach an invoice file.');
        }

        setSubmitLoading(true);
        try {
            const emp = employees.find(e => String(e.id || e._id) === String(selectedEmployeeId) || String(e.empCode) === String(selectedEmployeeId));
            const formData = new FormData();
            formData.append('userId', emp?.empCode || selectedEmployeeId);
            formData.append('userName', emp ? emp.name : '');
            formData.append('category', finalCategory.trim());
            formData.append('amount', parseFloat(amount));
            formData.append('billDate', billDate ? billDate.trim() : '');
            formData.append('siteName', siteName ? siteName.trim() : '');
            formData.append('billNo', billNo ? billNo.trim() : '');
            formData.append('merchantName', merchantName ? merchantName.trim() : '');
            formData.append('description', description.trim());
            formData.append('file', invoiceFile);

            await api.createExpense(formData);
            alert('Expense claim created successfully!');
            
            // Reset form
            setSelectedEmployeeId('');
            setCategory('Courier expense');
            setCustomCategory('');
            setAmount('');
            setBillDate('');
            setSiteName('');
            setBillNo('');
            setMerchantName('');
            setDescription('');
            setInvoiceFile(null);
            setShowAddExpenseModal(false);
            
            // Refresh list
            window.dispatchEvent(new CustomEvent('hrms-badge-sync'));
            fetchExpenses();
        } catch (err) {
            alert('Failed to upload expense: ' + (err.response?.data?.error || err.message));
        } finally {
            setSubmitLoading(false);
        }
    };

    // 1. Calculate Status Counts
    const allCount = expenses.length;
    const approvedCount = expenses.filter(e => String(e.status || '').toLowerCase().trim() === 'approved').length;
    const pendingCount = expenses.filter(e => String(e.status || '').toLowerCase().trim() === 'pending').length;
    const rejectedCount = expenses.filter(e => String(e.status || '').toLowerCase().trim() === 'rejected').length;

    // 2. Status Tab Filter (Case-Insensitive & Comprehensive)
    let filtered = expenses.filter(exp => {
        const s = String(exp.status || '').toLowerCase().trim();
        if (tab === 'all') return true;
        if (tab === 'approved') return s === 'approved';
        if (tab === 'pending') return s === 'pending';
        if (tab === 'rejected') return s === 'rejected';
        if (tab === 'history') return s !== 'pending';
        return true;
    });

    // 3. Date Range Filter (checking against exp.createdAt)
    if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        filtered = filtered.filter(exp => {
            if (!exp.createdAt) return false;
            const expDate = new Date(exp.createdAt);
            if (isNaN(expDate.getTime()) && !isNaN(Number(exp.createdAt))) {
                return new Date(Number(exp.createdAt)) >= from;
            }
            return expDate >= from;
        });
    }
    if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        filtered = filtered.filter(exp => {
            if (!exp.createdAt) return false;
            const expDate = new Date(exp.createdAt);
            if (isNaN(expDate.getTime()) && !isNaN(Number(exp.createdAt))) {
                return new Date(Number(exp.createdAt)) <= to;
            }
            return expDate <= to;
        });
    }

    // 4. Search Query Filter (by employee username or category)
    if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(exp => {
            const nameMatch = exp.userName && exp.userName.toLowerCase().includes(query);
            const categoryMatch = exp.category && exp.category.toLowerCase().includes(query);
            return nameMatch || categoryMatch;
        });
    }

    // 5. Paginate
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginatedExpenses = filtered.slice(startIndex, endIndex);

    const handleExportToExcel = async () => {
        if (!filtered || filtered.length === 0) {
            alert('No expense records found to export for the selected filters.');
            return;
        }

        try {
            // Dynamic import — ExcelJS (1.3 MB) only loads when user clicks Export
            const { default: ExcelJS } = await import('exceljs');
            const workbook = new ExcelJS.Workbook();
            const createExpenseWorksheet = (sheetTitle, items, summaryLabel) => {
                const ws = workbook.addWorksheet(sheetTitle);

                // Define Columns with requested layout:
                // 1. S.No. -> 2. Submitted By -> 3. Employee ID -> 4. Expense Date -> 5. Category -> 6. Description -> 7. Amount -> 8. Bill No -> 9. Actual Bill Date -> 10. Site Name -> 11. Merchant -> 12. Status -> 13. Invoice Link
                ws.columns = [
                    { header: 'S.No.', key: 'sno', width: 8 },
                    { header: 'Submitted By', key: 'userName', width: 22 },
                    { header: 'Employee ID', key: 'userId', width: 14 },
                    { header: 'Expense Date', key: 'submissionDate', width: 20 },
                    { header: 'Category', key: 'category', width: 20 },
                    { header: 'Description', key: 'description', width: 32 },
                    { header: 'Amount (₹)', key: 'amount', width: 16 },
                    { header: 'Bill Number', key: 'billNo', width: 18 },
                    { header: 'Actual Bill Date', key: 'billDate', width: 16 },
                    { header: 'Site Name', key: 'siteName', width: 22 },
                    { header: 'Merchant / Vendor Name', key: 'merchantName', width: 25 },
                    { header: 'Status', key: 'status', width: 14 },
                    { header: 'Invoice Attachment Link', key: 'invoiceUrl', width: 45 }
                ];

                // 1. Format Header Row: Bold text, dark professional background, center aligned
                const headerRow = ws.getRow(1);
                headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
                headerRow.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF1E293B' }
                };
                headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                headerRow.height = 28;

                // 2. Add Data Rows
                items.forEach((exp, index) => {
                    const subDate = exp.createdAt ? new Date(exp.createdAt).toLocaleDateString('en-GB') : '-';
                    const subTime = exp.createdAt ? new Date(exp.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const fullSubDate = exp.createdAt ? `${subDate} ${subTime}`.trim() : '-';
                    const bDate = exp.billDate ? (exp.billDate.includes('T') ? new Date(exp.billDate).toLocaleDateString('en-GB') : exp.billDate) : '-';
                    const invoiceUrl = exp.cloudinaryUrl || (exp.invoiceUrl ? getFullUrl(exp.invoiceUrl) : '-');
                    const { empCode, empName } = getEmployeeDisplayInfo(exp);

                    const row = ws.addRow({
                        sno: index + 1,
                        userName: empName,
                        userId: empCode,
                        submissionDate: fullSubDate,
                        category: exp.category || 'General',
                        description: exp.description || '-',
                        amount: Number(exp.amount || 0),
                        billNo: exp.billNo || '-',
                        billDate: bDate,
                        siteName: exp.siteName || '-',
                        merchantName: exp.merchantName || '-',
                        status: String(exp.status || 'PENDING').toUpperCase(),
                        invoiceUrl: invoiceUrl
                    });

                    row.alignment = { vertical: 'middle' };
                    row.height = 22;

                    // Format amount cell as currency number
                    const amountCell = row.getCell('amount');
                    amountCell.numFmt = '#,##0.00';
                });

                // 3. Add Total Summary Row
                const totalAmount = items.reduce((sum, e) => sum + Number(e.amount || 0), 0);
                const totalRow = ws.addRow({
                    sno: '',
                    userName: summaryLabel || 'TOTAL SUMMARY',
                    userId: '',
                    submissionDate: '',
                    category: `Total Claims: ${items.length}`,
                    description: '',
                    amount: totalAmount,
                    billNo: '',
                    billDate: '',
                    siteName: '',
                    merchantName: '',
                    status: '',
                    invoiceUrl: ''
                });

                totalRow.font = { name: 'Calibri', size: 11, bold: true };
                totalRow.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF1F5F9' }
                };
                totalRow.height = 24;
                const totalAmountCell = totalRow.getCell('amount');
                totalAmountCell.numFmt = '#,##0.00';
            };

            // TAB 1: Master Consolidated Sheet with all employees
            createExpenseWorksheet('All_Expenses', filtered, 'ALL EMPLOYEES TOTAL');

            // TABS 2+: Individual Employee Worksheets
            const empGroups = {};
            filtered.forEach(exp => {
                const { empCode, empName } = getEmployeeDisplayInfo(exp);
                const key = String(empCode || empName || 'Unknown').trim();
                if (!empGroups[key]) {
                    empGroups[key] = {
                        userName: empName,
                        userId: empCode,
                        items: []
                    };
                }
                empGroups[key].items.push(exp);
            });

            const usedSheetNames = new Set(['all_expenses']);
            Object.values(empGroups).forEach(group => {
                // Generate clean sheet title (max 31 chars, no forbidden chars: \ / ? * [ ] :)
                const rawTitle = group.userId && group.userId !== '-' ? `${group.userName} (${group.userId})` : group.userName;
                let cleanTitle = rawTitle.replace(/[\\/?*\[\]:]/g, '_').trim();
                if (cleanTitle.length > 31) {
                    cleanTitle = cleanTitle.substring(0, 31).trim();
                }
                if (!cleanTitle) cleanTitle = 'Employee';

                let uniqueTitle = cleanTitle;
                let counter = 1;
                while (usedSheetNames.has(uniqueTitle.toLowerCase())) {
                    const suffix = `_${counter}`;
                    uniqueTitle = cleanTitle.substring(0, 31 - suffix.length) + suffix;
                    counter++;
                }
                usedSheetNames.add(uniqueTitle.toLowerCase());

                createExpenseWorksheet(uniqueTitle, group.items, `${group.userName.toUpperCase()} TOTAL`);
            });

            // 4. Generate filename based on date range or current date
            let filename = 'Expenses_Report';
            if (fromDate && toDate) {
                filename += `_${fromDate}_to_${toDate}`;
            } else if (fromDate) {
                filename += `_from_${fromDate}`;
            } else if (toDate) {
                filename += `_until_${toDate}`;
            } else {
                filename += `_${new Date().toISOString().split('T')[0]}`;
            }
            filename += '.xlsx';

            // 5. Download buffer directly to browser
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
window.URL.revokeObjectURL(downloadUrl);
        } catch (err) {
            console.error('Failed to export expenses to Excel:', err);
            alert('Failed to generate Excel sheet: ' + err.message);
        }
    };

    const isRotated90 = rotation === 90 || rotation === 270;
    const baseW = baseDimensions?.width || 380;
    const baseH = baseDimensions?.height || 550;
    const currentWidth = Math.round((baseW * zoomLevel) / 100);
    const currentHeight = Math.round((baseH * zoomLevel) / 100);

    return (
        <div id="expenses-view" className="view active" style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
            {selectedExpense ? (
                /* ============================================================ */
                /* SPLIT-SCREEN VERIFICATION & EDIT PAGE (50% Image / 50% Edit) */
                /* ============================================================ */
                <div style={{ height: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'hidden' }}>
                    {/* Top Header Bar */}
                    <div className="glass" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, borderRadius: '12px', background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(10px)', border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <button 
                                onClick={() => setSelectedExpense(null)} 
                                className="btn btn-outline" 
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', borderRadius: '8px' }}
                            >
                                <i className="fa-solid fa-arrow-left"></i> Back to Expenses
                            </button>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#1e293b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    Expense Verification & Edit
                                    <span className={`badge-status badge-${String(editStatus || selectedExpense.status || '').toLowerCase()}`}>
                                        {String(editStatus || selectedExpense.status || '').toUpperCase()}
                                    </span>
                                    {selectedExpense.actionBy && String(editStatus || selectedExpense.status || '').toLowerCase() !== 'pending' && (
                                        <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                                            by <strong style={{ color: '#4f46e5' }}>{selectedExpense.actionBy}</strong>
                                        </span>
                                    )}
                                </h3>
                                <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                                    Submitted by <strong style={{ color: '#334155' }}>{getEmployeeDisplayInfo(selectedExpense).empName}</strong> <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, marginLeft: '4px' }}>{getEmployeeDisplayInfo(selectedExpense).empCode}</span> {selectedExpense.createdAt ? `on ${formatDate(selectedExpense.createdAt)}` : ''}
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Status Buttons */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button 
                                type="button" 
                                onClick={() => setEditStatus('approved')}
                                className={`btn ${editStatus === 'approved' ? 'btn-success' : 'btn-outline'}`}
                                style={{ padding: '7px 14px', fontSize: '0.82rem', fontWeight: 600, borderRadius: '8px' }}
                            >
                                <i className="fa-solid fa-check"></i> Approve
                            </button>
                            <button 
                                type="button" 
                                onClick={() => setEditStatus('rejected')}
                                className={`btn ${editStatus === 'rejected' ? 'btn-danger' : 'btn-outline'}`}
                                style={{ padding: '7px 14px', fontSize: '0.82rem', fontWeight: 600, borderRadius: '8px' }}
                            >
                                <i className="fa-solid fa-xmark"></i> Reject
                            </button>
                            <button 
                                type="button" 
                                onClick={() => setEditStatus('pending')}
                                className={`btn ${editStatus === 'pending' ? 'btn-primary' : 'btn-outline'}`}
                                style={{ padding: '7px 14px', fontSize: '0.82rem', fontWeight: 600, borderRadius: '8px' }}
                            >
                                <i className="fa-solid fa-clock"></i> Pending
                            </button>
                        </div>
                    </div>

                    {/* Main Split Screen Container */}
                    <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        
                        {/* LEFT 50%: Document / Receipt Image Viewer */}
                        <div className="glass" style={{ flex: '0 0 calc(50% - 8px)', display: 'flex', flexDirection: 'column', borderRadius: '14px', overflow: 'hidden', border: '1px solid var(--border-glass)', background: 'var(--bg-glass)' }}>
                            {/* Viewer Toolbar */}
                            <div style={{ padding: '10px 16px', background: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <i className="fa-solid fa-file-invoice" style={{ color: '#60a5fa' }}></i> Invoice / Receipt Preview
                                </span>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <button 
                                        type="button" 
                                        className="btn btn-outline" 
                                        style={{ padding: '4px 8px', fontSize: '0.75rem' }} 
                                        onClick={() => setZoomLevel(z => Math.max(50, z - 25))}
                                        disabled={zoomLevel <= 50}
                                        title="Zoom Out (Min: 50%)"
                                    >
                                        <i className="fa-solid fa-magnifying-glass-minus"></i>
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-outline"
                                        onClick={handleResetZoom}
                                        style={{ padding: '4px 8px', fontSize: '0.75rem', fontWeight: 600, color: zoomLevel === 100 ? 'var(--text-muted)' : '#60a5fa', minWidth: '46px', textAlign: 'center', cursor: 'pointer' }}
                                        title="Click to Reset Zoom (100%)"
                                    >
                                        {zoomLevel}%
                                    </button>
                                    <button 
                                        type="button" 
                                        className="btn btn-outline" 
                                        style={{ padding: '4px 8px', fontSize: '0.75rem' }} 
                                        onClick={() => setZoomLevel(z => Math.min(500, z + 25))}
                                        disabled={zoomLevel >= 500}
                                        title="Zoom In (Max: 500%)"
                                    >
                                        <i className="fa-solid fa-magnifying-glass-plus"></i>
                                    </button>
                                    <button 
                                        type="button" 
                                        className="btn btn-outline" 
                                        style={{ padding: '4px 8px', fontSize: '0.75rem' }} 
                                        onClick={handleResetZoom}
                                        title="Reset Zoom & Orientation (100%)"
                                    >
                                        <i className="fa-solid fa-arrows-rotate"></i>
                                    </button>
                                    <button 
                                        type="button" 
                                        className="btn btn-outline" 
                                        style={{ padding: '4px 8px', fontSize: '0.75rem' }} 
                                        onClick={() => setRotation(r => (r + 90) % 360)}
                                        title="Rotate 90°"
                                    >
                                        <i className="fa-solid fa-rotate-right"></i>
                                    </button>
                                    {(selectedExpense.invoiceUrl || selectedExpense.cloudinaryUrl) && (
                                        <>
                                            <a 
                                                href={selectedExpense.cloudinaryUrl || getFullUrl(selectedExpense.invoiceUrl)} 
                                                target="_blank" 
                                                rel="noreferrer" 
                                                className="btn btn-outline" 
                                                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                                                title="Open in Full Window"
                                            >
                                                <i className="fa-solid fa-arrow-up-right-from-square"></i>
                                            </a>
                                            <button 
                                                type="button" 
                                                className="btn btn-outline" 
                                                style={{ padding: '4px 8px', fontSize: '0.75rem' }} 
                                                onClick={() => forceDownload(selectedExpense.cloudinaryUrl || getFullUrl(selectedExpense.invoiceUrl), `invoice_${selectedExpense.id}`)}
                                                title="Download File"
                                            >
                                                <i className="fa-solid fa-download"></i>
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Image Container with Full-Resolution Layout Zoom and Smooth Drag-to-Pan */}
                            <div 
                                ref={viewerContainerRef}
                                onMouseDown={handleMouseDown}
                                style={{ 
                                    flex: 1, 
                                    minHeight: 0, 
                                    overflow: 'auto', 
                                    background: 'var(--bg-dark)', 
                                    padding: '20px', 
                                    position: 'relative',
                                    cursor: isDragging ? 'grabbing' : (zoomLevel > 100 ? 'grab' : 'default'),
                                    userSelect: 'none',
                                    WebkitUserSelect: 'none',
                                }}
                            >
                                {selectedExpense.invoiceUrl || selectedExpense.cloudinaryUrl ? (
                                    <div 
                                        style={{ 
                                            display: 'flex', 
                                            alignItems: 'flex-start', 
                                            justifyContent: 'center', 
                                            minWidth: '100%', 
                                            minHeight: '100%', 
                                            width: 'max-content',
                                            margin: '0 auto',
                                        }}
                                    >
                                        <div 
                                            style={{
                                                minWidth: isRotated90 ? `${currentHeight}px` : `${currentWidth}px`,
                                                minHeight: isRotated90 ? `${currentWidth}px` : `${currentHeight}px`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                transition: isDragging ? 'none' : 'min-width 0.15s ease, min-height 0.15s ease',
                                                position: 'relative',
                                            }}
                                        >
                                            <img 
                                                ref={imgRef}
                                                src={selectedExpense.cloudinaryUrl || getFullUrl(selectedExpense.invoiceUrl)} 
                                                alt="Invoice Bill" 
                                                draggable={false}
                                                onLoad={(e) => {
                                                    const el = e.target;
                                                    if (el) {
                                                        const w = el.offsetWidth || el.naturalWidth || 400;
                                                        const h = el.offsetHeight || el.naturalHeight || 600;
                                                        setBaseDimensions({ width: w, height: h });
                                                    }
                                                }}
                                                style={{ 
                                                    width: zoomLevel === 100 ? 'auto' : `${currentWidth}px`,
                                                    height: zoomLevel === 100 ? 'auto' : `${currentHeight}px`,
                                                    maxWidth: zoomLevel === 100 ? '100%' : 'none',
                                                    maxHeight: zoomLevel === 100 ? '62vh' : 'none',
                                                    objectFit: 'contain',
                                                    borderRadius: '8px', 
                                                    boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                                                    transform: `rotate(${rotation}deg)`,
                                                    transformOrigin: 'center center',
                                                    transition: isDragging ? 'none' : 'transform 0.2s ease, width 0.15s ease, height 0.15s ease',
                                                    imageRendering: 'high-quality',
                                                    WebkitFontSmoothing: 'subpixel-antialiased',
                                                    display: 'block',
                                                    pointerEvents: isDragging ? 'none' : 'auto'
                                                }}
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.src = 'https://via.placeholder.com/600x400?text=Invoice+Image+Not+Available';
                                                }}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                                        <i className="fa-regular fa-image" style={{ fontSize: '3rem', marginBottom: '12px', color: 'var(--text-muted)' }}></i>
                                        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>No Invoice Image Attached</p>
                                        <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Upload or attach a replacement receipt using the form on the right.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* RIGHT 50%: Editable Form */}
                        <div className="glass" style={{ flex: '0 0 calc(50% - 8px)', display: 'flex', flexDirection: 'column', borderRadius: '14px', overflow: 'hidden', border: '1px solid var(--border-glass)', background: 'var(--bg-glass)' }}>
                            <div style={{ padding: '10px 16px', background: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <i className="fa-solid fa-pen-to-square" style={{ color: '#60a5fa' }}></i> Edit Expense Details
                                </span>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                    Modify information & save changes
                                </span>
                            </div>

                            <form onSubmit={handleSaveVerificationDetails} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {/* Employee & Category */}
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Employee Name</label>
                                        <input 
                                            type="text" 
                                            value={selectedExpense.userName || 'Employee'} 
                                            disabled 
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.85rem' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Category *</label>
                                        <select 
                                            value={editCategory} 
                                            onChange={(e) => setEditCategory(e.target.value)}
                                            required
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
                                        >
                                            <option value="Courier expense">Courier expense</option>
                                            <option value="Food expense">Food expense</option>
                                            <option value="Goods expense">Goods expense</option>
                                            <option value="Goods transport">Goods transport</option>
                                            <option value="Petrol and diesel expense">Petrol and diesel expense</option>
                                            <option value="Other expense">Other expense</option>
                                        </select>
                                    </div>
                                </div>

                                {(editCategory === 'Other expense' || editCategory === 'Other') && (
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Specify Custom Category *</label>
                                        <input 
                                            type="text" 
                                            value={editCustomCategory} 
                                            onChange={(e) => setEditCustomCategory(e.target.value)}
                                            placeholder="e.g. Hotel Stay, Client Meeting"
                                            required
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                                        />
                                    </div>
                                )}

                                {/* Amount & Bill Date */}
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Amount (₹) *</label>
                                        <div style={{ position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: 'var(--text-muted)' }}>₹</span>
                                            <input 
                                                type="number" 
                                                step="0.01" 
                                                min="0.01"
                                                value={editAmount} 
                                                onChange={(e) => setEditAmount(e.target.value)}
                                                required
                                                style={{ width: '100%', padding: '8px 12px 8px 28px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', outline: 'none' }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Bill Date</label>
                                        <input 
                                            type="date" 
                                            value={editBillDate} 
                                            onChange={(e) => setEditBillDate(e.target.value)}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
                                        />
                                    </div>
                                </div>

                                {/* Bill No & Merchant Name */}
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Bill / Invoice Number</label>
                                        <input 
                                            type="text" 
                                            value={editBillNo} 
                                            onChange={(e) => setEditBillNo(e.target.value)}
                                            placeholder="e.g. INV-10492"
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Merchant / Vendor Name</label>
                                        <input 
                                            type="text" 
                                            value={editMerchantName} 
                                            onChange={(e) => setEditMerchantName(e.target.value)}
                                            placeholder="e.g. Fuel Station, Restaurant"
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
                                        />
                                    </div>
                                </div>

                                {/* Site Name & Status */}
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Site / Location</label>
                                        <input 
                                            type="text" 
                                            value={editSiteName} 
                                            onChange={(e) => setEditSiteName(e.target.value)}
                                            placeholder="e.g. Head Office / Noida Site"
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Claim Status *</label>
                                        <select 
                                            value={editStatus} 
                                            onChange={(e) => setEditStatus(e.target.value)}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 600, outline: 'none' }}
                                        >
                                            <option value="pending">⏳ Pending Review</option>
                                            <option value="approved">✅ Approved</option>
                                            <option value="rejected">❌ Rejected</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Description */}
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Description / Remarks</label>
                                    <textarea 
                                        value={editDescription} 
                                        onChange={(e) => setEditDescription(e.target.value)}
                                        placeholder="Add verification notes or explanation..."
                                        rows="2"
                                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', resize: 'vertical', outline: 'none' }}
                                    />
                                </div>

                                {/* Replace Attachment */}
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Replace Invoice File (Optional)</label>
                                    <input 
                                        type="file" 
                                        accept="image/*,.pdf" 
                                        onChange={(e) => setEditFile(e.target.files[0] || null)}
                                        style={{ width: '100%', padding: '6px', fontSize: '0.8rem', border: '1px dashed var(--border-glass)', borderRadius: '8px', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                                    />
                                </div>

                                {/* Form Action Buttons */}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid var(--border-glass)' }}>
                                    <button 
                                        type="button" 
                                        className="btn btn-outline" 
                                        onClick={() => setSelectedExpense(null)}
                                        disabled={saveLoading}
                                        style={{ padding: '8px 16px', fontSize: '0.85rem', fontWeight: 600, borderRadius: '8px' }}
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        type="submit" 
                                        className="btn btn-primary"
                                        disabled={saveLoading}
                                        style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: '8px', 
                                            padding: '8px 22px', 
                                            fontSize: '0.88rem', 
                                            fontWeight: 700, 
                                            backgroundColor: '#4f46e5', 
                                            color: 'white', 
                                            border: 'none', 
                                            borderRadius: '8px', 
                                            boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)', 
                                            cursor: saveLoading ? 'not-allowed' : 'pointer' 
                                        }}
                                    >
                                        {saveLoading ? (
                                            <>
                                                <i className="fa-solid fa-spinner fa-spin"></i> Saving...
                                            </>
                                        ) : (
                                            <>
                                                <i className="fa-solid fa-floppy-disk"></i> Save Details
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            ) : (
                /* ============================================================ */
                /* MAIN EXPENSES TABLE LIST VIEW                                */
                /* ============================================================ */
                <>
                    {/* Top Toolbar: Tabs, Date Selectors & Search (Clean Designer UI/UX) */}
                    <div className="glass" style={{ padding: '6px 12px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, borderRadius: '10px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', margin: '0 0 10px 0' }}>
                        {/* Left: Unified Status Tab Group */}
                        <div className="tab-btn-group" style={{ margin: 0, display: 'inline-flex', gap: '3px', background: 'var(--input-bg)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                            <button 
                                type="button" 
                                className={`tab-btn ${tab === 'all' ? 'active' : ''}`} 
                                onClick={() => setTab('all')}
                                style={{ 
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    gap: '5px', 
                                    fontWeight: tab === 'all' ? 700 : 500, 
                                    fontSize: '0.78rem',
                                    padding: '4px 10px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: tab === 'all' ? 'rgba(37, 99, 235, 0.25)' : 'transparent',
                                    color: tab === 'all' ? '#60a5fa' : 'var(--text-muted)',
                                    boxShadow: tab === 'all' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                All Expenses <span style={{ background: tab === 'all' ? 'rgba(37, 99, 235, 0.3)' : 'rgba(255,255,255,0.06)', color: tab === 'all' ? '#60a5fa' : 'var(--text-secondary)', borderRadius: '8px', padding: '1px 5px', fontSize: '10.5px', fontWeight: 700 }}>{allCount}</span>
                            </button>
                            <button 
                                type="button" 
                                className={`tab-btn ${tab === 'approved' ? 'active' : ''}`} 
                                onClick={() => setTab('approved')}
                                style={{ 
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    gap: '5px', 
                                    fontWeight: tab === 'approved' ? 700 : 500, 
                                    fontSize: '0.78rem',
                                    padding: '4px 10px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: tab === 'approved' ? 'rgba(34, 197, 94, 0.25)' : 'transparent',
                                    color: tab === 'approved' ? '#4ade80' : 'var(--text-muted)',
                                    boxShadow: tab === 'approved' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                Approved <span style={{ background: tab === 'approved' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255,255,255,0.06)', color: tab === 'approved' ? '#4ade80' : 'var(--text-secondary)', borderRadius: '8px', padding: '1px 5px', fontSize: '10.5px', fontWeight: 700 }}>{approvedCount}</span>
                            </button>
                            <button 
                                type="button" 
                                className={`tab-btn ${tab === 'pending' ? 'active' : ''}`} 
                                onClick={() => setTab('pending')}
                                style={{ 
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    gap: '5px', 
                                    fontWeight: tab === 'pending' ? 700 : 500, 
                                    fontSize: '0.78rem',
                                    padding: '4px 10px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: tab === 'pending' ? 'rgba(245, 158, 11, 0.25)' : 'transparent',
                                    color: tab === 'pending' ? '#fbbf24' : 'var(--text-muted)',
                                    boxShadow: tab === 'pending' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                Pending <span style={{ background: tab === 'pending' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255,255,255,0.06)', color: tab === 'pending' ? '#fbbf24' : 'var(--text-secondary)', borderRadius: '8px', padding: '1px 5px', fontSize: '10.5px', fontWeight: 700 }}>{pendingCount}</span>
                            </button>
                            <button 
                                type="button" 
                                className={`tab-btn ${tab === 'rejected' ? 'active' : ''}`} 
                                onClick={() => setTab('rejected')}
                                style={{ 
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    gap: '5px', 
                                    fontWeight: tab === 'rejected' ? 700 : 500, 
                                    fontSize: '0.78rem',
                                    padding: '4px 10px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: tab === 'rejected' ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
                                    color: tab === 'rejected' ? '#f87171' : 'var(--text-muted)',
                                    boxShadow: tab === 'rejected' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                Rejected <span style={{ background: tab === 'rejected' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.06)', color: tab === 'rejected' ? '#f87171' : 'var(--text-secondary)', borderRadius: '8px', padding: '1px 5px', fontSize: '10.5px', fontWeight: 700 }}>{rejectedCount}</span>
                            </button>
                        </div>

                        {/* Right: Unified Action Controls & Filters Bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {/* Date Range Picker */}
                            <div style={{ display: 'inline-flex', alignItems: 'center', height: '34px', background: 'var(--input-bg)', border: '1px solid var(--border-glass)', borderRadius: '6px', padding: '0 8px', gap: '6px' }}>
                                <i className="fa-regular fa-calendar" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}></i>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem', fontWeight: 600 }}>From</span>
                                <input 
                                    type="date" 
                                    value={fromDate}
                                    onChange={(e) => setFromDate(e.target.value)}
                                    title="From Date"
                                    style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.76rem', color: 'var(--text-primary)', cursor: 'pointer', padding: 0 }}
                                />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem', fontWeight: 600 }}>To</span>
                                <input 
                                    type="date" 
                                    value={toDate}
                                    onChange={(e) => setToDate(e.target.value)}
                                    title="To Date"
                                    style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.76rem', color: 'var(--text-primary)', cursor: 'pointer', padding: 0 }}
                                />
                                {(fromDate || toDate) && (
                                    <button 
                                        type="button" 
                                        onClick={() => { setFromDate(''); setToDate(''); }}
                                        title="Clear Date Filter"
                                        style={{ border: 'none', background: 'rgba(255,255,255,0.1)', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, marginLeft: '2px' }}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            {/* Search Input Box */}
                            <div style={{ position: 'relative', width: '220px', height: '34px' }}>
                                <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.75rem', pointerEvents: 'none' }}></i>
                                <input 
                                    type="text" 
                                    placeholder="Search Employee / Category..." 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{
                                        width: '100%',
                                        height: '34px',
                                        padding: '0 10px 0 28px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-glass)',
                                        background: 'var(--input-bg)',
                                        fontSize: '0.78rem',
                                        color: 'var(--text-primary)',
                                        outline: 'none',
                                        transition: 'border-color 0.15s, box-shadow 0.15s'
                                    }}
                                    onFocus={(e) => { e.target.style.borderColor = '#2563eb'; e.target.style.boxShadow = '0 0 0 2px rgba(37, 99, 235, 0.12)'; }}
                                    onBlur={(e) => { e.target.style.borderColor = 'var(--border-glass)'; e.target.style.boxShadow = 'none'; }}
                                />
                            </div>

                            {/* Download Excel Button */}
                            <button 
                                type="button" 
                                className="btn btn-success"
                                onClick={handleExportToExcel}
                                style={{ 
                                    height: '34px',
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    gap: '6px', 
                                    padding: '0 12px', 
                                    borderRadius: '6px', 
                                    fontSize: '0.78rem', 
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap'
                                }}
                                title="Export filtered records to formatted Excel spreadsheet"
                            >
                                <i className="fa-solid fa-file-excel" style={{ fontSize: '0.82rem' }}></i>
                                <span>Export Excel ({filtered.length})</span>
                            </button>

                            {/* + Add Expense Button */}
                            <button 
                                type="button"
                                className="btn btn-primary"
                                onClick={() => setShowAddExpenseModal(true)}
                                style={{ 
                                    height: '34px',
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    gap: '6px', 
                                    padding: '0 14px', 
                                    borderRadius: '6px', 
                                    fontSize: '0.78rem', 
                                    fontWeight: 600, 
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap'
                                }}
                                title="Create a new expense claim"
                            >
                                <i className="fa-solid fa-plus" style={{ fontSize: '0.78rem' }}></i>
                                <span>Add Expense</span>
                            </button>
                        </div>
                    </div>

                    <div className="table-container glass custom-scrollbar" style={{ padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', borderRadius: '10px' }}>
                        <table id="expenses-table">
                            <thead>
                                <tr>
                                    <th>Date Submitted</th>
                                    <th>Employee</th>
                                    <th>Category</th>
                                    <th>Amount</th>
                                    <th>Description</th>
                                    <th>Invoice</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan="8" style={{ padding: "40px 0" }}><LoadingSpinner message="Loading Expense Claims & Invoices..." minHeight="220px" /></td></tr>
                                ) : error ? (
                                    <tr><td colSpan="8" className="error-text" style={{ textAlign: 'center', padding: '30px' }}>Failed to load expenses</td></tr>
                                ) : paginatedExpenses.length === 0 ? (
                                    <tr><td colSpan="8" style={{ textAlign: 'center', padding: '30px' }}>No expenses found.</td></tr>
                                ) : (
                                    paginatedExpenses.map(exp => {
                                        const { empCode, empName } = getEmployeeDisplayInfo(exp);
                                        return (
                                            <tr 
                                                key={exp.id}
                                                onClick={() => handleOpenVerification(exp)}
                                                style={{ cursor: 'pointer', transition: 'background-color 0.15s ease' }}
                                                title="Click row to verify & edit expense details"
                                            >
                                                <td>{formatDate(exp.createdAt)}</td>
                                                <td>
                                                    <strong style={{ color: '#4f46e5', display: 'block' }}>{empName}</strong>
                                                    <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{empCode}</span>
                                                </td>
                                                <td>{exp.category}</td>
                                                <td><strong style={{ color: '#1e293b' }}>₹{Number(exp.amount || 0).toFixed(2)}</strong></td>
                                                <td>{exp.description || '-'}</td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                {exp.invoiceUrl || exp.cloudinaryUrl ? (
                                                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleOpenVerification(exp);
                                                            }} 
                                                            className="btn btn-primary" 
                                                            style={{ padding: '4px 8px', fontSize: '12px' }}
                                                            title="Verify & View"
                                                        >
                                                            <i className="fa-solid fa-image"></i> View
                                                        </button>
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                forceDownload(exp.cloudinaryUrl || getFullUrl(exp.invoiceUrl), `invoice_${exp.id}`);
                                                            }} 
                                                            className="btn btn-outline" 
                                                            style={{ padding: '4px 8px', fontSize: '12px' }}
                                                            title="Download"
                                                        >
                                                            <i className="fa-solid fa-download"></i>
                                                        </button>
                                                    </div>
                                                ) : '-'}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                                                    <span className={`badge-status badge-${String(exp.status || '').toLowerCase()}`}>{String(exp.status || '').toUpperCase()}</span>
                                                    {exp.actionBy && String(exp.status || '').toLowerCase() !== 'pending' && (
                                                        <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                                                            by <strong style={{ color: '#4f46e5' }}>{exp.actionBy}</strong>
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                {String(exp.status || '').toLowerCase() === 'pending' ? (
                                                    <div style={{ display: 'flex', gap: '5px' }}>
                                                        <button onClick={(e) => { e.stopPropagation(); handleUpdateStatus(exp.id, 'approved'); }} className="btn btn-success" style={{ padding: '4px 8px', fontSize: '12px' }}>Approve</button>
                                                        <button onClick={(e) => { e.stopPropagation(); handleUpdateStatus(exp.id, 'rejected'); }} className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '12px' }}>Reject</button>
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize: '0.85rem', color: '#6b7280', textTransform: 'capitalize' }}>{String(exp.status || '').toLowerCase()}</span>
                                                )}
                                            </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.3)', flexShrink: 0 }}>
                            <span style={{ fontSize: '0.85rem', color: '#4b5563' }}>
                                Showing {startIndex + 1} to {endIndex} of {totalItems} entries
                            </span>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button 
                                    className="btn btn-outline" 
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    style={{ padding: '6px 12px', fontSize: '0.85rem', opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                                >
                                    Previous
                                </button>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
                                    Page {currentPage} of {totalPages}
                                </span>
                                <button 
                                    className="btn btn-outline" 
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    style={{ padding: '6px 12px', fontSize: '0.85rem', opacity: currentPage === totalPages ? 0.5 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
            
            {/* Add Expense Modal */}
            {showAddExpenseModal && (
                <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="modal-content glass" style={{ width: '500px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto', padding: '25px', borderRadius: '14px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-lg)', position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Add New Expense</h3>
                            <button 
                                onClick={() => setShowAddExpenseModal(false)}
                                style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}
                            >
                                &times;
                            </button>
                        </div>

                        <form onSubmit={handleAddExpenseSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Employee *</label>
                                <select 
                                    value={selectedEmployeeId} 
                                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                                    required
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                                >
                                    <option value="">Select Employee</option>
                                    {employees.filter(isActiveEmployee).map(emp => (
                                        <option key={emp.id || emp._id} value={emp.id || emp._id}>
                                             {emp.name} ({emp.empCode || emp.id || emp._id})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Category *</label>
                                <select 
                                    value={category} 
                                    onChange={(e) => setCategory(e.target.value)}
                                    required
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                                >
                                    <option value="Courier expense">Courier expense</option>
                                    <option value="Food expense">Food expense</option>
                                    <option value="Goods expense">Goods expense</option>
                                    <option value="Goods transport">Goods transport</option>
                                    <option value="Petrol and diesel expense">Petrol and diesel expense</option>
                                    <option value="Other expense">Other expense</option>
                                </select>
                            </div>

                            {(category === 'Other expense' || category === 'Other') && (
                                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Specify Other Category *</label>
                                    <input 
                                        type="text" 
                                        value={customCategory} 
                                        onChange={(e) => setCustomCategory(e.target.value)}
                                        placeholder="e.g. Office Supplies"
                                        required
                                        style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                                    />
                                </div>
                            )}

                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Amount (₹) *</label>
                                <input 
                                    type="number" 
                                    step="0.01"
                                    min="0.01"
                                    value={amount} 
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    required
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                                />
                            </div>

                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Bill Date</label>
                                <input 
                                    type="date" 
                                    value={billDate} 
                                    onChange={(e) => setBillDate(e.target.value)}
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                                />
                            </div>

                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Merchant Name</label>
                                <input 
                                    type="text" 
                                    value={merchantName} 
                                    onChange={(e) => setMerchantName(e.target.value)}
                                    placeholder="e.g. Amazon, Shell, Uber"
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                                />
                            </div>

                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Bill / Invoice Number</label>
                                <input 
                                    type="text" 
                                    value={billNo} 
                                    onChange={(e) => setBillNo(e.target.value)}
                                    placeholder="e.g. INV-1049"
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                                />
                            </div>

                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Site Name</label>
                                <input 
                                    type="text" 
                                    value={siteName} 
                                    onChange={(e) => setSiteName(e.target.value)}
                                    placeholder="e.g. Site Alpha"
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                                />
                            </div>

                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Description / Notes</label>
                                <textarea 
                                    value={description} 
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Add any relevant remarks or details..."
                                    rows="3"
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', resize: 'vertical', outline: 'none' }}
                                />
                            </div>

                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Invoice File *</label>
                                <input 
                                    type="file" 
                                    onChange={(e) => setInvoiceFile(e.target.files[0])}
                                    accept="image/*,.pdf"
                                    required
                                    style={{ padding: '6px', borderRadius: '8px', border: '1px dashed var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                                />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                                <button 
                                    type="button" 
                                    onClick={() => setShowAddExpenseModal(false)}
                                    className="btn btn-outline"
                                    style={{ padding: '8px 16px' }}
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    className="btn btn-primary"
                                    disabled={submitLoading}
                                    style={{ padding: '8px 20px' }}
                                >
                                    {submitLoading ? 'Submitting...' : 'Add Expense'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal for viewing invoice images */}
            {modalImage && (
                <div 
                    className="modal-overlay" 
                    onClick={() => setModalImage(null)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 9999
                    }}
                >
                    <div 
                        className="modal-content" 
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'relative',
                            maxWidth: '90%',
                            maxHeight: '90%',
                            background: '#fff',
                            padding: '10px',
                            borderRadius: '8px',
                            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center'
                        }}
                    >
                        <button 
                            onClick={() => setModalImage(null)}
                            style={{
                                position: 'absolute',
                                top: '10px',
                                right: '10px',
                                background: '#ef4444',
                                color: 'white',
                                border: 'none',
                                borderRadius: '50%',
                                width: '30px',
                                height: '30px',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                            }}
                        >
                            &times;
                        </button>
                        <img 
                            src={modalImage} 
                            alt="Invoice Preview" 
                            style={{
                                maxWidth: '100%',
                                maxHeight: '80vh',
                                objectFit: 'contain',
                                borderRadius: '4px'
                            }}
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = 'https://via.placeholder.com/400x300?text=Invoice+Not+Available';
                            }}
                        />
                        <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                            <a 
                                href={modalImage} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="btn btn-primary"
                                style={{ padding: '6px 12px', fontSize: '13px' }}
                            >
                                Open Full Image
                            </a>
                            <button 
                                onClick={() => forceDownload(modalImage, 'invoice_preview')} 
                                className="btn btn-outline"
                                style={{ padding: '6px 12px', fontSize: '13px' }}
                            >
                                Download
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
