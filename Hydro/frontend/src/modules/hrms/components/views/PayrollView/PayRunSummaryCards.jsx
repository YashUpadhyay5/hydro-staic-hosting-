import React, { useState } from 'react';

export default function PayRunSummaryCards({ selectedRun, employees = [], employeeCount, runItems = [] }) {
  const [epfActive, setEpfActive] = useState(true);
  const [esicActive, setEsicActive] = useState(true);
  const [lwfActive, setLwfActive] = useState(true);
  const [detailModalType, setDetailModalType] = useState(null); // 'COST' | 'DEDUCTIONS' | null

  if (!selectedRun) return null;

  // Calculate dynamic metrics from actual runItems list or fallback to employees base salary sum
  const totalEmployees = employeeCount || employees.length || 9;
  
  // Calculate total database compensation sum for fallbacks (divides annual CTC by 12)
  const totalBaseSalary = employees.reduce((sum, emp) => {
    const rawGross = Number(emp.compensationGross || emp.salary || 0);
    const monthlyBase = rawGross > 0 ? (rawGross > 100000 ? Math.round(rawGross / 12) : rawGross) : 50000;
    return sum + monthlyBase;
  }, 0);

  const processedEmployees = runItems.length > 0 
    ? runItems.filter(item => item.status === 'COMPLETED').length
    : (selectedRun.status === 'PAID' ? totalEmployees : 0);
  
  const totalCost = runItems.length > 0 
    ? runItems.reduce((sum, item) => sum + Number(item.grossEarned || 0), 0)
    : (Number(selectedRun.totalGross || 0) > 0 ? Number(selectedRun.totalGross) : totalBaseSalary);

  const netDisbursed = runItems.length > 0 
    ? runItems.reduce((sum, item) => sum + Number(item.netSalary || 0), 0)
    : (Number(selectedRun.totalNet || 0) > 0 ? Number(selectedRun.totalNet) : Math.round(totalCost * 0.85));

  const totalDeductions = totalCost - netDisbursed;

  // Per-employee figures: the stored (server-calculated) payroll items once the run is processed,
  // otherwise a rough estimate from the registered monthly salary
  const num = (v) => Number(v) || 0;
  const pick = (obj, ...keys) => {
    for (const k of keys) {
      if (obj && obj[k] != null) return num(obj[k]);
    }
    return 0;
  };
  const breakdownRows = runItems.length > 0
    ? runItems.filter(item => item.status !== 'SKIPPED_EXIT').map(item => {
        const d = item.deductionsBreakdown || {};
        const emp = employees.find(e => String(e.id) === String(item.employeeId)) || item.employee || {};
        const gross = num(item.grossEarned);
        const epfEe = pick(d, 'EPF_EE', 'PF_EE');
        const esicEe = pick(d, 'ESI_EE');
        const lwfEe = pick(d, 'LWF', 'LWF_EE');
        const pt = pick(d, 'PT');
        const totalDed = num(item.totalDeductions);
        return {
          id: item.employeeId,
          name: emp.name || item.employeeName || item.employeeId,
          code: emp.empCode || item.employeeId,
          designation: emp.designation,
          gross,
          // Employer EPF matches the employee's 12%; employer ESIC is 3.25% where ESIC applies
          epfEr: epfEe,
          esicEr: esicEe > 0 ? Math.ceil(gross * 0.0325) : 0,
          lwfEr: lwfEe > 0 ? Math.round(40 / 12) : 0,
          epfEe,
          esicEe,
          lwfEe,
          pt,
          otherDed: Math.max(0, totalDed - epfEe - esicEe - lwfEe - pt),
          totalDed
        };
      })
    : employees.map(emp => {
        const rawGross = Number(emp.compensationGross || emp.salary || 0);
        const gross = rawGross > 0 ? (rawGross > 100000 ? Math.round(rawGross / 12) : rawGross) : 50000;
        const epfEe = Math.round(Math.min(gross * 0.70, 15000) * 0.12);
        const esicEe = emp.esiEligible !== false && gross <= 21000 ? Math.ceil(gross * 0.0075) : 0;
        const pt = emp.ptEligible !== false ? 208 : 0;
        return {
          id: emp.id,
          name: emp.name,
          code: emp.empCode || emp.id,
          designation: emp.designation,
          gross,
          epfEr: epfEe,
          esicEr: esicEe > 0 ? Math.ceil(gross * 0.0325) : 0,
          lwfEr: 0,
          epfEe,
          esicEe,
          lwfEe: 0,
          pt,
          otherDed: 0,
          totalDed: epfEe + esicEe + pt
        };
      });
  const sumOf = (field) => breakdownRows.reduce((sum, row) => sum + row[field], 0);

  // Dynamic statutory components detection and calculation (EPF 12% basic, ESIC 3.25% gross, LWF ₹40/yr = ₹3.33/mo)
  const activeComponents = [];
  if (epfActive) activeComponents.push('EPF');
  if (esicActive) activeComponents.push('ESIC');
  if (lwfActive) activeComponents.push('LWF');

  const contributionsLabel = activeComponents.length > 0
    ? `Contributions (${activeComponents.join(', ')})`
    : `Contributions (None)`;

  const employerContributions = (epfActive ? sumOf('epfEr') : 0) + (esicActive ? sumOf('esicEr') : 0) + (lwfActive ? sumOf('lwfEr') : 0);

  // Calculate dynamic Calendar Days based on selected month and year
  const getCalendarDays = () => {
    let year = new Date().getFullYear();
    let monthIndex = new Date().getMonth();

    const monthStr = selectedRun.month || selectedRun.period || selectedRun.payPeriod || '';
    
    if (/^\d{4}[-/]\d{1,2}$/.test(monthStr)) {
      const parts = monthStr.split(/[-/]/);
      year = parseInt(parts[0], 10);
      monthIndex = parseInt(parts[1], 10) - 1;
    } else if (monthStr) {
      const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      const shortNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      
      const lower = monthStr.toLowerCase();
      const mIdx = monthNames.findIndex(m => lower.includes(m));
      const sIdx = shortNames.findIndex(s => lower.includes(s));
      
      if (mIdx !== -1) monthIndex = mIdx;
      else if (sIdx !== -1) monthIndex = sIdx;

      const yearMatch = monthStr.match(/\b(20\d{2})\b/);
      if (yearMatch) year = parseInt(yearMatch[1], 10);
    }

    const totalDaysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const now = new Date();
    let elapsedDays = totalDaysInMonth;

    const isCurrentMonth = (now.getFullYear() === year && now.getMonth() === monthIndex);
    if (isCurrentMonth) {
      elapsedDays = Math.min(now.getDate(), totalDaysInMonth);
    } else if (now.getFullYear() < year || (now.getFullYear() === year && now.getMonth() < monthIndex)) {
      elapsedDays = 0;
    }

    return `${elapsedDays} / ${totalDaysInMonth}`;
  };

  const calendarDaysDisplay = getCalendarDays();

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '16px',
      marginBottom: '20px'
    }}>
      {/* Left Block: Cycle Details */}
      <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px', display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ flex: 1, borderRight: '1px solid var(--border-glass)', paddingRight: '10px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>TOTAL EMPLOYEES</span>
          <h4 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '6px 0 0 0' }}>{totalEmployees}</h4>
        </div>
        <div style={{ flex: 1, borderRight: '1px solid var(--border-glass)', paddingRight: '10px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>CALENDAR DAYS</span>
          <h4 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '6px 0 0 0' }}>{calendarDaysDisplay}</h4>
        </div>
        <div style={{ flex: 1.2 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>PAYROLL PROCESSED</span>
          <h4 style={{ fontSize: '1.3rem', fontWeight: 700, margin: '6px 0 0 0', color: 'var(--accent-primary)' }}>
            {processedEmployees}/{totalEmployees} <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>completed</span>
          </h4>
        </div>
      </div>

      {/* Right Block: Financial Details */}
      <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div 
          onClick={() => setDetailModalType('COST')} 
          style={{ cursor: 'pointer', padding: '4px', borderRadius: '6px', transition: 'all 0.2s ease' }}
          title="Click to view detailed itemized Total Payroll Cost breakdown"
        >
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Total Payroll Cost <i className="fa-solid fa-circle-info" style={{ color: 'var(--accent-primary)', fontSize: '0.7rem' }}></i>
          </span>
          <strong style={{ fontSize: '1.15rem', color: 'var(--text-primary)' }}>₹{totalCost.toLocaleString()}</strong>
        </div>

        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>Net Disbursed</span>
          <strong style={{ fontSize: '1.15rem', color: '#10b981' }}>₹{netDisbursed.toLocaleString()}</strong>
        </div>

        <div 
          onClick={() => setDetailModalType('DEDUCTIONS')} 
          style={{ cursor: 'pointer', padding: '4px', borderRadius: '6px', transition: 'all 0.2s ease' }}
          title="Click to view detailed itemized Total Deductions breakdown"
        >
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Total Deductions <i className="fa-solid fa-circle-info" style={{ color: '#ef4444', fontSize: '0.7rem' }}></i>
          </span>
          <strong style={{ fontSize: '1.15rem', color: '#ef4444' }}>₹{totalDeductions.toLocaleString()}</strong>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{contributionsLabel}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={epfActive} onChange={e => setEpfActive(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)' }} />
              <span style={{ color: epfActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: epfActive ? 600 : 400 }}>EPF</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={esicActive} onChange={e => setEsicActive(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)' }} />
              <span style={{ color: esicActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: esicActive ? 600 : 400 }}>ESIC</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={lwfActive} onChange={e => setLwfActive(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)' }} />
              <span style={{ color: lwfActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: lwfActive ? 600 : 400 }}>LWF</span>
            </label>
          </div>
          <strong style={{ fontSize: '1.15rem', color: 'var(--text-primary)' }}>₹{employerContributions.toLocaleString()}</strong>
        </div>
      </div>

      {/* DETAILED FINANCIAL BREAKDOWN MODAL */}
      {detailModalType && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="card glass" style={{ width: '850px', maxHeight: '85vh', padding: '24px', borderRadius: '14px', background: 'var(--bg-dark)', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                  <i className={`fa-solid ${detailModalType === 'COST' ? 'fa-chart-pie' : 'fa-receipt'}`} style={{ color: detailModalType === 'COST' ? 'var(--accent-primary)' : '#ef4444' }}></i>
                  {detailModalType === 'COST' ? 'Total Employer Payroll Cost Breakdown' : 'Total Employee Deductions Breakdown'}
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Detailed itemized financial audit for pay period {selectedRun.month} ({breakdownRows.length} Employees){runItems.length === 0 ? ' - estimate, payroll not processed yet' : ''}
                </span>
              </div>
              <button className="btn btn-ghost" onClick={() => setDetailModalType(null)} style={{ fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
            </div>

            {/* Financial Summary Cards */}
            {detailModalType === 'COST' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block' }}>GROSS SALARIES</span>
                  <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>₹{totalCost.toLocaleString()}</strong>
                </div>
                <div style={{ background: 'rgba(79, 70, 229, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(79, 70, 229, 0.2)' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', display: 'block' }}>EMPLOYER EPF (12%)</span>
                  <strong style={{ fontSize: '1rem', color: 'var(--accent-primary)' }}>₹{sumOf('epfEr').toLocaleString()}</strong>
                </div>
                <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#3b82f6', display: 'block' }}>EMPLOYER ESIC (3.25%)</span>
                  <strong style={{ fontSize: '1rem', color: '#3b82f6' }}>₹{sumOf('esicEr').toLocaleString()}</strong>
                </div>
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#10b981', display: 'block' }}>TOTAL PAYROLL COST</span>
                  <strong style={{ fontSize: '1.05rem', color: '#10b981' }}>₹{(totalCost + employerContributions).toLocaleString()}</strong>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <div style={{ background: 'rgba(239, 68, 68, 0.08)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#ef4444', display: 'block' }}>EMPLOYEE EPF (12%)</span>
                  <strong style={{ fontSize: '1rem', color: '#ef4444' }}>₹{sumOf('epfEe').toLocaleString()}</strong>
                </div>
                <div style={{ background: 'rgba(245, 158, 11, 0.08)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#f59e0b', display: 'block' }}>EMPLOYEE ESIC (0.75%)</span>
                  <strong style={{ fontSize: '1rem', color: '#f59e0b' }}>₹{sumOf('esicEe').toLocaleString()}</strong>
                </div>
                <div style={{ background: 'rgba(139, 92, 246, 0.08)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#8b5cf6', display: 'block' }}>PROFESSIONAL TAX (PT)</span>
                  <strong style={{ fontSize: '1rem', color: '#8b5cf6' }}>₹{sumOf('pt').toLocaleString()}</strong>
                </div>
                <div style={{ background: 'rgba(239, 68, 68, 0.12)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#ef4444', display: 'block' }}>TOTAL DEDUCTIONS</span>
                  <strong style={{ fontSize: '1.05rem', color: '#ef4444' }}>₹{totalDeductions.toLocaleString()}</strong>
                </div>
              </div>
            )}

            {/* Per-Employee Itemized Table */}
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', borderRadius: '8px', overflow: 'hidden' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)' }}>
                    <th style={{ padding: '10px 14px' }}>EMPLOYEE</th>
                    {detailModalType === 'COST' ? (
                      <>
                        <th style={{ padding: '10px 14px', textAlign: 'right' }}>GROSS SALARY</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--accent-primary)' }}>EPF ER (12%)</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right', color: '#3b82f6' }}>ESIC ER (3.25%)</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right', color: '#10b981' }}>LWF ER</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right' }}>TOTAL COST</th>
                      </>
                    ) : (
                      <>
                        <th style={{ padding: '10px 14px', textAlign: 'right', color: '#ef4444' }}>EPF EE (12%)</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right', color: '#f59e0b' }}>ESIC EE (0.75%)</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right' }}>LWF EE</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right', color: '#8b5cf6' }}>PROF. TAX</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right' }}>OTHER (VPF / TDS / ADVANCE)</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right', color: '#ef4444' }}>TOTAL DED.</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody style={{ fontSize: '0.8rem' }}>
                  {breakdownRows.map(row => {
                    const employerEpf = epfActive ? row.epfEr : 0;
                    const employerEsic = esicActive ? row.esicEr : 0;
                    const employerLwf = lwfActive ? row.lwfEr : 0;
                    const totalEmpCost = row.gross + employerEpf + employerEsic + employerLwf;

                    return (
                      <tr key={row.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                        <td style={{ padding: '10px 14px' }}>
                          <strong>{row.name}</strong><br/>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{row.code} • {row.designation || 'Staff'}</span>
                        </td>
                        {detailModalType === 'COST' ? (
                          <>
                            <td style={{ padding: '10px 14px', textAlign: 'right' }}>₹{row.gross.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--accent-primary)' }}>₹{employerEpf.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: '#3b82f6' }}>₹{employerEsic.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: '#10b981' }}>₹{employerLwf.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>₹{totalEmpCost.toLocaleString()}</td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: '#ef4444' }}>₹{row.epfEe.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: '#f59e0b' }}>₹{row.esicEe.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right' }}>₹{row.lwfEe.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: '#8b5cf6' }}>₹{row.pt.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right' }}>₹{row.otherDed.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>₹{row.totalDed.toLocaleString()}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '10px', borderTop: '1px solid var(--border-glass)' }}>
              <button className="btn btn-outline" onClick={() => setDetailModalType(null)} style={{ padding: '8px 20px', fontSize: '0.8rem' }}>Close Audit Window</button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
