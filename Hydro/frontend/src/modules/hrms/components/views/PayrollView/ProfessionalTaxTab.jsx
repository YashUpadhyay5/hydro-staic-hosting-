import React, { useState, useEffect } from 'react';
import { api } from '../../../services/api';

export default function ProfessionalTaxTab({ adminUser }) {
  const [states, setStates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [notification, setNotification] = useState({ type: '', message: '' });

  // Modals & Drawers State
  const [showStateModal, setShowStateModal] = useState(false);
  const [editingState, setEditingState] = useState(null);
  const [showSlabBuilder, setShowSlabBuilder] = useState(false);
  const [selectedStateForSlabs, setSelectedStateForSlabs] = useState(null);
  const [slabsList, setSlabsList] = useState([]);
  const [slabsEffectiveFrom, setSlabsEffectiveFrom] = useState('2026-04-01');
  const [slabsEffectiveTo, setSlabsEffectiveTo] = useState('');
  const [slabsStatus, setSlabsStatus] = useState('ACTIVE');
  const [validationResult, setValidationResult] = useState(null);

  // Sandbox Tester State
  const [showTestModal, setShowTestModal] = useState(false);
  const [testStateId, setTestStateId] = useState('');
  const [testGross, setTestGross] = useState(35000);
  const [testBasic, setTestBasic] = useState(17500);
  const [testTaxable, setTestTaxable] = useState(32000);
  const [testGender, setTestGender] = useState('MALE');
  const [testCategory, setTestCategory] = useState('EMPLOYEE');
  const [testDate, setTestDate] = useState('2026-07-01');
  const [testYtdPt, setTestYtdPt] = useState(600);
  const [testAttendanceRatio, setTestAttendanceRatio] = useState(1.0);
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  // History & Audit Log State
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [historyStateName, setHistoryStateName] = useState('');

  // Duplicate Modal State
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateSourceState, setDuplicateSourceState] = useState(null);
  const [duplicateCode, setDuplicateCode] = useState('');
  const [duplicateName, setDuplicateName] = useState('');

  // Import / Export State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importPreview, setImportPreview] = useState(null);

  // State Form State
  const [stateForm, setStateForm] = useState({
    stateCode: '',
    stateName: '',
    countryCode: 'IN',
    taxName: 'Professional Tax',
    salaryBasis: 'GROSS_SALARY',
    maxAnnualPt: 2500,
    maxMonthlyPt: '',
    frequency: 'MONTHLY',
    effectiveFrom: '2026-04-01',
    effectiveTo: '',
    description: '',
    isEnabled: true
  });

  useEffect(() => {
    fetchStates();
  }, []);

  const showNotify = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification({ type: '', message: '' });
    }, 5000);
  };

  const fetchStates = async () => {
    setLoading(true);
    try {
      const data = await api.getPTStates();
      setStates(data || []);
    } catch (err) {
      showNotify('error', `Failed to load PT states: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // State CRUD Handlers
  const handleOpenAddState = () => {
    setEditingState(null);
    setStateForm({
      stateCode: '',
      stateName: '',
      countryCode: 'IN',
      taxName: 'Professional Tax',
      salaryBasis: 'GROSS_SALARY',
      maxAnnualPt: 2500,
      maxMonthlyPt: '',
      frequency: 'MONTHLY',
      effectiveFrom: '2026-04-01',
      effectiveTo: '',
      description: '',
      isEnabled: true
    });
    setShowStateModal(true);
  };

  const handleOpenEditState = (st) => {
    setEditingState(st);
    setStateForm({
      stateCode: st.stateCode,
      stateName: st.stateName,
      countryCode: st.countryCode || 'IN',
      taxName: st.taxName || 'Professional Tax',
      salaryBasis: st.salaryBasis || 'GROSS_SALARY',
      maxAnnualPt: st.maxAnnualPt !== null && st.maxAnnualPt !== undefined ? st.maxAnnualPt : '',
      maxMonthlyPt: st.maxMonthlyPt !== null && st.maxMonthlyPt !== undefined ? st.maxMonthlyPt : '',
      frequency: st.frequency || 'MONTHLY',
      effectiveFrom: st.effectiveFrom || '2026-04-01',
      effectiveTo: st.effectiveTo || '',
      description: st.description || '',
      isEnabled: st.isEnabled !== false
    });
    setShowStateModal(true);
  };

  const handleSaveState = async (e) => {
    e.preventDefault();
    if (!stateForm.stateCode || !stateForm.stateName) {
      showNotify('error', 'State Code and State Name are required.');
      return;
    }

    try {
      if (editingState) {
        await api.updatePTState(editingState.id, stateForm);
        showNotify('success', `State ${stateForm.stateName} updated successfully.`);
      } else {
        await api.createPTState(stateForm);
        showNotify('success', `State ${stateForm.stateName} created successfully.`);
      }
      setShowStateModal(false);
      fetchStates();
    } catch (err) {
      showNotify('error', `Error saving state: ${err.message}`);
    }
  };

  const handleToggleState = async (st) => {
    const updatedStatus = !st.isEnabled;
    try {
      await api.updatePTState(st.id, { isEnabled: updatedStatus });
      showNotify('success', `State ${st.stateName} is now ${updatedStatus ? 'Enabled' : 'Disabled'}.`);
      fetchStates();
    } catch (err) {
      showNotify('error', `Error toggling state: ${err.message}`);
    }
  };

  // Duplicate State Handler
  const handleOpenDuplicate = (st) => {
    setDuplicateSourceState(st);
    setDuplicateCode(`${st.stateCode}_COPY`);
    setDuplicateName(`${st.stateName} (Copy)`);
    setShowDuplicateModal(true);
  };

  const handleConfirmDuplicate = async (e) => {
    e.preventDefault();
    if (!duplicateCode || !duplicateName) {
      showNotify('error', 'New State Code and Name are required.');
      return;
    }
    try {
      await api.duplicatePTState(duplicateSourceState.id, {
        newStateCode: duplicateCode,
        newStateName: duplicateName
      });
      showNotify('success', `Successfully duplicated ${duplicateSourceState.stateName} to ${duplicateName}.`);
      setShowDuplicateModal(false);
      fetchStates();
    } catch (err) {
      showNotify('error', `Error duplicating state: ${err.message}`);
    }
  };

  // Slab Builder Handlers
  const handleOpenSlabBuilder = async (st) => {
    setSelectedStateForSlabs(st);
    setValidationResult(null);
    try {
      const rules = await api.getPTRules(st.id);
      if (rules && rules.length > 0) {
        setSlabsList(rules.map(r => ({
          id: r.id,
          ruleName: r.ruleName || '',
          salaryFrom: r.salaryFrom,
          salaryTo: r.salaryTo,
          ptAmount: r.ptAmount,
          calculationType: r.calculationType || 'FIXED',
          formulaExpression: r.formulaExpression || '',
          periodType: r.periodType || st.frequency || 'MONTHLY',
          monthSpecificRules: r.monthSpecificRules || '',
          gender: r.gender || 'ALL',
          employeeCategory: r.employeeCategory || 'ALL',
          isExemption: r.isExemption || false,
          exemptionType: r.exemptionType || 'NONE',
          exemptionValue: r.exemptionValue || '',
          status: r.status || 'ACTIVE'
        })));
        setSlabsEffectiveFrom(rules[0].effectiveFrom || st.effectiveFrom || '2026-04-01');
        setSlabsEffectiveTo(rules[0].effectiveTo || '');
      } else {
        setSlabsList([
          { ruleName: 'Slab 1', salaryFrom: 0, salaryTo: 10000, ptAmount: 0, calculationType: 'FIXED', periodType: 'MONTHLY', gender: 'ALL', employeeCategory: 'ALL', isExemption: false, status: 'ACTIVE' },
          { ruleName: 'Slab 2', salaryFrom: 10001, salaryTo: 999999999, ptAmount: 200, calculationType: 'FIXED', periodType: 'MONTHLY', gender: 'ALL', employeeCategory: 'ALL', isExemption: false, status: 'ACTIVE' }
        ]);
        setSlabsEffectiveFrom(st.effectiveFrom || '2026-04-01');
        setSlabsEffectiveTo('');
      }
      setShowSlabBuilder(true);
    } catch (err) {
      showNotify('error', `Error fetching rules: ${err.message}`);
    }
  };

  const handleAddSlabRow = () => {
    const lastRow = slabsList[slabsList.length - 1];
    const newFrom = lastRow ? Number(lastRow.salaryTo) + 1 : 0;
    setSlabsList([
      ...slabsList,
      {
        ruleName: `Slab ${slabsList.length + 1}`,
        salaryFrom: isNaN(newFrom) || newFrom > 900000000 ? 0 : newFrom,
        salaryTo: 999999999,
        ptAmount: 200,
        calculationType: 'FIXED',
        periodType: selectedStateForSlabs?.frequency || 'MONTHLY',
        monthSpecificRules: '',
        gender: 'ALL',
        employeeCategory: 'ALL',
        isExemption: false,
        exemptionType: 'NONE',
        exemptionValue: '',
        status: 'ACTIVE'
      }
    ]);
  };

  const handleDuplicateSlabRow = (index) => {
    const target = slabsList[index];
    const clone = { ...target, ruleName: `${target.ruleName} (Copy)` };
    const newList = [...slabsList];
    newList.splice(index + 1, 0, clone);
    setSlabsList(newList);
  };

  const handleDeleteSlabRow = (index) => {
    if (slabsList.length <= 1) {
      showNotify('error', 'At least one slab is required.');
      return;
    }
    setSlabsList(slabsList.filter((_, i) => i !== index));
  };

  const handleMoveSlabRow = (index, direction) => {
    if ((direction === -1 && index === 0) || (direction === 1 && index === slabsList.length - 1)) return;
    const newList = [...slabsList];
    const target = newList[index];
    newList[index] = newList[index + direction];
    newList[index + direction] = target;
    setSlabsList(newList);
  };

  const handleUpdateSlabRow = (index, field, value) => {
    const newList = [...slabsList];
    newList[index] = { ...newList[index], [field]: value };
    setSlabsList(newList);
  };

  const handleValidateSlabs = async () => {
    try {
      const res = await api.validatePTSlabs(slabsList);
      setValidationResult(res);
      if (res.valid) {
        showNotify('success', 'Slab boundaries validation passed! Ready to activate.');
      } else {
        showNotify('error', 'Validation issues found. Please review the errors below.');
      }
    } catch (err) {
      showNotify('error', `Validation failed: ${err.message}`);
    }
  };

  const handleSaveSlabs = async (targetStatus = 'ACTIVE') => {
    try {
      const val = await api.validatePTSlabs(slabsList);
      setValidationResult(val);
      if (!val.valid) {
        showNotify('error', `Cannot save: ${val.errors.join(' ')}`);
        return;
      }

      await api.savePTRules(selectedStateForSlabs.id, {
        slabs: slabsList,
        effectiveFrom: slabsEffectiveFrom,
        effectiveTo: slabsEffectiveTo || null,
        status: targetStatus
      });

      showNotify('success', `Successfully saved and published ${slabsList.length} slabs for ${selectedStateForSlabs.stateName}.`);
      setShowSlabBuilder(false);
      fetchStates();
    } catch (err) {
      showNotify('error', `Error saving slabs: ${err.message}`);
    }
  };

  // Sandbox Tester Handler
  const handleOpenSandbox = (st = null) => {
    const initialId = st ? st.id : (states.length > 0 ? states[0].id : '');
    setTestStateId(initialId);
    setTestResult(null);
    setShowTestModal(true);
  };

  const handleRunCalculationTest = async (e) => {
    e.preventDefault();
    if (!testStateId) {
      showNotify('error', 'Please select a State to test.');
      return;
    }
    setIsTesting(true);
    try {
      const res = await api.testPTCalculation({
        stateId: testStateId,
        grossSalary: Number(testGross) || 0,
        basicSalary: Number(testBasic) || 0,
        taxableSalary: Number(testTaxable) || 0,
        totalEarnings: Number(testGross) || 0,
        gender: testGender,
        employeeCategory: testCategory,
        payrollDate: testDate,
        ytdPt: Number(testYtdPt) || 0,
        attendanceRatio: Number(testAttendanceRatio) || 1
      });
      setTestResult(res);
    } catch (err) {
      showNotify('error', `Test calculation error: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  // Audit History Handler
  const handleOpenHistory = async (st) => {
    setHistoryStateName(st.stateName);
    try {
      const logs = await api.getPTHistory(st.id);
      setHistoryLogs(logs || []);
      setShowHistoryModal(true);
    } catch (err) {
      showNotify('error', `Error fetching audit history: ${err.message}`);
    }
  };

  // Import / Export Handlers
  const handleExportJSON = async () => {
    try {
      const res = await api.exportPTConfig();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.data, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `Professional_Tax_Config_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showNotify('success', 'Professional Tax configuration exported successfully.');
    } catch (err) {
      showNotify('error', `Export error: ${err.message}`);
    }
  };

  const handleOpenImport = () => {
    setImportJsonText('');
    setImportPreview(null);
    setShowImportModal(true);
  };

  const handlePreviewImport = () => {
    try {
      const parsed = JSON.parse(importJsonText);
      if (!Array.isArray(parsed)) {
        throw new Error('Import data must be a JSON array of state objects.');
      }
      setImportPreview(parsed);
      showNotify('success', `Valid configuration detected with ${parsed.length} state(s).`);
    } catch (err) {
      showNotify('error', `Invalid JSON: ${err.message}`);
      setImportPreview(null);
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview || importPreview.length === 0) {
      showNotify('error', 'No valid data to import.');
      return;
    }
    try {
      await api.importPTConfig(importPreview);
      showNotify('success', `Successfully imported ${importPreview.length} state configurations.`);
      setShowImportModal(false);
      fetchStates();
    } catch (err) {
      showNotify('error', `Import error: ${err.message}`);
    }
  };

  // Filtered States
  const filteredStates = states.filter(st => {
    const matchSearch = !search || 
      st.stateName.toLowerCase().includes(search.toLowerCase()) || 
      st.stateCode.toLowerCase().includes(search.toLowerCase()) ||
      (st.taxName && st.taxName.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = statusFilter === 'ALL' || 
      (statusFilter === 'ENABLED' && st.isEnabled) || 
      (statusFilter === 'DISABLED' && !st.isEnabled);
    return matchSearch && matchStatus;
  });

  const totalStatesCount = states.length;
  const activeTaxingStates = states.filter(s => s.isEnabled && s.maxAnnualPt > 0).length;
  const totalRulesCount = states.reduce((acc, s) => acc + (s.activeRulesCount || 0), 0);
  const exemptStatesCount = states.filter(s => s.maxAnnualPt === 0 || s.maxAnnualPt === null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '40px' }}>
      
      {/* Toast Notification Alert */}
      {notification.message && (
        <div style={{
          padding: '12px 20px',
          borderRadius: '8px',
          background: notification.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
          color: notification.type === 'error' ? '#ef4444' : '#10b981',
          border: `1px solid ${notification.type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontWeight: '600',
          fontSize: '0.9rem'
        }}>
          <i className={`fa-solid ${notification.type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
          <span>{notification.message}</span>
        </div>
      )}

      {/* Top Banner & Title Bar */}
      <div className="card glass" style={{ padding: '24px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: 'linear-gradient(135deg, #4f46e5, #3b82f6)', color: '#fff', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
              <i className="fa-solid fa-landmark"></i>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-primary)', fontWeight: '700' }}>Professional Tax Configuration Engine</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Configurable, state-wise, effective-date driven statutory tax rules & dynamic slab calculation engine.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={handleOpenAddState} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '0.85rem' }}>
            <i className="fa-solid fa-plus"></i> Add State
          </button>
          <button className="btn btn-outline" onClick={() => handleOpenSandbox()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '0.85rem' }}>
            <i className="fa-solid fa-calculator"></i> Test Calculator
          </button>
          <button className="btn btn-outline" onClick={handleExportJSON} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '0.85rem' }}>
            <i className="fa-solid fa-file-export"></i> Export JSON
          </button>
          <button className="btn btn-outline" onClick={handleOpenImport} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '0.85rem' }}>
            <i className="fa-solid fa-file-import"></i> Import JSON
          </button>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <div className="card glass" style={{ padding: '18px 20px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(79, 70, 229, 0.15)', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
            <i className="fa-solid fa-map"></i>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Configured States</div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>{totalStatesCount}</div>
          </div>
        </div>

        <div className="card glass" style={{ padding: '18px 20px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
            <i className="fa-solid fa-receipt"></i>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Active PT States</div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#10b981' }}>{activeTaxingStates}</div>
          </div>
        </div>

        <div className="card glass" style={{ padding: '18px 20px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
            <i className="fa-solid fa-layer-group"></i>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Configured Slabs</div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>{totalRulesCount}</div>
          </div>
        </div>

        <div className="card glass" style={{ padding: '18px 20px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
            <i className="fa-solid fa-shield-halved"></i>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Exempt States (0 PT)</div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#3b82f6' }}>{exemptStatesCount}</div>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 300px' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '380px' }}>
            <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}></i>
            <input
              type="text"
              placeholder="Search state name, code (e.g. MH, Karnataka)..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '8px 12px 8px 36px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', fontSize: '0.85rem' }}
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', fontSize: '0.85rem' }}
          >
            <option value="ALL">All Status</option>
            <option value="ENABLED">Enabled Only</option>
            <option value="DISABLED">Disabled Only</option>
          </select>
        </div>

        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Showing <strong>{filteredStates.length}</strong> of {states.length} states
        </div>
      </div>

      {/* Main States Table */}
      <div className="card glass" style={{ padding: '0', borderRadius: '12px', overflow: 'hidden' }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-glass)' }}>
              <th style={{ padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '700' }}>STATE / REGION</th>
              <th style={{ padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '700' }}>TAX NAME</th>
              <th style={{ padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '700' }}>SALARY BASIS</th>
              <th style={{ padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '700' }}>ACTIVE SLABS</th>
              <th style={{ padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '700' }}>ANNUAL CAP</th>
              <th style={{ padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '700' }}>EFFECTIVE FROM</th>
              <th style={{ padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '700' }}>STATUS</th>
              <th style={{ padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '700', textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px' }}></i> Loading Professional Tax configurations...
                </td>
              </tr>
            ) : filteredStates.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No Professional Tax state configurations match your query. Click "+ Add State" to create one.
                </td>
              </tr>
            ) : (
              filteredStates.map(st => (
                <tr key={st.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' }}>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(79, 70, 229, 0.15)', color: '#4f46e5', fontWeight: '800', fontSize: '0.75rem' }}>
                        {st.stateCode}
                      </span>
                      <div>
                        <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '0.95rem' }}>{st.stateName}</div>
                        {st.description && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{st.description}</div>}
                      </div>
                    </div>
                  </td>

                  <td style={{ padding: '14px 18px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {st.taxName || 'Professional Tax'}
                  </td>

                  <td style={{ padding: '14px 18px' }}>
                    <span style={{ padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                      {st.salaryBasis ? st.salaryBasis.replace('_', ' ') : 'GROSS SALARY'}
                    </span>
                  </td>

                  <td style={{ padding: '14px 18px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      <i className="fa-solid fa-layer-group" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}></i>
                      {st.activeRulesCount || 0} Slabs
                    </span>
                  </td>

                  <td style={{ padding: '14px 18px', fontWeight: '700', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                    {st.maxAnnualPt !== null && st.maxAnnualPt !== undefined && st.maxAnnualPt > 0 ? `₹${Number(st.maxAnnualPt).toLocaleString('en-IN')}` : 'Exempt (₹0)'}
                  </td>

                  <td style={{ padding: '14px 18px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {st.effectiveFrom || '2026-04-01'}
                    {st.effectiveTo ? ` → ${st.effectiveTo}` : ' → Present'}
                  </td>

                  <td style={{ padding: '14px 18px' }}>
                    <button
                      onClick={() => handleToggleState(st)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '0.75rem',
                        fontWeight: '700',
                        border: 'none',
                        cursor: 'pointer',
                        background: st.isEnabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: st.isEnabled ? '#10b981' : '#ef4444',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <i className={`fa-solid ${st.isEnabled ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
                      {st.isEnabled ? 'Active' : 'Disabled'}
                    </button>
                  </td>

                  <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleOpenSlabBuilder(st)}
                        title="Configure Tax Slabs"
                        style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <i className="fa-solid fa-sliders"></i> Slabs
                      </button>

                      <button
                        className="btn btn-outline"
                        onClick={() => handleOpenSandbox(st)}
                        title="Test Calculation in Sandbox"
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                      >
                        <i className="fa-solid fa-vial"></i>
                      </button>

                      <button
                        className="btn btn-outline"
                        onClick={() => handleOpenEditState(st)}
                        title="Edit State Metadata"
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                      >
                        <i className="fa-solid fa-pen-to-square"></i>
                      </button>

                      <button
                        className="btn btn-outline"
                        onClick={() => handleOpenDuplicate(st)}
                        title="Duplicate State & Slabs"
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                      >
                        <i className="fa-solid fa-copy"></i>
                      </button>

                      <button
                        className="btn btn-outline"
                        onClick={() => handleOpenHistory(st)}
                        title="View Audit Log History"
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                      >
                        <i className="fa-solid fa-clock-rotate-left"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ========================================================================= */}
      {/* 1. MODAL: ADD / EDIT STATE                                                */}
      {/* ========================================================================= */}
      {showStateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto', padding: '28px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)' }}>
                <i className="fa-solid fa-landmark" style={{ marginRight: '8px', color: '#4f46e5' }}></i>
                {editingState ? `Edit State: ${editingState.stateName}` : 'Add New State Tax Configuration'}
              </h3>
              <button onClick={() => setShowStateModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleSaveState} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>State Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MH, KA, DL"
                    value={stateForm.stateCode}
                    onChange={e => setStateForm({ ...stateForm, stateCode: e.target.value.toUpperCase() })}
                    disabled={!!editingState}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>State / Region Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Maharashtra, Karnataka"
                    value={stateForm.stateName}
                    onChange={e => setStateForm({ ...stateForm, stateName: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Tax Name</label>
                  <input
                    type="text"
                    value={stateForm.taxName}
                    onChange={e => setStateForm({ ...stateForm, taxName: e.target.value })}
                    placeholder="e.g. Professional Tax"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Salary Basis For Evaluation</label>
                  <select
                    value={stateForm.salaryBasis}
                    onChange={e => setStateForm({ ...stateForm, salaryBasis: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  >
                    <option value="GROSS_SALARY">Gross Salary (Default)</option>
                    <option value="BASIC_SALARY">Basic Salary</option>
                    <option value="TAXABLE_SALARY">Taxable Salary (Gross - PF - ESI)</option>
                    <option value="TOTAL_EARNINGS">Total Earnings</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Max Annual PT Cap (₹)</label>
                  <input
                    type="number"
                    value={stateForm.maxAnnualPt}
                    onChange={e => setStateForm({ ...stateForm, maxAnnualPt: e.target.value })}
                    placeholder="e.g. 2500 (Set 0 for exempt states)"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Deduction Frequency</label>
                  <select
                    value={stateForm.frequency}
                    onChange={e => setStateForm({ ...stateForm, frequency: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="HALF_YEARLY">Half-Yearly (e.g. Tamil Nadu / Kerala)</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="ANNUAL">Annual</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Effective From Date</label>
                  <input
                    type="date"
                    required
                    value={stateForm.effectiveFrom}
                    onChange={e => setStateForm({ ...stateForm, effectiveFrom: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Effective To (Optional)</label>
                  <input
                    type="date"
                    value={stateForm.effectiveTo}
                    onChange={e => setStateForm({ ...stateForm, effectiveTo: e.target.value })}
                    placeholder="Leave empty for open-ended"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Description / Statutory Notes</label>
                <textarea
                  rows="2"
                  value={stateForm.description}
                  onChange={e => setStateForm({ ...stateForm, description: e.target.value })}
                  placeholder="Notes about jurisdiction rules, gazette notifications, or statutory exemptions..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                <input
                  type="checkbox"
                  id="stateEnabledToggle"
                  checked={stateForm.isEnabled}
                  onChange={e => setStateForm({ ...stateForm, isEnabled: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: '#4f46e5', cursor: 'pointer' }}
                />
                <label htmlFor="stateEnabledToggle" style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  Enable this state for payroll calculation
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px', borderTop: '1px solid var(--border-glass)', paddingTop: '16px' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowStateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save State Configuration</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. DRAWER / MODAL: DYNAMIC SLAB BUILDER                                    */}
      {/* ========================================================================= */}
      {showSlabBuilder && selectedStateForSlabs && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
          <div className="card glass custom-scrollbar" style={{ width: '100%', maxWidth: '1150px', maxHeight: '92vh', overflowY: 'auto', padding: '28px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-glass)', paddingBottom: '16px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ padding: '4px 10px', borderRadius: '6px', background: '#4f46e5', color: '#fff', fontWeight: '800', fontSize: '0.85rem' }}>
                    {selectedStateForSlabs.stateCode}
                  </span>
                  <h3 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--text-primary)', fontWeight: '800' }}>
                    Professional Tax Slab Builder — {selectedStateForSlabs.stateName}
                  </h3>
                </div>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Configure salary ranges, fixed/percentage/formula deduction amounts, month-specific rules, and exemptions.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-outline" onClick={() => handleOpenSandbox(selectedStateForSlabs)} style={{ fontSize: '0.8rem', padding: '6px 12px' }}>
                  <i className="fa-solid fa-vial" style={{ marginRight: '6px' }}></i> Test in Sandbox
                </button>
                <button onClick={() => setShowSlabBuilder(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.3rem' }}>
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>

            {/* Effective Dates & Status Bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-glass)' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Effective From Date</label>
                <input
                  type="date"
                  value={slabsEffectiveFrom}
                  onChange={e => setSlabsEffectiveFrom(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Effective To Date (Optional)</label>
                <input
                  type="date"
                  value={slabsEffectiveTo}
                  onChange={e => setSlabsEffectiveTo(e.target.value)}
                  placeholder="Open-ended"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Publication Status</label>
                <select
                  value={slabsStatus}
                  onChange={e => setSlabsStatus(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                >
                  <option value="ACTIVE">Active (Immediate for period)</option>
                  <option value="SCHEDULED">Scheduled (Future activation)</option>
                  <option value="DRAFT">Draft (Not active in payroll)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Salary Basis</label>
                <input
                  type="text"
                  disabled
                  value={selectedStateForSlabs.salaryBasis || 'GROSS_SALARY'}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'rgba(0,0,0,0.2)', color: 'var(--text-secondary)', outline: 'none' }}
                />
              </div>
            </div>

            {/* Validation Feedback Messages */}
            {validationResult && (
              <div style={{
                padding: '14px 18px',
                borderRadius: '8px',
                background: validationResult.valid ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${validationResult.valid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
              }}>
                <div style={{ fontWeight: '700', color: validationResult.valid ? '#10b981' : '#ef4444', marginBottom: '4px' }}>
                  <i className={`fa-solid ${validationResult.valid ? 'fa-circle-check' : 'fa-triangle-exclamation'}`} style={{ marginRight: '6px' }}></i>
                  {validationResult.valid ? 'Slab validation passed successfully.' : 'Validation Errors Detected:'}
                </div>
                {validationResult.errors?.map((err, i) => (
                  <div key={i} style={{ fontSize: '0.85rem', color: '#ef4444', marginLeft: '22px' }}>• {err}</div>
                ))}
                {validationResult.warnings?.map((warn, i) => (
                  <div key={i} style={{ fontSize: '0.85rem', color: '#f59e0b', marginLeft: '22px' }}>⚠️ {warn}</div>
                ))}
              </div>
            )}

            {/* Dynamic Slab Rows Table */}
            <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid var(--border-glass)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px', width: '50px' }}>#</th>
                    <th style={{ padding: '10px 12px', minWidth: '130px' }}>RULE / SLAB NAME</th>
                    <th style={{ padding: '10px 12px', width: '130px' }}>SALARY FROM (₹)</th>
                    <th style={{ padding: '10px 12px', width: '130px' }}>SALARY TO (₹)</th>
                    <th style={{ padding: '10px 12px', width: '110px' }}>CALC TYPE</th>
                    <th style={{ padding: '10px 12px', width: '110px' }}>PT AMOUNT (₹)</th>
                    <th style={{ padding: '10px 12px', minWidth: '150px' }}>MONTH ADJUSTMENT</th>
                    <th style={{ padding: '10px 12px', width: '100px' }}>GENDER</th>
                    <th style={{ padding: '10px 12px', width: '110px' }}>CATEGORY</th>
                    <th style={{ padding: '10px 12px', width: '70px', textAlign: 'center' }}>EXEMPT?</th>
                    <th style={{ padding: '10px 12px', width: '110px', textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {slabsList.map((slab, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: index % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                        {index + 1}
                      </td>

                      <td style={{ padding: '8px 12px' }}>
                        <input
                          type="text"
                          value={slab.ruleName}
                          onChange={e => handleUpdateSlabRow(index, 'ruleName', e.target.value)}
                          placeholder="e.g. 7.5K - 10K"
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                        />
                      </td>

                      <td style={{ padding: '8px 12px' }}>
                        <input
                          type="number"
                          value={slab.salaryFrom}
                          onChange={e => handleUpdateSlabRow(index, 'salaryFrom', Number(e.target.value))}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', fontWeight: '600' }}
                        />
                      </td>

                      <td style={{ padding: '8px 12px' }}>
                        <input
                          type="number"
                          value={slab.salaryTo}
                          onChange={e => handleUpdateSlabRow(index, 'salaryTo', Number(e.target.value))}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', fontWeight: '600' }}
                        />
                      </td>

                      <td style={{ padding: '8px 12px' }}>
                        <select
                          value={slab.calculationType}
                          onChange={e => handleUpdateSlabRow(index, 'calculationType', e.target.value)}
                          style={{ width: '100%', padding: '6px 6px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                        >
                          <option value="FIXED">FIXED</option>
                          <option value="PERCENTAGE">PERCENTAGE (%)</option>
                          <option value="FORMULA">FORMULA</option>
                        </select>
                      </td>

                      <td style={{ padding: '8px 12px' }}>
                        {slab.calculationType === 'FORMULA' ? (
                          <input
                            type="text"
                            value={slab.formulaExpression || ''}
                            onChange={e => handleUpdateSlabRow(index, 'formulaExpression', e.target.value)}
                            placeholder="e.g. gross * 0.01"
                            style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: '#10b981', outline: 'none', fontFamily: 'monospace' }}
                          />
                        ) : (
                          <input
                            type="number"
                            value={slab.ptAmount}
                            onChange={e => handleUpdateSlabRow(index, 'ptAmount', Number(e.target.value))}
                            style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', fontWeight: '700' }}
                          />
                        )}
                      </td>

                      <td style={{ padding: '8px 12px' }}>
                        <input
                          type="text"
                          value={slab.monthSpecificRules || ''}
                          onChange={e => handleUpdateSlabRow(index, 'monthSpecificRules', e.target.value)}
                          placeholder='e.g. {"2":300} for Feb'
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace', fontSize: '0.75rem' }}
                        />
                      </td>

                      <td style={{ padding: '8px 12px' }}>
                        <select
                          value={slab.gender}
                          onChange={e => handleUpdateSlabRow(index, 'gender', e.target.value)}
                          style={{ width: '100%', padding: '6px 4px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                        >
                          <option value="ALL">ALL</option>
                          <option value="MALE">MALE</option>
                          <option value="FEMALE">FEMALE</option>
                        </select>
                      </td>

                      <td style={{ padding: '8px 12px' }}>
                        <select
                          value={slab.employeeCategory}
                          onChange={e => handleUpdateSlabRow(index, 'employeeCategory', e.target.value)}
                          style={{ width: '100%', padding: '6px 4px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                        >
                          <option value="ALL">ALL</option>
                          <option value="EMPLOYEE">EMPLOYEE</option>
                          <option value="CONTRACTOR">CONTRACTOR</option>
                          <option value="OTHER">OTHER</option>
                        </select>
                      </td>

                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={slab.isExemption}
                          onChange={e => handleUpdateSlabRow(index, 'isExemption', e.target.checked)}
                          style={{ width: '16px', height: '16px', accentColor: '#ef4444', cursor: 'pointer' }}
                        />
                      </td>

                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button onClick={() => handleMoveSlabRow(index, -1)} disabled={index === 0} title="Move Up" style={{ padding: '4px 6px', background: 'transparent', border: '1px solid var(--border-glass)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: index === 0 ? 'not-allowed' : 'pointer' }}>
                            <i className="fa-solid fa-arrow-up"></i>
                          </button>
                          <button onClick={() => handleMoveSlabRow(index, 1)} disabled={index === slabsList.length - 1} title="Move Down" style={{ padding: '4px 6px', background: 'transparent', border: '1px solid var(--border-glass)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: index === slabsList.length - 1 ? 'not-allowed' : 'pointer' }}>
                            <i className="fa-solid fa-arrow-down"></i>
                          </button>
                          <button onClick={() => handleDuplicateSlabRow(index)} title="Duplicate Row" style={{ padding: '4px 6px', background: 'transparent', border: '1px solid var(--border-glass)', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer' }}>
                            <i className="fa-solid fa-copy"></i>
                          </button>
                          <button onClick={() => handleDeleteSlabRow(index)} title="Delete Row" style={{ padding: '4px 6px', background: 'transparent', border: '1px solid var(--border-glass)', borderRadius: '4px', color: '#ef4444', cursor: 'pointer' }}>
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderTop: '1px solid var(--border-glass)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn btn-outline" onClick={handleAddSlabRow} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fa-solid fa-plus"></i> Add Slab Row
                </button>
                <button className="btn btn-outline" onClick={handleValidateSlabs} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fa-solid fa-shield-check"></i> Validate Ranges
                </button>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn btn-outline" onClick={() => setShowSlabBuilder(false)}>Cancel</button>
                <button className="btn btn-outline" onClick={() => handleSaveSlabs('DRAFT')}>Save Draft</button>
                <button className="btn btn-primary" onClick={() => handleSaveSlabs(slabsStatus)}>
                  <i className="fa-solid fa-cloud-arrow-up" style={{ marginRight: '6px' }}></i> Publish & Activate Slabs
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. MODAL: INTERACTIVE SANDBOX & CALCULATION TESTER                        */}
      {/* ========================================================================= */}
      {showTestModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div className="card glass custom-scrollbar" style={{ width: '100%', maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto', padding: '28px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-vial" style={{ color: '#10b981' }}></i>
                  Interactive Professional Tax Sandbox & Tester
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Test state tax slab rules in real time before activating in live payroll.
                </p>
              </div>
              <button onClick={() => setShowTestModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleRunCalculationTest} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Select State *</label>
                  <select
                    value={testStateId}
                    onChange={e => setTestStateId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  >
                    <option value="">Choose State...</option>
                    {states.map(s => (
                      <option key={s.id} value={s.id}>{s.stateName} ({s.stateCode})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Payroll Period Date</label>
                  <input
                    type="date"
                    value={testDate}
                    onChange={e => setTestDate(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Gender</label>
                  <select
                    value={testGender}
                    onChange={e => setTestGender(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="ALL">All / Unspecified</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Gross Monthly Salary (₹)</label>
                  <input
                    type="number"
                    value={testGross}
                    onChange={e => setTestGross(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', fontWeight: '700' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Basic Salary (₹)</label>
                  <input
                    type="number"
                    value={testBasic}
                    onChange={e => setTestBasic(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>YTD PT Deducted (₹)</label>
                  <input
                    type="number"
                    value={testYtdPt}
                    onChange={e => setTestYtdPt(e.target.value)}
                    placeholder="For Annual Cap tests"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>Attendance Ratio (1 = full)</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={testAttendanceRatio}
                    onChange={e => setTestAttendanceRatio(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
                <button type="submit" className="btn btn-primary" disabled={isTesting} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
                  <i className={`fa-solid ${isTesting ? 'fa-spinner fa-spin' : 'fa-calculator'}`}></i>
                  Calculate & Test PT
                </button>
              </div>
            </form>

            {/* Test Calculation Output Card */}
            {testResult && (
              <div style={{ marginTop: '20px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-square-poll-vertical" style={{ color: '#3b82f6' }}></i>
                  Calculation Engine Result
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                  <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '14px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>FINAL PT DEDUCTION</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#10b981' }}>₹{testResult.ptAmount}</div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>UNPRORATED PT</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: '700', color: 'var(--text-primary)' }}>₹{testResult.unproratedPt || 0}</div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>EVALUATED SALARY</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: '700', color: 'var(--text-primary)' }}>₹{testResult.salaryEvaluated ? Number(testResult.salaryEvaluated).toLocaleString('en-IN') : testGross}</div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>MATCHED SLAB</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#4f46e5', marginTop: '4px' }}>{testResult.ruleName || testResult.reason || 'No rule matched'}</div>
                  </div>
                </div>

                {testResult.salaryRange && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.1)', padding: '10px 14px', borderRadius: '6px' }}>
                    <strong>Range:</strong> ₹{testResult.salaryRange.from} - ₹{testResult.salaryRange.to >= 900000000 ? 'Unlimited' : testResult.salaryRange.to} | <strong>Calculation Type:</strong> {testResult.calculationType} | <strong>Salary Basis:</strong> {testResult.salaryBasis}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. MODAL: AUDIT LOG HISTORY                                               */}
      {/* ========================================================================= */}
      {showHistoryModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div className="card glass custom-scrollbar" style={{ width: '100%', maxWidth: '800px', maxHeight: '85vh', overflowY: 'auto', padding: '28px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-clock-rotate-left" style={{ color: '#4f46e5' }}></i>
                  Audit Trail: {historyStateName}
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Complete chronological history of configuration changes, additions, and deactivations.
                </p>
              </div>
              <button onClick={() => setShowHistoryModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {historyLogs.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No audit log history records found for this state configuration.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {historyLogs.map(log => (
                  <div key={log.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', padding: '14px', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: '800',
                        background: log.action === 'CREATE' ? 'rgba(16, 185, 129, 0.15)' : log.action === 'UPDATE' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: log.action === 'CREATE' ? '#10b981' : log.action === 'UPDATE' ? '#3b82f6' : '#ef4444'
                      }}>
                        {log.action}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {new Date(Number(log.timestamp)).toLocaleString()}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '600', marginBottom: '4px' }}>
                      {log.reason || 'Configuration modification'}
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Performed by: <strong>{log.userName || log.userId || 'Admin'}</strong> | IP: {log.ipAddress || '127.0.0.1'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. MODAL: DUPLICATE STATE                                                 */}
      {/* ========================================================================= */}
      {showDuplicateModal && duplicateSourceState && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '500px', padding: '24px', borderRadius: '16px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.2rem', color: 'var(--text-primary)' }}>
              <i className="fa-solid fa-copy" style={{ marginRight: '8px', color: '#3b82f6' }}></i>
              Duplicate State: {duplicateSourceState.stateName}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              This will create a new state with a complete copy of all configured active tax slabs.
            </p>

            <form onSubmit={handleConfirmDuplicate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>New State Code *</label>
                <input
                  type="text"
                  required
                  value={duplicateCode}
                  onChange={e => setDuplicateCode(e.target.value.toUpperCase())}
                  placeholder="e.g. MH_NEW, KA_2027"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '600' }}>New State Name *</label>
                <input
                  type="text"
                  required
                  value={duplicateName}
                  onChange={e => setDuplicateName(e.target.value)}
                  placeholder="e.g. Maharashtra 2027"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowDuplicateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Duplicate</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. MODAL: IMPORT CONFIGURATION                                            */}
      {/* ========================================================================= */}
      {showImportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div className="card glass custom-scrollbar" style={{ width: '100%', maxWidth: '750px', maxHeight: '90vh', overflowY: 'auto', padding: '28px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)' }}>
                <i className="fa-solid fa-file-import" style={{ marginRight: '8px', color: '#10b981' }}></i>
                Import Professional Tax Configuration
              </h3>
              <button onClick={() => setShowImportModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Paste your exported JSON configuration array below to import or restore state tax configurations and slabs.
            </p>

            <textarea
              rows="10"
              value={importJsonText}
              onChange={e => setImportJsonText(e.target.value)}
              placeholder="Paste JSON configuration array here: [{ stateCode: 'MH', stateName: 'Maharashtra', ... }]"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace', fontSize: '0.8rem' }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              <button className="btn btn-outline" onClick={handlePreviewImport}>
                <i className="fa-solid fa-eye" style={{ marginRight: '6px' }}></i> Validate JSON
              </button>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn btn-outline" onClick={() => setShowImportModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleConfirmImport} disabled={!importPreview}>
                  <i className="fa-solid fa-cloud-arrow-down" style={{ marginRight: '6px' }}></i> Import to Database
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
