import React, { useState, useMemo, useEffect } from 'react';
import { api } from '../../../services/api';
import {
  COMPLIANCE_FORMS_CONFIG,
  exportFormToExcel,
  exportAllFormsToExcel,
  exportFormToPDF,
  getCurrentMonthYYYYMM,
  formatMonthYearLabel
} from '../../../data/complianceFormsData';
import ComplianceFormFullView from './ComplianceFormFullView';
import { resolvePayrollRunItems, resolveOverrideValue } from '../../../services/payrollItemResolver';

export default function ReportTab({
  employees = [],
  attendance = [],
  leaves = [],
  runItems = [],
  selectedReportMonth,
  setSelectedReportMonth,
  taxEmp,
  handleLoadTaxRecord,
  taxRegime,
  setTaxRegime,
  sec80C,
  setSec80C,
  sec80D,
  setSec80D,
  rentPaid,
  setRentPaid,
  handleSaveTax,
  setActiveTab
}) {
  const [selectedForm, setSelectedForm] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(selectedReportMonth || getCurrentMonthYYYYMM());
  const [selectedLocation, setSelectedLocation] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [activeSection, setActiveSection] = useState('compliance'); // 'compliance' | 'tax'
  const [internalEmployees, setInternalEmployees] = useState([]);
  const [internalRunItems, setInternalRunItems] = useState([]);
  const [hasRunForMonth, setHasRunForMonth] = useState(false);
  const [currentRunStep, setCurrentRunStep] = useState(0);
  const [loadingPayRun, setLoadingPayRun] = useState(false);
  const [payrollErrorModal, setPayrollErrorModal] = useState({ show: false, month: '', currentStep: 0 });
  const [attendanceSettings, setAttendanceSettings] = useState({});
  const [reportRefreshKey, setReportRefreshKey] = useState(0);

  useEffect(() => {
    const handleEmpUpdated = () => {
      setReportRefreshKey(k => k + 1);
      api.getEmployees({ limit: 1000 })
        .then(res => {
          const list = Array.isArray(res) ? res : (res?.data || []);
          if (list.length > 0) setInternalEmployees(list);
        })
        .catch(() => {});
    };
    window.addEventListener('employee-updated', handleEmpUpdated);
    return () => window.removeEventListener('employee-updated', handleEmpUpdated);
  }, []);

  // Auto-fetch employees if none were passed from parent
  useEffect(() => {
    if ((!employees || employees.length === 0) && internalEmployees.length === 0) {
      api.getEmployees({ limit: 1000 })
        .then(res => {
          const list = Array.isArray(res) ? res : (res?.data || []);
          if (list.length > 0) setInternalEmployees(list);
        })
        .catch(e => console.warn('Could not auto-fetch employees in ReportTab:', e));
    }
  }, [employees, internalEmployees.length]);

  // Fetch attendance shift policy once
  useEffect(() => {
    api.getSettings()
      .then(res => {
        const s = res?.data || res || {};
        setAttendanceSettings(s);
      })
      .catch(e => console.warn('Could not fetch settings in ReportTab:', e));
  }, []);

  const allEmployees = employees && employees.length > 0 ? employees : internalEmployees;

  // Auto-fetch pay run items & wizard edits strictly for selectedMonth
  useEffect(() => {
    let isCancelled = false;
    setLoadingPayRun(true);
    api.getPayrollRuns()
      .then(runs => {
        if (isCancelled || !Array.isArray(runs)) return;
        // Strictly find run for selectedMonth - NO FALLBACK to other months!
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
            setCurrentRunStep(step);

            // Pay run exists for this month -> mark as active and resolve live items with all wizard state
            setHasRunForMonth(true);
            const resolved = resolvePayrollRunItems(targetRun, baseItems, parsedWs, allEmployees, attendance, leaves);
            setInternalRunItems(resolved);
          });
        } else {
          setCurrentRunStep(0);
          setHasRunForMonth(false);
          setInternalRunItems([]);
        }
      })
      .catch(e => {
        console.warn('Could not auto-fetch pay run items in ReportTab:', e);
        if (!isCancelled) {
          setHasRunForMonth(false);
          setInternalRunItems([]);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoadingPayRun(false);
        }
      });

    return () => { isCancelled = true; };
  }, [selectedMonth, employees, reportRefreshKey]);

  const effectiveRunItems = hasRunForMonth 
    ? ((internalRunItems && internalRunItems.length > 0) ? internalRunItems : (runItems || []))
    : [];
  const isPayrollRun = Boolean(hasRunForMonth && effectiveRunItems.length > 0);

  // Sync selectedMonth with selectedReportMonth from parent
  useEffect(() => {
    if (selectedReportMonth && selectedReportMonth !== selectedMonth) {
      setSelectedMonth(selectedReportMonth);
    }
  }, [selectedReportMonth]);

  const monthLabel = formatMonthYearLabel(selectedMonth);

  const handleOpenForm = (form) => {
    const isWageForm = form.sheetName === 'Form W' || form.id === 'form-w' || form.sheetName === 'Form T' || form.id === 'form-t';
    if (isWageForm && !isPayrollRun && !loadingPayRun) {
      setPayrollErrorModal({ show: true, month: monthLabel, currentStep: currentRunStep });
      return;
    }
    setSelectedForm(form);
  };

  const handleExportFormExcel = (form) => {
    const isWageForm = form.sheetName === 'Form W' || form.id === 'form-w' || form.sheetName === 'Form T' || form.id === 'form-t';
    if (isWageForm && !isPayrollRun && !loadingPayRun) {
      setPayrollErrorModal({ show: true, month: monthLabel, currentStep: currentRunStep });
      return;
    }
    exportFormToExcel(form.sheetName, selectedMonth, filteredEmployees, attendance, leaves, effectiveRunItems, attendanceSettings);
  };

  const handleExportFormPDF = (form) => {
    const isWageForm = form.sheetName === 'Form W' || form.id === 'form-w' || form.sheetName === 'Form T' || form.id === 'form-t';
    if (isWageForm && !isPayrollRun && !loadingPayRun) {
      setPayrollErrorModal({ show: true, month: monthLabel, currentStep: currentRunStep });
      return;
    }
    exportFormToPDF(`printable-compliance-view-${form.id}`, form.title, selectedMonth);
  };

  const handleExportAllForms = () => {
    if (!isPayrollRun && !loadingPayRun) {
      setPayrollErrorModal({ show: true, month: monthLabel, currentStep: currentRunStep });
      return;
    }
    exportAllFormsToExcel(selectedMonth, filteredEmployees, attendance, leaves, effectiveRunItems, attendanceSettings);
  };

  // Dynamic location list derived from DB employees
  const locationsList = useMemo(() => {
    const locSet = new Set(['ALL']);
    if (allEmployees && Array.isArray(allEmployees)) {
      allEmployees.forEach(emp => {
        const loc = emp.location || emp.site;
        if (loc && typeof loc === 'string' && loc.trim() !== '') {
          locSet.add(loc.trim());
        }
      });
    }
    locSet.add('Headquarters');
    locSet.add('Branch Office');
    locSet.add('Field Sites');
    return Array.from(locSet);
  }, [allEmployees]);

  // Dynamically filter employees by Location and Status
  const filteredEmployees = useMemo(() => {
    if (!allEmployees || !Array.isArray(allEmployees)) return [];
    return allEmployees.filter(emp => {
      // 1. Location Filter
      if (selectedLocation !== 'ALL') {
        const empLoc = String(emp.location || emp.site || '').trim().toLowerCase();
        if (empLoc !== selectedLocation.trim().toLowerCase()) {
          return false;
        }
      }
      // 2. Status Filter
      if (selectedStatus === 'ACTIVE') {
        const st = String(emp.status || '').trim().toUpperCase();
        if (st !== 'ACTIVE') return false;
      } else if (selectedStatus === 'NOT_ACTIVE') {
        const st = String(emp.status || '').trim().toUpperCase();
        if (st === 'ACTIVE') return false;
      }
      return true;
    });
  }, [allEmployees, selectedLocation, selectedStatus]);

  // If a form is selected, render full-page view in the same tab
  if (selectedForm) {
    return (
      <ComplianceFormFullView
        formConfig={selectedForm}
        onBack={() => setSelectedForm(null)}
        selectedMonth={selectedMonth}
        setSelectedMonth={(m) => {
          setSelectedMonth(m);
          if (setSelectedReportMonth) setSelectedReportMonth(m);
        }}
        selectedLocation={selectedLocation}
        setSelectedLocation={setSelectedLocation}
        selectedStatus={selectedStatus}
        setSelectedStatus={setSelectedStatus}
        locationsList={locationsList}
        employees={filteredEmployees}
        attendance={attendance}
        leaves={leaves}
        runItems={effectiveRunItems}
        loadingPayRun={loadingPayRun}
        attendanceSettings={attendanceSettings}
        currentRunStep={currentRunStep}
        setActiveTab={setActiveTab}
      />
    );
  }

  return (
    <div className="reports-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Banner Header */}
      <div
        className="card glass"
        style={{
          padding: '24px 30px',
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
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <span
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'var(--primary-gradient)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '1.25rem',
                boxShadow: '0 6px 16px rgba(99, 102, 241, 0.35)'
              }}
            >
              <i className="fa-solid fa-file-invoice"></i>
            </span>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              HR Statutory & Compliance Reports
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: '740px', lineHeight: '1.5' }}>
            Official statutory compliance forms (Form S, U, V Muster, V Register, X, T, W) generated dynamically for <strong>{monthLabel}</strong> using active database records.
          </p>
        </div>

        {/* Dynamic Filters Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* Month Selector Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              <i className="fa-regular fa-calendar" style={{ marginRight: '6px' }}></i>
              Month & Year:
            </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => {
                setSelectedMonth(e.target.value);
                if (setSelectedReportMonth) setSelectedReportMonth(e.target.value);
              }}
              style={{
                padding: '9px 14px',
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

          {/* Location Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              <i className="fa-solid fa-location-dot" style={{ marginRight: '6px' }}></i>
              Location:
            </label>
            <select
              value={selectedLocation}
              onChange={e => setSelectedLocation(e.target.value)}
              style={{
                padding: '9px 14px',
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
              {locationsList.filter(l => l !== 'ALL').map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>

          {/* Employee Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              <i className="fa-solid fa-user-check" style={{ marginRight: '6px' }}></i>
              Status:
            </label>
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              style={{
                padding: '9px 14px',
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
              <option value="ACTIVE">Active Employees</option>
              <option value="NOT_ACTIVE">Not Active / Inactive</option>
            </select>
          </div>

          {/* Employee Count Pill */}
          <div
            style={{
              padding: '8px 14px',
              borderRadius: '10px',
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              color: '#6366f1',
              fontSize: '0.82rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <i className="fa-solid fa-users"></i>
            {filteredEmployees.length} {filteredEmployees.length === 1 ? 'Employee' : 'Employees'}
          </div>

          {/* Download All Forms */}
          <button
            onClick={handleExportAllForms}
            className="btn btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '11px 22px',
              fontSize: '0.9rem',
              fontWeight: 600,
              boxShadow: '0 4px 16px rgba(16, 185, 129, 0.35)',
              backgroundColor: '#10b981',
              borderColor: '#10b981',
              borderRadius: '12px',
              cursor: 'pointer'
            }}
          >
            <i className="fa-solid fa-file-excel" style={{ fontSize: '1.15rem' }}></i>
            Download All Forms ({monthLabel})
          </button>
        </div>
      </div>

      {/* Sub-Navigation Switcher */}
      <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
        <button
          onClick={() => setActiveSection('compliance')}
          className={`btn ${activeSection === 'compliance' ? 'btn-primary' : 'btn-outline'}`}
          style={{ padding: '10px 22px', fontSize: '0.88rem', fontWeight: 600, borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <i className="fa-solid fa-folder-open"></i>
          Compliance Statutory Forms ({COMPLIANCE_FORMS_CONFIG.length})
        </button>
        <button
          onClick={() => setActiveSection('tax')}
          className={`btn ${activeSection === 'tax' ? 'btn-primary' : 'btn-outline'}`}
          style={{ padding: '10px 22px', fontSize: '0.88rem', fontWeight: 600, borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <i className="fa-solid fa-calculator"></i>
          Tax Regime & TDS Calculator
        </button>
      </div>

      {/* Compliance Forms Cards Grid */}
      {activeSection === 'compliance' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
            gap: '24px'
          }}
        >
          {COMPLIANCE_FORMS_CONFIG.map(form => (
            <div
              key={form.id}
              className="card glass"
              style={{
                borderRadius: '20px',
                padding: '26px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: '1px solid var(--border-subtle)',
                background: 'var(--panel-bg)',
                backdropFilter: 'blur(20px)',
                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                cursor: 'pointer',
                boxShadow: 'var(--card-shadow)'
              }}
              onClick={() => handleOpenForm(form)}
            >
              <div>
                {/* Card Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '14px',
                        background: form.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: '1.35rem',
                        boxShadow: `0 6px 16px ${form.color}40`
                      }}
                    >
                      <i className={`fa-solid ${form.icon}`}></i>
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {form.title}
                      </h3>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        {form.category}
                      </span>
                    </div>
                  </div>

                  <span
                    style={{
                      padding: '4px 12px',
                      borderRadius: '16px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: `${form.color}20`,
                      color: form.color,
                      border: `1px solid ${form.color}40`
                    }}
                  >
                    {form.badge}
                  </span>
                </div>

                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {form.name}
                </h4>

                <p style={{ margin: '0 0 16px 0', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  {form.description}
                </p>

                <div
                  style={{
                    display: 'inline-block',
                    padding: '4px 12px',
                    borderRadius: '8px',
                    fontSize: '0.76rem',
                    background: 'var(--input-bg)',
                    color: 'var(--text-muted)',
                    marginBottom: '20px',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <i className="fa-solid fa-scale-balanced" style={{ marginRight: '6px', color: form.color }}></i>
                  {form.rule} &bull; <strong>{monthLabel}</strong>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div
                style={{
                  paddingTop: '18px',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px'
                }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  onClick={() => handleOpenForm(form)}
                  className="btn btn-primary"
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <i className="fa-solid fa-expand"></i>
                  Full Page View
                </button>

                <button
                  onClick={() => handleExportFormExcel(form)}
                  title={`Download Excel for ${monthLabel}`}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid #10b981',
                    background: 'rgba(16, 185, 129, 0.1)',
                    color: '#10b981',
                    fontSize: '0.92rem',
                    cursor: 'pointer'
                  }}
                >
                  <i className="fa-solid fa-file-excel"></i>
                </button>

                <button
                  onClick={() => handleExportFormPDF(form)}
                  title={`Download PDF for ${monthLabel}`}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid #ef4444',
                    background: 'rgba(239, 68, 68, 0.1)',
                    color: '#ef4444',
                    fontSize: '0.92rem',
                    cursor: 'pointer'
                  }}
                >
                  <i className="fa-solid fa-file-pdf"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tax Section */}
      {activeSection === 'tax' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
          <div className="card glass" style={{ padding: '24px', borderRadius: '16px', height: 'fit-content' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.05rem', color: 'var(--text-primary)' }}>Regime Selection</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Employee Profile</label>
                <select
                  value={taxEmp}
                  onChange={e => handleLoadTaxRecord(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                >
                  <option value="">Select Employee...</option>
                  {filteredEmployees?.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              {taxEmp && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Regime Option</label>
                    <select
                      value={taxRegime}
                      onChange={e => setTaxRegime(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                    >
                      <option value="NEW">New Tax Regime (Section 115BAC)</option>
                      <option value="OLD">Old Tax Regime (With Deductions)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>80C Declarations (₹)</label>
                    <input
                      type="number"
                      value={sec80C}
                      onChange={e => setSec80C(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>80D Declarations (₹)</label>
                    <input
                      type="number"
                      value={sec80D}
                      onChange={e => setSec80D(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Annual Rent Paid for HRA (₹)</label>
                    <input
                      type="number"
                      value={rentPaid}
                      onChange={e => setRentPaid(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                    />
                  </div>
                  <button className="btn btn-primary" onClick={handleSaveTax} style={{ marginTop: '8px' }}>Save & Project TDS</button>
                </>
              )}
            </div>
          </div>

          <div className="card glass" style={{ padding: '28px', borderRadius: '16px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', color: 'var(--text-primary)' }}>HRA, Regime & TDS Calculator Overview</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              Selecting <strong>New Regime</strong> gives a flat slab structure with standard deduction of ₹75,000. Selecting <strong>Old Regime</strong> allows claiming HRA exemptions (least of rent excess over 10% basic, actual HRA, or 50% basic) and deductions under Section 80C (up to ₹1,50,000) and 80D (up to ₹25,000). The taxation engine runs monthly projections and divides annual tax liabilities into equal monthly TDS cuts.
            </p>
          </div>
        </div>
      )}

      {/* Error Popup Modal: Please Run The Payroll First */}
      {payrollErrorModal.show && (
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
          onClick={() => setPayrollErrorModal({ show: false, month: '' })}
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
              Form W (Register of Wages) requires actual attendance and working days data filled and calculated from a processed pay run.
              {payrollErrorModal.currentStep > 0 ? (
                <> Payroll for <strong>{payrollErrorModal.month}</strong> is currently in draft at <strong>Step {payrollErrorModal.currentStep} of 8</strong>.</>
              ) : (
                <> No processed payroll records were found for <strong>{payrollErrorModal.month}</strong>.</>
              )}
              {" "}Please complete <strong>Step 7 (Review & Calculate)</strong> or <strong>Step 8 (Finalize & Lock)</strong> in the Pay Runs wizard before accessing or downloading this form.
            </p>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              {setActiveTab && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setPayrollErrorModal({ show: false, month: '', currentStep: 0 });
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
                onClick={() => setPayrollErrorModal({ show: false, month: '', currentStep: 0 })}
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
