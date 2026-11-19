import React, { useState, useRef, useEffect } from 'react';
import { api } from '../../../services/api';
import { getFullUrl, forceDownload } from '../../../utils/helpers';

export default function SettingsTab({ payslips = [], employees = [], onReload }) {
  const [search, setSearch] = useState('');
  const [filterEmp, setFilterEmp] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Dynamic selection for single, multi (2, 3), or bulk dispatch
  const [selectedPayslipIds, setSelectedPayslipIds] = useState([]);
  const selectAllRef = useRef(null);

  // Keka Split Dropdown Menu State
  const [showDispatchMenu, setShowDispatchMenu] = useState(false);
  const dispatchMenuRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dispatchMenuRef.current && !dispatchMenuRef.current.contains(e.target)) {
        setShowDispatchMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Modal State for Manual Payslip Upload
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadEmpId, setUploadEmpId] = useState('');
  const [uploadMonth, setUploadMonth] = useState(new Date().toISOString().substring(0, 7));
  const [uploadNetPay, setUploadNetPay] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  // Format YYYY-MM to Month Name Year (e.g. 2026-07 -> July 2026)
  const formatMonthName = (mStr) => {
    if (!mStr || !mStr.includes('-')) return mStr;
    const [year, monthNum] = mStr.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1, 1);
    if (isNaN(date.getTime())) return mStr;
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  // Derive unique years dynamically
  const years = [...new Set(payslips.map(ps => {
    if (!ps.month || !ps.month.includes('-')) return null;
    return ps.month.split('-')[0];
  }).filter(Boolean))].sort().reverse();

  // Include current year if empty
  const currentYearStr = String(new Date().getFullYear());
  if (!years.includes(currentYearStr)) {
    years.unshift(currentYearStr);
  }

  // Derive unique months for filter dropdown
  const allMonths = [...new Set(payslips.map(ps => ps.month).filter(Boolean))].sort().reverse();
  const availableMonths = filterYear 
    ? allMonths.filter(m => m.startsWith(filterYear))
    : allMonths;

  const filtered = payslips.filter(ps => {
    const empName = ps.employee ? ps.employee.name : (ps.employeeId || '');
    const matchSearch = !search || empName.toLowerCase().includes(search.toLowerCase());
    const matchEmp = !filterEmp || (ps.employeeId === filterEmp || (ps.employee && ps.employee.id === filterEmp));
    const matchMonth = !filterMonth || (ps.month && ps.month.includes(filterMonth));
    const matchYear = !filterYear || (ps.month && ps.month.startsWith(filterYear));
    return matchSearch && matchEmp && matchMonth && matchYear;
  });

  // Master checkbox states for filtered payslips
  const isAllSelected = filtered.length > 0 && filtered.every(ps => selectedPayslipIds.includes(ps.id));
  const isSomeSelected = filtered.some(ps => selectedPayslipIds.includes(ps.id)) && !isAllSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      const filteredIdSet = new Set(filtered.map(ps => ps.id));
      setSelectedPayslipIds(prev => prev.filter(id => !filteredIdSet.has(id)));
    } else {
      const allFilteredIds = filtered.map(ps => ps.id);
      setSelectedPayslipIds(prev => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  const handleToggleSelectOne = (id) => {
    setSelectedPayslipIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const selectedCount = selectedPayslipIds.length;

  // Contextual Target Evaluation:
  // Options to send (Email, App, Both) ONLY appear when:
  // 1. Specific employee + month are selected, OR
  // 2. Row checkboxes are selected (single, 2, 3 employees), OR
  // 3. Month cycle is selected
  const hasTargetSelection = 
    selectedCount > 0 || 
    (Boolean(filterEmp) && Boolean(filterMonth)) ||
    (Boolean(filterMonth) && filtered.length > 0);

  // Determine exact target payslips and display label
  let targetPayslips = [];
  let targetDescription = '';

  if (selectedCount > 0) {
    targetPayslips = filtered.filter(ps => selectedPayslipIds.includes(ps.id));
    targetDescription = `${targetPayslips.length} Selected`;
  } else if (filterEmp && filterMonth) {
    targetPayslips = filtered;
    const empName = targetPayslips[0]?.employee?.name || 'Selected Employee';
    targetDescription = `${empName} • ${formatMonthName(filterMonth)}`;
  } else if (filterMonth) {
    targetPayslips = filtered;
    targetDescription = `All in ${formatMonthName(filterMonth)} (${targetPayslips.length})`;
  }

  // Header Multi-Channel Dispatch Handler (Both, Email Only, Mobile App Only)
  const handleHeaderDispatch = async (channel = 'both') => {
    if (!hasTargetSelection || targetPayslips.length === 0) {
      alert('⚠️ Please select an Employee and Pay Cycle Month from the filters or select checkboxes before dispatching.');
      return;
    }

    const channelNames = {
      both: 'Both Email & Mobile App (1-Click)',
      email: 'Email Only (hydromaterials9@gmail.com)',
      app: 'Mobile App Only (In-App Document & Push)'
    };

    const confirmMsg = `🚀 Payslip Dispatch\n\nTarget: ${targetDescription}\nChannel: ${channelNames[channel]}\nRecipients: ${targetPayslips.length}\n\nAre you sure you want to proceed with dispatch?`;
    if (!window.confirm(confirmMsg)) return;

    setIsDispatching(true);
    try {
      const targetIds = targetPayslips.map(ps => ps.id);
      const res = await api.dispatchPayslips({
        month: filterMonth || (targetPayslips[0]?.month) || null,
        channel,
        payslipIds: targetIds
      });

      alert(res.message || `Dispatched ${targetPayslips.length} payslips via ${channelNames[channel]}!`);
      setSelectedPayslipIds([]); // Clear selection after successful dispatch
      if (onReload) onReload();
    } catch (err) {
      alert(`Dispatch error: ${err.message}`);
    } finally {
      setIsDispatching(false);
    }
  };

  const handleDownloadPayslips = async () => {
    if (!filterMonth) {
      alert('Please select a specific Pay Cycle Month from the filter dropdown before downloading.');
      return;
    }

    setIsDownloading(true);
    try {
      await api.downloadPayslipsArchive({
        month: filterMonth,
        employeeId: filterEmp || null
      });
    } catch (err) {
      alert(`Download error: ${err.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleUploadPayslip = async (e) => {
    e.preventDefault();
    if (!uploadEmpId || !uploadMonth || !uploadFile) {
      alert('Please select Employee, Pay Cycle Month, and a PDF file.');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('employeeId', uploadEmpId);
      formData.append('month', uploadMonth);
      if (uploadNetPay) formData.append('netPay', uploadNetPay);
      formData.append('file', uploadFile);

      const res = await api.uploadPayslip(formData);
      alert(res.message || 'Payslip uploaded successfully!');
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadNetPay('');
      if (onReload) onReload();
    } catch (err) {
      alert(`Upload error: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Page Header Card */}
      <div className="card glass" style={{ padding: '20px 24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        
        {/* Top Row: Title on Left, Action & Filters on Right */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(79, 70, 229, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-primary)' }}>
            <i className="fa-solid fa-receipt"></i>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Payslips Archive</h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {payslips.length} payslip{payslips.length !== 1 ? 's' : ''} generated across all cycles
            </p>
          </div>
        </div>

        {/* Toolbar & Filters */}
        <div className="payslips-toolbar" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          
          {/* Upload Payslip */}
          <button 
            className="btn btn-secondary" 
            style={{ padding: '7px 14px', fontSize: '0.8rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => setShowUploadModal(true)}
          >
            <i className="fa-solid fa-cloud-arrow-up"></i>
            Upload Payslip
          </button>

          {/* Keka-Style Split Dropdown Button for Multi-Channel Dispatch */}
          {hasTargetSelection && targetPayslips.length > 0 && (
            <div 
              ref={dispatchMenuRef}
              style={{ 
                position: 'relative', 
                display: 'inline-flex', 
                alignItems: 'stretch',
                borderRadius: '8px',
                boxShadow: '0 2px 6px rgba(79, 70, 229, 0.35)',
                zIndex: 60
              }}
            >
              {/* Main 1-Click Action: Send to Email & App */}
              <button
                type="button"
                className="btn btn-primary"
                style={{
                  padding: '7px 13px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#ffffff',
                  background: 'linear-gradient(135deg, #4f46e5, #4338ca)',
                  border: 'none',
                  borderTopLeftRadius: '8px',
                  borderBottomLeftRadius: '8px',
                  borderTopRightRadius: 0,
                  borderBottomRightRadius: 0,
                  cursor: isDispatching ? 'wait' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease'
                }}
                onClick={() => handleHeaderDispatch('both')}
                disabled={isDispatching}
                title={`Send to Both Email & Mobile App for ${targetDescription}`}
              >
                {isDispatching ? (
                  <i className="fa-solid fa-spinner fa-spin"></i>
                ) : (
                  <i className="fa-solid fa-paper-plane"></i>
                )}
                <span>Send to Email & App{selectedCount > 0 ? ` (${selectedCount})` : ''}</span>
              </button>

              {/* Split Caret Dropdown Trigger */}
              <button
                type="button"
                style={{
                  padding: '7px 10px',
                  fontSize: '0.75rem',
                  color: '#ffffff',
                  background: 'linear-gradient(135deg, #4338ca, #3730a3)',
                  border: 'none',
                  borderLeft: '1px solid rgba(255, 255, 255, 0.25)',
                  borderTopRightRadius: '8px',
                  borderBottomRightRadius: '8px',
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  cursor: isDispatching ? 'wait' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s ease'
                }}
                onClick={() => setShowDispatchMenu(prev => !prev)}
                disabled={isDispatching}
                title="More delivery options (Send by Email only, Send by App only)"
              >
                <i 
                  className="fa-solid fa-chevron-down" 
                  style={{ 
                    transition: 'transform 0.2s', 
                    transform: showDispatchMenu ? 'rotate(180deg)' : 'none' 
                  }}
                ></i>
              </button>

              {/* Keka Dropdown Menu */}
              {showDispatchMenu && (
                <div 
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    width: '270px',
                    background: 'var(--bg-card, #1e293b)',
                    border: '1px solid var(--border-glass, rgba(255, 255, 255, 0.15))',
                    borderRadius: '10px',
                    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45), 0 4px 10px rgba(0, 0, 0, 0.25)',
                    padding: '6px',
                    zIndex: 1000,
                    backdropFilter: 'blur(12px)'
                  }}
                >
                  {/* Target Scope Pill */}
                  <div style={{
                    padding: '8px 10px',
                    background: 'rgba(99, 102, 241, 0.08)',
                    borderRadius: '7px',
                    marginBottom: '6px',
                    border: '1px solid rgba(99, 102, 241, 0.2)'
                  }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Ready to Dispatch
                    </div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {targetDescription}
                    </div>
                  </div>

                  {/* Option 1: Send to Both */}
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '7px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'var(--text-primary)',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(99, 102, 241, 0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                      setShowDispatchMenu(false);
                      handleHeaderDispatch('both');
                    }}
                  >
                    <div style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '7px',
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: '#6366f1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.82rem',
                      flexShrink: 0
                    }}>
                      <i className="fa-solid fa-rocket"></i>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Send to Both</span>
                        <span style={{ fontSize: '0.62rem', background: '#4f46e5', color: '#fff', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                          Recommended
                        </span>
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        Email PDF + Mobile App Vault
                      </div>
                    </div>
                  </button>

                  {/* Option 2: Send by Email */}
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '7px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'var(--text-primary)',
                      marginTop: '2px',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(2, 132, 199, 0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                      setShowDispatchMenu(false);
                      handleHeaderDispatch('email');
                    }}
                  >
                    <div style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '7px',
                      background: 'rgba(2, 132, 199, 0.15)',
                      color: '#0284c7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.82rem',
                      flexShrink: 0
                    }}>
                      <i className="fa-solid fa-envelope"></i>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Send by Email</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        hydromaterials9@gmail.com
                      </div>
                    </div>
                  </button>

                  {/* Option 3: Send by App */}
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '7px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'var(--text-primary)',
                      marginTop: '2px',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(147, 51, 234, 0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                      setShowDispatchMenu(false);
                      handleHeaderDispatch('app');
                    }}
                  >
                    <div style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '7px',
                      background: 'rgba(147, 51, 234, 0.15)',
                      color: '#9333ea',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.82rem',
                      flexShrink: 0
                    }}>
                      <i className="fa-solid fa-mobile-screen"></i>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Send by App</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        Mobile Document Vault + Push
                      </div>
                    </div>
                  </button>

                </div>
              )}
            </div>
          )}

          {/* Download Payslips */}
          <button 
            className="btn btn-secondary" 
            style={{ 
              padding: '7px 14px', 
              fontSize: '0.8rem', 
              background: 'linear-gradient(135deg, #475569, #334155)', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '8px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              fontWeight: 600, 
              cursor: filterMonth ? 'pointer' : 'not-allowed',
              opacity: filterMonth ? 1 : 0.65,
              transition: 'all 0.2s ease'
            }} 
            onClick={handleDownloadPayslips}
            disabled={isDownloading || !filterMonth}
            title={!filterMonth ? 'Select a Pay Cycle Month first' : (filterEmp ? 'Download Payslip for selected employee' : 'Download All Payslips for this month')}
          >
            {isDownloading ? (
              <i className="fa-solid fa-spinner fa-spin"></i>
            ) : (
              <i className="fa-solid fa-file-arrow-down"></i>
            )}
            {filterEmp ? 'Download Payslip' : 'Download All Payslips'}
          </button>

          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: '0.75rem', pointerEvents: 'none' }}></i>
            <input
              type="text"
              placeholder="Search employee..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: '30px', padding: '7px 12px 7px 30px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none', width: '135px' }}
            />
          </div>

          {/* Employee Filter */}
          <select 
            value={filterEmp} 
            onChange={e => setFilterEmp(e.target.value)} 
            style={{ 
              padding: '7px 12px', 
              borderRadius: '8px', 
              border: filterEmp ? '1.5px solid #6366f1' : '1px solid var(--border-glass)', 
              background: filterEmp ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-input)', 
              color: 'var(--text-primary)', 
              fontSize: '0.8rem', 
              outline: 'none', 
              maxWidth: '140px',
              fontWeight: filterEmp ? 600 : 'normal'
            }}
          >
            <option value="">All Employees</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.empCode || emp.id})
              </option>
            ))}
          </select>

          {/* Year Filter */}
          <select 
            value={filterYear} 
            onChange={e => {
              setFilterYear(e.target.value);
              setFilterMonth('');
            }} 
            style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none', maxWidth: '95px' }}
          >
            <option value="">All Years</option>
            {years.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {/* Month Filter */}
          <select 
            value={filterMonth} 
            onChange={e => setFilterMonth(e.target.value)} 
            style={{ 
              padding: '7px 12px', 
              borderRadius: '8px', 
              border: filterMonth ? '1.5px solid #6366f1' : '1px solid var(--border-glass)', 
              background: filterMonth ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-input)', 
              color: 'var(--text-primary)', 
              fontSize: '0.8rem', 
              outline: 'none',
              maxWidth: '150px',
              fontWeight: filterMonth ? 600 : 'normal'
            }}
          >
            <option value="">All Months</option>
            {availableMonths.map(m => (
              <option key={m} value={m}>
                {formatMonthName(m)} ({m})
              </option>
            ))}
          </select>

          {/* Clear Filters */}
          {(search || filterEmp || filterYear || filterMonth || selectedCount > 0) && (
            <button 
              className="btn btn-outline" 
              style={{ padding: '7px 12px', fontSize: '0.8rem' }} 
              onClick={() => { 
                setSearch(''); 
                setFilterEmp(''); 
                setFilterYear(''); 
                setFilterMonth(''); 
                setSelectedPayslipIds([]);
              }}
            >
              <i className="fa-solid fa-xmark" style={{ marginRight: '4px' }}></i> Clear
            </button>
          )}
          </div>
        </div>

      </div>

      {/* Payslips Table */}
      <div className="card glass" style={{ borderRadius: '12px', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', color: 'var(--text-secondary)', marginBottom: '16px', opacity: 0.4 }}>
              <i className="fa-solid fa-file-invoice"></i>
            </div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>
              {payslips.length === 0 ? 'No Payslips Generated Yet' : 'No Payslips Match Filters'}
            </h3>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '380px', marginLeft: 'auto', marginRight: 'auto' }}>
              {payslips.length === 0
                ? 'Payslips are auto-generated when you click "Save Payslips" at the end of a payroll run in the Pay Runs tab.'
                : 'Try clearing your search or filter to see all payslips.'}
            </p>
            {payslips.length === 0 && (
              <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <i className="fa-solid fa-arrow-right" style={{ color: 'var(--accent-primary)' }}></i>
                <span>Go to <strong>Pay Runs</strong> → Complete Wizard → <strong>Save Payslips</strong></span>
              </div>
            )}
          </div>
        ) : (
          <div className="payroll-table-wrap">
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-glass)', fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ padding: '12px 14px', width: '40px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      ref={selectAllRef}
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#6366f1' }}
                      title={isAllSelected ? 'Deselect all visible' : 'Select all visible'}
                    />
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>EMPLOYEE</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>PAY CYCLE</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>NET PAY</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>GENERATED</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>STATUS</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ps, idx) => {
                  const empName = ps.employee ? ps.employee.name : (ps.employeeId || 'Unknown');
                  const designation = ps.employee ? ps.employee.designation : '';
                  const netPay = ps.payrollItem?.netSalary ?? ps.netSalary ?? ps.net_pay ?? null;
                  const isSent = ps.emailSentStatus === true || ps.emailSentStatus === 1;
                  const isAppSent = ps.appSentStatus === true || ps.appSentStatus === 1;
                  const isSelected = selectedPayslipIds.includes(ps.id);

                  return (
                    <tr 
                      key={ps.id || idx} 
                      style={{ 
                        borderBottom: '1px solid rgba(255,255,255,0.04)', 
                        transition: 'background 0.15s',
                        background: isSelected ? 'rgba(99, 102, 241, 0.09)' : 'transparent'
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = isSelected ? 'rgba(99, 102, 241, 0.09)' : 'transparent';
                      }}
                    >
                      {/* Checkbox Column */}
                      <td style={{ padding: '14px 14px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectOne(ps.id)}
                          style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#6366f1' }}
                        />
                      </td>

                      {/* Employee Info */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(79,70,229,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 700, flexShrink: 0 }}>
                            {empName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{empName}</div>
                            {designation && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{designation}</div>}
                          </div>
                        </div>
                      </td>

                      {/* Pay Cycle */}
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ fontSize: '0.82rem', padding: '3px 10px', borderRadius: '10px', background: 'rgba(79,70,229,0.1)', color: 'var(--accent-primary)', fontWeight: 600 }}>
                          {ps.month || '—'}
                        </span>
                      </td>

                      {/* Net Pay */}
                      <td style={{ padding: '14px 16px', fontWeight: 600, color: '#10b981', fontSize: '0.85rem' }}>
                        {netPay ? `₹${Number(netPay).toLocaleString()}` : '—'}
                      </td>

                      {/* Generated Date */}
                      <td style={{ padding: '14px 16px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {ps.createdAt ? new Date(ps.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>

                      {/* Delivery Status */}
                      <td style={{ padding: '14px 16px' }}>
                        {isSent && isAppSent ? (
                          <span style={{ fontSize: '0.72rem', color: '#059669', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '3px 9px', borderRadius: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fa-solid fa-circle-check"></i> Both Sent
                          </span>
                        ) : isSent ? (
                          <span style={{ fontSize: '0.72rem', color: '#2563eb', background: 'rgba(37, 99, 235, 0.1)', border: '1px solid rgba(37, 99, 235, 0.25)', padding: '3px 8px', borderRadius: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fa-solid fa-envelope"></i> Email Sent
                          </span>
                        ) : isAppSent ? (
                          <span style={{ fontSize: '0.72rem', color: '#7c3aed', background: 'rgba(147, 51, 234, 0.1)', border: '1px solid rgba(147, 51, 234, 0.25)', padding: '3px 8px', borderRadius: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fa-solid fa-mobile-screen"></i> In App
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: '#d97706', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', padding: '3px 8px', borderRadius: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fa-regular fa-clock"></i> Pending
                          </span>
                        )}
                      </td>

                      {/* ONLY Preview and Download in the Row Action Column */}
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                          
                          {/* Preview / View PDF */}
                          <a
                            href={`${getFullUrl(ps.filePath)}?_t=${Date.now()}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-outline"
                            style={{ 
                              padding: '6px 12px', 
                              fontSize: '0.75rem', 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '5px', 
                              borderRadius: '7px', 
                              color: '#ef4444', 
                              borderColor: 'rgba(239, 68, 68, 0.35)', 
                              background: 'rgba(239, 68, 68, 0.05)', 
                              fontWeight: 600, 
                              textDecoration: 'none' 
                            }}
                            title="Preview Payslip PDF"
                          >
                            <i className="fa-solid fa-file-pdf"></i>
                            <span>View PDF</span>
                          </a>

                          {/* Download PDF */}
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ 
                              padding: '6px 10px', 
                              fontSize: '0.75rem', 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '5px', 
                              borderRadius: '7px', 
                              color: '#0284c7', 
                              borderColor: 'rgba(2, 132, 199, 0.35)', 
                              background: 'rgba(2, 132, 199, 0.05)', 
                              fontWeight: 600, 
                              cursor: 'pointer' 
                            }}
                            title="Download Payslip PDF"
                            onClick={() => forceDownload(getFullUrl(ps.filePath), `payslip_${ps.employee?.empCode || ps.employeeId || 'emp'}_${ps.month}.pdf`)}
                          >
                            <i className="fa-solid fa-download"></i>
                            <span>Download</span>
                          </button>

                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Payslip Upload Modal */}
      {showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '480px', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border-glass)', boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}>
            
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', fontSize: '1rem' }}>
                  <i className="fa-solid fa-cloud-arrow-up"></i>
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Upload Manual Payslip</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Upload an external or signed payslip PDF</p>
                </div>
              </div>
              <button 
                onClick={() => setShowUploadModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem', padding: '4px' }}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleUploadPayslip} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Select Employee <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  value={uploadEmpId}
                  onChange={e => setUploadEmpId(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }}
                  required
                >
                  <option value="">-- Choose Employee --</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.empCode || emp.id}) - {emp.designation || 'Staff'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Pay Cycle Month <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="month"
                  value={uploadMonth}
                  onChange={e => setUploadMonth(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Net Salary (₹) <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>(Optional)</span>
                </label>
                <input
                  type="number"
                  placeholder="e.g. 25000"
                  value={uploadNetPay}
                  onChange={e => setUploadNetPay(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Payslip PDF File <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={e => setUploadFile(e.target.files[0] || null)}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px dashed var(--border-glass)', background: 'rgba(255,255,255,0.02)', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none' }}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ padding: '8px 16px', fontSize: '0.8rem' }}
                  onClick={() => setShowUploadModal(false)}
                  disabled={isUploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ padding: '8px 18px', fontSize: '0.8rem', background: '#10b981', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-check"></i>
                      <span>Upload & Archive</span>
                    </>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
