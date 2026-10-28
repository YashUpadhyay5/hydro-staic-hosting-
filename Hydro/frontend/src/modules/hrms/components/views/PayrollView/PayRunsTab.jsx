import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../../services/api';
import PayRunCycleSelector from './PayRunCycleSelector';
import PayRunSummaryCards from './PayRunSummaryCards';
import PayRunWizardSteps from './PayRunWizardSteps';
import PayRunActivitySidebar from './PayRunActivitySidebar';
import { resolvePayrollRunItems } from '../../../services/payrollItemResolver';

export default function PayRunsTab({
  runs = [],
  employees = [],
  reimbursements = [],
  adminUser,
  newRunMonth,
  setNewRunMonth,
  handleCreateRun,
  handleDeleteRun,
  handleProcessRun,
  handleDisburseRun,
  handleViewItems
}) {
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedRunItems, setSelectedRunItems] = useState([]);
  const [isWizardActive, setIsWizardActive] = useState(false);
  const [initialWizardStep, setInitialWizardStep] = useState(1);

  // Deactivated employees check state for active cycle
  const [tabDeactivatedData, setTabDeactivatedData] = useState([]);
  const [tabCheckedExited, setTabCheckedExited] = useState({});

  // Get max completed step for selected run from persistent draft state or run status
  const getCompletedStepNumber = () => {
    if (!selectedRun) return 0;
    if (selectedRun.status === 'PAID' || selectedRun.status === 'COMPLETED') return 8;
    try {
      const savedDraft = localStorage.getItem(`payroll_wizard_draft_${selectedRun.id}`);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed.completedStep) return parsed.completedStep;
      }
    } catch (err) {
      console.error("Draft read error", err);
    }
    // Fallback to database wizardState stored on the run (multi-device sync)
    try {
      const ws = selectedRun.wizardState || selectedRun.wizard_state;
      if (ws) {
        const parsed = typeof ws === 'string' ? JSON.parse(ws) : ws;
        if (parsed.completedStep) return parsed.completedStep;
      }
    } catch (err) {
      console.error("Run wizardState read error", err);
    }
    return 0;
  };

  const completedStepCount = getCompletedStepNumber();

  // Local state for payroll wizard activities, initialized empty
  const [activities, setActivities] = useState([]);

  const handleEnterStep = (stepId) => {
    setInitialWizardStep(stepId);
    setIsWizardActive(true);
  };

  const logActivity = (actionText) => {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userName = (adminUser && adminUser.name) || 'Admin';
    setActivities(prev => [
      { time: timeString, user: userName, action: actionText },
      ...prev
    ]);
  };

  // Set the default selected run to the latest current run when runs list loads
  useEffect(() => {
    if (runs.length > 0 && !selectedRun) {
      const currentRun = runs.find(r => r.status !== 'PAID') || runs[runs.length - 1];
      setSelectedRun(currentRun);
    }
  }, [runs]);

  // Keep selectedRun in sync with updated runs data from API
  useEffect(() => {
    if (selectedRun && runs.length > 0) {
      const updated = runs.find(r => r.id === selectedRun.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedRun)) {
        setSelectedRun(updated);
      }
    }
  }, [runs]);

  // Fetch selected run items dynamically to enable dynamic calculations of LOP, overrides, etc.
  useEffect(() => {
    if (selectedRun) {
      api.getPayrollRunItems(selectedRun.id)
        .then(items => setSelectedRunItems(items || []))
        .catch(err => {
          console.error(err);
          setSelectedRunItems([]);
        });

      if (selectedRun.month) {
        api.getDeactivatedCheck(selectedRun.month)
          .then(res => {
            if (res && res.deactivatedEmployees) {
              setTabDeactivatedData(res.deactivatedEmployees);
              const initMap = {};
              res.deactivatedEmployees.forEach(e => {
                initMap[e.id] = false;
              });
              setTabCheckedExited(initMap);
            }
          })
          .catch(err => console.warn("Tab deactivated check error:", err));
      }
    } else {
      setSelectedRunItems([]);
      setTabDeactivatedData([]);
    }
  }, [selectedRun]);

  // Filter employees for the active pay run:
  // Deactivated employees (status === 'PAST') are NEVER part of the run payroll
  // UNLESS they are explicitly checked in tabCheckedExited for their single settlement window
  const activePayRunEmployees = employees.filter(emp => {
    if (emp.status === 'PAST') {
      return !!tabCheckedExited[emp.id];
    }
    return true;
  });

  // Dynamically resolve items with latest employee salary and wizard state
  const resolvedRunItems = useMemo(() => {
    return resolvePayrollRunItems(selectedRun, selectedRunItems, selectedRun?.wizardState, activePayRunEmployees);
  }, [selectedRun, selectedRunItems, activePayRunEmployees]);

  useEffect(() => {
    const handleEmpUpdated = () => {
      if (selectedRun) {
        api.getPayrollRunItems(selectedRun.id)
          .then(items => setSelectedRunItems(items || []))
          .catch(() => {});
      }
    };
    window.addEventListener('employee-updated', handleEmpUpdated);
    return () => window.removeEventListener('employee-updated', handleEmpUpdated);
  }, [selectedRun]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. Cycle Selector Slider (Hide when inside wizard to focus user on steps) */}
      {runs.length > 0 && !isWizardActive && (
        <PayRunCycleSelector 
          runs={runs} 
          selectedRun={selectedRun} 
          onSelectRun={setSelectedRun} 
          onDeleteRun={handleDeleteRun}
        />
      )}

      {selectedRun ? (
        <>
          {/* Cycle Specific Title & Info Alert */}
          {!isWizardActive ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Pay Cycle Summary: {(() => {
                    if (!selectedRun || !selectedRun.month) return '';
                    const [y, m] = selectedRun.month.split('-').map(Number);
                    return new Date(y, (m || 1) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
                  })()} ({selectedRun.month})
                </h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="month"
                    value={newRunMonth}
                    onChange={e => setNewRunMonth(e.target.value)}
                    style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', fontSize: '0.85rem' }}
                  />
                  <button className="btn btn-primary" onClick={handleCreateRun} style={{ fontSize: '0.85rem' }}>
                    <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Create Run
                  </button>
                  {handleDeleteRun && selectedRun && (
                    <button 
                      className="btn btn-outline" 
                      onClick={() => handleDeleteRun(selectedRun.id)} 
                      style={{ fontSize: '0.85rem', color: '#ef4444', borderColor: '#fca5a5', background: '#fff' }}
                      title={`Delete pay run for ${selectedRun.month}`}
                    >
                      <i className="fa-solid fa-trash-can" style={{ marginRight: '6px' }}></i> Delete Run
                    </button>
                  )}
                </div>
              </div>

              {/* Alert Message for changes */}
              {/* Deactivated Employees Warning Banner */}
              {tabDeactivatedData.length > 0 && selectedRun && selectedRun.status !== 'PAID' && (
                <div style={{
                  background: '#fffbeb',
                  border: '2px solid #f59e0b',
                  borderRadius: '12px',
                  padding: '16px 20px',
                  boxShadow: '0 4px 12px rgba(245, 158, 11, 0.12)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '1.4rem' }}>⚠️</span>
                      <div>
                        <strong style={{ fontSize: '0.95rem', color: '#92400e' }}>
                          "These employees are no longer part of this organization. Do you want to process their payroll also?"
                        </strong>
                        <div style={{ fontSize: '0.78rem', color: '#b45309', marginTop: '2px' }}>
                          {tabDeactivatedData.length} deactivated employee(s) detected. Check the box to process their salary settlement, or leave unchecked to archive without payment.
                        </div>
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleEnterStep(2)}
                      style={{ padding: '6px 16px', fontSize: '0.82rem', background: '#d97706', borderColor: '#d97706', color: '#fff', fontWeight: 700 }}
                    >
                      <i className="fa-solid fa-user-pen" style={{ marginRight: '6px' }}></i> Review in Wizard
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    {tabDeactivatedData.map(emp => {
                      const isChecked = !!tabCheckedExited[emp.id];
                      return (
                        <label
                          key={emp.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 14px',
                            borderRadius: '8px',
                            border: isChecked ? '1px solid #10b981' : '1px solid #e2e8f0',
                            background: isChecked ? '#f0fdf4' : '#ffffff',
                            cursor: 'pointer',
                            fontSize: '0.82rem'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => setTabCheckedExited(prev => ({ ...prev, [emp.id]: e.target.checked }))}
                            style={{ accentColor: '#10b981', cursor: 'pointer' }}
                          />
                          <span style={{ fontWeight: 600, color: '#1e293b' }}>{emp.name}</span>
                          <span style={{ color: '#64748b', fontSize: '0.75rem' }}>({emp.empCode || emp.id})</span>
                          <span style={{ color: isChecked ? '#15803d' : '#94a3b8', fontWeight: 700, fontSize: '0.75rem' }}>
                            {isChecked ? '☑️ INCLUDED' : '⬜ SKIPPED'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="glass alert" style={{
                padding: '12px 20px',
                borderRadius: '8px',
                background: 'rgba(245, 158, 11, 0.08)',
                color: '#f59e0b',
                borderLeft: '4px solid #f59e0b',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <i className="fa-solid fa-triangle-exclamation"></i>
                <span>There are changes in payroll inputs since the last process. Run calculations to update balances before locking.</span>
              </div>

              {/* 2. Summary Metrics Cards */}
              <PayRunSummaryCards 
                selectedRun={selectedRun} 
                employees={activePayRunEmployees}
                employeeCount={activePayRunEmployees.length} 
                runItems={resolvedRunItems}
              />

              {/* 3. Main Grid layout: Steps & Activity Sidebar */}
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px', alignItems: 'flex-start' }}>
                {/* Steps Overview Summary */}
                <div className="card glass" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'center' }}>
                    <div style={{ fontSize: '2rem', color: 'var(--accent-primary)' }}>
                      <i className="fa-solid fa-wand-magic-sparkles"></i>
                    </div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Payroll Run Wizard Checklist</h3>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '500px', margin: '0 auto', textAlign: 'center' }}>
                    Review attendance, LOP calculations, new joinees, revisions, and statutory overrides. Click on any step to open directly.
                  </p>
                  
                  {/* Production-grade Step Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '12px',
                    margin: '10px 0',
                    textAlign: 'left'
                  }}>
                    {[
                      { id: 1, label: 'Leave & Payable Units', icon: 'fa-calendar-check', desc: 'Verify LOP & leaves' },
                      { id: 2, label: 'New Joinees & Exits', icon: 'fa-user-plus', desc: 'Settlement & new hires' },
                      { id: 3, label: 'Revisions & Bonus', icon: 'fa-arrow-trend-up', desc: 'CTCs & special bonuses' },
                      { id: 4, label: 'Ad-hoc Adjustments', icon: 'fa-file-invoice-dollar', desc: 'Payments, deductions, arrears' },
                      { id: 5, label: 'Salary Hold', icon: 'fa-pause', desc: 'Exclude / hold salary payouts' },
                      { id: 6, label: 'Statutory Overrides', icon: 'fa-percent', desc: 'Custom TDS, EPF overrides' },
                      { id: 7, label: 'Validation & Preview', icon: 'fa-circle-check', desc: 'Audit blocking alerts & warnings' },
                      { id: 8, label: 'Finalize & Lock', icon: 'fa-lock', desc: 'Freeze salaries & release slips' }
                    ].map(step => {
                      const isCompleted = step.id <= completedStepCount;

                      return (
                        <div 
                          key={step.id}
                          onClick={() => handleEnterStep(step.id)}
                          style={{
                            background: isCompleted ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                            border: isCompleted ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid var(--border-glass)',
                            borderRadius: '8px',
                            padding: '12px 14px',
                            cursor: 'pointer',
                            transition: 'all 0.25s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            boxShadow: isCompleted ? '0 0 12px rgba(16, 185, 129, 0.15)' : 'none'
                          }}
                          onMouseEnter={e => {
                            if (!isCompleted) {
                              e.currentTarget.style.background = 'rgba(79, 70, 229, 0.1)';
                              e.currentTarget.style.borderColor = 'var(--accent-primary)';
                            }
                          }}
                          onMouseLeave={e => {
                            if (!isCompleted) {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                              e.currentTarget.style.borderColor = 'var(--border-glass)';
                            }
                          }}
                        >
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: isCompleted ? 'rgba(16, 185, 129, 0.25)' : 'rgba(79, 70, 229, 0.15)',
                            color: isCompleted ? '#10b981' : 'var(--accent-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.85rem',
                            flexShrink: 0
                          }}>
                            <i className={`fa-solid ${isCompleted ? 'fa-circle-check' : step.icon}`}></i>
                          </div>
                          
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: isCompleted ? '#10b981' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {step.label}
                              </div>
                              {isCompleted && (
                                <span style={{ fontSize: '0.62rem', background: '#10b981', color: '#fff', padding: '2px 6px', borderRadius: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                  ✓ Done
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: isCompleted ? 'rgba(16, 185, 129, 0.85)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {step.desc}
                            </div>
                          </div>

                          {!isCompleted && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              <i className="fa-solid fa-chevron-right"></i>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button 
                    className="btn btn-primary" 
                    onClick={() => handleEnterStep(1)}
                    style={{ alignSelf: 'center', padding: '10px 30px', fontSize: '0.9rem', fontWeight: 600 }}
                  >
                    <i className="fa-solid fa-play" style={{ marginRight: '8px' }}></i> 
                    {selectedRun.status === 'PAID' ? 'Review Finalized Steps' : 'Start Payroll Run Wizard'}
                  </button>
                </div>

                {/* Right Sidebar Section */}
                <PayRunActivitySidebar selectedRun={selectedRun} activities={activities} />

              </div>
            </>
          ) : (
            /* WIZARD ACTIVE VIEW - Full wizard pages rendering */
            <PayRunWizardSteps
              selectedRun={selectedRun}
              employees={activePayRunEmployees}
              runItems={resolvedRunItems}
              reimbursements={reimbursements}
              logActivity={logActivity}
              handleProcessRun={handleProcessRun}
              handleDisburseRun={handleDisburseRun}
              handleViewItems={handleViewItems}
              initialStep={initialWizardStep}
              initialCheckedExited={tabCheckedExited}
              onBack={() => setIsWizardActive(false)}
            />
          )}
        </>
      ) : (
        <div className="card glass" style={{ padding: '40px', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 12px 0' }}>No Pay Runs Configured</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
            Initialize your first pay cycle month using the controls below.
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <input
              type="month"
              value={newRunMonth}
              onChange={e => setNewRunMonth(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
            />
            <button className="btn btn-primary" onClick={handleCreateRun}>
              Initialize First Run
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
