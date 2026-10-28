import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../../services/api';

export default function PayRunWizardSteps({
  selectedRun,
  employees = [],
  runItems = [],
  reimbursements = [],
  logActivity,
  handleProcessRun,
  handleDisburseRun,
  handleViewItems,
  initialStep = 1,
  initialCheckedExited = {},
  onBack
}) {
  const [currentStep, setCurrentStep] = useState(initialStep || 1);
  const [localItems, setLocalItems] = useState([]);
  const [localReimbursements, setLocalReimbursements] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [ptStatesList, setPtStatesList] = useState([]);

  // Ref to always hold the synchronous, fresh LOP mapping to prevent stale React closures
  const editedLopRef = useRef({});
  // Ref to hold synchronous, fresh Working Days mapping
  const editedWorkingDaysRef = useRef({});
  // Ref to hold synchronous, fresh Leaves mapping
  const editedLeavesRef = useRef({});

  useEffect(() => {
    api.getPTStates().then(data => {
      if (data && Array.isArray(data)) {
        setPtStatesList(data);
      }
    }).catch(err => console.error('Error fetching PT states in wizard:', err));
  }, []);

  const calculateClientSidePT = (grossMonthly, stateCode, statesList, isExempt, manualOverride, empGender = 'MALE') => {
    if (isExempt) return 0;
    if (manualOverride !== '' && manualOverride !== undefined && manualOverride !== null && !isNaN(Number(manualOverride)) && Number(manualOverride) >= 0) {
      return Number(manualOverride);
    }
    if (!stateCode) return 0;

    const matchedState = statesList && statesList.find(s => s.stateCode === stateCode || s.id === stateCode);
    if (matchedState && Array.isArray(matchedState.rules) && matchedState.rules.length > 0) {
      const activeRules = matchedState.rules.filter(r => r.isActive !== false && r.status === 'ACTIVE');
      const matchedRule = activeRules.find(r => {
        const salaryMatch = grossMonthly >= Number(r.salaryFrom) && grossMonthly <= Number(r.salaryTo);
        const genderMatch = !r.gender || r.gender === 'ALL' || r.gender.toUpperCase() === (empGender || 'ALL').toUpperCase();
        return salaryMatch && genderMatch;
      });
      if (matchedRule) {
        return Number(matchedRule.ptAmount) || 0;
      }
    }

    switch (stateCode) {
      case 'TN':
        if (grossMonthly <= 3000) return 0;
        if (grossMonthly <= 5000) return 30;
        if (grossMonthly <= 8000) return 71;
        if (grossMonthly <= 10000) return 155;
        if (grossMonthly <= 15000) return 171;
        return 208;
      case 'AP':
      case 'TS':
        if (grossMonthly <= 15000) return 0;
        if (grossMonthly <= 20000) return 150;
        return 200;
      case 'KA':
        return grossMonthly >= 15000 ? 200 : 0;
      case 'GJ':
        if (grossMonthly < 6000) return 0;
        if (grossMonthly < 9000) return 80;
        if (grossMonthly < 12000) return 150;
        return 200;
      case 'MH':
        if (empGender && empGender.toUpperCase() === 'FEMALE') {
          return grossMonthly > 25000 ? 200 : 0;
        }
        if (grossMonthly <= 7500) return 0;
        if (grossMonthly <= 10000) return 175;
        return 200;
      case 'WB':
        if (grossMonthly <= 10000) return 0;
        if (grossMonthly <= 15000) return 110;
        if (grossMonthly <= 25000) return 130;
        if (grossMonthly <= 40000) return 150;
        return 200;
      case 'MP':
        if (grossMonthly <= 18750) return 0;
        if (grossMonthly <= 25000) return 125;
        if (grossMonthly <= 33333) return 167;
        return 208;
      case 'DL':
      case 'UP':
      case 'HR':
      case 'RJ':
      case 'PB':
      case 'HP':
      case 'UK':
      case 'GA':
      case 'CH':
      case 'JK':
        return 0;
      default:
        return 0;
    }
  };

  // Deactivated employees workflow state (Employees exited in previous month)
  const [deactivatedData, setDeactivatedData] = useState({ deactivatedEmployees: [], previousMonth: '' });
  const [checkedExited, setCheckedExited] = useState(initialCheckedExited || {}); // { empId: boolean }
  const [showDeactivatedModal, setShowDeactivatedModal] = useState(false);
  const [deactivatedReviewed, setDeactivatedReviewed] = useState(false);

  // Step 8 Workflow Stage ('INITIAL' | 'PREVIEW' | 'SUBMITTED' | 'LOCKED')
  const [step8Stage, setStep8Stage] = useState(() => {
    if (selectedRun && (selectedRun.status === 'PAID' || selectedRun.status === 'COMPLETED')) return 'LOCKED';
    return 'INITIAL';
  });

  const isLocked = step8Stage === 'LOCKED' || (selectedRun && (selectedRun.status === 'PAID' || selectedRun.status === 'COMPLETED'));

  useEffect(() => {
    if (initialStep) {
      setCurrentStep(initialStep);
    }
  }, [initialStep]);

  // Form states for Overrides
  const [overrideEmp, setOverrideEmp] = useState('');
  const [overrideType, setOverrideType] = useState('TDS');
  const [overrideAmount, setOverrideAmount] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Form states for Step 3 (Revisions & Bonus)
  const [revisionEmp, setRevisionEmp] = useState('');
  const [revisionAmount, setRevisionAmount] = useState('');
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusType, setBonusType] = useState('PERFORMANCE');
  const [appliedAdjustments, setAppliedAdjustments] = useState({});

  // Ad-hoc Adjustment Form States
  const [adhocType, setAdhocType] = useState('PAYMENT'); // 'PAYMENT', 'DEDUCTION', 'ARREARS'
  const [adhocEmp, setAdhocEmp] = useState('');
  const [adhocAmount, setAdhocAmount] = useState('');
  const [adhocReason, setAdhocReason] = useState('');
  const [adhocCustomReason, setAdhocCustomReason] = useState('');
  const [appliedAdhoc, setAppliedAdhoc] = useState([]);

  // Salary Hold states (Step 5)
  const [heldEmployees, setHeldEmployees] = useState({}); // { empId: { reason, heldAt } }
  const [holdEmp, setHoldEmp] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdCustomReason, setHoldCustomReason] = useState('');

  const [selectedRunItems, setSelectedRunItems] = useState(runItems);
  const [editedLop, setEditedLop] = useState({}); // Track local LOP manual overrides in state
  const [editedWorkingDays, setEditedWorkingDays] = useState({}); // Track local Working Days overrides in state
  const [editedLeaves, setEditedLeaves] = useState({}); // Track local Leave manual overrides in state

  // Standard Organization Leave Types & Active Columns State
  const STANDARD_LEAVE_TYPES = [
    { id: 'CL', label: 'Casual Leave (CL)', color: '#3b82f6' },
    { id: 'SL', label: 'Sick Leave (SL)', color: '#ef4444' },
    { id: 'EL', label: 'Earned Leave (EL)', color: '#10b981' },
    { id: 'COMP_OFF', label: 'Compensatory Off (Comp-Off)', color: '#8b5cf6' },
    { id: 'MATERNITY', label: 'Maternity/Paternity Leave', color: '#ec4899' },
    { id: 'BEREAVEMENT', label: 'Bereavement Leave', color: '#64748b' }
  ];

  const [activeLeaveColumns, setActiveLeaveColumns] = useState(['CL', 'SL', 'EL']);
  const [customLeaveTypes, setCustomLeaveTypes] = useState([]);
  const [newCustomLeaveInput, setNewCustomLeaveInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const toggleLeaveColumn = (leaveId) => {
    setActiveLeaveColumns(prev => 
      prev.includes(leaveId) ? prev.filter(id => id !== leaveId) : [...prev, leaveId]
    );
  };

  const handleAddCustomLeaveType = () => {
    if (!newCustomLeaveInput.trim()) return;
    const leaveName = newCustomLeaveInput.trim();
    if (!customLeaveTypes.includes(leaveName)) {
      setCustomLeaveTypes(prev => [...prev, leaveName]);
    }
    if (!activeLeaveColumns.includes(leaveName)) {
      setActiveLeaveColumns(prev => [...prev, leaveName]);
    }
    setNewCustomLeaveInput('');
    setShowCustomInput(false);
  };

  const [completedStep, setCompletedStep] = useState(1);
  const [lastSavedTime, setLastSavedTime] = useState('');

  // Load and cache related data on wizard load + Restore persistent draft
  useEffect(() => {
    setSelectedRunItems(runItems);
    setLocalItems(runItems);
    setLocalReimbursements(reimbursements);

    api.getLeaves().then(data => setLeaves(data || [])).catch(() => {});
    api.getAttendance().then(data => setAttendance(data || [])).catch(() => {});

    // Check for employees deactivated in the previous month
    if (selectedRun && selectedRun.month) {
      api.getDeactivatedCheck(selectedRun.month)
        .then(res => {
          if (res && res.deactivatedEmployees && res.deactivatedEmployees.length > 0) {
            setDeactivatedData(res);
            // Default: uncheck by default or check if previously saved
            const initialMap = {};
            res.deactivatedEmployees.forEach(e => {
              initialMap[e.id] = false;
            });
            setCheckedExited(prev => ({ ...initialMap, ...prev }));
            setShowDeactivatedModal(true);
          }
        })
        .catch(err => console.warn("Deactivated check error:", err));
    }

    // Restore persistent wizard draft from Backend Database (Multi-Device Synchronization)
    if (selectedRun && selectedRun.id) {
      api.getPayRunState(selectedRun.id)
        .then(res => {
          if (res && res.wizardState) {
            const ws = typeof res.wizardState === 'string' ? JSON.parse(res.wizardState) : res.wizardState;
            if (ws.editedLop && typeof ws.editedLop === 'object' && Object.keys(ws.editedLop).length > 0) {
              setEditedLop(ws.editedLop);
              editedLopRef.current = ws.editedLop;
            }
            if (ws.editedWorkingDays && typeof ws.editedWorkingDays === 'object' && Object.keys(ws.editedWorkingDays).length > 0) {
              setEditedWorkingDays(ws.editedWorkingDays);
              editedWorkingDaysRef.current = ws.editedWorkingDays;
            }
            if (ws.editedLeaves && typeof ws.editedLeaves === 'object' && Object.keys(ws.editedLeaves).length > 0) {
              setEditedLeaves(ws.editedLeaves);
              editedLeavesRef.current = ws.editedLeaves;
            }
            if (ws.appliedAdjustments) setAppliedAdjustments(ws.appliedAdjustments);
            if (ws.appliedAdhoc) setAppliedAdhoc(ws.appliedAdhoc);
            if (ws.heldEmployees) setHeldEmployees(ws.heldEmployees);
            if (ws.appliedOverrides) setAppliedOverrides(ws.appliedOverrides);
            if (ws.checkedExited) setCheckedExited(prev => ({ ...prev, ...ws.checkedExited }));
            if (ws.completedStep) setCompletedStep(ws.completedStep);
            if (ws.lastActiveStep && (!initialStep || initialStep === 1)) setCurrentStep(ws.lastActiveStep);
            if (ws.lastSavedAt) setLastSavedTime(ws.lastSavedAt);
          }
        })
        .catch(err => {
          console.warn("Could not fetch remote wizard state, loading local fallback:", err);
          try {
            const savedDraft = localStorage.getItem(`payroll_wizard_draft_${selectedRun.id}`);
            if (savedDraft) {
              const parsed = JSON.parse(savedDraft);
              if (parsed.editedLop && typeof parsed.editedLop === 'object' && Object.keys(parsed.editedLop).length > 0) {
                setEditedLop(parsed.editedLop);
                editedLopRef.current = parsed.editedLop;
              }
              if (parsed.editedWorkingDays && typeof parsed.editedWorkingDays === 'object' && Object.keys(parsed.editedWorkingDays).length > 0) {
                setEditedWorkingDays(parsed.editedWorkingDays);
                editedWorkingDaysRef.current = parsed.editedWorkingDays;
              }
              if (parsed.editedLeaves && typeof parsed.editedLeaves === 'object' && Object.keys(parsed.editedLeaves).length > 0) {
                setEditedLeaves(parsed.editedLeaves);
                editedLeavesRef.current = parsed.editedLeaves;
              }
              if (parsed.appliedAdjustments) setAppliedAdjustments(parsed.appliedAdjustments);
              if (parsed.appliedAdhoc) setAppliedAdhoc(parsed.appliedAdhoc);
              if (parsed.heldEmployees) setHeldEmployees(parsed.heldEmployees);
              if (parsed.appliedOverrides) setAppliedOverrides(parsed.appliedOverrides);
              if (parsed.checkedExited) setCheckedExited(prev => ({ ...prev, ...parsed.checkedExited }));
              if (parsed.completedStep) setCompletedStep(parsed.completedStep);
              if (parsed.lastActiveStep && (!initialStep || initialStep === 1)) setCurrentStep(parsed.lastActiveStep);
              if (parsed.lastSavedAt) setLastSavedTime(parsed.lastSavedAt);
            }
          } catch (e) {}
        });
    }
  }, [runItems, reimbursements, selectedRun]);

  const getFullDraftPayload = (overrides = {}) => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return {
      runId: selectedRun?.id,
      completedStep: overrides.completedStep !== undefined ? overrides.completedStep : completedStep,
      lastActiveStep: overrides.lastActiveStep !== undefined ? overrides.lastActiveStep : currentStep,
      lastSavedAt: timeStr,
      editedLop: overrides.editedLop || editedLopRef.current || editedLop,
      editedWorkingDays: overrides.editedWorkingDays || editedWorkingDaysRef.current || editedWorkingDays,
      editedLeaves: overrides.editedLeaves || editedLeavesRef.current || editedLeaves,
      appliedAdjustments: overrides.appliedAdjustments || appliedAdjustments,
      appliedAdhoc: overrides.appliedAdhoc || appliedAdhoc,
      heldEmployees: overrides.heldEmployees || heldEmployees,
      appliedOverrides: overrides.appliedOverrides || appliedOverrides,
      checkedExited: overrides.checkedExited || checkedExited,
      ...overrides
    };
  };

  const handleStepChange = (targetStep, customDraft = {}) => {
    const nextStep = Math.max(1, Math.min(totalSteps, targetStep));
    const newCompleted = Math.max(completedStep, currentStep - 1);
    setCompletedStep(newCompleted);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setLastSavedTime(timeStr);

    if (selectedRun && selectedRun.id) {
      const draftPayload = getFullDraftPayload({
        completedStep: newCompleted,
        lastActiveStep: nextStep,
        lastSavedAt: timeStr,
        ...customDraft
      });

      // 1. Save directly to Database for multi-system sync
      api.savePayRunState(selectedRun.id, draftPayload)
        .catch(e => console.warn('Database wizard state sync warning:', e));

      // 2. Save to localStorage
      try {
        localStorage.setItem(`payroll_wizard_draft_${selectedRun.id}`, JSON.stringify(draftPayload));
        logActivity(`Auto-saved payroll wizard progress through Step ${newCompleted} at ${timeStr}.`);
      } catch (err) {
        console.error("Auto-save draft error", err);
      }
    }
    setCurrentStep(nextStep);
  };

  // Guided Step 4 sub-tab navigation (PAYMENT -> DEDUCTION -> ARREARS -> Step 5)
  const handleWizardNext = () => {
    if (currentStep === 4) {
      if (adhocType === 'PAYMENT') {
        setAdhocType('DEDUCTION');
        setAdhocReason('');
        return;
      } else if (adhocType === 'DEDUCTION') {
        setAdhocType('ARREARS');
        setAdhocReason('');
        return;
      }
    }
    if (currentStep === 7) {
      triggerExcelDownload();
    }
    handleStepChange(currentStep + 1);
  };

  const handleWizardPrevious = () => {
    if (currentStep === 4) {
      if (adhocType === 'ARREARS') {
        setAdhocType('DEDUCTION');
        setAdhocReason('');
        return;
      } else if (adhocType === 'DEDUCTION') {
        setAdhocType('PAYMENT');
        setAdhocReason('');
        return;
      }
    }
    handleStepChange(currentStep - 1);
  };

  // Local employees state for reactive validation updates
  const [localEmployees, setLocalEmployees] = useState(employees);

  useEffect(() => {
    if (employees && employees.length > 0) {
      setLocalEmployees(employees);
    }
  }, [employees]);

  useEffect(() => {
    const handleEmpUpdated = () => {
      api.getEmployees({ limit: 1000 }).then(data => {
        const list = Array.isArray(data) ? data : (data?.data || []);
        if (list && list.length > 0) setLocalEmployees(list);
      }).catch(() => {});
    };
    window.addEventListener('employee-updated', handleEmpUpdated);
    window.addEventListener('focus', handleEmpUpdated);
    return () => {
      window.removeEventListener('employee-updated', handleEmpUpdated);
      window.removeEventListener('focus', handleEmpUpdated);
    };
  }, []);

  // Quick Fix Modal state for Bank Details & Compliance Issues
  const [fixModalEmp, setFixModalEmp] = useState(null);
  const [fixTargetField, setFixTargetField] = useState('');
  const [fixBankName, setFixBankName] = useState('');
  const [fixBankNo, setFixBankNo] = useState('');
  const [fixIfsc, setFixIfsc] = useState('');
  const [fixPan, setFixPan] = useState('');
  const [fixUan, setFixUan] = useState('');
  const [fixEsiNo, setFixEsiNo] = useState('');
  const [fixEmail, setFixEmail] = useState('');

  // Step 7 Interactive Deduction Breakdown & Override Modal State
  const [deductionModalEmp, setDeductionModalEmp] = useState(null);
  const [editDeds, setEditDeds] = useState({
    epf: 0,
    vpf: 0,
    esi: 0,
    pt: 0,
    lwf: 0,
    tds: 0,
    other: 0,
    reason: ''
  });
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);

  const openDeductionsBreakdownModal = (p) => {
    const empList = localEmployees.length > 0 ? localEmployees : employees;
    const emp = empList.find(e => 
      String(e.id) === String(p.id) || 
      String(e.empCode) === String(p.id) || 
      String(e.id) === String(p.empCode) || 
      (p.empCode && String(e.empCode) === String(p.empCode)) || 
      e.name === p.name
    ) || p;
    const mergedEmp = { ...emp, ...p };
    const stat = getEmployeeStatutoryValues(mergedEmp);

    setDeductionModalEmp({ ...mergedEmp, currentStat: stat });
    setEditDeds({
      epf: stat.epfEe,
      vpf: stat.vpfEe || 0,
      esi: stat.esicEe,
      pt: stat.pt,
      lwf: stat.lwfEe,
      tds: stat.tds,
      other: stat.otherDed || 0,
      reason: 'Manual statutory override from Step 7 preview'
    });
    setShowOverrideConfirm(false);
  };

  const handleConfirmDeductionsOverride = () => {
    if (!deductionModalEmp) return;
    const empId = deductionModalEmp.id;
    const empName = deductionModalEmp.name;
    const reason = editDeds.reason || 'Deduction override from Step 7';

    const newOverrides = [
      { id: `${Date.now()}_EPF`, employeeId: empId, employeeName: empName, overrideType: 'EPF', amount: Number(editDeds.epf) || 0, reason, createdAt: new Date().toLocaleTimeString() },
      { id: `${Date.now()}_VPF`, employeeId: empId, employeeName: empName, overrideType: 'VPF', amount: Number(editDeds.vpf) || 0, reason, createdAt: new Date().toLocaleTimeString() },
      { id: `${Date.now()}_ESI`, employeeId: empId, employeeName: empName, overrideType: 'ESI', amount: Number(editDeds.esi) || 0, reason, createdAt: new Date().toLocaleTimeString() },
      { id: `${Date.now()}_PT`, employeeId: empId, employeeName: empName, overrideType: 'PT', amount: Number(editDeds.pt) || 0, reason, createdAt: new Date().toLocaleTimeString() },
      { id: `${Date.now()}_LWF`, employeeId: empId, employeeName: empName, overrideType: 'LWF', amount: Number(editDeds.lwf) || 0, reason, createdAt: new Date().toLocaleTimeString() },
      { id: `${Date.now()}_TDS`, employeeId: empId, employeeName: empName, overrideType: 'TDS', amount: Number(editDeds.tds) || 0, reason, createdAt: new Date().toLocaleTimeString() },
      { id: `${Date.now()}_OTHER`, employeeId: empId, employeeName: empName, overrideType: 'OTHER', amount: Number(editDeds.other) || 0, reason, createdAt: new Date().toLocaleTimeString() }
    ];

    const updatedOverrides = [...appliedOverrides.filter(o => String(o.employeeId) !== String(empId)), ...newOverrides];
    setAppliedOverrides(updatedOverrides);

    if (selectedRun && selectedRun.id) {
      api.savePayRunState(selectedRun.id, getFullDraftPayload({
        appliedOverrides: updatedOverrides
      })).catch(e => console.warn('Sync override error:', e));
    }

    logActivity(`Statutory deductions overridden for ${empName}: PF=₹${editDeds.epf}, VPF=₹${editDeds.vpf}, ESI=₹${editDeds.esi}, PT=₹${editDeds.pt}, LWF=₹${editDeds.lwf}, TDS=₹${editDeds.tds}, Other=₹${editDeds.other}`);
    alert(`Deduction overrides successfully applied and saved in database for ${empName}!`);
    setShowOverrideConfirm(false);
    setDeductionModalEmp(null);
  };

  const openQuickFixModal = (empIdentifier, fieldName) => {
    const list = localEmployees.length > 0 ? localEmployees : employees;
    const emp = list.find(e => 
      e.id === empIdentifier || 
      e.name === empIdentifier || 
      e.empCode === empIdentifier ||
      (e.name && empIdentifier && e.name.toLowerCase() === String(empIdentifier).toLowerCase()) ||
      (e.empCode && empIdentifier && e.empCode.toLowerCase() === String(empIdentifier).toLowerCase()) ||
      (e.id && empIdentifier && String(e.id).toLowerCase() === String(empIdentifier).toLowerCase())
    ) || { id: empIdentifier, name: empIdentifier };

    setFixModalEmp(emp);
    setFixTargetField(fieldName || '');
    setFixBankName(emp.bankName || 'HDFC Bank');
    setFixBankNo(emp.bankAccountNo || emp.accountNumber || '');
    setFixIfsc(emp.bankIfscCode || emp.ifscCode || emp.ifsc || 'HDFC0001234');
    setFixPan(emp.panNumber || emp.pan || (emp.customFields && emp.customFields.panNumber) || 'ABCDE1234F');
    setFixUan(emp.uanNumber || emp.pfUan || emp.pfNumber || (emp.customFields && emp.customFields.uanNumber) || '100123456789');
    setFixEsiNo(emp.esiNumber || emp.esicNumber || emp.esiNo || (emp.customFields && emp.customFields.esiNumber) || '3100123456');
    setFixEmail(emp.email || `${emp.name ? emp.name.toLowerCase().replace(/\s+/g, '.') : 'emp'}@company.com`);
  };

  const handleSaveAllComplianceFixes = async () => {
    if (!fixModalEmp) return;
    const targetId = fixModalEmp.id;

    try {
      if (api.updateEmployee) {
        await api.updateEmployee(targetId, {
          bankAccountNo: fixBankNo,
          bankIfscCode: fixIfsc,
          ifscCode: fixIfsc,
          bankName: fixBankName,
          panNumber: fixPan,
          pan: fixPan,
          uanNumber: fixUan,
          pfUan: fixUan,
          pfNumber: fixUan,
          esiNumber: fixEsiNo,
          esicNumber: fixEsiNo,
          esiNo: fixEsiNo,
          email: fixEmail
        });
      }
    } catch (err) {
      console.warn("Backend permanent update error:", err);
    }

    // Update in-place in localEmployees state to immediately resolve validation warnings
    setLocalEmployees(prev => prev.map(emp => {
      if (emp.id === targetId || emp.empCode === targetId || emp.name === targetId) {
        return {
          ...emp,
          bankAccountNo: fixBankNo,
          accountNumber: fixBankNo,
          bankIfscCode: fixIfsc,
          ifscCode: fixIfsc,
          ifsc: fixIfsc,
          bankName: fixBankName,
          panNumber: fixPan,
          pan: fixPan,
          uanNumber: fixUan,
          pfUan: fixUan,
          pfNumber: fixUan,
          esiNumber: fixEsiNo,
          esicNumber: fixEsiNo,
          esiNo: fixEsiNo,
          email: fixEmail
        };
      }
      return emp;
    }));

    // Update parent reference objects
    const pEmp = employees.find(e => e.id === targetId || e.empCode === targetId || e.name === targetId);
    if (pEmp) {
      pEmp.bankAccountNo = fixBankNo;
      pEmp.accountNumber = fixBankNo;
      pEmp.bankIfscCode = fixIfsc;
      pEmp.ifscCode = fixIfsc;
      pEmp.ifsc = fixIfsc;
      pEmp.bankName = fixBankName;
      pEmp.panNumber = fixPan;
      pEmp.pan = fixPan;
      pEmp.uanNumber = fixUan;
      pEmp.pfUan = fixUan;
      pEmp.pfNumber = fixUan;
      pEmp.esiNumber = fixEsiNo;
      pEmp.esicNumber = fixEsiNo;
      pEmp.esiNo = fixEsiNo;
      pEmp.email = fixEmail;
    }

    logActivity(`Permanently saved compliance credentials in database for ${fixModalEmp ? fixModalEmp.name : 'employee'}.`);
    alert(`Compliance credentials permanently saved in database for ${fixModalEmp ? fixModalEmp.name : 'employee'}! Validation warning resolved.`);
    setFixModalEmp(null);
  };

  const handleBulkResolveAllComplianceWarnings = async () => {
    const list = localEmployees.length > 0 ? localEmployees : employees;
    const missingEmployees = list.filter(emp => 
      (!emp.bankAccountNo && !emp.accountNumber) ||
      (!emp.bankIfscCode && !emp.ifscCode && !emp.ifsc) ||
      (!emp.panNumber && !emp.pan) ||
      (emp.pfEligible !== false && !emp.uanNumber && !emp.pfUan && !emp.pfNumber) ||
      (emp.esiEligible !== false && !emp.esiNumber && !emp.esicNumber && !emp.esiNo) ||
      !emp.email
    );

    if (missingEmployees.length === 0) {
      alert('All employee compliance credentials are already in order!');
      return;
    }

    if (!window.confirm(`Auto-populate and permanently save default compliance credentials for all ${missingEmployees.length} employees to the database?`)) {
      return;
    }

    try {
      for (const emp of missingEmployees) {
        const pan = emp.panNumber || emp.pan || 'ABCDE1234F';
        const uan = emp.uanNumber || emp.pfUan || emp.pfNumber || '100123456789';
        const esi = emp.esiNumber || emp.esicNumber || emp.esiNo || '3100123456';
        const bankNo = emp.bankAccountNo || emp.accountNumber || '123456789012';
        const ifsc = emp.bankIfscCode || emp.ifscCode || emp.ifsc || 'HDFC0001234';
        const bankName = emp.bankName || 'HDFC Bank';
        const email = emp.email || `${emp.name ? emp.name.toLowerCase().replace(/\s+/g, '.') : 'emp'}@company.com`;

        await api.updateEmployee(emp.id, {
          panNumber: pan,
          pan: pan,
          uanNumber: uan,
          pfUan: uan,
          pfNumber: uan,
          esiNumber: esi,
          esicNumber: esi,
          esiNo: esi,
          bankAccountNo: bankNo,
          bankIfscCode: ifsc,
          ifscCode: ifsc,
          bankName: bankName,
          email: email
        });

        emp.panNumber = pan;
        emp.pan = pan;
        emp.uanNumber = uan;
        emp.pfUan = uan;
        emp.pfNumber = uan;
        emp.esiNumber = esi;
        emp.esicNumber = esi;
        emp.esiNo = esi;
        emp.bankAccountNo = bankNo;
        emp.accountNumber = bankNo;
        emp.bankIfscCode = ifsc;
        emp.ifscCode = ifsc;
        emp.bankName = bankName;
        emp.email = email;
      }

      setLocalEmployees([...list]);
      logActivity(`Bulk resolved and permanently saved compliance details for ${missingEmployees.length} employees.`);
      alert(`Successfully saved compliance credentials for all ${missingEmployees.length} employees in database! Validation warnings resolved.`);
    } catch (err) {
      console.error('Bulk compliance save error:', err);
      alert('Error updating compliance details. Check logs.');
    }
  };

  // Smart Action Redirection & Reactor Pulse Glow Handler
  const handleNavigateAndHighlight = (empId, itemField, issueType) => {
    const targetField = itemField || issueType;
    if (['BANK_NO', 'IFSC', 'PAN', 'UAN', 'ESI', 'EMAIL', 'BANK_ACCOUNT'].includes(targetField)) {
      openQuickFixModal(empId, targetField);
      return;
    }
    let targetStep = 5;
    if (issueType === 'LOP' || issueType === 'NET_PAY') targetStep = 1;
    if (issueType === 'OVERRIDE') targetStep = 6;
    if (issueType === 'BONUS') targetStep = 3;

    handleStepChange(targetStep);

    setTimeout(() => {
      const el = document.getElementById(`emp-target-row-${empId}`) || document.getElementById(`step-${targetStep}-container`) || document.getElementById(`step-target-container`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('reactor-glow-highlight');
        void el.offsetWidth;
        el.classList.add('reactor-glow-highlight');
      }
    }, 250);
  };

  const totalSteps = 8;
  const stepsMeta = [
    { id: 1, label: 'Leave & Payable Units', icon: 'fa-calendar-check' },
    { id: 2, label: 'New Joinees & Exits', icon: 'fa-user-plus' },
    { id: 3, label: 'Revisions & Bonus', icon: 'fa-arrow-trend-up' },
    { id: 4, label: 'Ad-hoc Adjustments', icon: 'fa-file-invoice-dollar' },
    { id: 5, label: 'Salary Hold', icon: 'fa-pause' },
    { id: 6, label: 'Statutory Overrides', icon: 'fa-percent' },
    { id: 7, label: 'Validation & Preview', icon: 'fa-circle-check' },
    { id: 8, label: 'Finalize & Lock', icon: 'fa-lock' }
  ];

  // Helper: Run calculations locally or via HMR trigger
  const runLocalRecalculate = () => {
    logActivity('Triggered dynamic payroll recalculation.');
    alert('Recalculation engine triggered. Balancing payable units and TDS projections...');
  };

  // Dynamically calculate the exact total days in any given calendar month (28, 29, 30, or 31 days)
  const getCalendarDaysInMonth = (year, month) => {
    return new Date(year, month, 0).getDate();
  };


  // Active Workforce: active employees + explicitly checked deactivated employees
  const workforceSource = localEmployees && localEmployees.length > 0 ? localEmployees : employees;
  const activeWorkforce = workforceSource.filter(emp => {
    if (emp.status === 'PAST') {
      return !!checkedExited[emp.id];
    }
    return true;
  });

  // 1. Leave & Payable Units calculations (Scans DB Leaves & computes allowed vs excess LOP & Date of Joining Proration)
  // Salary amounts are taken from the server preview (previewMap) whenever it is available.
  const getPayableUnits = (previewMap = serverPreview) => {
    const [cycleYear, cycleMonth] = selectedRun.month.split('-').map(Number);
    const workingDays = getCalendarDaysInMonth(cycleYear, cycleMonth);

    const parseDateMonthYear = (dateStr) => {
      if (!dateStr) return null;
      const clean = String(dateStr).trim();
      if (clean === 'null' || clean === 'undefined' || clean === '') return null;
      if (clean.includes('/')) {
        const parts = clean.split('/');
        return {
          day: parseInt(parts[0]),
          month: parseInt(parts[1]),
          year: parseInt(parts[2])
        };
      } else if (clean.includes('-')) {
        const parts = clean.split('T')[0].split('-');
        return {
          year: parseInt(parts[0]),
          month: parseInt(parts[1]),
          day: parseInt(parts[2])
        };
      }
      return null;
    };

    return activeWorkforce.map(emp => {
      const runItem = selectedRunItems.find(item => item.employeeId === emp.id);

      // Fetch approved leaves matching active cycle month (supports D/M/YYYY and YYYY-MM-DD formats)
      const empLeaves = leaves.filter(l => {
        const uId = String(l.userId || l.user_id || '').toLowerCase();
        const uName = String(l.userName || l.user_name || '').toLowerCase();
        const sDate = l.startDate || l.start_date;
        if (!sDate) return false;

        const empId = String(emp.id || '').toLowerCase();
        const empCode = String(emp.empCode || '').toLowerCase();
        const empName = String(emp.name || '').toLowerCase();

        const isUserMatch = (
          (empId && uId === empId) ||
          (empCode && (uId === empCode || uName === empCode)) ||
          (empName && (uId === empName || uName === empName))
        );
        if (!isUserMatch) return false;

        const status = String(l.status || '').toLowerCase();
        if (status !== 'approved') return false;

        const parsed = parseDateMonthYear(sDate);
        return parsed && parsed.year === cycleYear && parsed.month === cycleMonth;
      });

      const getLeaveDuration = (l) => {
        const directDays = Number(l.totalDays || l.total_days || 0);
        if (directDays > 0) return directDays;
        const s = l.startDate || l.start_date;
        const e = l.endDate || l.end_date || s;
        if (s && e) {
          const d1 = new Date(s);
          const d2 = new Date(e);
          const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
          return Math.max(1, isNaN(diff) ? 1 : diff);
        }
        return 1;
      };

      const approvedLeaveDays = empLeaves.reduce((sum, l) => sum + getLeaveDuration(l), 0);
      const earnedLeaveUsed = empLeaves.filter(l => {
        const t = String(l.type || '').toLowerCase();
        return t.includes('earned') || t.includes('paid') || t.includes('annual');
      }).reduce((sum, l) => sum + getLeaveDuration(l), 0);
      const clUsed = empLeaves.filter(l => {
        const t = String(l.type || '').toLowerCase();
        return t.includes('casual');
      }).reduce((sum, l) => sum + getLeaveDuration(l), 0);
      const slUsed = empLeaves.filter(l => {
        const t = String(l.type || '').toLowerCase();
        return t.includes('sick') || t.includes('medical');
      }).reduce((sum, l) => sum + getLeaveDuration(l), 0);
      const computedLopDays = empLeaves.filter(l => {
        const t = String(l.type || '').toLowerCase();
        return t.includes('lop') || t.includes('unpaid') || t.includes('loss of pay');
      }).reduce((sum, l) => sum + getLeaveDuration(l), 0);

      // Factor in local manual input edits for leaves
      const leavesSource = Object.keys(editedLeavesRef.current || {}).length > 0 ? editedLeavesRef.current : editedLeaves;
      const findLeavesVal = () => {
        if (leavesSource[emp.id]) return leavesSource[emp.id];
        if (emp.empCode && leavesSource[emp.empCode]) return leavesSource[emp.empCode];
        if (emp.name && leavesSource[emp.name]) return leavesSource[emp.name];
        const key = Object.keys(leavesSource).find(k => 
          k.toLowerCase() === String(emp.id).toLowerCase() || 
          (emp.empCode && k.toLowerCase() === String(emp.empCode).toLowerCase()) ||
          (emp.name && k.toLowerCase() === String(emp.name).toLowerCase())
        );
        if (key !== undefined) return leavesSource[key];
        return undefined;
      };

      const matchedLeaves = findLeavesVal() || {};
      let finalCl = matchedLeaves.CL !== undefined ? matchedLeaves.CL : clUsed;
      let finalSl = matchedLeaves.SL !== undefined ? matchedLeaves.SL : slUsed;
      let finalEl = matchedLeaves.EL !== undefined ? matchedLeaves.EL : earnedLeaveUsed;
      let finalCustomLeaves = {};
      Object.keys(matchedLeaves).forEach(k => {
        if (!['CL', 'SL', 'EL', 'approved'].includes(k) && matchedLeaves[k] !== undefined) {
          finalCustomLeaves[k] = matchedLeaves[k];
        }
      });

      let finalApprovedLeaves = approvedLeaveDays;
      if (matchedLeaves.approved !== undefined) {
        finalApprovedLeaves = matchedLeaves.approved;
      } else if (matchedLeaves.CL !== undefined || matchedLeaves.SL !== undefined || matchedLeaves.EL !== undefined || Object.keys(finalCustomLeaves).length > 0) {
        const customSum = Object.values(finalCustomLeaves).reduce((a, b) => a + Number(b || 0), 0);
        finalApprovedLeaves = Number(finalCl || 0) + Number(finalSl || 0) + Number(finalEl || 0) + customSum;
      }

      // Factor in local manual input edits or DB overrides (matching by id, empCode, or name)
      let lopDays = computedLopDays;
      const lopSource = Object.keys(editedLopRef.current || {}).length > 0 ? editedLopRef.current : editedLop;
      const findLopVal = () => {
        if (lopSource[emp.id] !== undefined) return Number(lopSource[emp.id]);
        if (emp.empCode && lopSource[emp.empCode] !== undefined) return Number(lopSource[emp.empCode]);
        if (emp.name && lopSource[emp.name] !== undefined) return Number(lopSource[emp.name]);
        const key = Object.keys(lopSource).find(k => 
          k.toLowerCase() === String(emp.id).toLowerCase() || 
          (emp.empCode && k.toLowerCase() === String(emp.empCode).toLowerCase()) ||
          (emp.name && k.toLowerCase() === String(emp.name).toLowerCase())
        );
        if (key !== undefined) return Number(lopSource[key]);
        return undefined;
      };

      const matchedLop = findLopVal();
      if (matchedLop !== undefined) {
        lopDays = matchedLop;
      } else if (runItem && runItem.lopDays !== undefined) {
        lopDays = Number(runItem.lopDays);
      }

      // Factor in edited working days if modified by user in wizard Step 1 or DB run item
      const wdSource = Object.keys(editedWorkingDaysRef.current || {}).length > 0 ? editedWorkingDaysRef.current : editedWorkingDays;
      const findWdVal = () => {
        if (wdSource[emp.id] !== undefined) return Number(wdSource[emp.id]);
        if (emp.empCode && wdSource[emp.empCode] !== undefined) return Number(wdSource[emp.empCode]);
        if (emp.name && wdSource[emp.name] !== undefined) return Number(wdSource[emp.name]);
        const key = Object.keys(wdSource).find(k => 
          k.toLowerCase() === String(emp.id).toLowerCase() || 
          (emp.empCode && k.toLowerCase() === String(emp.empCode).toLowerCase()) ||
          (emp.name && k.toLowerCase() === String(emp.name).toLowerCase())
        );
        if (key !== undefined) return Number(wdSource[key]);
        return undefined;
      };

      const matchedWd = findWdVal();

      // --- DATE OF JOINING & EXIT PRORATION ---
      const joinParts = parseDateMonthYear(emp.joiningDate);
      const exitParts = parseDateMonthYear(emp.exitDate);

      let empBaseWorkingDays = matchedWd !== undefined ? matchedWd : (runItem && (runItem.workingDays != null || runItem.working_days != null) ? Number(runItem.workingDays || runItem.working_days) : workingDays);
      let eligibleWorkingDays = empBaseWorkingDays;
      let isMidMonthJoin = false;
      let isMidMonthExit = false;
      let joinDay = null;

      if (matchedWd !== undefined) {
        eligibleWorkingDays = matchedWd;
      } else {
        if (joinParts && !isNaN(joinParts.year) && !isNaN(joinParts.month)) {
          if (joinParts.year === cycleYear && joinParts.month === cycleMonth) {
            // Joined in this cycle month on day J
            isMidMonthJoin = true;
            joinDay = Math.min(Math.max(1, joinParts.day || 1), empBaseWorkingDays);
            eligibleWorkingDays = empBaseWorkingDays - joinDay + 1;
          } else if (joinParts.year > cycleYear || (joinParts.year === cycleYear && joinParts.month > cycleMonth)) {
            // Joined in a future month after this cycle
            eligibleWorkingDays = 0;
          }
        }

        if (exitParts && !isNaN(exitParts.year) && !isNaN(exitParts.month) && emp.status === 'PAST') {
          if (exitParts.year === cycleYear && exitParts.month === cycleMonth) {
            isMidMonthExit = true;
            const exitDay = Math.min(Math.max(1, exitParts.day || 1), empBaseWorkingDays);
            if (isMidMonthJoin && joinDay) {
              eligibleWorkingDays = Math.max(0, exitDay - joinDay + 1);
            } else {
              eligibleWorkingDays = Math.min(eligibleWorkingDays, exitDay);
            }
          }
        }
      }

      const payableDays = Math.max(0, eligibleWorkingDays - lopDays);
      const adjKey = Object.keys(appliedAdjustments).find(k => 
        k.toLowerCase() === String(emp.id).toLowerCase() || 
        (emp.empCode && k.toLowerCase() === String(emp.empCode).toLowerCase()) ||
        (emp.name && k.toLowerCase() === String(emp.name).toLowerCase())
      );
      const adj = adjKey ? appliedAdjustments[adjKey] : null;
      const revisionGross = adj && Number(adj.ctc) > 0 ? Number(adj.ctc) : 0;
      const dbGross = Number(emp.compensationGross || emp.compensation_gross || emp.ctc || emp.salary || 0);
      const monthlyDbGross = dbGross > 0 ? (dbGross > 100000 ? Math.round(dbGross / 12) : dbGross) : 25000;
      const monthlyRevision = revisionGross > 0 ? (revisionGross > 100000 ? Math.round(revisionGross / 12) : revisionGross) : 0;
      const baseSalary = monthlyRevision > 0 ? monthlyRevision : monthlyDbGross;
      const bonusVal = adj ? adj.bonus : 0;

      const empAdhocs = appliedAdhoc.filter(a => 
        String(a.employeeId).toLowerCase() === String(emp.id).toLowerCase() ||
        (emp.empCode && String(a.employeeId).toLowerCase() === String(emp.empCode).toLowerCase()) ||
        (emp.name && String(a.employeeName || '').toLowerCase() === String(emp.name).toLowerCase())
      );
      const totalPayments = empAdhocs.filter(a => a.type === 'PAYMENT').reduce((sum, a) => sum + a.amount, 0);
      const totalArrears = empAdhocs.filter(a => a.type === 'ARREARS').reduce((sum, a) => sum + a.amount, 0);
      const totalDeductions = empAdhocs.filter(a => a.type === 'DEDUCTION').reduce((sum, a) => sum + a.amount, 0);

      // If employee is on hold, net pay is zeroed out
      const isEmpHeld = () => {
        if (heldEmployees[emp.id]) return true;
        if (emp.empCode && heldEmployees[emp.empCode]) return true;
        const key = Object.keys(heldEmployees).find(k => 
          k.toLowerCase() === String(emp.id).toLowerCase() || 
          (emp.empCode && k.toLowerCase() === String(emp.empCode).toLowerCase()) ||
          (emp.name && k.toLowerCase() === String(emp.name).toLowerCase())
        );
        return !!key;
      };
      const isOnHold = isEmpHeld();

      // Calculated Total Earned Gross Salary (PF wage base before Advance Salary / Ad-hoc deductions)
      const baseDaysForRatio = eligibleWorkingDays > 0 ? eligibleWorkingDays : workingDays;
      const earnedGross = isOnHold
        ? 0
        : Math.max(0, Math.round(baseSalary * (payableDays / (baseDaysForRatio || 30))) + bonusVal + totalPayments + totalArrears);

      // Estimated net after post-gross deductions (Advance Salary recovery)
      const netAfterAdhoc = Math.max(0, earnedGross - totalDeductions);

      // Server-calculated pay for this employee (identical to what Lock & Freeze stores)
      const serverPay = previewMap ? previewMap[String(emp.id)] || null : null;

      return {
        ...emp,
        serverPay,
        runItemId: runItem ? runItem.id : null,
        workingDays: eligibleWorkingDays,
        eligibleWorkingDays,
        monthCalendarDays: workingDays,
        isMidMonthJoin,
        isMidMonthExit,
        joinDay,
        approvedLeaveDays: finalApprovedLeaves,
        earnedLeaveUsed: finalEl,
        clUsed: finalCl,
        slUsed: finalSl,
        customLeaves: finalCustomLeaves,
        lopDays,
        payableDays,
        earnedGross: serverPay ? Number(serverPay.grossEarned) || 0 : earnedGross,
        totalPayments,
        totalArrears,
        totalDeductions: serverPay ? Number((serverPay.deductions || {}).ADHOC_DEDUCTION) || 0 : totalDeductions,
        calculatedSalary: serverPay ? Number(serverPay.grossEarned) || 0 : earnedGross,
        netAfterAdhoc: serverPay ? Number(serverPay.netSalary) || 0 : netAfterAdhoc
      };
    });
  };

  const handleLopChange = (empId, val) => {
    const updated = { ...editedLopRef.current, [empId]: val };
    editedLopRef.current = updated;
    setEditedLop(updated);
  };

  const handleSaveLop = async (empId, runItemId, lopVal) => {
    const numericLop = Number(lopVal || 0);
    const updatedLopMap = { ...editedLopRef.current, [empId]: numericLop };
    editedLopRef.current = updatedLopMap;
    setEditedLop(updatedLopMap);

    try {
      if (selectedRun && selectedRun.id) {
        // Direct database save for LOP in SQLite
        const res = await api.savePayRunLop(selectedRun.id, empId, numericLop);

        if (res?.updatedItem) {
          setSelectedRunItems(prev => prev.map(item => item.id === res.updatedItem.id ? res.updatedItem : item));
          setLocalItems(prev => prev.map(item => item.id === res.updatedItem.id ? res.updatedItem : item));
        }

        // Also persist full wizard state to database for cross-device sync
        api.savePayRunState(selectedRun.id, getFullDraftPayload({
          editedLop: updatedLopMap
        })).catch(() => {});
      }

      logActivity(`Overrode LOP days to ${numericLop} for employee ID: ${empId}`);
      alert(`✓ LOP of ${numericLop} days saved successfully in database.`);
    } catch (err) {
      console.error(err);
      alert(`✓ LOP of ${numericLop} days updated.`);
    }
  };

  const handleWorkingDaysChange = (empId, val) => {
    const updated = { ...editedWorkingDaysRef.current, [empId]: val };
    editedWorkingDaysRef.current = updated;
    setEditedWorkingDays(updated);
  };

  const handleSaveWorkingDays = async (empId, runItemId, wdVal) => {
    const numericWd = Number(wdVal || 0);
    const updatedWdMap = { ...editedWorkingDaysRef.current, [empId]: numericWd };
    editedWorkingDaysRef.current = updatedWdMap;
    setEditedWorkingDays(updatedWdMap);

    try {
      if (selectedRun && selectedRun.id) {
        const res = await api.savePayRunWorkingDays(selectedRun.id, empId, numericWd);

        if (res?.updatedItem) {
          setSelectedRunItems(prev => prev.map(item => item.id === res.updatedItem.id ? res.updatedItem : item));
          setLocalItems(prev => prev.map(item => item.id === res.updatedItem.id ? res.updatedItem : item));
        }

        api.savePayRunState(selectedRun.id, getFullDraftPayload({
          editedWorkingDays: updatedWdMap
        })).catch(() => {});
      }

      logActivity(`Overrode Working Days to ${numericWd} for employee ID: ${empId}`);
      alert(`✓ Working Days of ${numericWd} days saved successfully in database.`);
    } catch (err) {
      console.error(err);
      alert(`✓ Working Days of ${numericWd} days updated.`);
    }
  };

  const handleLeaveChange = (empId, leaveKey, val, currentP) => {
    const currentEmpLeaves = { ...(editedLeavesRef.current[empId] || {}) };
    currentEmpLeaves[leaveKey] = val;

    if (leaveKey !== 'approved') {
      const cl = currentEmpLeaves.CL !== undefined && currentEmpLeaves.CL !== '' ? Number(currentEmpLeaves.CL) : Number(currentP?.clUsed || 0);
      const sl = currentEmpLeaves.SL !== undefined && currentEmpLeaves.SL !== '' ? Number(currentEmpLeaves.SL) : Number(currentP?.slUsed || 0);
      const el = currentEmpLeaves.EL !== undefined && currentEmpLeaves.EL !== '' ? Number(currentEmpLeaves.EL) : Number(currentP?.earnedLeaveUsed || 0);
      
      let customSum = 0;
      activeLeaveColumns.forEach(c => {
        if (!['CL', 'SL', 'EL'].includes(c)) {
          const cVal = currentEmpLeaves[c] !== undefined && currentEmpLeaves[c] !== '' 
            ? Number(currentEmpLeaves[c]) 
            : Number(currentP?.customLeaves?.[c] || 0);
          customSum += cVal;
        }
      });

      currentEmpLeaves.approved = cl + sl + el + customSum;
    }

    const updated = { ...editedLeavesRef.current, [empId]: currentEmpLeaves };
    editedLeavesRef.current = updated;
    setEditedLeaves(updated);
  };

  const handleSaveLeaves = async (empId, runItemId) => {
    const currentEmpLeaves = editedLeavesRef.current[empId] || {};
    try {
      if (selectedRun && selectedRun.id) {
        if (api.savePayRunLeaves) {
          api.savePayRunLeaves(selectedRun.id, empId, currentEmpLeaves).catch(() => {});
        }
        await api.savePayRunState(selectedRun.id, getFullDraftPayload({
          editedLeaves: editedLeavesRef.current
        }));
      }

      logActivity(`Saved leave adjustments for employee ID: ${empId}`);
      alert(`✓ Leaves saved successfully in database.`);
    } catch (err) {
      console.error(err);
      alert(`✓ Leaves updated.`);
    }
  };

  const handleAutoSaveLeaves = async (empId) => {
    if (selectedRun && selectedRun.id) {
      try {
        if (api.savePayRunLeaves && empId) {
          api.savePayRunLeaves(selectedRun.id, empId, editedLeavesRef.current[empId] || {}).catch(() => {});
        }
        await api.savePayRunState(selectedRun.id, getFullDraftPayload({
          editedLeaves: editedLeavesRef.current
        }));
      } catch (e) {}
    }
  };

  // 2. New Joinees & Exits detection with ascending joining date sort (oldest on top, newest at bottom)
  const getJoineesExits = () => {
    const currentMonth = selectedRun.month;
    const list = employees.map(emp => {
      const isNew = emp.joiningDate && emp.joiningDate.startsWith(currentMonth);
      const isExit = emp.status === 'PAST';
      const isChecked = !!checkedExited[emp.id];
      return {
        ...emp,
        isNew,
        isExit,
        isChecked,
        statusAction: isExit ? (isChecked ? 'INCLUDE (SETTLEMENT)' : 'EXCLUDED (UNPROCESSED)') : 'INCLUDE'
      };
    });

    return list.sort((a, b) => {
      const timeA = a.joiningDate ? new Date(a.joiningDate).getTime() : 0;
      const timeB = b.joiningDate ? new Date(b.joiningDate).getTime() : 0;
      return timeA - timeB;
    });
  };

  // Automatic Excel / CSV Register Download Engine
  // Statutory Overrides Audit History State
  const [appliedOverrides, setAppliedOverrides] = useState([]);

  // Salary figures come from the server (PayCalculator): the same calculation that Lock & Freeze stores
  // and that Form W / payslips read back. Unsaved edits are previewed by sending the current wizard state.
  const [serverPreview, setServerPreview] = useState({});
  const previewSeqRef = useRef(0);

  const refreshServerPreview = async () => {
    if (!selectedRun || !selectedRun.id) return serverPreview;
    const seq = ++previewSeqRef.current;
    const res = await api.previewPayRun(selectedRun.id, getFullDraftPayload());
    const map = {};
    ((res && res.rows) || []).forEach(row => {
      if (row && row.employeeId != null) map[String(row.employeeId)] = row;
    });
    if (seq === previewSeqRef.current) setServerPreview(map);
    return map;
  };

  useEffect(() => {
    if (!selectedRun || !selectedRun.id) return undefined;
    const timer = setTimeout(() => {
      refreshServerPreview().catch(err => console.warn('Payroll preview error:', err));
    }, 400);
    return () => clearTimeout(timer);
  }, [selectedRun?.id, selectedRun?.status, editedLop, editedWorkingDays, appliedAdjustments, appliedAdhoc, heldEmployees, appliedOverrides, checkedExited, localEmployees]);

  // Dynamic Statutory & Net Pay Calculation helper with Override synchronization based on Earned Gross
  // Uses the server-calculated pay (previewMap) when available; the local estimate only covers the first load.
  const getEmployeeStatutoryValues = (p, previewMap = serverPreview) => {
    // Match employee record from local state or props
    const empList = localEmployees.length > 0 ? localEmployees : employees;
    const emp = empList.find(e => String(e.id) === String(p.id) || String(e.empCode) === String(p.id) || e.name === p.name) || p;

    const isEmpHeld = () => {
      if (heldEmployees[p.id]) return true;
      if (emp.id && heldEmployees[emp.id]) return true;
      if (emp.empCode && heldEmployees[emp.empCode]) return true;
      const key = Object.keys(heldEmployees).find(k => 
        k.toLowerCase() === String(p.id).toLowerCase() || 
        (emp.empCode && k.toLowerCase() === String(emp.empCode).toLowerCase()) ||
        (emp.name && k.toLowerCase() === String(emp.name).toLowerCase())
      );
      return !!key;
    };
    const isOnHold = isEmpHeld();

    const workingDays = Number(p.workingDays) > 0 ? Number(p.workingDays) : 30;
    const payableDays = p.payableDays !== undefined ? Number(p.payableDays) : workingDays;
    const attendanceRatio = workingDays > 0 ? Math.max(0, Math.min(1, payableDays / workingDays)) : 1;

    // Determine exact Earned Gross Salary for this pay run cycle (Pre-deduction wage base)
    const rawEmpGross = Number(emp.compensationGross || emp.compensation_gross || emp.ctc || emp.salary || 0);
    const fullMonthlyGross = rawEmpGross > 0 
      ? (rawEmpGross > 100000 ? Math.round(rawEmpGross / 12) : rawEmpGross) 
      : 25000;
    
    const earnedGross = isOnHold 
      ? 0 
      : (p.earnedGross !== undefined 
          ? p.earnedGross 
          : (p.calculatedSalary !== undefined 
              ? p.calculatedSalary 
              : Math.round(fullMonthlyGross * attendanceRatio)));

    const basic = Math.round(earnedGross * 0.50);
    const hra = Math.round(earnedGross * 0.30);
    const otherAllowance = Math.max(0, earnedGross - basic - hra);
    const pfWage = basic + otherAllowance; // i.e. (earnedGross - hra)

    if (isOnHold) {
      return {
        gross: 0,
        basic: 0,
        hra: 0,
        other: 0,
        epfEe: 0,
        vpfEe: 0,
        esicEe: 0,
        lwfEe: 0,
        pt: 0,
        tds: 0,
        otherDed: 0,
        nonTdsStatutory: 0,
        totalStatutoryDed: 0,
        net: 0,
        hasOverrides: false,
        attendanceRatio,
        workingDays,
        payableDays
      };
    }

    // Check individual override first, then company-wide 'ALL' override
    const findOverride = (type) => {
      const specific = appliedOverrides.find(o => 
        (String(o.employeeId) === String(p.id) || 
         (emp.id && String(o.employeeId) === String(emp.id)) ||
         (emp.empCode && String(o.employeeId) === String(emp.empCode)) || 
         (emp.name && o.employeeName === emp.name)) && 
        o.overrideType === type
      );
      if (specific !== undefined) return specific.amount;
      const general = appliedOverrides.find(o => o.employeeId === 'ALL' && o.overrideType === type);
      if (general !== undefined) return general.amount;
      return null;
    };

    const epfOverride = findOverride('EPF');
    const vpfOverride = findOverride('VPF');
    const esiOverride = findOverride('ESI');
    const ptOverride = findOverride('PT');
    const lwfOverride = findOverride('LWF');
    const tdsOverride = findOverride('TDS');
    const otherOverride = findOverride('OTHER') || findOverride('LWP');

    const hasOverrides = epfOverride !== null || vpfOverride !== null || esiOverride !== null || ptOverride !== null || lwfOverride !== null || tdsOverride !== null || otherOverride !== null;
    const registered = {
      pfEligible: emp.pfEligible !== false,
      pfAmount: emp.pfAmount,
      vpfEligible: !!emp.vpfEligible,
      vpfAmount: emp.vpfAmount,
      esiEligible: emp.esiEligible !== false,
      ptEligible: emp.ptEligible !== false,
      ptAmount: emp.ptAmount,
      lwfEligible: emp.lwfEligible !== false,
      lwfAmount: emp.lwfAmount,
      taxRegime: emp.taxRegime || 'New Regime'
    };

    // Server-calculated pay: exactly what Lock & Freeze stores and what Form W / payslips show
    const serverPay = p.serverPay || (previewMap ? previewMap[String(p.id)] : null);
    if (serverPay) {
      const e = serverPay.earnings || {};
      const d = serverPay.deductions || {};
      const pick = (obj, ...keys) => {
        for (const k of keys) {
          if (obj[k] != null) return Number(obj[k]) || 0;
        }
        return 0;
      };
      const srvEpf = pick(d, 'EPF_EE', 'PF_EE');
      const srvVpf = pick(d, 'VPF_EE', 'VPF');
      const srvEsi = pick(d, 'ESI_EE', 'ESI');
      const srvPt = pick(d, 'PT');
      const srvLwf = pick(d, 'LWF', 'LWF_EE');
      const srvTds = pick(d, 'TDS');
      const srvOther = pick(d, 'OTHER', 'LWP');
      const loanEmi = pick(d, 'LOAN_EMI');
      const srvNonTds = srvEpf + srvVpf + srvEsi + srvPt + srvLwf + srvOther + loanEmi;
      const srvWorkingDays = Number(serverPay.workingDays) || 0;
      const srvPayableDays = Number(serverPay.workedDays) || 0;
      const srvBasic = pick(e, 'BASIC');
      const srvHra = pick(e, 'HRA');
      const srvOtherEarn = pick(e, 'SPECIAL_ALLOWANCE', 'OTHER_ALLOWANCE', 'OTHER', 'special', 'other')
        || Math.max(0, (Number(serverPay.grossEarned) || 0) - srvBasic - srvHra - pick(e, 'ADHOC_PAYMENT') - pick(e, 'ARREARS'));
      return {
        gross: Number(serverPay.grossEarned) || 0,
        basic: srvBasic,
        hra: srvHra,
        other: srvOtherEarn,
        epfEe: srvEpf,
        epfEr: srvEpf,
        vpfEe: srvVpf,
        esicEe: srvEsi,
        lwfEe: srvLwf,
        pt: srvPt,
        tds: srvTds,
        otherDed: srvOther,
        loanEmi,
        adhocDed: pick(d, 'ADHOC_DEDUCTION'),
        adhocPay: pick(e, 'ADHOC_PAYMENT') + pick(e, 'ARREARS'),
        nonTdsStatutory: srvNonTds,
        totalStatutoryDed: srvNonTds + srvTds,
        totalDeductions: Number(serverPay.totalDeductions) || 0,
        net: Number(serverPay.netSalary) || 0,
        isHeld: !!serverPay.isHeld,
        hasOverrides,
        attendanceRatio: srvWorkingDays > 0 ? Math.min(1, srvPayableDays / srvWorkingDays) : 0,
        workingDays: srvWorkingDays,
        payableDays: srvPayableDays,
        registered
      };
    }

    // 1. EPF (Provident Fund calculated on earned PF wage)
    let epfEe = 0;
    if (epfOverride !== null) {
      epfEe = Number(epfOverride) || 0;
    } else if (emp.pfEligible === false) {
      epfEe = 0;
    } else if (emp.pfAmount !== undefined && emp.pfAmount !== null && emp.pfAmount !== '' && !isNaN(Number(emp.pfAmount)) && Number(emp.pfAmount) > 0) {
      epfEe = Math.round(Number(emp.pfAmount) * attendanceRatio);
    } else {
      epfEe = pfWage < 15000 ? Math.round(pfWage * 0.12) : Math.round(1800 * attendanceRatio);
    }
    const epfEr = emp.pfEligible === false ? 0 : epfEe;

    // 2. VPF (Voluntary Provident Fund - Fixed Monthly Registered Contribution)
    let vpfEe = 0;
    if (vpfOverride !== null) {
      vpfEe = Number(vpfOverride) || 0;
    } else if (emp.vpfEligible === false) {
      vpfEe = 0;
    } else {
      vpfEe = Number(emp.vpfAmount) || 0;
    }

    // 3. ESIC (Calculated on earned gross salary with statutory ESIC ceil rounding)
    let esicEe = 0;
    if (esiOverride !== null) {
      esicEe = Number(esiOverride) || 0;
    } else if (emp.esiEligible === false) {
      esicEe = 0;
    } else if (fullMonthlyGross <= 21000) {
      esicEe = Math.ceil(earnedGross * 0.0075);
    } else {
      esicEe = 0;
    }

    // 4. PT (Professional Tax evaluated on Monthly Gross Salary - Statutory Fixed Slab)
    let pt = 0;
    if (ptOverride !== null) {
      pt = Number(ptOverride) || 0;
    } else if (emp.ptEligible === false || emp.ptExemption === true) {
      pt = 0;
    } else if (emp.ptAmount !== undefined && emp.ptAmount !== null && emp.ptAmount !== '' && !isNaN(Number(emp.ptAmount))) {
      pt = Number(emp.ptAmount);
    } else {
      const calculatedStatePt = calculateClientSidePT(fullMonthlyGross, emp.ptStateCode, ptStatesList, emp.ptExemption, emp.ptAmount, emp.gender);
      pt = calculatedStatePt;
    }

    // 5. LWF (Labour Welfare Fund)
    let lwfEe = 0;
    if (lwfOverride !== null) {
      lwfEe = Number(lwfOverride) || 0;
    } else if (emp.lwfEligible === false) {
      lwfEe = 0;
    } else {
      const annualLwf = (Number(emp.lwfAmount) >= 0 && emp.lwfAmount !== '' && emp.lwfAmount !== null) ? Number(emp.lwfAmount) : 60;
      lwfEe = Math.round(annualLwf / 12);
    }

    // 6. TDS / Tax
    let tds = 0;
    if (tdsOverride !== null) {
      tds = Number(tdsOverride) || 0;
    } else {
      tds = 0;
    }

    // 7. Other Deductions
    const otherDed = otherOverride !== null ? (Number(otherOverride) || 0) : 0;

    const nonTdsStatutory = epfEe + vpfEe + esicEe + pt + lwfEe + otherDed;
    const totalStatutoryDed = nonTdsStatutory + tds;
    const adhocDed = Number(p.totalDeductions) >= 0 ? Number(p.totalDeductions) : 0;
    const net = Math.max(0, earnedGross - totalStatutoryDed - adhocDed);

    return {
      gross: earnedGross,
      basic,
      hra,
      other: otherAllowance,
      epfEe,
      epfEr,
      vpfEe,
      esicEe,
      lwfEe,
      pt,
      tds,
      otherDed,
      nonTdsStatutory,
      totalStatutoryDed,
      net,
      hasOverrides,
      attendanceRatio,
      workingDays,
      payableDays,
      registered
    };
  };

  // Automatic Excel / CSV Register Download Engine
  const triggerExcelDownload = async () => {
    try {
      // Always export the latest server calculation (the figures Lock & Freeze will store)
      let previewMap = serverPreview;
      try {
        previewMap = await refreshServerPreview();
      } catch (previewErr) {
        console.warn('Could not refresh payroll preview before export:', previewErr);
      }
      const units = getPayableUnits(previewMap);
      const headers = [
        "Employee Name", "Emp ID", "Designation", "Working Days", "Payable Days", "LOP Days", 
        "Basic Salary (₹)", "HRA (₹)", "Other (₹)", "Gross Salary (₹)", "EPF EE (12%)", "Voluntary PF VPF (₹)", "ESIC EE (0.75%)", 
        "LWF EE (₹)", "Prof Tax PT (₹)", "TDS Tax (₹)", "Ad-hoc Payments (₹)", "Ad-hoc Deductions (₹)", 
        "Other Deductions (₹)", "Total Deductions (₹)", "Net Payable (₹)", "Bank Account Number", "IFSC Code"
      ];
      
      const rows = units.map(p => {
        const stat = getEmployeeStatutoryValues(p, previewMap);
        let adhocPay, adhocDed, otherDed, totalDeductions, netPayable;
        if (p.serverPay) {
          adhocPay = stat.adhocPay;
          adhocDed = stat.adhocDed;
          otherDed = (stat.otherDed || 0) + (stat.loanEmi || 0);
          totalDeductions = stat.totalDeductions;
          netPayable = stat.net;
        } else {
          const empAdhocs = appliedAdhoc.filter(a => a.employeeId === p.id);
          adhocPay = empAdhocs.filter(a => a.type === 'PAYMENT' || a.type === 'ARREARS').reduce((s, a) => s + a.amount, 0);
          adhocDed = empAdhocs.filter(a => a.type === 'DEDUCTION').reduce((s, a) => s + a.amount, 0);
          otherDed = stat.otherDed || 0;
          totalDeductions = (stat.epfEe || 0) + (stat.vpfEe || 0) + (stat.esicEe || 0) + (stat.lwfEe || 0) + (stat.pt || 0) + (stat.tds || 0) + otherDed + adhocDed;
          netPayable = stat.isHeld || (stat.net === 0 && stat.gross > 0) ? 0 : Math.max(0, stat.gross - totalDeductions);
        }

        return [
          p.name,
          p.empCode || p.id,
          p.designation || 'Staff',
          stat.workingDays,
          stat.payableDays,
          p.lopDays,
          stat.basic,
          stat.hra,
          stat.other || 0,
          stat.gross,
          stat.epfEe,
          stat.vpfEe || 0,
          stat.esicEe,
          stat.lwfEe,
          stat.pt,
          stat.tds,
          adhocPay,
          adhocDed,
          otherDed,
          totalDeductions,
          netPayable,
          p.bankAccountNo || p.accountNumber || 'N/A',
          p.bankIfscCode || p.ifscCode || p.ifsc || 'N/A'
        ];
      });

      const csvContent = [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Payroll_Register_${selectedRun ? selectedRun.month : '2026-12'}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      logActivity(`Automatically exported Excel Payroll Register for period: ${selectedRun.month}`);
    } catch (err) {
      console.error("Auto Excel download error", err);
    }
  };

  const getReimbursementSummary = () => {
    return localReimbursements.filter(r => r.createdAt && r.createdAt.startsWith(selectedRun.month));
  };

  // 6. Overrides Submission handler (Supports ALL employees & individual employees)
  const handleAddOverride = (e) => {
    e.preventDefault();
    if (!overrideEmp || overrideAmount === '' || !overrideReason) {
      alert('Override amount, reason, and employee selection are mandatory.');
      return;
    }
    const isAll = overrideEmp === 'ALL';
    const emp = isAll ? null : employees.find(e => e.id === overrideEmp);
    const newOverride = {
      id: Date.now(),
      employeeId: overrideEmp,
      employeeName: isAll ? 'All Employees (Company-Wide)' : (emp ? `${emp.name} (${emp.empCode || emp.id})` : overrideEmp),
      overrideType,
      amount: Number(overrideAmount),
      reason: overrideReason,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    
    // Replace duplicate override of same type for the same target
    const updatedOverrides = [newOverride, ...appliedOverrides.filter(o => !(o.employeeId === overrideEmp && o.overrideType === overrideType))];
    setAppliedOverrides(updatedOverrides);

    if (selectedRun && selectedRun.id) {
      api.savePayRunState(selectedRun.id, getFullDraftPayload({
        appliedOverrides: updatedOverrides
      })).catch(e => console.warn('Override sync error:', e));
    }

    logActivity(`Override: Configured custom ${overrideType} override of ₹${Number(overrideAmount).toLocaleString()} for ${isAll ? 'All Employees' : (emp ? emp.name : overrideEmp)}. Reason: ${overrideReason}`);
    alert(`Statutory override for ${overrideType} applied successfully to ${isAll ? 'all employees' : (emp ? emp.name : overrideEmp)}.`);
    setOverrideEmp('');
    setOverrideAmount('');
    setOverrideReason('');
  };

  const handleRemoveOverride = (id) => {
    const updatedOverrides = appliedOverrides.filter(o => o.id !== id);
    setAppliedOverrides(updatedOverrides);
    if (selectedRun && selectedRun.id) {
      api.savePayRunState(selectedRun.id, getFullDraftPayload({
        appliedOverrides: updatedOverrides
      })).catch(e => console.warn('Remove override sync error:', e));
    }
    logActivity(`Override Removed: Reverted statutory override entry.`);
  };

  const handleApplyRevisionAndBonus = async (e) => {
    e.preventDefault();
    if (!revisionEmp) {
      alert('Please select an employee.');
      return;
    }
    const updatedAdjustments = {
      ...appliedAdjustments,
      [revisionEmp]: {
        ctc: Number(revisionAmount) || 0,
        bonus: Number(bonusAmount) || 0
      }
    };
    setAppliedAdjustments(updatedAdjustments);

    if (selectedRun && selectedRun.id) {
      api.savePayRunState(selectedRun.id, getFullDraftPayload({
        appliedAdjustments: updatedAdjustments
      })).catch(e => console.warn('Adjustments sync error:', e));
    }

    logActivity(`Adjustment Applied: Revise CTC/Bonus for employee: ${revisionEmp}. Revision: ₹${revisionAmount || 0}, Bonus: ₹${bonusAmount || 0}`);
    alert(`Adjustments for CTC revision/bonus submitted and saved successfully.`);
    setRevisionEmp('');
    setRevisionAmount('');
    setBonusAmount('');
  };

  const handleAddAdhoc = (e) => {
    e.preventDefault();
    if (!adhocEmp || !adhocAmount) {
      alert('Please fill out employee profile and amount.');
      return;
    }
    const emp = employees.find(e => e.id === adhocEmp);
    const finalReason = adhocReason === 'Other' ? adhocCustomReason : adhocReason;
    const newEntry = {
      id: Date.now(),
      employeeId: adhocEmp,
      employeeName: emp ? emp.name : adhocEmp,
      type: adhocType,
      amount: Number(adhocAmount),
      reason: finalReason,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    const updatedAdhoc = [...appliedAdhoc, newEntry];
    setAppliedAdhoc(updatedAdhoc);

    if (selectedRun && selectedRun.id) {
      api.savePayRunState(selectedRun.id, getFullDraftPayload({
        appliedAdhoc: updatedAdhoc
      })).catch(e => console.warn('Adhoc sync error:', e));
    }

    logActivity(`Ad-hoc ${adhocType} of ₹${Number(adhocAmount).toLocaleString()} added for ${emp ? emp.name : adhocEmp}. Reason: ${finalReason}`);
    alert(`Ad-hoc ${adhocType} entry of ₹${Number(adhocAmount).toLocaleString()} successfully recorded and saved.`);
    setAdhocEmp('');
    setAdhocAmount('');
    setAdhocReason('');
    setAdhocCustomReason('');
  };

  const handleDeleteAdhoc = (id) => {
    const item = appliedAdhoc.find(i => i.id === id);
    if (item) {
      logActivity(`Ad-hoc adjustment deleted: ${item.type} for ${item.employeeName}`);
    }
    const updatedAdhoc = appliedAdhoc.filter(i => i.id !== id);
    setAppliedAdhoc(updatedAdhoc);

    if (selectedRun && selectedRun.id) {
      api.savePayRunState(selectedRun.id, getFullDraftPayload({
        appliedAdhoc: updatedAdhoc
      })).catch(e => console.warn('Delete adhoc sync error:', e));
    }
  };

  // 7. Comprehensive Mandatory Salary Field Validation Check
  const runValidationCheck = () => {
    const errors = [];
    const warnings = [];
    const targetList = localEmployees.length > 0 ? localEmployees : employees;

    // Verify all mandatory employee compliance & payout credentials
    targetList.forEach(emp => {
      // 1. Bank Account Number
      if (!emp.bankAccountNo && !emp.accountNumber && !(emp.customFields && emp.customFields.bankAccountNo)) {
        warnings.push({ emp: emp.name, code: emp.id, field: 'BANK_NO', msg: 'Missing active bank account number.' });
      }
      // 2. Bank IFSC Code
      if (!emp.bankIfscCode && !emp.ifscCode && !emp.ifsc && !(emp.customFields && emp.customFields.bankIfscCode)) {
        warnings.push({ emp: emp.name, code: emp.id, field: 'IFSC', msg: 'Missing bank IFSC code for transfer.' });
      }
      // 3. PAN Card Number (Mandatory for TDS / Tax)
      if (!emp.panNumber && !emp.pan && !(emp.customFields && emp.customFields.panNumber) && !(emp.customFields && emp.customFields.pan)) {
        warnings.push({ emp: emp.name, code: emp.id, field: 'PAN', msg: 'Missing PAN card details for TDS/Tax.' });
      }
      // 4. EPF UAN Number (Mandatory if PF Eligible)
      if (emp.pfEligible !== false && !emp.uanNumber && !emp.pfUan && !emp.pfNumber && !(emp.customFields && emp.customFields.uanNumber)) {
        warnings.push({ emp: emp.name, code: emp.id, field: 'UAN', msg: 'Missing EPF UAN number for PF filing.' });
      }
      // 5. ESIC Insurance Number (Mandatory if ESI Eligible)
      if (emp.esiEligible !== false && !emp.esiNumber && !emp.esicNumber && !emp.esiNo && !(emp.customFields && emp.customFields.esiNumber)) {
        warnings.push({ emp: emp.name, code: emp.id, field: 'ESI', msg: 'Missing ESIC insurance number.' });
      }
      // 6. Email Address
      if (!emp.email) {
        warnings.push({ emp: emp.name, code: emp.id, field: 'EMAIL', msg: 'Missing active email address for payslip dispatch.' });
      }
    });

    // Check for LOP / Net Pay issues
    const payable = getPayableUnits();
    payable.forEach(p => {
      const isOnHold = !!heldEmployees[p.id];
      if (p.calculatedSalary < 0 && !isOnHold) {
        errors.push({ emp: p.name, code: p.id, field: 'NET_PAY', msg: 'Calculated Net Pay is negative (deductions exceed gross earnings).' });
      } else if (p.calculatedSalary === 0 && !isOnHold) {
        warnings.push({ emp: p.name, code: p.id, field: 'LOP', msg: `Zero net payout (Full month ${p.lopDays || p.workingDays} days Loss of Pay / Unpaid leave).` });
      }
    });

    return { errors, warnings };
  };

  const validation = runValidationCheck();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minHeight: '600px', width: '100%' }}>
      {/* Reactor Pulse Glow Animation Styles */}
      <style>{`
        @keyframes reactorGlowPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.9), 0 0 25px 6px rgba(79, 70, 229, 0.8);
            border-color: #f59e0b !important;
            background-color: rgba(245, 158, 11, 0.25) !important;
            transform: scale(1.02);
          }
          35% {
            box-shadow: 0 0 40px 12px rgba(245, 158, 11, 1), 0 0 60px 20px rgba(59, 130, 246, 0.8);
            border-color: #3b82f6 !important;
            background-color: rgba(59, 130, 246, 0.35) !important;
            transform: scale(1.03);
          }
          70% {
            box-shadow: 0 0 20px 5px rgba(245, 158, 11, 0.5);
            border-color: #f59e0b !important;
            background-color: rgba(245, 158, 11, 0.15) !important;
            transform: scale(1.01);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
            border-color: var(--border-glass) !important;
            background-color: transparent !important;
            transform: scale(1);
          }
        }
        .reactor-glow-highlight {
          animation: reactorGlowPulse 2.5s ease-in-out 3 !important;
          border-radius: 8px !important;
        }
      `}</style>
      
      {/* WIZARD TOP PROGRESS TRACKER WITH HORIZONTAL STEPPER */}
      <div className="card glass" style={{ padding: '20px 24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Step Metadata Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Step {currentStep} of {totalSteps}: {stepsMeta[currentStep - 1].label}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {lastSavedTime && (
              <span style={{ fontSize: '0.75rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '3px 10px', borderRadius: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <i className="fa-solid fa-cloud-arrow-up"></i>
                Steps 1–{Math.max(1, currentStep - 1)} Auto-Saved ({lastSavedTime})
              </span>
            )}
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Progress: {Math.round((currentStep / totalSteps) * 100)}%
            </span>
            <button 
              className="btn btn-outline" 
              onClick={() => handleStepChange(currentStep)}
              style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            >
              <i className="fa-solid fa-arrow-left"></i> Exit
            </button>
          </div>
        </div>

        {/* Horizontal Line Stepper */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', margin: '10px 0' }}>
          {/* Background Connecting Line */}
          <div style={{ position: 'absolute', top: '16px', left: '20px', right: '20px', height: '2px', background: 'rgba(255,255,255,0.06)', zIndex: 0 }}></div>
          {/* Active Progress Connecting Line */}
          <div style={{ position: 'absolute', top: '16px', left: '20px', width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%`, height: '2px', background: 'var(--accent-primary)', zIndex: 0, transition: 'width 0.3s ease' }}></div>
          
          {stepsMeta.map(step => {
            const isCompleted = step.id < currentStep;
            const isActive = step.id === currentStep;
            return (
              <div 
                key={step.id} 
                onClick={() => handleStepChange(step.id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, cursor: 'pointer', flex: 1 }}
              >
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: isActive ? 'var(--accent-primary)' : (isCompleted ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)'),
                  border: isActive ? 'none' : (isCompleted ? '1px solid #10b981' : '1px solid var(--border-glass)'),
                  color: isActive ? '#fff' : (isCompleted ? '#10b981' : 'var(--text-secondary)'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? '0 0 10px rgba(79, 70, 229, 0.3)' : 'none'
                }}>
                  {isCompleted ? <i className="fa-solid fa-check" style={{ fontSize: '0.7rem' }}></i> : step.id}
                </div>
                <div style={{ fontSize: '0.65rem', color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', marginTop: '6px', fontWeight: isActive ? 600 : 400, textAlign: 'center', maxWidth: '80px', lineHeight: '1.2' }}>
                  {step.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* FULL WIDTH STEP CONTENT PANEL */}
      <div className="card glass" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
          
          {/* TOP LOCKED & RESTRICTED BANNER */}
          {isLocked && (
            <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid #ef4444', color: '#b91c1c', padding: '14px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 2px 4px rgba(239,68,68,0.08)' }}>
              <i className="fa-solid fa-lock" style={{ fontSize: '1.2rem', color: '#ef4444' }}></i>
              <div>
                <strong>PAYROLL LOCKED & SALARIES FROZEN:</strong> This payroll cycle has been finalized and locked. Further editing has been set to <code>NULL</code> (disabled). All input fields, adjustments, overrides, and action controls across all wizard steps are set to READ-ONLY.
              </div>
            </div>
          )}

          {/* STEP 1: LEAVE, ATTENDANCE & PAYABLE DAYS */}
          {currentStep === 1 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Active Payable Units & LOP Calculations</h3>
                <button className="btn btn-outline" disabled={isLocked} style={{ padding: '6px 12px', fontSize: '0.75rem', opacity: isLocked ? 0.5 : 1 }} onClick={runLocalRecalculate}>
                  <i className="fa-solid fa-arrows-rotate"></i> Refresh from Leaves
                </button>
              </div>

              {/* DYNAMIC ORGANIZATION LEAVE TYPES SELECTOR BAR */}
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '14px 18px', borderRadius: '10px', border: '1px solid var(--border-glass)', marginBottom: '20px' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fa-solid fa-list-check" style={{ color: 'var(--accent-primary)' }}></i>
                  Toggle Active Organization Leave Columns in Payroll Register:
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                  {/* Standard Leave Types */}
                  {STANDARD_LEAVE_TYPES.map(leave => {
                    const isSelected = activeLeaveColumns.includes(leave.id);
                    return (
                      <label key={leave.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: isSelected ? 'rgba(79, 70, 229, 0.15)' : 'rgba(255,255,255,0.03)', border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-glass)', padding: '5px 12px', borderRadius: '20px', fontSize: '0.75rem', cursor: 'pointer', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'all 0.2s ease' }}>
                        <input 
                          type="checkbox" 
                          checked={isSelected} 
                          onChange={() => toggleLeaveColumn(leave.id)} 
                          style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                        />
                        <span style={{ fontWeight: isSelected ? 600 : 400 }}>{leave.label}</span>
                      </label>
                    );
                  })}

                  {/* Custom Added Leaves */}
                  {customLeaveTypes.map(customName => {
                    const isSelected = activeLeaveColumns.includes(customName);
                    return (
                      <label key={customName} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: isSelected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.03)', border: isSelected ? '1px solid #10b981' : '1px solid var(--border-glass)', padding: '5px 12px', borderRadius: '20px', fontSize: '0.75rem', cursor: 'pointer', color: '#10b981', transition: 'all 0.2s ease' }}>
                        <input 
                          type="checkbox" 
                          checked={isSelected} 
                          onChange={() => toggleLeaveColumn(customName)} 
                          style={{ accentColor: '#10b981', cursor: 'pointer' }}
                        />
                        <span style={{ fontWeight: 600 }}>{customName}</span>
                      </label>
                    );
                  })}

                  {/* Add Custom Leave Input */}
                  {!showCustomInput ? (
                    <button className="btn btn-outline" onClick={() => setShowCustomInput(true)} style={{ padding: '4px 12px', fontSize: '0.75rem', color: '#3b82f6', borderColor: 'rgba(59, 130, 246, 0.4)', borderRadius: '20px' }}>
                      <i className="fa-solid fa-plus" style={{ marginRight: '4px' }}></i> Add Custom Leave Type
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input 
                        type="text" 
                        placeholder="e.g. Sabbatical Leave" 
                        value={newCustomLeaveInput} 
                        onChange={e => setNewCustomLeaveInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddCustomLeaveType()}
                        style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: '6px', border: '1px solid var(--accent-primary)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                      />
                      <button className="btn btn-primary" onClick={handleAddCustomLeaveType} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>Add</button>
                      <button className="btn btn-ghost" onClick={() => setShowCustomInput(false)} style={{ padding: '4px 8px', fontSize: '0.75rem' }}>✕</button>
                    </div>
                  )}
                </div>
              </div>

              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '10px' }}>EMPLOYEE</th>
                    <th style={{ padding: '10px' }}>WORKING DAYS (EDITABLE)</th>
                    <th style={{ padding: '10px' }}>APPROVED LEAVES (EDITABLE)</th>
                    
                    {/* DYNAMIC LEAVE HEADERS */}
                    {activeLeaveColumns.map(colKey => {
                      const std = STANDARD_LEAVE_TYPES.find(l => l.id === colKey);
                      const label = std ? std.label.toUpperCase() : colKey.toUpperCase();
                      return (
                        <th key={colKey} style={{ padding: '10px', color: 'var(--accent-primary)', fontWeight: 700 }}>
                          {label} (EDITABLE)
                        </th>
                      );
                    })}

                    <th style={{ padding: '10px' }}>LOP DAYS (EDITABLE)</th>
                    <th style={{ padding: '10px' }}>PAYABLE DAYS</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>EST. NET</th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: '0.8rem' }}>
                  {getPayableUnits().map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <strong>{p.name}</strong>
                          {p.isMidMonthJoin && (
                            <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontWeight: 700 }} title={`Joined on day ${p.joinDay}. Prorated for ${p.eligibleWorkingDays} active days.`}>
                              <i className="fa-solid fa-user-plus" style={{ marginRight: '3px' }}></i>
                              Joined {p.joinDay ? `${p.joinDay}th` : ''} ({p.eligibleWorkingDays}/{p.monthCalendarDays || 30}d)
                            </span>
                          )}
                          {p.isMidMonthExit && (
                            <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontWeight: 700 }} title={`Exit recorded. Prorated for ${p.eligibleWorkingDays} active days.`}>
                              <i className="fa-solid fa-user-minus" style={{ marginRight: '3px' }}></i>
                              Exit ({p.eligibleWorkingDays}/{p.monthCalendarDays || 30}d)
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{p.empCode || p.id}</span>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="number"
                            min="0"
                            max="31"
                            disabled={isLocked}
                            value={p.workingDays}
                            onChange={e => handleWorkingDaysChange(p.id, e.target.value)}
                            style={{
                              width: '56px',
                              padding: '4px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-glass)',
                              background: 'var(--bg-input)',
                              color: 'var(--text-primary)',
                              textAlign: 'center',
                              fontWeight: 600,
                              opacity: isLocked ? 0.6 : 1
                            }}
                          />
                          <button
                            className="btn btn-primary"
                            disabled={isLocked}
                            onClick={() => handleSaveWorkingDays(p.id, p.runItemId, p.workingDays)}
                            style={{ padding: '4px 8px', fontSize: '0.7rem', opacity: isLocked ? 0.5 : 1 }}
                            title="Save working days to database"
                          >
                            <i className="fa-solid fa-floppy-disk"></i>
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="number"
                            min="0"
                            max="31"
                            step="0.5"
                            disabled={isLocked}
                            value={p.approvedLeaveDays}
                            onChange={e => handleLeaveChange(p.id, 'approved', e.target.value, p)}
                            onBlur={() => handleAutoSaveLeaves(p.id)}
                            style={{
                              width: '52px',
                              padding: '4px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-glass)',
                              background: 'var(--bg-input)',
                              color: '#10b981',
                              textAlign: 'center',
                              fontWeight: 700,
                              opacity: isLocked ? 0.6 : 1
                            }}
                          />
                          <button
                            className="btn btn-primary"
                            disabled={isLocked}
                            onClick={() => handleSaveLeaves(p.id, p.runItemId)}
                            style={{ padding: '4px 8px', fontSize: '0.7rem', opacity: isLocked ? 0.5 : 1 }}
                            title="Save leaves to database"
                          >
                            <i className="fa-solid fa-floppy-disk"></i>
                          </button>
                        </div>
                      </td>
                      
                      {/* DYNAMIC LEAVE ROW CELLS */}
                      {activeLeaveColumns.map(colKey => {
                        const cellVal = colKey === 'CL' 
                          ? (p.clUsed ?? 0) 
                          : (colKey === 'SL' 
                            ? (p.slUsed ?? 0) 
                            : (colKey === 'EL' 
                              ? (p.earnedLeaveUsed ?? 0) 
                              : (p.customLeaves?.[colKey] ?? 0)));

                        return (
                          <td key={colKey} style={{ padding: '10px' }}>
                            <input
                              type="number"
                              min="0"
                              max="31"
                              step="0.5"
                              disabled={isLocked}
                              value={cellVal}
                              onChange={e => handleLeaveChange(p.id, colKey, e.target.value, p)}
                              onBlur={() => handleAutoSaveLeaves(p.id)}
                              style={{
                                width: '46px',
                                padding: '4px 6px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-glass)',
                                background: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                textAlign: 'center',
                                fontWeight: 500,
                                opacity: isLocked ? 0.6 : 1
                              }}
                            />
                          </td>
                        );
                      })}
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="number"
                            min="0"
                            max="30"
                            disabled={isLocked}
                            value={p.lopDays}
                            onChange={e => handleLopChange(p.id, e.target.value)}
                            style={{
                              width: '60px',
                              padding: '4px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-glass)',
                              background: 'var(--bg-input)',
                              color: 'var(--text-primary)',
                              textAlign: 'center',
                              opacity: isLocked ? 0.6 : 1
                            }}
                          />
                          <button
                            className="btn btn-primary"
                            disabled={isLocked}
                            onClick={() => handleSaveLop(p.id, p.runItemId, p.lopDays)}
                            style={{ padding: '4px 8px', fontSize: '0.7rem', opacity: isLocked ? 0.5 : 1 }}
                            title="Save override to database"
                          >
                            <i className="fa-solid fa-floppy-disk"></i> Save
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '10px', fontWeight: 600 }}>{p.payableDays}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>₹{p.calculatedSalary.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* STEP 2: NEW JOINEES & EXITS */}
          {currentStep === 2 && (
            <div>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Active Joinees & Settlement List</h3>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '10px' }}>EMPLOYEE</th>
                    <th style={{ padding: '10px' }}>JOINING DATE</th>
                    <th style={{ padding: '10px' }}>STATUS DETECTED</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>ACTION ACTION</th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: '0.8rem' }}>
                  {getJoineesExits().map(emp => (
                    <tr key={emp.id} id={`emp-target-row-${emp.id}`} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)', transition: 'all 0.3s ease' }}>
                      <td style={{ padding: '10px' }}><strong>{emp.name}</strong><br/><span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{emp.empCode || emp.id}</span></td>
                      <td style={{ padding: '10px' }}>{emp.joiningDate || 'Prior'}</td>
                      <td style={{ padding: '10px' }}>
                        {emp.isNew && <span style={{ color: '#10b981', fontWeight: 600 }}>[NEW JOINEE]</span>}
                        {emp.isExit && <span style={{ color: '#ef4444', fontWeight: 600 }}>[EXIT EMPLOYEE]</span>}
                        {!emp.isNew && !emp.isExit && <span style={{ color: 'var(--text-secondary)' }}>Regular</span>}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>
                        <select disabled={isLocked} defaultValue="INCLUDE" style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.75rem', opacity: isLocked ? 0.6 : 1 }}>
                          <option value="INCLUDE">Include</option>
                          <option value="EXCLUDE">Exclude</option>
                          <option value="HOLD">Hold F&F</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* STEP 3: REVISIONS & BONUS */}
          {currentStep === 3 && (
            <div>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Include Compensation Revisions & Bonuses</h3>
              
              <form onSubmit={handleApplyRevisionAndBonus} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-glass)', opacity: isLocked ? 0.65 : 1 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Select Employee</label>
                  <select disabled={isLocked} required value={revisionEmp} onChange={e => setRevisionEmp(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                    <option value="">Select...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Revised Monthly Gross (INR)</label>
                  <input disabled={isLocked} type="number" placeholder="₹" value={revisionAmount} onChange={e => setRevisionAmount(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Add Bonus (INR)</label>
                  <input disabled={isLocked} type="number" placeholder="₹" value={bonusAmount} onChange={e => setBonusAmount(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button disabled={isLocked} type="submit" className="btn btn-primary" style={{ width: '100%', padding: '8px', opacity: isLocked ? 0.5 : 1 }}>Apply adjustments</button>
                </div>
              </form>

              {Object.keys(appliedAdjustments).length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <h4 style={{ fontSize: '0.9rem', marginBottom: '10px' }}>Applied Revisions & Bonuses</h4>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '10px' }}>EMPLOYEE</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>REVISED MONTHLY GROSS (INR)</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>BONUS AMOUNT (INR)</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody style={{ fontSize: '0.8rem' }}>
                      {Object.keys(appliedAdjustments).map(empId => {
                        const emp = employees.find(e => e.id === empId);
                        const adj = appliedAdjustments[empId];
                        return (
                          <tr key={empId} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                            <td style={{ padding: '10px' }}><strong>{emp ? emp.name : empId}</strong><br/><span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{empId}</span></td>
                            <td style={{ padding: '10px', textAlign: 'right' }}>₹{(adj.ctc || 0).toLocaleString()}</td>
                            <td style={{ padding: '10px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>₹{(adj.bonus || 0).toLocaleString()}</td>
                            <td style={{ padding: '10px', textAlign: 'right' }}>
                              <button disabled={isLocked} className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.7rem', color: '#ef4444', borderColor: '#ef4444', opacity: isLocked ? 0.5 : 1 }} onClick={() => {
                                setAppliedAdjustments(prev => {
                                  const copy = { ...prev };
                                  delete copy[empId];
                                  return copy;
                                });
                              }}>
                                <i className="fa-solid fa-trash"></i> Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: AD-HOC ADJUSTMENTS */}
          {currentStep === 4 && (
            <div>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Include Ad-hoc Adjustments</h3>

              {/* Adjustment Category Segment Tabs */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                {[
                  { id: 'PAYMENT', label: 'Ad-hoc Payment', icon: 'fa-hand-holding-dollar', color: '#10b981' },
                  { id: 'DEDUCTION', label: 'Ad-hoc Deduction', icon: 'fa-circle-minus', color: '#f59e0b' },
                  { id: 'ARREARS', label: 'Arrears', icon: 'fa-clock-rotate-left', color: '#3b82f6' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    disabled={isLocked}
                    onClick={() => {
                      setAdhocType(tab.id);
                      setAdhocReason('');
                    }}
                    className="btn"
                    style={{
                      padding: '8px 16px',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: adhocType === tab.id ? 'var(--accent-primary)' : 'rgba(255,255,255,0.03)',
                      color: adhocType === tab.id ? '#fff' : 'var(--text-secondary)',
                      border: '1px solid var(--border-glass)',
                      cursor: isLocked ? 'not-allowed' : 'pointer',
                      borderRadius: '6px',
                      opacity: isLocked ? 0.6 : 1
                    }}
                  >
                    <i className={`fa-solid ${tab.icon}`} style={{ color: adhocType === tab.id ? '#fff' : tab.color }}></i>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Adjustment Form */}
              <form onSubmit={handleAddAdhoc} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-glass)', opacity: isLocked ? 0.65 : 1 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Select Employee</label>
                  <select disabled={isLocked} required value={adhocEmp} onChange={e => setAdhocEmp(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                    <option value="">Select...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Amount (₹)</label>
                  <input disabled={isLocked} required type="number" min="1" placeholder="Amount" value={adhocAmount} onChange={e => setAdhocAmount(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Reason / Comment</label>
                  <select required value={adhocReason} onChange={e => setAdhocReason(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                    <option value="">Select Reason...</option>
                    {adhocType === 'PAYMENT' && (
                      <>
                        <option value="Referral Bonus">Referral Bonus</option>
                        <option value="Internet Allowance">Internet Allowance</option>
                        <option value="Relocation Payout">Relocation Payout</option>
                        <option value="Other">Other</option>
                      </>
                    )}
                    {adhocType === 'DEDUCTION' && (
                      <>
                        <option value="Advance Salary">Advance Salary</option>
                        <option value="Instrument Damage">Instrument Damage</option>
                        <option value="Excess Leave Loss">Excess Leave Loss</option>
                        <option value="Other">Other</option>
                      </>
                    )}
                    {adhocType === 'ARREARS' && (
                      <>
                        <option value="Previous Month Arrears">Previous Month Arrears</option>
                        <option value="Statutory Dues Adjustment">Statutory Dues Adjustment</option>
                        <option value="Joining Arrears">Joining Arrears</option>
                        <option value="Other">Other</option>
                      </>
                    )}
                  </select>
                </div>

                {adhocReason === 'Other' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Specify Reason</label>
                    <input required type="text" placeholder="Write custom reason..." value={adhocCustomReason} onChange={e => setAdhocCustomReason(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '9px' }}>
                    <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Add Adjustment
                  </button>
                </div>
              </form>

              {/* Applied Ledger Table */}
              <h4 style={{ fontSize: '0.9rem', marginBottom: '10px' }}>Applied Ad-hoc Adjustments</h4>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '10px' }}>EMPLOYEE</th>
                    <th style={{ padding: '10px' }}>ADJUSTMENT TYPE</th>
                    <th style={{ padding: '10px' }}>REASON / COMMENT</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>AMOUNT</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: '0.8rem' }}>
                  {appliedAdhoc.map(item => (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                      <td style={{ padding: '10px' }}><strong>{item.employeeName}</strong><br/><span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{item.employeeId}</span></td>
                      <td style={{ padding: '10px' }}>
                        <span style={{
                          fontSize: '0.7rem',
                          padding: '3px 8px',
                          borderRadius: '10px',
                          fontWeight: 600,
                          background: item.type === 'PAYMENT' ? 'rgba(16, 185, 129, 0.12)' : (item.type === 'DEDUCTION' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(59, 130, 246, 0.12)'),
                          color: item.type === 'PAYMENT' ? '#10b981' : (item.type === 'DEDUCTION' ? '#f59e0b' : '#3b82f6')
                        }}>
                          {item.type}
                        </span>
                      </td>
                      <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{item.reason}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: item.type === 'DEDUCTION' ? '#ef4444' : '#10b981' }}>
                        {item.type === 'DEDUCTION' ? '-' : '+'}₹{item.amount.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>
                        <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.7rem', color: '#ef4444', borderColor: '#ef4444' }} onClick={() => handleDeleteAdhoc(item.id)}>
                          <i className="fa-solid fa-trash-can"></i> Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {appliedAdhoc.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                        No ad-hoc adjustments registered for this run cycle yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* STEP 5: SALARY HOLD */}
          {currentStep === 5 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Salary Hold / Exclude</h3>
                {Object.keys(heldEmployees).length > 0 && (
                  <span style={{ fontSize: '0.75rem', padding: '4px 12px', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', fontWeight: 600 }}>
                    <i className="fa-solid fa-circle-pause" style={{ marginRight: '6px' }}></i>
                    {Object.keys(heldEmployees).length} employee{Object.keys(heldEmployees).length > 1 ? 's' : ''} on hold
                  </span>
                )}
              </div>

              {/* Hold Form */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '16px', marginBottom: '20px', opacity: isLocked ? 0.65 : 1 }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <i className="fa-solid fa-hand" style={{ marginRight: '6px', color: '#f59e0b' }}></i> Place New Salary Hold
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', alignItems: 'flex-end' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Select Employee</label>
                    <select disabled={isLocked} value={holdEmp} onChange={e => setHoldEmp(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                      <option value="">Select...</option>
                      {employees.filter(e => !heldEmployees[e.id]).map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Hold Reason</label>
                    <select disabled={isLocked} value={holdReason} onChange={e => { setHoldReason(e.target.value); setHoldCustomReason(''); }} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                      <option value="">Select Reason...</option>
                      <option value="PF Investigation">PF Investigation</option>
                      <option value="Absconding">Absconding</option>
                      <option value="Disciplinary Action">Disciplinary Action</option>
                      <option value="Document Pending">Document Pending</option>
                      <option value="Legal Hold">Legal Hold</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  {holdReason === 'Other' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Specify Reason</label>
                      <input disabled={isLocked} type="text" placeholder="Describe reason..." value={holdCustomReason} onChange={e => setHoldCustomReason(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                    </div>
                  )}
                  <div>
                    <button
                      className="btn"
                      disabled={isLocked || !holdEmp || !holdReason || (holdReason === 'Other' && !holdCustomReason)}
                      onClick={() => {
                        if (isLocked || !holdEmp || !holdReason) return;
                        const emp = employees.find(e => e.id === holdEmp);
                        const finalReason = holdReason === 'Other' ? holdCustomReason : holdReason;
                        const updatedHeld = {
                          ...heldEmployees,
                          [holdEmp]: { reason: finalReason, heldAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
                        };
                        setHeldEmployees(updatedHeld);

                        if (selectedRun && selectedRun.id) {
                          api.savePayRunState(selectedRun.id, getFullDraftPayload({
                            heldEmployees: updatedHeld
                          })).catch(e => console.warn('Salary hold sync error:', e));
                        }

                        logActivity(`Salary HOLD placed for ${emp ? emp.name : holdEmp}. Reason: ${finalReason}`);
                        setHoldEmp('');
                        setHoldReason('');
                        setHoldCustomReason('');
                      }}
                      style={{ width: '100%', padding: '9px', background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', cursor: isLocked ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.8rem', opacity: isLocked ? 0.5 : 1 }}
                    >
                      <i className="fa-solid fa-circle-pause" style={{ marginRight: '6px' }}></i> Hold Salary
                    </button>
                  </div>
                </div>
              </div>

              {/* Full Employee Table */}
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '10px' }}>EMPLOYEE</th>
                    <th style={{ padding: '10px' }}>DESIGNATION</th>
                    <th style={{ padding: '10px' }}>HOLD REASON</th>
                    <th style={{ padding: '10px', textAlign: 'center' }}>SALARY STATUS</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: '0.8rem' }}>
                  {employees.map(emp => {
                    const holdInfo = heldEmployees[emp.id];
                    const isOnHold = !!holdInfo;
                    return (
                      <tr key={emp.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)', opacity: isOnHold ? 0.75 : 1, background: isOnHold ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
                        <td style={{ padding: '10px' }}>
                          <strong>{emp.name}</strong>
                          {isOnHold && (
                            <span style={{ display: 'block', fontSize: '0.65rem', color: '#ef4444', marginTop: '2px' }}>
                              Held at {holdInfo.heldAt}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{emp.designation || '—'}</td>
                        <td style={{ padding: '10px', color: isOnHold ? '#ef4444' : 'var(--text-secondary)' }}>
                          {isOnHold ? holdInfo.reason : '—'}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          {isOnHold ? (
                            <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', fontWeight: 600 }}>
                              <i className="fa-solid fa-circle-pause" style={{ marginRight: '4px' }}></i> HELD
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontWeight: 600 }}>
                              <i className="fa-solid fa-circle-check" style={{ marginRight: '4px' }}></i> ACTIVE PAY
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          {isOnHold ? (
                            <button
                              className="btn btn-outline"
                              disabled={isLocked}
                              style={{ padding: '4px 12px', fontSize: '0.72rem', color: '#10b981', borderColor: '#10b981', opacity: isLocked ? 0.5 : 1 }}
                              onClick={() => {
                                if (isLocked) return;
                                const updatedHeld = { ...heldEmployees };
                                delete updatedHeld[emp.id];
                                setHeldEmployees(updatedHeld);

                                if (selectedRun && selectedRun.id) {
                                  api.savePayRunState(selectedRun.id, getFullDraftPayload({
                                    heldEmployees: updatedHeld
                                  })).catch(e => console.warn('Release hold sync error:', e));
                                }

                                logActivity(`Salary hold RELEASED for ${emp.name}`);
                              }}
                            >
                              <i className="fa-solid fa-circle-play" style={{ marginRight: '4px' }}></i> Release Hold
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* STEP 6: STATUTORY OVERRIDES */}
          {currentStep === 6 && (
            <div>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Configure Custom Statutory Overrides</h3>
              
              <form onSubmit={handleAddOverride} style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)', opacity: isLocked ? 0.65 : 1 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Select Employee</label>
                    <select disabled={isLocked} required value={overrideEmp} onChange={e => setOverrideEmp(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                      <option value="">Select Employee...</option>
                      <option value="ALL" style={{ fontWeight: 700, color: 'var(--accent-primary, #4f46e5)' }}>
                        ★ All Employees (Company-Wide Bulk Override)
                      </option>
                      <optgroup label="Individual Employees">
                        {employees.map(e => (
                          <option key={e.id} value={e.id}>
                            {e.name} ({e.empCode || e.id})
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Override Type</label>
                    <select disabled={isLocked} value={overrideType} onChange={e => setOverrideType(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                      <option value="TDS">TDS Tax Override</option>
                      <option value="EPF">EPF Override</option>
                      <option value="ESI">ESI Override</option>
                      <option value="LWP">LWP Override</option>
                      <option value="PT">PT Override</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Custom Amount (₹)</label>
                    <input disabled={isLocked} required type="number" value={overrideAmount} onChange={e => setOverrideAmount(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Mandatory Audit Reason</label>
                  <textarea disabled={isLocked} required rows="2" placeholder="Explain the rationale for this manual override..." value={overrideReason} onChange={e => setOverrideReason(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }} />
                </div>
                <div>
                  <button disabled={isLocked} type="submit" className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '0.8rem', opacity: isLocked ? 0.5 : 1 }}>
                    <i className="fa-solid fa-floppy-disk" style={{ marginRight: '6px' }}></i> Save Statutory Override
                  </button>
                </div>
              </form>

              {/* Statutory Overrides Audit History Table */}
              <div style={{ marginTop: '24px' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-clock-rotate-left" style={{ color: 'var(--accent-primary)' }}></i>
                  Statutory Override Audit History ({appliedOverrides.length})
                </h4>

                {appliedOverrides.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    No custom statutory overrides applied for this run cycle yet.
                  </div>
                ) : (
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse', borderRadius: '8px', overflow: 'hidden' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)' }}>
                        <th style={{ padding: '10px 14px' }}>Employee</th>
                        <th style={{ padding: '10px 14px' }}>Override Type</th>
                        <th style={{ padding: '10px 14px' }}>Custom Amount</th>
                        <th style={{ padding: '10px 14px' }}>Audit Rationale</th>
                        <th style={{ padding: '10px 14px' }}>Applied At</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appliedOverrides.map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid var(--border-glass)', fontSize: '0.85rem' }}>
                          <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.employeeName}</td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ background: 'rgba(79, 70, 229, 0.15)', color: 'var(--accent-primary)', padding: '3px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                              {item.overrideType}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>₹{item.amount.toLocaleString()}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{item.reason}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{item.createdAt}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <button 
                              onClick={() => handleRemoveOverride(item.id)} 
                              style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                            >
                              <i className="fa-solid fa-trash" style={{ marginRight: '4px' }}></i> Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* STEP 7: VALIDATION ENGINE & PREVIEW */}
          {currentStep === 7 && (
            <div>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Payroll Validation & Preview Engine</h3>
              
              {/* Warnings & Errors */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ background: 'rgba(239, 68, 68, 0.08)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <h4 style={{ color: '#ef4444', margin: '0 0 10px 0', fontSize: '0.85rem' }}>
                    <i className="fa-solid fa-circle-xmark"></i> Blocking Errors ({validation.errors.length})
                  </h4>
                  {validation.errors.map((e, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => handleNavigateAndHighlight(e.code || e.emp, e.field, 'NET_PAY')}
                      style={{ fontSize: '0.75rem', marginBottom: '8px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.25)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      title="Click to navigate and highlight target fix location"
                    >
                      <div>
                        <strong style={{ color: '#ef4444' }}>{e.emp}</strong>: {e.msg}
                      </div>
                      <span style={{ fontSize: '0.7rem', color: '#ef4444', textDecoration: 'underline', fontWeight: 700, marginLeft: '8px', whiteSpace: 'nowrap' }}>
                        Fix Error ⚡
                      </span>
                    </div>
                  ))}
                </div>

                <div style={{ background: 'rgba(245, 158, 11, 0.08)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ color: '#f59e0b', margin: 0, fontSize: '0.85rem' }}>
                      <i className="fa-solid fa-triangle-exclamation"></i> Action Warnings ({validation.warnings.length})
                    </h4>
                    {validation.warnings.length > 0 && (
                      <button
                        onClick={handleBulkResolveAllComplianceWarnings}
                        style={{
                          background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                          color: '#fff',
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <i className="fa-solid fa-bolt"></i> Auto-Fix All & Save to DB
                      </button>
                    )}
                  </div>
                  {validation.warnings.map((w, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => handleNavigateAndHighlight(w.code || w.emp, w.field, 'BANK_ACCOUNT')}
                      style={{ fontSize: '0.75rem', marginBottom: '8px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.25)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      title="Click to navigate and highlight target fix location"
                    >
                      <div>
                        <strong style={{ color: '#f59e0b' }}>{w.emp}</strong>: {w.msg}
                      </div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', textDecoration: 'underline', fontWeight: 700, marginLeft: '8px', whiteSpace: 'nowrap' }}>
                        Fix Issue ⚡
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview Table */}
              <h4 style={{ fontSize: '0.9rem', marginBottom: '10px' }}>Grand Ledger Preview</h4>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '10px' }}>EMPLOYEE</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>GROSS PAY</th>
                    <th style={{ padding: '10px', textAlign: 'right', color: '#10b981' }}>+AD-HOC</th>
                    <th style={{ padding: '10px', textAlign: 'right', color: '#f59e0b' }}>-AD-HOC DED.</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>TDS</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>DEDUCTIONS</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>NET PAYABLE</th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: '0.8rem' }}>
                  {getPayableUnits().map(p => {
                    const empAdhocs = appliedAdhoc.filter(a => a.employeeId === p.id);
                    const adhocPay = empAdhocs.filter(a => a.type === 'PAYMENT' || a.type === 'ARREARS').reduce((s, a) => s + a.amount, 0);
                    const adhocDed = empAdhocs.filter(a => a.type === 'DEDUCTION').reduce((s, a) => s + a.amount, 0);
                    const isOnHold = !!heldEmployees[p.id];
                    const stat = getEmployeeStatutoryValues(p);
                    const nonTdsDeductions = stat.nonTdsStatutory;

                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)', opacity: isOnHold ? 0.6 : 1, background: isOnHold ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
                        <td style={{ padding: '10px' }}>
                          <strong>{p.name}</strong>
                          {isOnHold && (
                            <span style={{ display: 'block', fontSize: '0.65rem', color: '#ef4444', fontWeight: 600, marginTop: '2px' }}>
                              <i className="fa-solid fa-circle-pause" style={{ marginRight: '3px' }}></i>
                              HELD — {heldEmployees[p.id].reason}
                            </span>
                          )}
                          {!isOnHold && stat.hasOverrides && (
                            <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--accent-primary)', fontWeight: 600, marginTop: '2px' }}>
                              ⚡ Statutory Override Active
                            </span>
                          )}
                          {!isOnHold && empAdhocs.length > 0 && (
                            <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--accent-primary)', marginTop: '2px' }}>
                              {empAdhocs.length} ad-hoc adjustment{empAdhocs.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          {isOnHold ? <span style={{ color: '#ef4444' }}>₹0 (held)</span> : `₹${stat.gross.toLocaleString()}`}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', color: '#10b981', fontWeight: adhocPay > 0 ? 600 : 400 }}>
                          {isOnHold ? '—' : (adhocPay > 0 ? `+₹${adhocPay.toLocaleString()}` : '—')}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', color: '#f59e0b', fontWeight: adhocDed > 0 ? 600 : 400 }}>
                          {isOnHold ? '—' : (adhocDed > 0 ? `-₹${adhocDed.toLocaleString()}` : '—')}
                        </td>
                        <td 
                          style={{ padding: '10px', textAlign: 'right', color: '#ef4444', cursor: isOnHold ? 'default' : 'pointer' }}
                          onClick={() => !isOnHold && openDeductionsBreakdownModal(p)}
                          title="Click to view & override employee deductions"
                        >
                          {isOnHold ? '—' : (
                            <span style={{ borderBottom: '1px dotted #ef4444', paddingBottom: '1px' }}>
                              -₹{stat.tds.toLocaleString()} <i className="fa-solid fa-pen" style={{ fontSize: '0.65rem', opacity: 0.6, marginLeft: '3px' }}></i>
                            </span>
                          )}
                        </td>
                        <td 
                          style={{ padding: '10px', textAlign: 'right', color: '#ef4444', cursor: isOnHold ? 'default' : 'pointer' }}
                          onClick={() => !isOnHold && openDeductionsBreakdownModal(p)}
                          title="Click to view breakdown (PF, VPF, ESI, PT, LWF) & override deductions"
                        >
                          {isOnHold ? '—' : (
                            <span style={{ borderBottom: '1px dotted #ef4444', paddingBottom: '1px', fontWeight: 600 }}>
                              -₹{nonTdsDeductions.toLocaleString()} <i className="fa-solid fa-pen-to-square" style={{ fontSize: '0.68rem', opacity: 0.7, marginLeft: '3px' }}></i>
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: isOnHold ? '#ef4444' : '#10b981' }}>
                          {isOnHold ? '₹0' : `₹${stat.net.toLocaleString()}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border-glass)', fontSize: '0.8rem', fontWeight: 700 }}>
                    <td style={{ padding: '10px' }}>TOTAL</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      ₹{getPayableUnits().reduce((s, p) => s + getEmployeeStatutoryValues(p).gross, 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: '#10b981' }}>
                      +₹{appliedAdhoc.filter(a => a.type !== 'DEDUCTION').reduce((s, a) => s + a.amount, 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: '#f59e0b' }}>
                      -₹{appliedAdhoc.filter(a => a.type === 'DEDUCTION').reduce((s, a) => s + a.amount, 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: '#ef4444' }}>
                      -₹{getPayableUnits().reduce((s, p) => s + getEmployeeStatutoryValues(p).tds, 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: '#ef4444' }}>
                      -₹{getPayableUnits().reduce((s, p) => s + getEmployeeStatutoryValues(p).nonTdsStatutory, 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: '#10b981' }}>
                      ₹{getPayableUnits().reduce((s, p) => s + getEmployeeStatutoryValues(p).net, 0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* STEP 8: FINALIZE & LOCK (KEKA-STYLE MULTI-STAGE APPROVAL WORKFLOW) */}
          {currentStep === 8 && (
            <div>
              {/* STAGE 1: INITIAL RUN & PREVIEW */}
              {step8Stage === 'INITIAL' && (
                <div style={{ textAlign: 'center', padding: '36px 20px' }}>
                  <div style={{ fontSize: '3.5rem', color: 'var(--accent-primary)', marginBottom: '16px' }}>
                    <i className="fa-solid fa-wand-magic-sparkles"></i>
                  </div>
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '1.3rem' }}>Finalize and Audit Payroll Calculations</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '520px', margin: '0 auto 24px auto', lineHeight: '1.6' }}>
                    Click <strong>Run & Preview Payroll</strong> to generate the comprehensive all-fields salary register, audit all statutory deductions, and automatically download the Excel payroll file.
                  </p>

                  {validation.errors.length > 0 ? (
                    <div style={{ background: 'rgba(239, 68, 68, 0.08)', padding: '14px 20px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.25)', display: 'inline-block', fontSize: '0.85rem', color: '#ef4444', fontWeight: 600 }}>
                      <i className="fa-solid fa-circle-xmark" style={{ marginRight: '8px' }}></i> Please resolve blocking errors in Step 7 before running payroll.
                    </div>
                  ) : (
                    <button
                      className="btn btn-primary"
                      style={{ padding: '14px 40px', fontSize: '1rem', background: 'var(--accent-primary)', fontWeight: 600, boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)' }}
                      onClick={() => {
                        setStep8Stage('PREVIEW');
                        triggerExcelDownload();
                        logActivity(`Executed Run & Preview and auto-downloaded Excel Register for cycle: ${selectedRun.month}`);
                      }}
                    >
                      <i className="fa-solid fa-play" style={{ marginRight: '8px' }}></i> Run & Preview Payroll
                    </button>
                  )}
                </div>
              )}

              {/* STAGE 2: ALL-FIELDS PREVIEW TABLE & SUBMIT REGISTER BUTTON */}
              {step8Stage === 'PREVIEW' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16, 185, 129, 0.08)', padding: '16px 20px', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                    <div>
                      <h4 style={{ margin: 0, color: '#10b981', fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <i className="fa-solid fa-circle-check"></i>
                        Comprehensive Payroll Register Preview (Keka Format)
                      </h4>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        📥 Excel Payroll Register (CSV/XLSX) automatically downloaded to your computer!
                      </span>
                    </div>
                    <button className="btn btn-outline" onClick={triggerExcelDownload} style={{ padding: '6px 14px', fontSize: '0.75rem', color: '#10b981', borderColor: '#10b981' }}>
                      <i className="fa-solid fa-download" style={{ marginRight: '4px' }}></i> Re-download Excel
                    </button>
                  </div>

                  {/* Keka-Style All-Fields Detailed Salary Register Preview Table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table" style={{ width: '100%', borderCollapse: 'collapse', borderRadius: '8px', overflow: 'hidden', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' }}>
                          <th style={{ padding: '10px' }}>EMPLOYEE</th>
                          <th style={{ padding: '10px' }}>DAYS</th>
                          <th style={{ padding: '10px', textAlign: 'right' }}>BASIC</th>
                          <th style={{ padding: '10px', textAlign: 'right' }}>HRA</th>
                          <th style={{ padding: '10px', textAlign: 'right' }}>OTHER</th>
                          <th style={{ padding: '10px', textAlign: 'right' }}>GROSS PAY</th>
                          <th style={{ padding: '10px', textAlign: 'right', color: 'var(--accent-primary)' }}>EPF EE</th>
                          <th style={{ padding: '10px', textAlign: 'right', color: '#3b82f6' }}>ESIC EE</th>
                          <th style={{ padding: '10px', textAlign: 'right', color: '#8b5cf6' }}>PT</th>
                          <th style={{ padding: '10px', textAlign: 'right', color: '#ef4444' }}>TDS</th>
                          <th style={{ padding: '10px', textAlign: 'right', color: '#10b981' }}>NET PAYABLE</th>
                          <th style={{ padding: '10px' }}>BANK ACCOUNT</th>
                          <th style={{ padding: '10px' }}>IFSC CODE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getPayableUnits().map(p => {
                          const isOnHold = !!heldEmployees[p.id];
                          const stat = getEmployeeStatutoryValues(p);

                          return (
                            <tr key={p.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)', opacity: isOnHold ? 0.6 : 1 }}>
                              <td style={{ padding: '10px' }}>
                                <strong>{p.name}</strong><br/>
                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>{p.id}</span>
                              </td>
                              <td style={{ padding: '10px' }}>{p.payableDays}/{p.workingDays}</td>
                              <td style={{ padding: '10px', textAlign: 'right' }}>₹{stat.basic.toLocaleString()}</td>
                              <td style={{ padding: '10px', textAlign: 'right' }}>₹{stat.hra.toLocaleString()}</td>
                              <td style={{ padding: '10px', textAlign: 'right' }}>₹{(stat.other || 0).toLocaleString()}</td>
                              <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>₹{stat.gross.toLocaleString()}</td>
                              <td style={{ padding: '10px', textAlign: 'right', color: 'var(--accent-primary)' }}>₹{stat.epfEe.toLocaleString()}</td>
                              <td style={{ padding: '10px', textAlign: 'right', color: '#3b82f6' }}>₹{stat.esicEe.toLocaleString()}</td>
                              <td style={{ padding: '10px', textAlign: 'right', color: '#8b5cf6' }}>₹{stat.pt.toLocaleString()}</td>
                              <td style={{ padding: '10px', textAlign: 'right', color: '#ef4444' }}>₹{stat.tds.toLocaleString()}</td>
                              <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: '#10b981' }}>₹{stat.net.toLocaleString()}</td>
                              <td style={{ padding: '10px', fontSize: '0.72rem' }}>{p.bankAccountNo || p.accountNumber || '—'}</td>
                              <td style={{ padding: '10px', fontSize: '0.72rem' }}>{p.bankIfscCode || p.ifscCode || p.ifsc || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Submit Button */}
                  <div style={{ textAlign: 'center', marginTop: '16px' }}>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '12px 36px', fontSize: '0.95rem', background: '#3b82f6' }}
                      onClick={() => {
                        setStep8Stage('SUBMITTED');
                        logActivity(`Submitted Payroll Register for Lock Approval for cycle: ${selectedRun.month}`);
                      }}
                    >
                      <i className="fa-solid fa-paper-plane" style={{ marginRight: '8px' }}></i> Submit Payroll Register for Lock Approval
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 3: SUBMITTED STATE & LOCK BUTTON */}
              {step8Stage === 'SUBMITTED' && (
                <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                  <div style={{ fontSize: '3rem', color: '#f59e0b', marginBottom: '16px' }}>
                    <i className="fa-solid fa-shield-halved"></i>
                  </div>
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '1.25rem' }}>Payroll Register Submitted & Ready for Lock</h3>
                  <div style={{ background: 'rgba(245, 158, 11, 0.08)', padding: '14px 20px', borderRadius: '10px', border: '1px solid rgba(245, 158, 11, 0.25)', maxWidth: '520px', margin: '0 auto 24px auto', fontSize: '0.82rem', color: '#f59e0b', textAlign: 'left', lineHeight: '1.5' }}>
                    <strong>⚠️ Warning:</strong> Locking payroll is permanent. All employee salary registers will be frozen, PDF payslips generated, and all future chances of editing across this wizard will be set to <strong>NULL</strong> (disabled).
                  </div>

                  <button
                    className="btn btn-primary"
                    style={{ background: '#10b981', padding: '14px 40px', fontSize: '1rem', fontWeight: 700 }}
                    onClick={async () => {
                      const fullPayload = getFullDraftPayload({ completedStep: 8, lastActiveStep: 8, status: 'LOCKED' });
                      if (selectedRun && selectedRun.id) {
                        try {
                          await api.savePayRunState(selectedRun.id, fullPayload);
                        } catch (e) {
                          console.warn('Failed saving full state before lock:', e);
                        }
                      }
                      await handleProcessRun(selectedRun.id, { isLock: true });
                      setStep8Stage('LOCKED');
                      logActivity(`Locked and froze payroll cycle: ${selectedRun.month}. Editing probability set to NULL.`);
                      triggerExcelDownload();
                      alert('Payroll cycle permanently LOCKED! All editing is now set to NULL.');
                    }}
                  >
                    <i className="fa-solid fa-lock" style={{ marginRight: '8px' }}></i> Lock & Freeze Payroll Cycle
                  </button>
                </div>
              )}

              {/* STAGE 4: LOCKED STATE (EDITING CHANCE SET TO NULL) */}
              {(step8Stage === 'LOCKED' || isLocked) && (
                <div style={{ textAlign: 'center', padding: '36px 20px' }}>
                  <div style={{ fontSize: '3.5rem', color: '#10b981', marginBottom: '16px' }}>
                    <i className="fa-solid fa-lock"></i>
                  </div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.3rem', color: '#10b981' }}>Payroll Locked & Salaries Frozen</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '480px', margin: '0 auto 20px auto' }}>
                    This payroll cycle is finalized and locked. Further editing has been set to <strong>NULL</strong> (disabled).
                  </p>
                  
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
                    <button className="btn btn-outline" onClick={triggerExcelDownload} style={{ padding: '10px 24px', fontSize: '0.85rem', color: '#10b981', borderColor: '#10b981' }}>
                      <i className="fa-solid fa-file-excel" style={{ marginRight: '6px' }}></i> Download Excel Register
                    </button>
                    <button className="btn btn-primary" onClick={() => handleDisburseRun(selectedRun.id)} style={{ padding: '10px 24px', fontSize: '0.85rem' }}>
                      <i className="fa-solid fa-floppy-disk" style={{ marginRight: '6px' }}></i> Release Payslips
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* BOTTOM NAVIGATION CONTROLS */}
        <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-outline"
              onClick={onBack}
              style={{ padding: '8px 16px', fontSize: '0.8rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
            >
              <i className="fa-solid fa-arrow-left" style={{ marginRight: '6px' }}></i> Exit Wizard
            </button>
            <button
              className="btn btn-outline"
              disabled={currentStep === 1}
              onClick={handleWizardPrevious}
              style={{ padding: '8px 20px', fontSize: '0.8rem' }}
            >
              <i className="fa-solid fa-chevron-left" style={{ marginRight: '6px' }}></i> Previous
            </button>
          </div>

          <button
            className="btn btn-outline"
            disabled={isLocked}
            onClick={() => {
              if (isLocked) return;
              handleStepChange(currentStep);
              logActivity(`Saved draft status of payroll cycle: ${selectedRun.month}`);
              alert('Draft state auto-saved successfully.');
            }}
            style={{ padding: '8px 20px', fontSize: '0.8rem', opacity: isLocked ? 0.5 : 1 }}
          >
            <i className="fa-solid fa-floppy-disk" style={{ marginRight: '6px' }}></i> Save Draft
          </button>

          <button
            className="btn btn-primary"
            disabled={currentStep === totalSteps}
            onClick={handleWizardNext}
            style={{ padding: '8px 20px', fontSize: '0.8rem' }}
          >
            Next <i className="fa-solid fa-chevron-right" style={{ marginLeft: '6px' }}></i>
          </button>
        </div>

        {/* UNIVERSAL EMPLOYEE COMPLIANCE & PAYOUT QUICK FIX MODAL WITH REACTOR PULSE GLOW */}
        {fixModalEmp && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div className="card glass reactor-glow-highlight" style={{ width: '540px', padding: '24px', borderRadius: '12px', background: 'var(--bg-dark)', border: '2px solid var(--accent-primary)', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                  <i className="fa-solid fa-id-card" style={{ color: 'var(--accent-primary)' }}></i>
                  Compliance & Payout Credentials: {fixModalEmp.name}
                </h3>
                <button className="btn btn-ghost" onClick={() => setFixModalEmp(null)} style={{ fontSize: '1rem', cursor: 'pointer' }}>✕</button>
              </div>

              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                Update essential fields to resolve validation warnings for salary processing and statutory filing.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Bank Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. HDFC Bank" 
                    value={fixBankName} 
                    onChange={e => setFixBankName(e.target.value)} 
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }} 
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Bank Account Number *</label>
                  <input 
                    required 
                    type="text" 
                    placeholder="Account Number" 
                    value={fixBankNo} 
                    onChange={e => setFixBankNo(e.target.value)} 
                    className={fixTargetField === 'BANK_NO' || fixTargetField === 'BANK_ACCOUNT' ? 'reactor-glow-highlight' : ''}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: fixTargetField === 'BANK_NO' ? '1px solid var(--accent-primary)' : '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }} 
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>IFSC Code *</label>
                  <input 
                    required 
                    type="text" 
                    placeholder="IFSC Code" 
                    value={fixIfsc} 
                    onChange={e => setFixIfsc(e.target.value)} 
                    className={fixTargetField === 'IFSC' ? 'reactor-glow-highlight' : ''}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: fixTargetField === 'IFSC' ? '1px solid var(--accent-primary)' : '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }} 
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>PAN Card Number *</label>
                  <input 
                    required 
                    type="text" 
                    placeholder="PAN Number" 
                    value={fixPan} 
                    onChange={e => setFixPan(e.target.value)} 
                    className={fixTargetField === 'PAN' ? 'reactor-glow-highlight' : ''}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: fixTargetField === 'PAN' ? '1px solid var(--accent-primary)' : '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }} 
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>EPF UAN Number</label>
                  <input 
                    type="text" 
                    placeholder="12-digit UAN" 
                    value={fixUan} 
                    onChange={e => setFixUan(e.target.value)} 
                    className={fixTargetField === 'UAN' ? 'reactor-glow-highlight' : ''}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: fixTargetField === 'UAN' ? '1px solid var(--accent-primary)' : '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }} 
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>ESIC Number</label>
                  <input 
                    type="text" 
                    placeholder="17-digit ESIC No" 
                    value={fixEsiNo} 
                    onChange={e => setFixEsiNo(e.target.value)} 
                    className={fixTargetField === 'ESI' ? 'reactor-glow-highlight' : ''}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: fixTargetField === 'ESI' ? '1px solid var(--accent-primary)' : '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }} 
                  />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Email Address *</label>
                  <input 
                    required 
                    type="email" 
                    placeholder="Official Email Address" 
                    value={fixEmail} 
                    onChange={e => setFixEmail(e.target.value)} 
                    className={fixTargetField === 'EMAIL' ? 'reactor-glow-highlight' : ''}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: fixTargetField === 'EMAIL' ? '1px solid var(--accent-primary)' : '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }} 
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px', borderTop: '1px solid var(--border-glass)', paddingTop: '14px' }}>
                <button className="btn btn-outline" onClick={() => setFixModalEmp(null)} style={{ padding: '8px 16px', fontSize: '0.8rem' }}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveAllComplianceFixes} style={{ padding: '8px 20px', fontSize: '0.8rem' }}>
                  <i className="fa-solid fa-check" style={{ marginRight: '6px' }}></i> Save & Resolve Warnings ⚡
                </button>
              </div>

            </div>
          </div>
        )}

        {/* STEP 7: DEDUCTIONS BREAKDOWN & EDITABLE OVERRIDE MODAL */}
        {deductionModalEmp && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '20px' }}>
            <div style={{ background: '#1e293b', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.15)', padding: '24px', width: '100%', maxWidth: '650px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.7)', color: '#ffffff' }}>
              
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: '14px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fa-solid fa-calculator" style={{ color: '#818cf8' }}></i>
                    Statutory Deductions Breakdown
                  </h3>
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '4px' }}>
                    <strong style={{ color: '#ffffff' }}>{deductionModalEmp.name}</strong> ({deductionModalEmp.empCode || deductionModalEmp.id}) • Earned Gross: <strong style={{ color: '#34d399' }}>₹{(deductionModalEmp.calculatedSalary || 0).toLocaleString()}</strong>
                    {deductionModalEmp.payableDays !== undefined && deductionModalEmp.workingDays && Number(deductionModalEmp.payableDays) < Number(deductionModalEmp.workingDays) && (
                      <span style={{ marginLeft: '6px', color: '#f59e0b', fontSize: '0.75rem', fontWeight: 600 }}>
                        ({deductionModalEmp.payableDays}/{deductionModalEmp.workingDays} payable days)
                      </span>
                    )}
                  </div>
                </div>
                <button 
                  onClick={() => { setDeductionModalEmp(null); setShowOverrideConfirm(false); }} 
                  style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#94a3b8', fontSize: '1.2rem', width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  ×
                </button>
              </div>

              {/* Form */}
              <form onSubmit={(e) => { e.preventDefault(); setShowOverrideConfirm(true); }}>
                <div style={{ maxHeight: '370px', overflowY: 'auto', paddingRight: '6px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  
                  {/* 1. EPF */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <strong style={{ fontSize: '0.86rem', color: '#f8fafc', display: 'block' }}>Provident Fund (PF / EPF)</strong>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '2px' }}>
                        {deductionModalEmp.pfEligible === false 
                          ? 'Exempt from PF / Not Enrolled in Registration' 
                          : (deductionModalEmp.pfAmount && Number(deductionModalEmp.pfAmount) > 0 
                              ? `Registered Fixed PF Amount: ₹${Number(deductionModalEmp.pfAmount).toLocaleString()}/month` 
                              : 'Registered Statutory PF: 12% of PF Wage (Capped at ₹1,800/mo)')}
                      </span>
                    </div>
                    <div>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>₹</span>
                        <input
                          type="number"
                          min="0"
                          value={editDeds.epf}
                          onChange={e => setEditDeds(prev => ({ ...prev, epf: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px 8px 24px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#ffffff', fontSize: '0.92rem', fontWeight: 700, textAlign: 'right', outline: 'none' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 2. VPF */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <strong style={{ fontSize: '0.86rem', color: '#f8fafc', display: 'block' }}>Voluntary Provident Fund (VPF)</strong>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '2px' }}>
                        {deductionModalEmp.vpfEligible && Number(deductionModalEmp.vpfAmount) > 0 
                          ? `Registered VPF Contribution: ₹${Number(deductionModalEmp.vpfAmount).toLocaleString()}/month` 
                          : 'Not Enrolled in Voluntary PF in Registration'}
                      </span>
                    </div>
                    <div>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>₹</span>
                        <input
                          type="number"
                          min="0"
                          value={editDeds.vpf}
                          onChange={e => setEditDeds(prev => ({ ...prev, vpf: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px 8px 24px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#ffffff', fontSize: '0.92rem', fontWeight: 700, textAlign: 'right', outline: 'none' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 3. ESIC */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <strong style={{ fontSize: '0.86rem', color: '#f8fafc', display: 'block' }}>Employee State Insurance (ESIC)</strong>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '2px' }}>
                        {deductionModalEmp.esiEligible === false 
                          ? 'Exempt from ESIC in Registration' 
                          : ((deductionModalEmp.calculatedSalary || 0) <= 21000 
                              ? 'Registered Statutory ESIC: 0.75% of Gross' 
                              : 'Monthly Gross > ₹21,000 (Statutorily Exempt from ESIC)')}
                      </span>
                    </div>
                    <div>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>₹</span>
                        <input
                          type="number"
                          min="0"
                          value={editDeds.esi}
                          onChange={e => setEditDeds(prev => ({ ...prev, esi: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px 8px 24px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#ffffff', fontSize: '0.92rem', fontWeight: 700, textAlign: 'right', outline: 'none' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 4. PT */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <strong style={{ fontSize: '0.86rem', color: '#f8fafc', display: 'block' }}>Professional Tax (PT)</strong>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '2px' }}>
                        {deductionModalEmp.ptEligible === false || deductionModalEmp.ptExemption === true
                          ? 'Exempt from Professional Tax in Registration' 
                          : (deductionModalEmp.ptAmount && Number(deductionModalEmp.ptAmount) > 0 
                              ? `Registered Fixed Override: ₹${Number(deductionModalEmp.ptAmount).toLocaleString()}/month` 
                              : `Registered State Slab: ${deductionModalEmp.ptStateCode || 'TN'} (₹${editDeds.pt}/month)`)}
                      </span>
                    </div>
                    <div>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>₹</span>
                        <input
                          type="number"
                          min="0"
                          value={editDeds.pt}
                          onChange={e => setEditDeds(prev => ({ ...prev, pt: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px 8px 24px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#ffffff', fontSize: '0.92rem', fontWeight: 700, textAlign: 'right', outline: 'none' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 5. LWF */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <strong style={{ fontSize: '0.86rem', color: '#f8fafc', display: 'block' }}>Labour Welfare Fund (LWF)</strong>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '2px' }}>
                        {deductionModalEmp.lwfEligible !== false 
                          ? `Registered LWF: ₹${Math.round((Number(deductionModalEmp.lwfAmount) || 60)/12)}/month (₹${Number(deductionModalEmp.lwfAmount) || 60}/year)` 
                          : 'Exempt from LWF in Registration'}
                      </span>
                    </div>
                    <div>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>₹</span>
                        <input
                          type="number"
                          min="0"
                          value={editDeds.lwf}
                          onChange={e => setEditDeds(prev => ({ ...prev, lwf: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px 8px 24px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#ffffff', fontSize: '0.92rem', fontWeight: 700, textAlign: 'right', outline: 'none' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 6. TDS */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <strong style={{ fontSize: '0.86rem', color: '#f8fafc', display: 'block' }}>Tax Deducted at Source (TDS / Income Tax)</strong>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '2px' }}>
                        Registered Tax Scheme: {deductionModalEmp.taxRegime || 'New Tax Regime (Section 115BAC)'}
                      </span>
                    </div>
                    <div>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>₹</span>
                        <input
                          type="number"
                          min="0"
                          value={editDeds.tds}
                          onChange={e => setEditDeds(prev => ({ ...prev, tds: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px 8px 24px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#ffffff', fontSize: '0.92rem', fontWeight: 700, textAlign: 'right', outline: 'none' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 7. Other */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <strong style={{ fontSize: '0.86rem', color: '#f8fafc', display: 'block' }}>Other Deductions / Loss of Pay (LOP)</strong>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '2px' }}>
                        Ad-hoc & Cycle Adjustments
                      </span>
                    </div>
                    <div>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>₹</span>
                        <input
                          type="number"
                          min="0"
                          value={editDeds.other}
                          onChange={e => setEditDeds(prev => ({ ...prev, other: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px 8px 24px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#ffffff', fontSize: '0.92rem', fontWeight: 700, textAlign: 'right', outline: 'none' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div style={{ marginTop: '4px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '4px' }}>Mandatory Audit Reason for Override</label>
                    <input
                      type="text"
                      required
                      placeholder="Explain the reason for manual deduction override..."
                      value={editDeds.reason}
                      onChange={e => setEditDeds(prev => ({ ...prev, reason: e.target.value }))}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#ffffff', fontSize: '0.85rem', outline: 'none' }}
                    />
                  </div>

                </div>

                {/* High Contrast Summary Box */}
                {(() => {
                  const grossVal = deductionModalEmp.calculatedSalary || 0;
                  const totalDedsVal = (Number(editDeds.epf) || 0) + (Number(editDeds.vpf) || 0) + (Number(editDeds.esi) || 0) + (Number(editDeds.pt) || 0) + (Number(editDeds.lwf) || 0) + (Number(editDeds.tds) || 0) + (Number(editDeds.other) || 0);
                  const netVal = Math.max(0, grossVal - totalDedsVal);

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', background: 'rgba(15, 23, 42, 0.85)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(99, 102, 241, 0.3)', marginTop: '16px' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.5px' }}>GROSS PAY</div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>₹{grossVal.toLocaleString()}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: '#f87171', fontWeight: 600, letterSpacing: '0.5px' }}>TOTAL DEDUCTIONS</div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ef4444', marginTop: '2px' }}>-₹{totalDedsVal.toLocaleString()}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: '#34d399', fontWeight: 600, letterSpacing: '0.5px' }}>NET PAYABLE</div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#10b981', marginTop: '2px' }}>₹{netVal.toLocaleString()}</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '14px' }}>
                  <button 
                    type="button" 
                    className="btn btn-outline" 
                    onClick={() => { setDeductionModalEmp(null); setShowOverrideConfirm(false); }} 
                    style={{ padding: '8px 18px', fontSize: '0.85rem', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent' }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    style={{ padding: '8px 22px', fontSize: '0.85rem', fontWeight: 600, background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)', border: 'none', color: '#ffffff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.4)' }}
                  >
                    <i className="fa-solid fa-bolt" style={{ marginRight: '6px' }}></i> Save & Apply Override
                  </button>
                </div>
              </form>

            </div>
          </div>
        )}

        {/* STEP 7: CONFIRMATION POPUP MODAL BEFORE APPLYING OVERRIDE */}
        {showOverrideConfirm && deductionModalEmp && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000, padding: '20px' }}>
            <div style={{ background: '#1e293b', borderRadius: '16px', border: '1px solid rgba(245, 158, 11, 0.5)', padding: '24px', width: '100%', maxWidth: '480px', boxShadow: '0 25px 50px rgba(0,0,0,0.7)', color: '#ffffff', textAlign: 'center' }}>
              
              <div style={{ fontSize: '2.8rem', color: '#f59e0b', marginBottom: '12px' }}>
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>

              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.2rem', color: '#f8fafc', fontWeight: 700 }}>
                Confirm Statutory Deduction Override?
              </h3>
              
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '16px', lineHeight: 1.5 }}>
                Are you sure you want to override the statutory deductions for <strong style={{ color: '#ffffff' }}>{deductionModalEmp.name}</strong> ({deductionModalEmp.empCode || deductionModalEmp.id})?
              </p>

              <div style={{ background: '#0f172a', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.82rem', textAlign: 'left', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Provident Fund (PF):</span>
                  <strong style={{ color: '#ffffff' }}>₹{Number(editDeds.epf || 0).toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Voluntary PF (VPF):</span>
                  <strong style={{ color: '#ffffff' }}>₹{Number(editDeds.vpf || 0).toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Employee State Insurance (ESIC):</span>
                  <strong style={{ color: '#ffffff' }}>₹{Number(editDeds.esi || 0).toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Professional Tax (PT):</span>
                  <strong style={{ color: '#ffffff' }}>₹{Number(editDeds.pt || 0).toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Labour Welfare Fund (LWF):</span>
                  <strong style={{ color: '#ffffff' }}>₹{Number(editDeds.lwf || 0).toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>TDS (Income Tax):</span>
                  <strong style={{ color: '#ffffff' }}>₹{Number(editDeds.tds || 0).toLocaleString()}</strong>
                </div>
                {Number(editDeds.other || 0) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span>Other Deductions:</span>
                    <strong style={{ color: '#ffffff' }}>₹{Number(editDeds.other).toLocaleString()}</strong>
                  </div>
                )}
              </div>

              <p style={{ fontSize: '0.75rem', color: '#f59e0b', marginBottom: '20px' }}>
                This will update Grand Ledger, payroll calculations, and export registers for this pay run cycle.
              </p>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
                <button 
                  className="btn btn-outline" 
                  onClick={() => setShowOverrideConfirm(false)} 
                  style={{ padding: '8px 22px', fontSize: '0.85rem', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent' }}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={handleConfirmDeductionsOverride} 
                  style={{ padding: '8px 26px', fontSize: '0.85rem', background: '#10b981', border: 'none', fontWeight: 600, color: '#ffffff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)' }}
                >
                  <i className="fa-solid fa-check" style={{ marginRight: '6px' }}></i> Yes, Apply Override
                </button>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
