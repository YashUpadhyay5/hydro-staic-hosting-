import React, { useState, useEffect, Suspense, lazy } from 'react';
import { api } from '../../../services/api';

// Tab Subcomponents — core tabs load with PayrollView for instant tab switching
import DashboardTab from './DashboardTab';
import PayRunsTab from './PayRunsTab';
import PayrollAdminTab from './PayrollAdminTab';
import ApprovalsTab from './ApprovalsTab';
import LoansTab from './LoansTab';
import BenefitsTab from './BenefitsTab';
import SettingsTab from './SettingsTab';
import ProfessionalTaxTab from './ProfessionalTaxTab';
import RunItemsModal from './RunItemsModal';

// Heavy compliance report tab is lazy — only loaded when user opens Reports
const ReportTab = lazy(() => import('./ReportTab'));

export default function PayrollView({ employees = [], adminUser }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboardData, setDashboardData] = useState({
    totalGrossCost: 0,
    totalNetDisbursed: 0,
    pendingRuns: 0,
    alerts: [],
    runsTrend: []
  });

  // State management for different sections
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [runItems, setRunItems] = useState([]);
  const [showRunItemsModal, setShowRunItemsModal] = useState(false);

  const [loans, setLoans] = useState([]);
  const [reimbursements, setReimbursements] = useState([]);
  const [components, setComponents] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [fetchedEmployees, setFetchedEmployees] = useState([]);
  const [liveEmployees, setLiveEmployees] = useState(employees);

  useEffect(() => {
    if (employees && employees.length > 0) {
      setLiveEmployees(employees);
    }
  }, [employees]);

  const refreshLiveEmployees = async () => {
    try {
      const data = await api.getEmployees({ limit: 1000 });
      const list = Array.isArray(data) ? data : (data?.data || []);
      if (list && list.length > 0) {
        setLiveEmployees(list);
        setFetchedEmployees(list);
      }
    } catch (e) {
      console.warn('Could not refresh live employees in PayrollView:', e);
    }
  };

  useEffect(() => {
    refreshLiveEmployees();
  }, [activeTab]);

  useEffect(() => {
    const handleEmpUpdated = () => {
      refreshLiveEmployees();
      fetchDashboard();
      fetchTabRelatedData();
    };
    window.addEventListener('employee-updated', handleEmpUpdated);
    window.addEventListener('focus', handleEmpUpdated);
    return () => {
      window.removeEventListener('employee-updated', handleEmpUpdated);
      window.removeEventListener('focus', handleEmpUpdated);
    };
  }, []);

  // Report tab state — payroll run items for compliance forms
  const [runItemsForForms, setRunItemsForForms] = useState([]);
  const [selectedReportMonth, setSelectedReportMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Structure edit state
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [ctcInput, setCtcInput] = useState('');
  const [grossInput, setGrossInput] = useState('');
  const [effectiveFromInput, setEffectiveFromInput] = useState('2026-04-01');

  // Loan/Claim form states
  const [loanEmp, setLoanEmp] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [loanTenure, setLoanTenure] = useState('');

  const [claimEmp, setClaimEmp] = useState('');
  const [claimTitle, setClaimTitle] = useState('');
  const [claimAmount, setClaimAmount] = useState('');
  const [claimCategory, setClaimCategory] = useState('TRAVEL');

  // Tax form states
  const [taxEmp, setTaxEmp] = useState('');
  const [taxRegime, setTaxRegime] = useState('NEW');
  const [sec80C, setSec80C] = useState('0');
  const [sec80D, setSec80D] = useState('0');
  const [rentPaid, setRentPaid] = useState('0');

  // New pay run state
  const [newRunMonth, setNewRunMonth] = useState('2026-07');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [latestRunItems, setLatestRunItems] = useState([]);

  // Fetch initial dashboard and data
  useEffect(() => {
    fetchDashboard();
    fetchTabRelatedData();
  }, [activeTab, selectedReportMonth]);

  const fetchDashboard = async () => {
    try {
      const data = await api.getPayrollDashboard();
      setDashboardData(data);
      
      const leavesData = await api.getLeaves();
      setLeaves(leavesData || []);
      
      // Get the latest paid or processed run's items to calculate distributions
      if (data.runsTrend && data.runsTrend.length > 0) {
        const sortedTrend = [...data.runsTrend].sort((a, b) => b.month.localeCompare(a.month));
        const latestRun = sortedTrend[0];
        const items = await api.getPayrollRunItems(latestRun.id);
        setLatestRunItems(items || []);
      } else {
        setLatestRunItems([]);
      }
    } catch (err) {
      console.error(err);
      setLatestRunItems([]);
    }
  };

  const fetchTabRelatedData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'runs') {
        const data = await api.getPayrollRuns();
        setRuns(data);
      } else if (activeTab === 'loans') {
        const data = await api.getLoans();
        setLoans(data);
      } else if (activeTab === 'benefits') {
        const data = await api.getReimbursements();
        setReimbursements(data);
      } else if (activeTab === 'approvals') {
        const data = await api.getSalaryComponents();
        setComponents(data);
      } else if (activeTab === 'payslips') {
        const data = await api.getPayslips();
        setPayslips(data);
      } else if (activeTab === 'report') {
        const [attData, leavesData, empData, runsData] = await Promise.all([
          api.getAttendance({ month: selectedReportMonth }).catch(() => []),
          api.getLeaves().catch(() => []),
          api.getEmployees({ limit: 1000 }).catch(() => []),
          api.getPayrollRuns().catch(() => [])
        ]);
        if (attData) setAttendance(attData);
        if (leavesData) setLeaves(leavesData);
        if (empData) {
          const list = Array.isArray(empData) ? empData : (empData?.data || []);
          if (list.length > 0) setFetchedEmployees(list);
        }

        // Find the run matching selectedReportMonth and load its items (prefer PAID, then COMPLETED, then any matching run strictly for selectedReportMonth)
        const matchedRun = (runsData || []).find(r => r.month === selectedReportMonth && (r.status === 'PAID' || r.status === 'COMPLETED' || r.status === 'APPROVED'))
          || (runsData || []).find(r => r.month === selectedReportMonth);
        if (matchedRun) {
          try {
            const items = await api.getPayrollRunItems(matchedRun.id);
            setRunItemsForForms(items || []);
          } catch (e) {
            console.warn('Could not load run items for compliance forms:', e.message);
            setRunItemsForForms([]);
          }
        } else {
          setRunItemsForForms([]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Actions
  const handleCreateRun = async () => {
    try {
      await api.createPayrollRun(newRunMonth);
      setMessage(`Pay run initialized for ${newRunMonth} successfully.`);
      fetchTabRelatedData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleDeleteRun = async (runId) => {
    if (!window.confirm('Are you sure you want to permanently delete this pay run, calculated items, and payslips from the database?')) {
      return;
    }
    try {
      setLoading(true);
      await api.deletePayrollRun(runId);
      localStorage.removeItem(`payroll_wizard_draft_${runId}`);
      setMessage('Pay run deleted successfully.');
      const updatedRuns = await api.getPayrollRuns();
      setRuns(updatedRuns || []);
      if (selectedRun && selectedRun.id === runId) {
        setSelectedRun(updatedRuns && updatedRuns.length > 0 ? updatedRuns[0] : null);
      }
      fetchDashboard();
    } catch (err) {
      setMessage(`Error deleting run: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessRun = async (runId, options = {}) => {
    try {
      setLoading(true);
      const res = await api.processPayroll(runId, options);
      setMessage('Processing payroll calculations in background...');
      
      // Actively poll job status or runs until completed
      let attempts = 0;
      const maxAttempts = 20; // 20 * 1000ms = 20 seconds max
      let completed = false;
      
      while (attempts < maxAttempts && !completed) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
        if (res && res.jobId) {
          try {
            const jobStatus = await api.request(`/payroll/job/${res.jobId}`);
            if (jobStatus && (jobStatus.status === 'COMPLETED' || jobStatus.status === 'FAILED')) {
              completed = true;
              break;
            }
          } catch (e) {}
        }
        try {
          const freshRuns = await api.getPayrollRuns();
          const target = freshRuns?.find(r => r.id === runId);
          if (target && target.status !== 'PROCESSING') {
            completed = true;
            break;
          }
        } catch (e) {}
      }

      const freshRuns = await api.getPayrollRuns();
      setRuns(freshRuns || []);
      const updatedTarget = freshRuns?.find(r => r.id === runId);
      if (updatedTarget) {
        setSelectedRun(updatedTarget);
      }
      const freshItems = await api.getPayrollRunItems(runId);
      setRunItems(freshItems || []);
      setRunItemsForForms(freshItems || []);
      fetchDashboard();
      setMessage('Payroll calculations processed and synchronized successfully.');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveRun = async (runId) => {
    try {
      await api.approvePayroll(runId);
      setMessage('Payroll calculations approved.');
      fetchTabRelatedData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleDisburseRun = async (runId, options = {}) => {
    try {
      const result = await api.disbursePayroll(runId, options);
      const count = result?.payslipsGenerated ?? 0;
      setMessage(`Payroll disbursed. ${count} payslip${count !== 1 ? 's' : ''} saved — check the Payslips tab.`);
      // Immediately reload payslips list and switch to that tab
      const payslipData = await api.getPayslips();
      setPayslips(payslipData);
      setActiveTab('payslips');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleViewItems = async (run) => {
    try {
      const items = await api.getPayrollRunItems(run.id);
      setSelectedRun(run);
      setRunItems(items);
      setShowRunItemsModal(true);
    } catch (err) {
      alert(`Error fetching items: ${err.message}`);
    }
  };

  const handleCreateStructure = async () => {
    try {
      await api.createSalaryStructure({
        employeeId: selectedEmployee,
        ctc: Number(ctcInput),
        grossSalary: Number(grossInput),
        effectiveFrom: effectiveFromInput
      });
      setMessage('Salary Structure revision configured successfully.');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleCreateLoan = async () => {
    try {
      await api.createLoan({
        employeeId: loanEmp,
        principalAmount: Number(loanAmount),
        tenureMonths: Number(loanTenure)
      });
      setMessage('Personal Loan request registered.');
      setLoanAmount('');
      setLoanTenure('');
      fetchTabRelatedData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleCreateClaim = async () => {
    try {
      await api.createReimbursement({
        employeeId: claimEmp,
        title: claimTitle,
        amount: Number(claimAmount),
        category: claimCategory
      });
      setMessage('Reimbursement claim logged.');
      setClaimTitle('');
      setClaimAmount('');
      fetchTabRelatedData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleUpdateClaim = async (id, status) => {
    try {
      await api.updateReimbursementStatus(id, status);
      setMessage(`Claim status updated to ${status}.`);
      fetchTabRelatedData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleLoadTaxRecord = async (empId) => {
    setTaxEmp(empId);
    try {
      const record = await api.getTaxRecord(empId);
      if (record && record.regime) {
        setTaxRegime(record.regime);
        setSec80C(record.investmentDeclarations.sec80C || '0');
        setSec80D(record.investmentDeclarations.sec80D || '0');
        setRentPaid(record.investmentDeclarations.hraRentPaid || '0');
      } else {
        setTaxRegime('NEW');
        setSec80C('0');
        setSec80D('0');
        setRentPaid('0');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveTax = async () => {
    try {
      await api.saveTaxRecord(taxEmp, {
        regime: taxRegime,
        investmentDeclarations: {
          sec80C: Number(sec80C),
          sec80D: Number(sec80D),
          hraRentPaid: Number(rentPaid)
        }
      });
      setMessage('Tax regime and investment declarations saved.');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  return (
    <div className="payroll-view-container" style={{ minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Tabs Sidebar/Bar */}
      <div className="tabs-header glass pill-tabs-scroll" style={{ display: 'flex', gap: '8px', padding: '10px 12px', borderRadius: '12px', marginBottom: '16px', overflowX: 'auto', flexShrink: 0, WebkitOverflowScrolling: 'touch' }}>
        {[
          { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
          { id: 'runs', label: 'Pay Runs', icon: 'fa-play' },
          { id: 'payroll-admin', label: 'Payroll Admin', icon: 'fa-user-gear' },
          { id: 'professional-tax', label: 'Professional Tax', icon: 'fa-landmark' },
          { id: 'approvals', label: 'Approvals', icon: 'fa-circle-check' },
          { id: 'loans', label: 'Loans', icon: 'fa-handshake' },
          { id: 'benefits', label: 'Benefits', icon: 'fa-hand-holding-heart' },
          { id: 'report', label: 'Report', icon: 'fa-chart-bar' },
          { id: 'payslips', label: 'Payslips', icon: 'fa-receipt' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setMessage(''); }}
            className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-outline'}`}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            <i className={`fa-solid ${tab.icon}`}></i>
            {tab.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="glass alert" style={{ padding: '12px 20px', borderRadius: '8px', marginBottom: '16px', background: 'rgba(79, 70, 229, 0.15)', color: 'var(--text-primary)', borderLeft: '4px solid var(--accent-primary)', fontSize: '0.9rem', flexShrink: 0 }}>
          <i className="fa-solid fa-circle-info" style={{ marginRight: '8px' }}></i>
          {message}
        </div>
      )}

      {/* Tab views */}
      <div className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {activeTab === 'dashboard' && (
        <DashboardTab dashboardData={dashboardData} employees={liveEmployees} onTabChange={setActiveTab} latestRunItems={latestRunItems} leaves={leaves} />
      )}

      {activeTab === 'runs' && (
        <PayRunsTab
          runs={runs}
          employees={liveEmployees}
          adminUser={adminUser}
          reimbursements={reimbursements}
          newRunMonth={newRunMonth}
          setNewRunMonth={setNewRunMonth}
          handleCreateRun={handleCreateRun}
          handleDeleteRun={handleDeleteRun}
          handleProcessRun={handleProcessRun}
          handleDisburseRun={handleDisburseRun}
          handleViewItems={handleViewItems}
        />
      )}

      {activeTab === 'payroll-admin' && (
        <PayrollAdminTab
          employees={liveEmployees}
          selectedEmployee={selectedEmployee}
          setSelectedEmployee={setSelectedEmployee}
          ctcInput={ctcInput}
          setCtcInput={setCtcInput}
          grossInput={grossInput}
          setGrossInput={setGrossInput}
          effectiveFromInput={effectiveFromInput}
          setEffectiveFromInput={setEffectiveFromInput}
          handleCreateStructure={handleCreateStructure}
          onNavigateTab={setActiveTab}
        />
      )}

      {activeTab === 'professional-tax' && (
        <ProfessionalTaxTab adminUser={adminUser} />
      )}

      {activeTab === 'approvals' && (
        <ApprovalsTab components={components} />
      )}

      {activeTab === 'loans' && (
        <LoansTab
          employees={liveEmployees}
          loans={loans}
          loanEmp={loanEmp}
          setLoanEmp={setLoanEmp}
          loanAmount={loanAmount}
          setLoanAmount={setLoanAmount}
          loanTenure={loanTenure}
          setLoanTenure={setLoanTenure}
          handleCreateLoan={handleCreateLoan}
        />
      )}

      {activeTab === 'benefits' && (
        <BenefitsTab
          employees={liveEmployees}
          reimbursements={reimbursements}
          claimEmp={claimEmp}
          setClaimEmp={setClaimEmp}
          claimCategory={claimCategory}
          setClaimCategory={setClaimCategory}
          claimTitle={claimTitle}
          setClaimTitle={setClaimTitle}
          claimAmount={claimAmount}
          setClaimAmount={setClaimAmount}
          handleCreateClaim={handleCreateClaim}
          handleUpdateClaim={handleUpdateClaim}
        />
      )}

      {activeTab === 'report' && (
        <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}><i className="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px' }}></i>Loading compliance reports...</div>}>
          <ReportTab
            setActiveTab={setActiveTab}
            employees={liveEmployees}
            attendance={attendance}
            leaves={leaves}
            runItems={runItemsForForms}
            selectedReportMonth={selectedReportMonth}
            setSelectedReportMonth={setSelectedReportMonth}
            taxEmp={taxEmp}
            handleLoadTaxRecord={handleLoadTaxRecord}
            taxRegime={taxRegime}
            setTaxRegime={setTaxRegime}
            sec80C={sec80C}
            setSec80C={setSec80C}
            sec80D={sec80D}
            setSec80D={setSec80D}
            rentPaid={rentPaid}
            setRentPaid={setRentPaid}
            handleSaveTax={handleSaveTax}
          />
        </Suspense>
      )}

      {activeTab === 'payslips' && (
        <SettingsTab
          payslips={payslips}
          employees={liveEmployees}
          onReload={async () => {
            try {
              const data = await api.getPayslips();
              setPayslips(data);
            } catch (e) {
              console.error(e);
            }
          }}
        />
      )}
      </div>

      {/* Run Items breakdown details modal */}
      <RunItemsModal
        show={showRunItemsModal}
        onClose={() => setShowRunItemsModal(false)}
        selectedRun={selectedRun}
        runItems={runItems}
      />
    </div>
  );
}
