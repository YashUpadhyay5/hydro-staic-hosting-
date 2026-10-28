import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

export default function LeaveAdjustmentModal({
  isOpen,
  onClose,
  employees = [],
  defaultEmployeeId = null,
  onSuccess
}) {
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [days, setDays] = useState('20');
  const [reason, setReason] = useState('Migrated from previous software');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setSuccessMsg('');
      if (defaultEmployeeId) {
        setSelectedEmpId(String(defaultEmployeeId));
      } else if (employees.length > 0 && !selectedEmpId) {
        setSelectedEmpId(String(employees[0].id || employees[0].empCode));
      }
    }
  }, [isOpen, defaultEmployeeId, employees]);

  const selectedEmployee = (employees || []).find(e => 
    String(e.id || '').toLowerCase() === String(selectedEmpId || '').toLowerCase() ||
    String(e.empCode || '').toLowerCase() === String(selectedEmpId || '').toLowerCase()
  );

  if (!isOpen) return null;

  const currentOpening = Number(selectedEmployee?.openingLeaveBalance ?? selectedEmployee?.opening_leave_balance ?? selectedEmployee?.earnedLeaves ?? 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!selectedEmployee) {
      setErrorMsg('Please select an employee.');
      return;
    }
    const numDays = parseFloat(days);
    if (isNaN(numDays) || numDays < 0) {
      setErrorMsg('Please enter a valid positive number of days.');
      return;
    }
    if (!reason.trim()) {
      setErrorMsg('Please provide a reason (e.g. Migrated from previous software).');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        employeeId: selectedEmployee.id || selectedEmployee.empCode,
        empCode: selectedEmployee.empCode,
        adjustmentType: 'OPENING_BALANCE',
        leaveType: 'Earned Leave',
        days: numDays,
        reason: reason.trim(),
        effectiveDate: new Date().toISOString().slice(0, 10)
      };

      const res = await api.adjustLeaveBalance(payload);
      setSuccessMsg('Opening balance added successfully!');
      
      if (onSuccess) {
        onSuccess(res.employee);
      }

      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to add opening balance.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '16px'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '480px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
        overflow: 'hidden',
        border: '1px solid #e2e8f0'
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8fafc'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
              Add Opening Leave Balance
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Add previous accumulated Earned Leaves from migration
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.25rem',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px',
              lineHeight: 1
            }}
          >
            &times;
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {errorMsg && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: '0.85rem'
            }}>
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#047857',
              fontSize: '0.85rem'
            }}>
              {successMsg}
            </div>
          )}

          {/* Select Employee */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              Employee <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              style={{
                width: '100%',
                height: '42px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            >
              {employees.map(emp => (
                <option key={emp.id || emp.empCode} value={emp.id || emp.empCode}>
                  {emp.name} ({emp.empCode || emp.id})
                </option>
              ))}
            </select>
            {selectedEmployee && currentOpening > 0 && (
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                Current Opening Balance: <strong style={{ color: '#4f46e5' }}>{currentOpening} days</strong>
              </div>
            )}
          </div>

          {/* Leave Type */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              Leave Type
            </label>
            <input
              type="text"
              value="Earned Leave"
              disabled
              style={{
                width: '100%',
                height: '42px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#475569',
                fontSize: '0.9rem',
                fontWeight: 600,
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Days */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              Opening Balance (Days) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="e.g. 20"
              required
              style={{
                width: '100%',
                height: '42px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: '1rem',
                fontWeight: 600,
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Reason */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              Reason <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Migrated from previous software"
              required
              style={{
                width: '100%',
                height: '42px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '0 18px',
                height: '40px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '0 20px',
                height: '40px',
                borderRadius: '8px',
                border: 'none',
                background: '#4f46e5',
                color: '#ffffff',
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {submitting ? 'Saving...' : 'Save Opening Balance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
