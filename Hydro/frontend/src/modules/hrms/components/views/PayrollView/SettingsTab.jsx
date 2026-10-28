import React, { useState } from 'react';
import { api } from '../../../services/api';
import { getFullUrl, forceDownload } from '../../../utils/helpers';

export default function SettingsTab({ payslips = [], employees = [], onReload }) {
  const [search, setSearch] = useState('');
  const [filterEmp, setFilterEmp] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

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

  const handleDispatch = async () => {
    if (!filterMonth) {
      alert("Please select a specific Month from the filter before dispatching payslips.");
      return;
    }
    
    if (window.confirm(`Are you sure you want to send payslips for ${formatMonthName(filterMonth)} (${filterMonth}) to all employees?`)) {
      setIsDispatching(true);
      try {
        const res = await api.dispatchPayslips(filterMonth);
        alert(res.message || 'Payslips dispatched successfully.');
        if (onReload) onReload();
      } catch (err) {
        alert(`Error: ${err.message}`);
      } finally {
        setIsDispatching(false);
      }
    }
  };

  const handleDownloadPayslips = async () => {
    if (!filterMonth) {
      alert("Please select a specific Pay Cycle Month from the filter dropdown before downloading.");
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

      {/* Page Header */}
      <div className="card glass" style={{ padding: '20px 24px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
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
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          
          <button 
            className="btn btn-secondary" 
            style={{ padding: '7px 14px', fontSize: '0.8rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => setShowUploadModal(true)}
          >
            <i className="fa-solid fa-cloud-arrow-up"></i>
            Upload Payslip
          </button>

          <button 
            className="btn btn-primary" 
            style={{ padding: '7px 12px', fontSize: '0.8rem' }} 
            onClick={handleDispatch}
            disabled={isDispatching || !filterMonth}
            title={!filterMonth ? "Select a month first" : "Dispatch to all"}
          >
            {isDispatching ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-paper-plane" style={{ marginRight: '5px' }}></i>}
            Send Payslips to All
          </button>
          
          <button 
            className="btn btn-secondary" 
            style={{ 
              padding: '7px 14px', 
              fontSize: '0.8rem', 
              background: 'linear-gradient(135deg, #0284c7, #0369a1)', 
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
            title={!filterMonth ? "Select a Pay Cycle Month first" : (filterEmp ? "Download Payslip for selected employee" : "Download All Payslips for this month")}
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
              style={{ paddingLeft: '30px', padding: '7px 12px 7px 30px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none', width: '160px' }}
            />
          </div>

          {/* Employee Filter */}
          <select 
            value={filterEmp} 
            onChange={e => setFilterEmp(e.target.value)} 
            style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none', maxWidth: '150px' }}
          >
            <option value="">All Employees</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>

          {/* Year Filter */}
          <select 
            value={filterYear} 
            onChange={e => {
              setFilterYear(e.target.value);
              setFilterMonth(''); // reset month selection when year changes
            }} 
            style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none' }}
          >
            <option value="">All Years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Month Filter with Scrollable Dropdown Styling */}
          <select 
            value={filterMonth} 
            onChange={e => setFilterMonth(e.target.value)} 
            style={{ 
              padding: '7px 12px', 
              borderRadius: '8px', 
              border: '1px solid var(--border-glass)', 
              background: 'var(--bg-input)', 
              color: 'var(--text-primary)', 
              fontSize: '0.8rem', 
              outline: 'none',
              maxHeight: '220px',
              overflowY: 'auto'
            }}
          >
            <option value="">All Months</option>
            {availableMonths.map(m => (
              <option key={m} value={m}>
                {formatMonthName(m)} ({m})
              </option>
            ))}
          </select>

          {(search || filterEmp || filterYear || filterMonth) && (
            <button className="btn btn-outline" style={{ padding: '7px 12px', fontSize: '0.8rem' }} onClick={() => { setSearch(''); setFilterEmp(''); setFilterYear(''); setFilterMonth(''); }}>
              <i className="fa-solid fa-xmark" style={{ marginRight: '4px' }}></i> Clear
            </button>
          )}
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
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-glass)', fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)' }}>
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
                return (
                  <tr key={ps.id || idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
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
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: '0.82rem', padding: '3px 10px', borderRadius: '10px', background: 'rgba(79,70,229,0.1)', color: 'var(--accent-primary)', fontWeight: 600 }}>
                        {ps.month || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: 600, color: '#10b981', fontSize: '0.85rem' }}>
                      {netPay ? `₹${Number(netPay).toLocaleString()}` : '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {ps.createdAt ? new Date(ps.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {isSent ? (
                        <span style={{ fontSize: '0.72rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '3px 8px', borderRadius: '12px', fontWeight: 600 }}>
                          <i className="fa-solid fa-check" style={{ marginRight: '4px' }}></i> Dispatched
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '3px 8px', borderRadius: '12px', fontWeight: 600 }}>
                          Pending
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                        <a
                          href={`${getFullUrl(ps.filePath)}?_t=${Date.now()}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-outline"
                          style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          <i className="fa-solid fa-file-pdf" style={{ color: '#ef4444' }}></i> View PDF
                        </a>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '6px 10px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                          title="Download Payslip (PDF)"
                          onClick={() => {
                            api.downloadPayslipsArchive({
                              month: ps.month,
                              employeeId: ps.employeeId || ps.employee?.id
                            }).catch(err => alert(`Download error: ${err.message}`));
                          }}
                        >
                          <i className="fa-solid fa-download" style={{ color: 'var(--accent-primary)' }}></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
