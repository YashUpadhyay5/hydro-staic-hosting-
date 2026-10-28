import React, { useState } from 'react';

export default function DashboardTab({ dashboardData, employees = [], onTabChange, latestRunItems = [], leaves = [] }) {
  const [financialYear, setFinancialYear] = useState('2026-2027');
  const [showUpcomingModal, setShowUpcomingModal] = useState(false);
  const [revisionSearch, setRevisionSearch] = useState('');
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [pendingSearch, setPendingSearch] = useState('');
  const [showUnprocessedModal, setShowUnprocessedModal] = useState(false);
  const [unprocessedFilter, setUnprocessedFilter] = useState('ALL'); // 'ALL' | 'HOLD' | 'EXITED'
  const [unprocessedSearch, setUnprocessedSearch] = useState('');

  const getWorkingDaysExcludeSundays = (year, month) => {
    const daysInMonth = new Date(year, month, 0).getDate();
    let sundays = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      if (date.getDay() === 0) {
        sundays++;
      }
    }
    return daysInMonth - sundays;
  };

  const parseDateMonthYear = (dateStr) => {
    if (!dateStr) return { month: 0, year: 0 };
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      return {
        day: parseInt(parts[0]),
        month: parseInt(parts[1]),
        year: parseInt(parts[2])
      };
    } else if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      return {
        year: parseInt(parts[0]),
        month: parseInt(parts[1]),
        day: parseInt(parts[2])
      };
    }
    return { month: 0, year: 0 };
  };

  const calculateTotalNetForMonth = (targetMonth) => {
    const [year, month] = targetMonth.split('-').map(Number);
    const workingDays = getWorkingDaysExcludeSundays(year, month);

    return employees.reduce((sum, emp) => {
      const empLeaves = leaves.filter(l => {
        const uId = l.userId || l.user_id;
        const sDate = l.startDate || l.start_date;
        if (!uId || !emp.id) return false;
        if (uId.toLowerCase() !== emp.id.toLowerCase()) return false;
        if (!l.status || l.status.toLowerCase() !== 'approved') return false;
        
        const parsed = parseDateMonthYear(sDate);
        return parsed.year === year && parsed.month === month;
      });

      const lopDays = empLeaves.reduce((total, l) => total + Number(l.lopDays || l.lop_days || 0), 0);
      const payableDays = Math.max(0, workingDays - lopDays);
      const rawGross = Number(emp.compensationGross || emp.salary || 0);
      const baseSalary = rawGross > 0 ? (rawGross > 100000 ? Math.round(rawGross / 12) : rawGross) : 50000;
      const calculatedSalary = Math.round(baseSalary * (payableDays / workingDays));
      return sum + calculatedSalary;
    }, 0);
  };

  // Calculate Unprocessed & Held Employees (Category A: Salary Hold, Category B: Exited & Skipped)
  const unprocessedEmployees = [];

  // A. Deactivated employees (status: 'PAST' - exited and unchecked from active pay runs)
  const deactivatedEmployees = employees.filter(e => e.status === 'PAST');
  deactivatedEmployees.forEach(emp => {
    const rawGross = Number(emp.compensationGross || emp.salary || 0);
    const monthlyBase = rawGross > 0 ? (rawGross > 100000 ? Math.round(rawGross / 12) : rawGross) : 50000;
    unprocessedEmployees.push({
      id: emp.id,
      empCode: emp.empCode || emp.id,
      name: emp.name,
      department: emp.department || 'Operations',
      designation: emp.designation || 'Staff',
      type: 'EXITED_SKIPPED',
      typeLabel: 'Exited (Skipped from Run)',
      typeColor: '#d97706',
      typeBg: 'rgba(245, 158, 11, 0.12)',
      reason: emp.exitReason ? `Deactivated on ${emp.exitDate || 'Recent'} - ${emp.exitReason}` : `Deactivated on ${emp.exitDate || 'Recent'} - Skipped from salary run by admin`,
      amount: monthlyBase,
      status: 'NOT_PROCESSED'
    });
  });

  // B. Employees with Salary on Hold (from latestRunItems or hold records)
  latestRunItems.forEach(item => {
    if (item.status === 'SKIPPED_EXIT' && !unprocessedEmployees.some(u => u.id === item.employeeId)) {
      unprocessedEmployees.push({
        id: item.employeeId,
        empCode: item.employee?.empCode || item.employeeId,
        name: item.employee?.name || item.employeeId,
        department: item.employee?.department || 'Operations',
        designation: item.employee?.designation || 'Staff',
        type: 'EXITED_SKIPPED',
        typeLabel: 'Exited (Skipped from Run)',
        typeColor: '#d97706',
        typeBg: 'rgba(245, 158, 11, 0.12)',
        reason: item.errorLog || 'Deactivated employee - recorded without salary disbursement',
        amount: Number(item.grossEarned || item.netSalary || 0),
        status: 'NOT_PROCESSED'
      });
    } else if (item.status === 'FAILED' || (item.errorLog && item.errorLog.toLowerCase().includes('hold'))) {
      unprocessedEmployees.push({
        id: item.employeeId,
        empCode: item.employee?.empCode || item.employeeId,
        name: item.employee?.name || item.employeeId,
        department: item.employee?.department || 'Operations',
        designation: item.employee?.designation || 'Staff',
        type: 'SALARY_HOLD',
        typeLabel: 'Salary on Hold',
        typeColor: '#ef4444',
        typeBg: 'rgba(239, 68, 68, 0.12)',
        reason: item.errorLog || 'Disciplinary / Compliance Hold placed on salary',
        amount: Number(item.grossEarned || 0),
        status: 'ON_HOLD'
      });
    }
  });

  const totalUnprocessedAmount = unprocessedEmployees.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalHeldCount = unprocessedEmployees.filter(e => e.type === 'SALARY_HOLD').length;
  const totalExitedSkippedCount = unprocessedEmployees.filter(e => e.type === 'EXITED_SKIPPED').length;

  const filteredUnprocessedList = unprocessedEmployees.filter(emp => {
    if (unprocessedFilter === 'HOLD' && emp.type !== 'SALARY_HOLD') return false;
    if (unprocessedFilter === 'EXITED' && emp.type !== 'EXITED_SKIPPED') return false;
    if (!unprocessedSearch.trim()) return true;
    const q = unprocessedSearch.toLowerCase();
    return (
      (emp.name && emp.name.toLowerCase().includes(q)) ||
      (emp.empCode && emp.empCode.toLowerCase().includes(q)) ||
      (emp.department && emp.department.toLowerCase().includes(q)) ||
      (emp.reason && emp.reason.toLowerCase().includes(q))
    );
  });

    // Sort database runs chronologically to determine progression
  const sortedRuns = [...(dashboardData.runsTrend || [])].sort((a, b) => a.month.localeCompare(b.month));
  const paidRuns = sortedRuns.filter(r => r.status === 'PAID');
  
  // Last processed is the latest PAID month chronologically
  const lastRun = paidRuns[paidRuns.length - 1];
  const lastSalaryMonth = lastRun ? lastRun.month : '2026-07'; 
  const lastSalary = calculateTotalNetForMonth(lastSalaryMonth);

  // Upcoming month must be chronologically AFTER the last processed month
  let upcomingSalaryMonth = '2026-08';
  if (lastRun) {
    const [year, month] = lastRun.month.split('-');
    let nextYear = parseInt(year);
    let nextMonth = parseInt(month) + 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    upcomingSalaryMonth = `${nextYear}-${nextMonth.toString().padStart(2, '0')}`;
  }

  const upcomingSalary = calculateTotalNetForMonth(upcomingSalaryMonth);

  // Fallback to active employees list grouping if latestRunItems is empty
  const dataSource = latestRunItems.length > 0 
    ? latestRunItems 
    : employees.map(emp => {
        const rawGross = Number(emp.compensationGross || emp.salary || 0);
        const monthlyBase = rawGross > 100000 ? Math.round(rawGross / 12) : (rawGross > 0 ? rawGross : 50000);
        return {
          employee: emp,
          grossEarned: monthlyBase
        };
      });

  // 2. Group items by Department
  const deptMap = {};
  let totalDeptCompensation = 0;
  let highestDeptName = 'N/A';
  let highestDeptVal = 0;
  let lowestDeptName = 'N/A';
  let lowestDeptVal = Infinity;

  dataSource.forEach(item => {
    const dept = (item.employee && item.employee.department) || 'Unassigned';
    const amount = Number(item.grossEarned || 0);
    deptMap[dept] = (deptMap[dept] || 0) + amount;
    totalDeptCompensation += amount;
  });

  const deptData = Object.keys(deptMap).map((dept, index) => {
    const val = deptMap[dept];
    if (val > highestDeptVal) {
      highestDeptVal = val;
      highestDeptName = dept;
    }
    if (val < lowestDeptVal) {
      lowestDeptVal = val;
      lowestDeptName = dept;
    }
    const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#ef4444'];
    const percentage = totalDeptCompensation > 0 ? Math.round((val / totalDeptCompensation) * 100) : 0;
    return {
      name: dept,
      value: val,
      color: colors[index % colors.length],
      percentage
    };
  });

  if (lowestDeptVal === Infinity) lowestDeptVal = 0;

  // 3. Group items by Location
  const locMap = {};
  let totalLocCompensation = 0;
  let highestLocName = 'N/A';
  let highestLocVal = 0;
  let lowestLocName = 'N/A';
  let lowestLocVal = Infinity;

  dataSource.forEach(item => {
    const loc = (item.employee && item.employee.location) || 'Primary Office';
    const amount = Number(item.grossEarned || 0);
    locMap[loc] = (locMap[loc] || 0) + amount;
    totalLocCompensation += amount;
  });

  const locationData = Object.keys(locMap).map((loc, index) => {
    const val = locMap[loc];
    if (val > highestLocVal) {
      highestLocVal = val;
      highestLocName = loc;
    }
    if (val < lowestLocVal) {
      lowestLocVal = val;
      lowestLocName = loc;
    }
    const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#4f46e5', '#ec4899'];
    const percentage = totalLocCompensation > 0 ? Math.round((val / totalLocCompensation) * 100) : 0;
    return {
      name: loc,
      value: val,
      color: colors[index % colors.length],
      percentage
    };
  });

  // Calculate employees whose salary is scheduled for revision within next 3 months (90 days)
  const today = new Date();
  const upcomingRevisionEmployees = (employees || []).map((emp, index) => {
    let revDateObj = null;

    if (emp.nextRevisionDate || emp.revisionDate) {
      revDateObj = new Date(emp.nextRevisionDate || emp.revisionDate);
    } else if (emp.joiningDate) {
      const jParts = parseDateMonthYear(emp.joiningDate);
      if (jParts.year > 0 && jParts.month > 0) {
        let targetYear = today.getFullYear();
        let targetMonth = jParts.month - 1;
        let targetDay = jParts.day || 1;

        let annivDate = new Date(targetYear, targetMonth, targetDay);
        if (annivDate < today) {
          annivDate = new Date(targetYear + 1, targetMonth, targetDay);
        }
        revDateObj = annivDate;
      }
    }

    if (!revDateObj || isNaN(revDateObj.getTime())) {
      const idNum = String(emp.id || index).replace(/\D/g, '') || String(index + 1);
      const offsetDays = (parseInt(idNum, 10) % 80) + 10;
      revDateObj = new Date();
      revDateObj.setDate(today.getDate() + offsetDays);
    }

    const diffDays = Math.ceil((revDateObj.getTime() - today.getTime()) / (1000 * 3600 * 24));
    const isUpcoming = diffDays >= 0 && diffDays <= 90;

    let dueBadge = 'Due in 3 Months';
    let dueColor = '#8b5cf6';
    let dueBg = 'rgba(139, 92, 246, 0.1)';
    if (diffDays <= 30) {
      dueBadge = 'Due in 1 Month';
      dueColor = '#10b981';
      dueBg = 'rgba(16, 185, 129, 0.1)';
    } else if (diffDays <= 60) {
      dueBadge = 'Due in 2 Months';
      dueColor = '#2563eb';
      dueBg = 'rgba(37, 99, 235, 0.1)';
    }

    const formattedDate = revDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    return {
      ...emp,
      revisionDateObj: revDateObj,
      revisionDateFormatted: formattedDate,
      diffDays,
      dueBadge,
      dueColor,
      dueBg,
      isUpcoming
    };
  }).filter(emp => emp.isUpcoming).sort((a, b) => a.diffDays - b.diffDays);

  const filteredUpcomingEmployees = upcomingRevisionEmployees.filter(emp => {
    if (!revisionSearch.trim()) return true;
    const q = revisionSearch.toLowerCase();
    const name = (emp.name || '').toLowerCase();
    const code = (emp.empCode || emp.id || '').toLowerCase();
    const dept = (emp.department || '').toLowerCase();
    return name.includes(q) || code.includes(q) || dept.includes(q);
  });

  // Calculate employees whose salary revision is pending/overdue
  const pendingRevisionEmployees = (employees || []).map((emp, index) => {
    let revDateObj = null;

    if (emp.lastRevisionDate || emp.joiningDate) {
      const jParts = parseDateMonthYear(emp.joiningDate || emp.lastRevisionDate);
      if (jParts.year > 0 && jParts.month > 0) {
        let prevAnnivDate = new Date(today.getFullYear() - 1, jParts.month - 1, jParts.day || 1);
        revDateObj = prevAnnivDate;
      }
    }

    if (!revDateObj || isNaN(revDateObj.getTime())) {
      const idNum = String(emp.id || index).replace(/\D/g, '') || String(index + 1);
      const pastDays = (parseInt(idNum, 10) % 45) + 5;
      revDateObj = new Date();
      revDateObj.setDate(today.getDate() - pastDays);
    }

    const diffDays = Math.ceil((today.getTime() - revDateObj.getTime()) / (1000 * 3600 * 24));
    const isPending = diffDays > 0;

    const formattedDate = revDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    return {
      ...emp,
      revisionDateObj: revDateObj,
      revisionDateFormatted: formattedDate,
      diffDays,
      dueBadge: `Overdue by ${diffDays} Days`,
      dueColor: '#ef4444',
      dueBg: 'rgba(239, 68, 68, 0.1)',
      isPending
    };
  }).filter(emp => emp.isPending).sort((a, b) => b.diffDays - a.diffDays);

  const filteredPendingEmployees = pendingRevisionEmployees.filter(emp => {
    if (!pendingSearch.trim()) return true;
    const q = pendingSearch.toLowerCase();
    const name = (emp.name || '').toLowerCase();
    const code = (emp.empCode || emp.id || '').toLowerCase();
    const dept = (emp.department || '').toLowerCase();
    return name.includes(q) || code.includes(q) || dept.includes(q);
  });

  let accumulatedPercentDept = 0;
  let accumulatedPercentLoc = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Cards Row */}
      <div className="kpi-grid-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
        
        {/* Card 1: Last Salary Processed */}
        <div className="stat-card glass" style={{ padding: '20px', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '120px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>Last Salary Processed</span>
            <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(79, 70, 229, 0.1)', color: 'var(--accent-primary)', fontWeight: 600 }}>{lastSalaryMonth}</span>
          </div>
          <h3 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '12px 0 0 0', color: 'var(--text-primary)' }}>₹{lastSalary.toLocaleString()}</h3>
        </div>

        {/* Card 2: Upcoming Salary */}
        <div className="stat-card glass" style={{ padding: '20px', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '120px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>Upcoming Salary</span>
            <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontWeight: 600 }}>{upcomingSalaryMonth}</span>
          </div>
          <h3 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '12px 0 0 0', color: 'var(--text-primary)' }}>₹{upcomingSalary.toLocaleString()}</h3>
        </div>

        {/* Card 3: Upcoming Revisions */}
        <div 
          className="stat-card glass" 
          onClick={() => setShowUpcomingModal(true)}
          style={{ padding: '20px', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '120px', cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid rgba(139, 92, 246, 0.3)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>Upcoming Revisions</span>
            <button 
              onClick={(e) => { e.stopPropagation(); setShowUpcomingModal(true); }}
              style={{ background: 'none', border: 'none', color: '#8b5cf6', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}
            >
              View Employees 👁️
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '12px' }}>
            <h3 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{upcomingRevisionEmployees.length}</h3>
            <span style={{ fontSize: '0.75rem', color: '#8b5cf6', background: 'rgba(139, 92, 246, 0.1)', padding: '2px 8px', borderRadius: '10px', fontWeight: 700 }}>3 MONTHS</span>
          </div>
        </div>

        {/* Card 5: Unprocessed & Held Salaries */}
        <div 
          className="stat-card glass" 
          onClick={() => setShowUnprocessedModal(true)}
          style={{ padding: '20px', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '120px', cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid rgba(245, 158, 11, 0.35)', background: 'rgba(245, 158, 11, 0.05)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: '#fbbf24', fontSize: '0.85rem', fontWeight: 700 }}>Unprocessed Salaries</span>
            <button 
              onClick={(e) => { e.stopPropagation(); setShowUnprocessedModal(true); }}
              style={{ background: 'none', border: 'none', color: '#fbbf24', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}
            >
              View List 👁️
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '12px' }}>
            <div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, color: '#f59e0b' }}>{unprocessedEmployees.length}</h3>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>₹{totalUnprocessedAmount.toLocaleString()} pending</span>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '2px 8px', borderRadius: '10px', fontWeight: 700 }}>
              {totalExitedSkippedCount} Exited | {totalHeldCount} Hold
            </span>
          </div>
        </div>

                {/* Card 4: Pending Revisions */}
        <div 
          className="stat-card glass" 
          onClick={() => setShowPendingModal(true)}
          style={{ padding: '20px', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '120px', cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid rgba(239, 68, 68, 0.3)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>Pending Revisions</span>
            <button 
              onClick={(e) => { e.stopPropagation(); setShowPendingModal(true); }}
              style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}
            >
              View Employees 👁️
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '12px' }}>
            <h3 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{pendingRevisionEmployees.length}</h3>
            <span style={{ fontSize: '0.75rem', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '10px', fontWeight: 700 }}>OVERDUE</span>
          </div>
        </div>

      </div>

      {/* Compensation Summary Section */}
      <div className="card glass" style={{ padding: '24px', borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Compensation Summary</h2>
          <select
            value={financialYear}
            onChange={e => setFinancialYear(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-glass)',
              background: 'var(--input-bg)',
              color: 'var(--text-primary)',
              outline: 'none',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            <option value="2026-2027">Financial Year 2026 - 2027</option>
            <option value="2025-2026">Financial Year 2025 - 2026</option>
          </select>
        </div>

        {/* Charts Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          
          {/* Chart 1: Compensation by Department */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
            <h4 style={{ margin: '0 0 20px 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Compensation Distribution by Department/Sub-Department</h4>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
              {/* SVG Donut */}
              <div style={{ position: 'relative', width: '150px', height: '150px' }}>
                <svg width="100%" height="100%" viewBox="0 0 42 42" className="donut">
                  <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="4.5"></circle>
                  {totalDeptCompensation === 0 ? (
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="rgba(255,255,255,0.15)" strokeWidth="4.5"></circle>
                  ) : (
                    deptData.map((item, idx) => {
                      const strokeDasharray = `${item.percentage} ${100 - item.percentage}`;
                      const strokeDashoffset = 100 - accumulatedPercentDept + 25;
                      accumulatedPercentDept += item.percentage;
                      return (
                        <circle
                          key={idx}
                          cx="21"
                          cy="21"
                          r="15.91549430918954"
                          fill="transparent"
                          stroke={item.color}
                          strokeWidth="4.5"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                        ></circle>
                      );
                    })
                  )}
                </svg>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block' }}>Departments</span>
                  <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{deptData.length} Active</strong>
                </div>
              </div>

              {/* Data Breakdown list */}
              <div style={{ flex: 1, minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>TOTAL COMPENSATION</span>
                  <strong style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>₹{totalDeptCompensation.toLocaleString()}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>HIGHEST COMPENSATION</span>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{highestDeptName} {highestDeptVal > 0 ? `(₹${highestDeptVal.toLocaleString()})` : ''}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>LOWEST COMPENSATION</span>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{lowestDeptName} {lowestDeptVal > 0 && lowestDeptVal !== Infinity ? `(₹${lowestDeptVal.toLocaleString()})` : ''}</strong>
                </div>
              </div>
            </div>

            {/* Custom Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-glass)' }}>
              {totalDeptCompensation === 0 ? (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No department distribution records found.</span>
              ) : (
                deptData.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color }}></span>
                    {item.name} ({item.percentage}%)
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Chart 2: Compensation by Location */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
            <h4 style={{ margin: '0 0 20px 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Compensation Distribution by Location</h4>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
              {/* SVG Donut */}
              <div style={{ position: 'relative', width: '150px', height: '150px' }}>
                <svg width="100%" height="100%" viewBox="0 0 42 42" className="donut">
                  <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="4.5"></circle>
                  {totalLocCompensation === 0 ? (
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="rgba(255,255,255,0.15)" strokeWidth="4.5"></circle>
                  ) : (
                    locationData.map((item, idx) => {
                      const strokeDasharray = `${item.percentage} ${100 - item.percentage}`;
                      const strokeDashoffset = 100 - accumulatedPercentLoc + 25;
                      accumulatedPercentLoc += item.percentage;
                      return (
                        <circle
                          key={idx}
                          cx="21"
                          cy="21"
                          r="15.91549430918954"
                          fill="transparent"
                          stroke={item.color}
                          strokeWidth="4.5"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                        ></circle>
                      );
                    })
                  )}
                </svg>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.7', color: 'var(--text-secondary)', display: 'block' }}>Locations</span>
                  <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{locationData.length} Active</strong>
                </div>
              </div>

              {/* Data Breakdown list */}
              <div style={{ flex: 1, minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>TOTAL COMPENSATION</span>
                  <strong style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>₹{totalLocCompensation.toLocaleString()}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>HIGHEST COMPENSATION</span>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{highestLocName} {highestLocVal > 0 ? `(₹${highestLocVal.toLocaleString()})` : ''}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>LOWEST COMPENSATION</span>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{lowestLocName} {lowestLocVal > 0 && lowestLocVal !== Infinity ? `(₹${lowestLocVal.toLocaleString()})` : ''}</strong>
                </div>
              </div>
            </div>

            {/* Custom Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-glass)' }}>
              {totalLocCompensation === 0 ? (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No location distribution records found.</span>
              ) : (
                locationData.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color }}></span>
                    {item.name} ({item.percentage}%)
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Variance Section */}
      <div className="card glass" style={{ padding: '24px', borderRadius: '12px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem', color: 'var(--text-primary)' }}>Planned Vs Actual Compensation (Variance) - Past Months</h3>
        
        {(!dashboardData.runsTrend || dashboardData.runsTrend.length === 0) ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No historical run data to display variance.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', height: '220px', alignItems: 'flex-end', gap: '24px', padding: '20px 10px 10px 10px', overflowX: 'auto' }}>
              {(() => {
                const trendData = dashboardData.runsTrend || [];
                const parsedItems = trendData.map(r => {
                  const grossVal = Number(r.totalGross || r.gross || r.planned || r.totalAmount || 801667);
                  const netVal = Number(r.totalNet || r.net || r.actual || r.totalPay || 750000);
                  return {
                    ...r,
                    grossVal,
                    netVal
                  };
                });

                const maxVal = Math.max(...parsedItems.map(r => Math.max(r.grossVal, r.netVal)), 100000);

                return parsedItems.map((run, idx) => {
                  const plannedPct = Math.max(15, Math.round((run.grossVal / maxVal) * 100));
                  const actualPct = Math.max(12, Math.round((run.netVal / maxVal) * 100));

                  return (
                    <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', minWidth: '70px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', height: '160px', width: '100%', justifyContent: 'center' }}>
                        {/* Planned Bar */}
                        <div 
                          style={{
                            height: `${plannedPct}%`,
                            width: '20px',
                            background: 'linear-gradient(180deg, #818cf8 0%, #4f46e5 100%)',
                            borderRadius: '6px 6px 0 0',
                            position: 'relative',
                            boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)',
                            transition: 'all 0.3s ease',
                            cursor: 'pointer'
                          }}
                          title={`Planned (${run.month}): ₹${run.grossVal.toLocaleString()}`}
                        ></div>

                        {/* Actual Bar */}
                        <div 
                          style={{
                            height: `${actualPct}%`,
                            width: '20px',
                            background: 'linear-gradient(180deg, #34d399 0%, #059669 100%)',
                            borderRadius: '6px 6px 0 0',
                            position: 'relative',
                            boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
                            transition: 'all 0.3s ease',
                            cursor: 'pointer'
                          }}
                          title={`Actual (${run.month}): ₹${run.netVal.toLocaleString()}`}
                        ></div>
                      </div>

                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: '10px' }}>{run.month}</span>
                    </div>
                  );
                });
              })()}
            </div>

            <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', marginTop: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-glass)', paddingTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '14px', height: '14px', background: 'linear-gradient(180deg, #818cf8 0%, #4f46e5 100%)', borderRadius: '4px' }}></span>
                Planned Compensation
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '14px', height: '14px', background: 'linear-gradient(180deg, #34d399 0%, #059669 100%)', borderRadius: '4px' }}></span>
                Actual Compensation
              </div>
            </div>
          </>
        )}
      </div>

      {/* Upcoming Revisions Employee Modal */}
      {showUpcomingModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '920px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden',
            border: '1px solid #e2e8f0'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                  📅 Upcoming Salary Revisions (Next 3 Months)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Showing {filteredUpcomingEmployees.length} employee(s) whose salary is scheduled for revision within 90 days.
                </p>
              </div>
              <button
                onClick={() => setShowUpcomingModal(false)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  fontSize: '18px',
                  cursor: 'pointer',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            </div>

            {/* Search Input Bar */}
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
              <input
                type="text"
                placeholder="Search by Employee Name, Code, or Department..."
                value={revisionSearch}
                onChange={e => setRevisionSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  outline: 'none',
                  color: '#1e293b'
                }}
              />
            </div>

            {/* Employee Table Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 20px 24px' }}>
              {filteredUpcomingEmployees.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
                  No upcoming salary revisions match your search filter.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left', marginTop: '16px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Employee Details</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Department & Role</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Current Gross</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Joining Date</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Revision Date</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUpcomingEmployees.map(emp => {
                      const rawGross = Number(emp.compensationGross || emp.salary || 0);
                      const monthlyGross = rawGross > 0 ? (rawGross > 100000 ? Math.round(rawGross / 12) : rawGross) : 50000;
                      const displaySalary = `₹${monthlyGross.toLocaleString()}`;

                      return (
                        <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          {/* Employee Details */}
                          <td style={{ padding: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                background: '#2563eb',
                                color: '#ffffff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: '0.85rem'
                              }}>
                                {(emp.name || 'E').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, color: '#1e293b' }}>{emp.name || 'Employee'}</div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{emp.empCode || emp.id}</div>
                              </div>
                            </div>
                          </td>

                          {/* Department & Role */}
                          <td style={{ padding: '12px' }}>
                            <div style={{ fontWeight: 600, color: '#334155' }}>{emp.department || 'Operations'}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{emp.designation || emp.jobTitle || 'Executive'}</div>
                          </td>

                          {/* Current Gross */}
                          <td style={{ padding: '12px', fontWeight: 800, color: '#0f172a' }}>
                            {displaySalary}
                          </td>

                          {/* Joining Date */}
                          <td style={{ padding: '12px', color: '#64748b' }}>
                            {emp.joiningDate || '01/04/2025'}
                          </td>

                          {/* Scheduled Revision Date */}
                          <td style={{ padding: '12px', fontWeight: 800, color: '#2563eb' }}>
                            📅 {emp.revisionDateFormatted}
                          </td>

                          {/* Status Badge */}
                          <td style={{ padding: '12px' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '4px 10px',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              color: emp.dueColor,
                              background: emp.dueBg
                            }}>
                              {emp.dueBadge}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '14px 24px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justify: 'flex-end',
              background: '#f8fafc'
            }}>
              <button
                onClick={() => setShowUpcomingModal(false)}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unprocessed & Held Salaries Employee Modal */}
      {showUnprocessedModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '920px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden',
            border: '2px solid #f59e0b'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#fffbeb'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⏸️</span> Unprocessed & Held Salaries ({unprocessedEmployees.length})
                </h3>
                <p style={{ margin: '4px 0 0 0', color: '#b45309', fontSize: '0.85rem' }}>
                  Total Pending Salary Amount: <strong>₹{totalUnprocessedAmount.toLocaleString()}</strong>
                </p>
              </div>
              <button
                onClick={() => setShowUnprocessedModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  color: '#92400e',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                ✕
              </button>
            </div>

            {/* Filter Tabs & Search Bar */}
            <div style={{
              padding: '16px 24px',
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap'
            }}>
              <div className="tab-btn-group" style={{ margin: 0, display: 'flex', gap: '6px' }}>
                <button 
                  type="button" 
                  className={`tab-btn ${unprocessedFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setUnprocessedFilter('ALL')}
                  style={{ padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700, borderRadius: '8px' }}
                >
                  All ({unprocessedEmployees.length})
                </button>
                <button 
                  type="button" 
                  className={`tab-btn ${unprocessedFilter === 'EXITED' ? 'active' : ''}`}
                  onClick={() => setUnprocessedFilter('EXITED')}
                  style={{ padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700, borderRadius: '8px' }}
                >
                  Exited / Skipped ({totalExitedSkippedCount})
                </button>
                <button 
                  type="button" 
                  className={`tab-btn ${unprocessedFilter === 'HOLD' ? 'active' : ''}`}
                  onClick={() => setUnprocessedFilter('HOLD')}
                  style={{ padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700, borderRadius: '8px' }}
                >
                  Salary on Hold ({totalHeldCount})
                </button>
              </div>

              <input
                type="text"
                placeholder="Search by name, ID, or reason..."
                value={unprocessedSearch}
                onChange={e => setUnprocessedSearch(e.target.value)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '0.85rem',
                  outline: 'none',
                  minWidth: '260px'
                }}
              />
            </div>

            {/* Table Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 20px 24px' }}>
              {filteredUnprocessedList.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
                  No unprocessed or on-hold employee records match your filter.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left', marginTop: '16px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Employee Details</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Department & Role</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Status Type</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Reason / Audit Remarks</th>
                      <th style={{ padding: '12px', fontWeight: 700, textAlign: 'right' }}>Unprocessed (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUnprocessedList.map(emp => (
                      <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              background: emp.typeColor,
                              color: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 800,
                              fontSize: '0.85rem'
                            }}>
                              {(emp.name || 'E').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, color: '#1e293b' }}>{emp.name}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{emp.empCode || emp.id}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ fontWeight: 600, color: '#334155' }}>{emp.department || 'Operations'}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{emp.designation || 'Staff'}</div>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            background: emp.typeBg,
                            color: emp.typeColor
                          }}>
                            {emp.typeLabel}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#475569', fontSize: '0.8rem', maxWidth: '300px', lineHeight: 1.4 }}>
                          {emp.reason}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800, color: emp.typeColor }}>
                          ₹{(emp.amount || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '14px 24px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Showing {filteredUnprocessedList.length} of {unprocessedEmployees.length} records
              </span>
              <div style={{ display: 'flex', gap: '10px' }}>
                {onTabChange && (
                  <button
                    onClick={() => {
                      setShowUnprocessedModal(false);
                      onTabChange('runs');
                    }}
                    style={{
                      padding: '8px 18px',
                      borderRadius: '8px',
                      background: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer'
                    }}
                  >
                    Manage in Pay Runs Tab ➔
                  </button>
                )}
                <button
                  onClick={() => setShowUnprocessedModal(false)}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '8px',
                    background: '#64748b',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Pending Revisions Employee Modal */}
      {showPendingModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '920px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden',
            border: '1px solid #e2e8f0'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justify: 'space-between',
              alignItems: 'center',
              background: '#fef2f2'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#991b1b' }}>
                  ⚠️ Pending / Overdue Salary Revisions
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#b91c1c' }}>
                  Showing {filteredPendingEmployees.length} employee(s) whose salary revision is overdue and requires action.
                </p>
              </div>
              <button
                onClick={() => setShowPendingModal(false)}
                style={{
                  background: '#ffffff',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  fontSize: '18px',
                  cursor: 'pointer',
                  color: '#991b1b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            </div>

            {/* Search Input Bar */}
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
              <input
                type="text"
                placeholder="Search by Employee Name, Code, or Department..."
                value={pendingSearch}
                onChange={e => setPendingSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  outline: 'none',
                  color: '#1e293b'
                }}
              />
            </div>

            {/* Employee Table Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 20px 24px' }}>
              {filteredPendingEmployees.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
                  No pending salary revisions match your search filter.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left', marginTop: '16px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Employee Details</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Department & Role</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Current Gross</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Scheduled Date</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Overdue Status</th>
                      <th style={{ padding: '12px', fontWeight: 700 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPendingEmployees.map(emp => {
                      const rawGross = Number(emp.compensationGross || emp.salary || 0);
                      const monthlyGross = rawGross > 0 ? (rawGross > 100000 ? Math.round(rawGross / 12) : rawGross) : 50000;
                      const displaySalary = `₹${monthlyGross.toLocaleString()}`;

                      return (
                        <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          {/* Employee Details */}
                          <td style={{ padding: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                background: '#ef4444',
                                color: '#ffffff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: '0.85rem'
                              }}>
                                {(emp.name || 'E').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, color: '#1e293b' }}>{emp.name || 'Employee'}</div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{emp.empCode || emp.id}</div>
                              </div>
                            </div>
                          </td>

                          {/* Department & Role */}
                          <td style={{ padding: '12px' }}>
                            <div style={{ fontWeight: 600, color: '#334155' }}>{emp.department || 'Operations'}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{emp.designation || emp.jobTitle || 'Executive'}</div>
                          </td>

                          {/* Current Gross */}
                          <td style={{ padding: '12px', fontWeight: 800, color: '#0f172a' }}>
                            {displaySalary}
                          </td>

                          {/* Scheduled Date */}
                          <td style={{ padding: '12px', fontWeight: 700, color: '#dc2626' }}>
                            📅 {emp.revisionDateFormatted}
                          </td>

                          {/* Status Badge */}
                          <td style={{ padding: '12px' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '4px 10px',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              color: '#dc2626',
                              background: '#fef2f2',
                              border: '1px solid #fecaca'
                            }}>
                              ⚠️ {emp.dueBadge}
                            </span>
                          </td>

                          {/* Action Button */}
                          <td style={{ padding: '12px' }}>
                            <button
                              onClick={() => {
                                setShowPendingModal(false);
                                if (onTabChange) onTabChange('payroll-admin');
                              }}
                              style={{
                                background: '#ef4444',
                                color: '#ffffff',
                                border: 'none',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              Revise Salary ✏️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '14px 24px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justify: 'flex-end',
              background: '#f8fafc'
            }}>
              <button
                onClick={() => setShowPendingModal(false)}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  background: '#64748b',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
