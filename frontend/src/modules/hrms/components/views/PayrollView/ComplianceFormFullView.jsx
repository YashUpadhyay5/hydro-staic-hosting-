import React, { useState, useMemo, useEffect } from 'react';
import { api } from '../../../services/api';
import {
  getDynamicFormData,
  exportFormToExcel,
  exportFormToPDF,
  formatMonthYearLabel,
  getCurrentMonthYYYYMM
} from '../../../data/complianceFormsData';
import { resolvePayrollRunItems, resolveOverrideValue } from '../../../services/payrollItemResolver';

export default function ComplianceFormFullView({
  formConfig,
  onBack,
  selectedMonth = getCurrentMonthYYYYMM(),
  setSelectedMonth,
  selectedLocation,
  setSelectedLocation,
  selectedStatus,
  setSelectedStatus,
  locationsList = [],
  employees = [],
  attendance = [],
  leaves = [],
  runItems = [],
  loadingPayRun = false,
  attendanceSettings = {},
  currentRunStep = 0,
  setActiveTab
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [internalEmployees, setInternalEmployees] = useState([]);
  const [internalRunStep, setInternalRunStep] = useState(currentRunStep || 0);

  useEffect(() => {
    if ((!employees || employees.length === 0) && internalEmployees.length === 0) {
      api.getEmployees({ limit: 1000 })
        .then(res => {
          const list = Array.isArray(res) ? res : (res?.data || []);
          if (list.length > 0) setInternalEmployees(list);
        })
        .catch(e => console.warn('Could not auto-fetch employees in ComplianceFormFullView:', e));
    }
  }, [employees, internalEmployees.length]);

  const effectiveEmployees = employees && employees.length > 0 ? employees : internalEmployees;

  const [internalSettings, setInternalSettings] = useState({});
  useEffect(() => {
    if (!attendanceSettings || Object.keys(attendanceSettings).length === 0) {
      api.getSettings()
        .then(res => {
          const s = res?.data || res || {};
          if (s && Object.keys(s).length > 0) setInternalSettings(s);
        })
        .catch(() => {});
    }
  }, [attendanceSettings]);
  const effectiveSettings = (attendanceSettings && Object.keys(attendanceSettings).length > 0) ? attendanceSettings : internalSettings;

  const [internalRunItems, setInternalRunItems] = useState([]);
  const [hasRunForMonth, setHasRunForMonth] = useState(false);
  const [internalLoadingPayRun, setInternalLoadingPayRun] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);

  // Auto-fetch pay run items & wizard edits strictly for selectedMonth
  useEffect(() => {
    let isCancelled = false;
    setInternalLoadingPayRun(true);
    api.getPayrollRuns()
      .then(runs => {
        if (isCancelled || !Array.isArray(runs)) return;
        const targetRun = runs.find(r => r.month === selectedMonth && (r.status === 'PAID' || r.status === 'COMPLETED' || r.status === 'APPROVED'))
          || runs.find(r => r.month === selectedMonth);

        if (targetRun) {
          return Promise.all([
            api.getPayrollRunItems(targetRun.id).catch(() => []),
            api.getPayRunState(targetRun.id).catch(() => null)
          ]).then(([items, stateRes]) => {
            if (isCancelled) return;
            const ws = stateRes?.wizardState || targetRun.wizardState;
            const parsedWs = typeof ws === 'string' ? JSON.parse(ws) : (ws || {});
            const baseItems = Array.isArray(items) ? items : [];

            const step = Number(parsedWs.completedStep || 0);
            setInternalRunStep(step);

            // Pay run exists for this month -> mark as active and resolve live items with all wizard state
            setHasRunForMonth(true);
            const resolved = resolvePayrollRunItems(targetRun, baseItems, parsedWs, effectiveEmployees, attendance, leaves);
            setInternalRunItems(resolved);
          });
        } else {
          setInternalRunStep(0);
          setHasRunForMonth(false);
          setInternalRunItems([]);
        }
      })
      .catch(e => {
        console.warn('Could not auto-fetch pay run items in ComplianceFormFullView:', e);
        if (!isCancelled) {
          setHasRunForMonth(false);
          setInternalRunItems([]);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setInternalLoadingPayRun(false);
        }
      });

    return () => { isCancelled = true; };
  }, [selectedMonth]);

  const effectiveRunItems = hasRunForMonth 
    ? ((internalRunItems && internalRunItems.length > 0) ? internalRunItems : (runItems || []))
    : [];
  const isWageForm = formConfig.sheetName === 'Form W' || formConfig.id === 'form-w' || formConfig.sheetName === 'Form T' || formConfig.id === 'form-t';
  const isFormW = isWageForm;
  const isPayrollRun = Boolean(hasRunForMonth && effectiveRunItems.length > 0);
  const isStillLoading = (loadingPayRun || internalLoadingPayRun) && effectiveRunItems.length === 0;

  // Compute dynamic form data strictly from DB state & selected month & filtered employees
  const { meta, headers, body, payrollNotRun } = useMemo(() => {
    return getDynamicFormData(formConfig.sheetName, selectedMonth, effectiveEmployees, attendance, leaves, effectiveRunItems, effectiveSettings);
  }, [formConfig, selectedMonth, effectiveEmployees, attendance, leaves, effectiveRunItems, effectiveSettings]);

  // Filter rows by search query
  const filteredBody = useMemo(() => {
    if (!searchTerm.trim()) return body;
    const q = searchTerm.toLowerCase();
    return body.filter(row =>
      row.some(cell => cell && String(cell).toLowerCase().includes(q))
    );
  }, [body, searchTerm]);

  const handleDownloadExcel = () => {
    if (isWageForm && !isPayrollRun && !isStillLoading) {
      setShowErrorModal(true);
      return;
    }
    exportFormToExcel(formConfig.sheetName, selectedMonth, effectiveEmployees, attendance, leaves, effectiveRunItems, effectiveSettings);
  };

  const handleDownloadPdf = async () => {
    if (isWageForm && !isPayrollRun && !isStillLoading) {
      setShowErrorModal(true);
      return;
    }
    setDownloadingPdf(true);
    await exportFormToPDF(`printable-compliance-view-${formConfig.id}`, formConfig.title, selectedMonth);
    setDownloadingPdf(false);
  };

  const monthLabel = formatMonthYearLabel(selectedMonth);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        width: '100%',
        animation: 'fadeIn 0.3s ease-in-out'
      }}
    >
      {/* Top Header Controls Bar */}
      <div
        className="card glass"
        style={{
          padding: '20px 28px',
          borderRadius: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '20px',
          background: 'var(--panel-bg)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--card-shadow)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button
            onClick={onBack}
            className="btn btn-outline"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 18px',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--card-bg)',
              color: 'var(--text-primary)'
            }}
          >
            <i className="fa-solid fa-arrow-left"></i>
            Back to Compliance Reports
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '14px',
                background: formConfig.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontSize: '1.35rem',
                boxShadow: `0 8px 20px ${formConfig.color}40`
              }}
            >
              <i className={`fa-solid ${formConfig.icon}`}></i>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {formConfig.title} &mdash; {formConfig.name}
                </h2>
                <span
                  style={{
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    background: `${formConfig.color}20`,
                    color: formConfig.color,
                    border: `1px solid ${formConfig.color}40`
                  }}
                >
                  {formConfig.category}
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {formConfig.rule} &bull; Loaded from Database ({filteredBody.length} records)
              </p>
            </div>
          </div>
        </div>

        {/* Right Toolbar Controls: Month Selector, Location, Status & Export Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* Month Selector Control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              <i className="fa-regular fa-calendar" style={{ marginRight: '6px' }}></i>
              Month & Year:
            </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth && setSelectedMonth(e.target.value)}
              style={{
                padding: '8px 14px',
                borderRadius: '10px',
                border: '1px solid var(--border-subtle)',
                background: 'var(--input-bg)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
                outline: 'none',
                fontWeight: 600
              }}
            />
          </div>

          {/* Location Filter Control */}
          {selectedLocation !== undefined && setSelectedLocation && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                <i className="fa-solid fa-location-dot" style={{ marginRight: '6px' }}></i>
                Location:
              </label>
              <select
                value={selectedLocation}
                onChange={e => setSelectedLocation(e.target.value)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--input-bg)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                  outline: 'none',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <option value="ALL">All Locations</option>
                {locationsList && locationsList.filter(l => l !== 'ALL').map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
          )}

          {/* Employee Status Filter Control */}
          {selectedStatus !== undefined && setSelectedStatus && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                <i className="fa-solid fa-user-check" style={{ marginRight: '6px' }}></i>
                Status:
              </label>
              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--input-bg)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                  outline: 'none',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="NOT_ACTIVE">Not Active</option>
              </select>
            </div>
          )}

          <button
            onClick={handleDownloadExcel}
            className="btn btn-outline"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              fontSize: '0.88rem',
              borderColor: '#10b981',
              color: '#10b981',
              fontWeight: 600,
              borderRadius: '10px',
              cursor: 'pointer'
            }}
          >
            <i className="fa-solid fa-file-excel" style={{ fontSize: '1.1rem' }}></i>
            Download Excel
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="btn btn-outline"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              fontSize: '0.88rem',
              borderColor: '#ef4444',
              color: '#ef4444',
              fontWeight: 600,
              borderRadius: '10px',
              cursor: 'pointer'
            }}
          >
            <i className={`fa-solid ${downloadingPdf ? 'fa-spinner fa-spin' : 'fa-file-pdf'}`} style={{ fontSize: '1.1rem' }}></i>
            {downloadingPdf ? 'Generating PDF...' : 'Download PDF'}
          </button>
        </div>
      </div>

      {/* Main Full-Page Document Container */}
      <div
        className="card glass"
        style={{
          borderRadius: '20px',
          padding: '32px',
          display: 'flex',
          flexDirection: 'column',
          gap: '28px',
          background: 'var(--panel-bg)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--card-shadow)'
        }}
      >
        {/* Search Bar & DB Live Status */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            paddingBottom: '20px',
            borderBottom: '1px solid var(--border-subtle)'
          }}
        >
          <div style={{ position: 'relative', width: '400px', maxWidth: '100%' }}>
            <i
              className="fa-solid fa-magnifying-glass"
              style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                fontSize: '0.9rem'
              }}
            ></i>
            <input
              type="text"
              placeholder="Search by employee name, ID, designation..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px 10px 42px',
                borderRadius: '12px',
                border: '1px solid var(--border-subtle)',
                background: 'var(--input-bg)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                fontSize: '0.82rem',
                fontWeight: 600,
                border: '1px solid rgba(16, 185, 129, 0.25)'
              }}
            >
              <i className="fa-solid fa-database" style={{ marginRight: '8px' }}></i>
              Active Database Records ({monthLabel})
            </span>
            <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
              Showing {filteredBody.length} of {body.length} entries
            </span>
          </div>
        </div>

        {/* Printable & Premium Form Layout */}
        <div
          id={`printable-compliance-view-${formConfig.id}`}
          style={{
            background: 'var(--card-bg)',
            color: 'var(--text-primary)',
            borderRadius: '16px',
            padding: '36px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--card-shadow)'
          }}
        >
          {/* Header Banner */}
          <div
            style={{
              textAlign: 'center',
              borderBottom: '2px solid var(--border-subtle)',
              paddingBottom: '24px',
              marginBottom: '28px'
            }}
          >
            <h1
              style={{
                margin: '0 0 8px 0',
                fontSize: '1.75rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '0.5px'
              }}
            >
              {formConfig.title} &mdash; {formConfig.name.toUpperCase()}
            </h1>
            <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {formConfig.rule} &bull; Wage Period: {monthLabel}
            </p>
          </div>

          {/* Spacious Metadata Card Grid */}
          {meta.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '20px',
                marginBottom: '32px',
                padding: '24px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '14px',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {meta.map((mRow, idx) => {
                const label = mRow[0] || '';
                const val = mRow.slice(1).filter(Boolean).join(' ') || mRow[2] || mRow[3] || '-';
                if (!label.trim()) return null;
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {label.replace(':', '')}
                    </span>
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: '1.4' }}>
                      {val}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Premium Data Table, Loading, or Un-Run Alert */}
          {isFormW && isStillLoading ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 24px',
                borderRadius: '16px',
                background: 'rgba(99, 102, 241, 0.04)',
                border: '1px dashed rgba(99, 102, 241, 0.25)',
                color: 'var(--text-secondary)'
              }}
            >
              <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2.2rem', marginBottom: '16px', color: 'var(--primary-color, #6366f1)' }}></i>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Loading Pay Run Records
              </h3>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                Retrieving processed salary and attendance records for <strong>{monthLabel}</strong>...
              </p>
            </div>
          ) : isFormW && !isPayrollRun ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 24px',
                borderRadius: '16px',
                background: 'rgba(239, 68, 68, 0.04)',
                border: '1px dashed rgba(239, 68, 68, 0.25)'
              }}
            >
              <div
                style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  color: '#ef4444',
                  fontSize: '2.2rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px'
                }}
              >
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>
                Please Run the Payroll First
              </h2>
              <p style={{ maxWidth: '540px', margin: '0 auto 26px', color: 'var(--text-secondary)', fontSize: '0.94rem', lineHeight: 1.6 }}>
                <strong>{formConfig.title || formConfig.sheetName || 'This form'}</strong> requires actual working days and attendance numbers filled and calculated during the pay run.
                {internalRunStep > 0 ? (
                  <> Payroll for <strong>{monthLabel}</strong> is currently in draft at <strong>Step {internalRunStep} of 8</strong>.</>
                ) : (
                  <> No processed payroll was found for <strong>{monthLabel}</strong>.</>
                )}
                {" "}Please complete <strong>Step 7 (Review & Calculate)</strong> or <strong>Step 8 (Finalize & Lock)</strong> in the Pay Runs wizard before viewing or downloading this form.
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                {setActiveTab && (
                  <button
                    onClick={() => setActiveTab('payruns')}
                    className="btn btn-primary"
                    style={{
                      padding: '10px 24px',
                      borderRadius: '10px',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      background: 'var(--accent-primary)',
                      borderColor: 'var(--accent-primary)'
                    }}
                  >
                    <i className="fa-solid fa-play" style={{ marginRight: '8px' }}></i>
                    Go to Pay Runs
                  </button>
                )}
                <button
                  onClick={onBack}
                  className="btn btn-outline"
                  style={{
                    padding: '10px 24px',
                    borderRadius: '10px',
                    fontSize: '0.9rem',
                    fontWeight: 600
                  }}
                >
                  <i className="fa-solid fa-arrow-left" style={{ marginRight: '8px' }}></i>
                  Back to Reports
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                overflowX: 'auto',
                borderRadius: '12px',
                border: '1px solid var(--border-subtle)'
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.88rem',
                  textAlign: 'left'
                }}
              >
                <thead>
                  {headers.map((hRow, rIdx) => (
                    <tr key={rIdx} style={{ background: rIdx === 0 ? 'var(--primary-gradient)' : 'linear-gradient(135deg, #4338ca 0%, #3730a3 100%)', color: '#ffffff' }}>
                      {hRow.map((cell, cIdx) => {
                        const isObj = cell && typeof cell === 'object';
                        const label = isObj ? cell.label : (cell || '');
                        const colSpan = isObj && cell.colSpan ? cell.colSpan : 1;
                        const rowSpan = isObj && cell.rowSpan ? cell.rowSpan : 1;
                        const align = isObj && cell.align ? cell.align : (colSpan > 1 ? 'center' : 'left');

                        return (
                          <th
                            key={cIdx}
                            colSpan={colSpan}
                            rowSpan={rowSpan}
                            style={{
                              padding: rIdx === 0 ? '12px 14px' : '10px 12px',
                              fontWeight: 700,
                              fontSize: rIdx === 0 ? '0.82rem' : '0.78rem',
                              letterSpacing: '0.3px',
                              textAlign: align,
                              borderRight: '1px solid rgba(255, 255, 255, 0.18)',
                              borderBottom: '1px solid rgba(255, 255, 255, 0.18)',
                              whiteSpace: 'nowrap',
                              ...(isObj && cell.style ? cell.style : {})
                            }}
                          >
                            {label}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {filteredBody.length === 0 ? (
                    <tr>
                      <td
                        colSpan={headers[0]?.length || 22}
                        style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.92rem' }}
                      >
                        No active database records found for this month query.
                      </td>
                    </tr>
                  ) : (
                    filteredBody.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        style={{
                          backgroundColor: rIdx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                          borderBottom: '1px solid var(--border-subtle)',
                          transition: 'background 0.2s ease'
                        }}
                      >
                        {row.map((cell, cIdx) => {
                          const isNum = typeof cell === 'number';
                          const isMoneyCol = isNum && cIdx >= 5 && cIdx <= row.length - 2;
                          const isCenterCol = cIdx === 0 || cIdx === 2 || cIdx === 3 || cIdx === 4 || cIdx === row.length - 1;
                          const formattedVal = isNum 
                            ? (isMoneyCol ? `₹${cell.toLocaleString()}` : cell.toLocaleString())
                            : (cell !== null && cell !== undefined ? String(cell) : '-');

                          return (
                            <td
                              key={cIdx}
                              style={{
                                padding: '12px 14px',
                                color: 'var(--text-primary)',
                                fontWeight: cIdx === 1 ? 600 : (cIdx === row.length - 2 ? 700 : 400),
                                textAlign: isMoneyCol ? 'right' : (isCenterCol ? 'center' : 'left'),
                                borderRight: '1px solid var(--border-subtle)',
                                whiteSpace: 'nowrap',
                                color: cIdx === row.length - 2 ? '#10b981' : 'var(--text-primary)'
                              }}
                            >
                              {formattedVal}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Form Footer Stamp */}
          <div
            style={{
              marginTop: '32px',
              paddingTop: '24px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.82rem',
              color: 'var(--text-muted)'
            }}
          >
            <span>HRMS Statutory Compliance System &bull; Database Verified</span>
            <span>Generated for Month: {monthLabel}</span>
          </div>
        </div>
      </div>

      {/* Error Popup Modal: Please Run The Payroll First */}
      {showErrorModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}
          onClick={() => setShowErrorModal(false)}
        >
          <div
            className="card glass"
            style={{
              maxWidth: '460px',
              width: '100%',
              borderRadius: '20px',
              padding: '32px',
              background: 'var(--panel-bg, #121218)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(239, 68, 68, 0.2)',
              textAlign: 'center',
              position: 'relative'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                color: '#ef4444',
                fontSize: '1.8rem'
              }}
            >
              <i className="fa-solid fa-triangle-exclamation"></i>
            </div>

            <h3 style={{ margin: '0 0 12px', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Please Run the Payroll First
            </h3>

            <p style={{ margin: '0 0 24px', fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <strong>{formConfig.title || formConfig.sheetName || 'This form'}</strong> requires actual attendance and working days data from a processed pay run.
              {internalRunStep > 0 ? (
                <> Payroll for <strong>{monthLabel}</strong> is currently at <strong>Step {internalRunStep} of 8</strong>.</>
              ) : (
                <> No processed payroll records were found for <strong>{monthLabel}</strong>.</>
              )}
              {" "}Please complete <strong>Step 7 (Review & Calculate)</strong> or <strong>Step 8 (Finalize & Lock)</strong> in the Pay Runs wizard before downloading this form.
            </p>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              {setActiveTab && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setShowErrorModal(false);
                    setActiveTab('payruns');
                  }}
                  style={{
                    padding: '10px 22px',
                    borderRadius: '10px',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    background: 'var(--accent-primary)',
                    borderColor: 'var(--accent-primary)'
                  }}
                >
                  <i className="fa-solid fa-play" style={{ marginRight: '8px' }}></i>
                  Go to Pay Runs
                </button>
              )}
              <button
                className="btn btn-outline"
                onClick={() => setShowErrorModal(false)}
                style={{
                  padding: '10px 24px',
                  borderRadius: '10px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  borderColor: 'rgba(255, 255, 255, 0.2)'
                }}
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
