import React, { useState, useEffect } from 'react';

export default function PayrollAdminModals({
  activeModal,
  onClose,
  employees,
  selectedEmployee,
  setSelectedEmployee,
  ctcInput,
  setCtcInput,
  grossInput,
  setGrossInput,
  effectiveFromInput,
  setEffectiveFromInput,
  handleCreateStructure
}) {
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    setShowWarning(false);
  }, [activeModal]);

  if (!activeModal) return null;

  const handleConfirmSubmit = () => {
    if (!showWarning) {
      setShowWarning(true);
      return;
    }
    handleCreateStructure();
    setShowWarning(false);
    onClose();
  };

  // Helper to get formatted title
  const getTitle = () => activeModal.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  // Render generic override form
  const renderOverrideForm = (title) => (
    <>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: '600' }}>{title}</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem', lineHeight: '1.4' }}>
        Specify custom deduction amounts for selected employees.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '28px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '500' }}>Select Employee</label>
          <select style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', outline: 'none' }}>
            <option>Choose...</option>
            {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '500' }}>Override Amount (INR)</label>
          <input type="number" placeholder="Enter custom amount" style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', outline: 'none' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '500' }}>Effective Month</label>
          <input type="month" style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', outline: 'none' }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '12px' }}>
        <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
        <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', background: 'var(--primary-color)', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}>Apply Override</button>
      </div>
    </>
  );

  // Render generic import form
  const renderImportForm = (title) => (
    <>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: '600' }}>{title}</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem', lineHeight: '1.4' }}>
        Upload an Excel (.xlsx) or CSV file to bulk import records.
      </p>
      <div style={{ padding: '30px', border: '2px dashed var(--input-border)', borderRadius: '8px', background: '#fff', textAlign: 'center', marginBottom: '28px', cursor: 'pointer' }}>
        <i className="fa-solid fa-file-excel" style={{ fontSize: '36px', color: '#10b981', marginBottom: '12px' }}></i>
        <h4 style={{ margin: '0 0 4px 0', color: 'var(--text-primary)' }}>Click to upload or drag and drop</h4>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>XLSX, CSV up to 10MB</p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '12px' }}>
        <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
        <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', background: 'var(--primary-color)', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}>Start Import</button>
      </div>
    </>
  );

  // Render generic date picker form
  const renderDatePickerForm = (title) => (
    <>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: '600' }}>{title}</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem', lineHeight: '1.4' }}>
        Set the cutoff date for employee submissions. The portal will automatically lock after this date.
      </p>
      <div style={{ marginBottom: '28px' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '500' }}>Select Cutoff Date</label>
        <input type="date" style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', outline: 'none' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '12px' }}>
        <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
        <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', background: 'var(--primary-color)', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}>Save Date</button>
      </div>
    </>
  );

  const renderContent = () => {
    switch (activeModal) {
      case 'salary_component':
        return (
          <>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: '600' }}>1. Employee Salary Component Override</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem', lineHeight: '1.4' }}>Update details of employee salary components such as Basic, HRA, etc.</p>
            {showWarning ? (
              <div style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', marginBottom: '24px' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#dc2626', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-triangle-exclamation"></i> Warning: Irreversible Change
                </h4>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.5' }}>You are about to permanently alter the salary structure. Are you absolutely sure?</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '28px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '500' }}>Select Employee</label>
                  <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', outline: 'none' }}>
                    <option value="">Choose...</option>
                    {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '500' }}>CTC Amount</label>
                    <input type="number" placeholder="CTC in INR" value={ctcInput} onChange={e => setCtcInput(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '500' }}>Monthly Gross</label>
                    <input type="number" placeholder="Gross" value={grossInput} onChange={e => setGrossInput(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', outline: 'none' }} />
                  </div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '12px' }}>
              <button onClick={() => showWarning ? setShowWarning(false) : onClose()} style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
              <button onClick={handleConfirmSubmit} style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', background: showWarning ? '#dc2626' : 'var(--primary-color)', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}>{showWarning ? 'Yes, Confirm' : 'Update Agreement'}</button>
            </div>
          </>
        );

      case 'payroll_status':
        return (
          <>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: '600' }}>Payroll Status</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem', lineHeight: '1.4' }}>Enable or disable payroll processing for specific employees.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '28px', maxHeight: '300px', overflowY: 'auto', paddingRight: '8px' }}>
              {employees?.map(emp => (
                <div key={emp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#fff', borderRadius: '8px', border: '1px solid var(--input-border)' }}>
                  <div><h4 style={{ margin: '0 0 4px 0', fontSize: '0.95rem' }}>{emp.name}</h4><p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>ID: {emp.empCode || emp.id}</p></div>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}><span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Active</span><input type="checkbox" defaultChecked={true} style={{ accentColor: 'var(--primary-color)', width: '18px', height: '18px' }} /></label>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '12px' }}>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', background: 'var(--primary-color)', color: '#fff', fontWeight: '600', cursor: 'pointer' }}>Save Changes</button>
            </div>
          </>
        );

      case 'tax_regime':
        return (
          <>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: '600' }}>Income Tax Regime</h3>
            <div style={{ marginBottom: '28px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '500' }}>Select Employee</label>
              <select style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', marginBottom: '16px', outline: 'none' }}>
                {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '500' }}>Tax Regime</label>
              <select style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', outline: 'none' }}>
                <option value="NEW">New Tax Regime (Default)</option>
                <option value="OLD">Old Tax Regime</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '12px' }}>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', background: 'var(--primary-color)', color: '#fff', fontWeight: '600', cursor: 'pointer' }}>Save Regime</button>
            </div>
          </>
        );

      case 'payment_details':
        return (
          <>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: '600' }}>Payment Details</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '28px' }}>
              <select style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', outline: 'none' }}>
                {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
              <input type="text" placeholder="Bank Name" style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', outline: 'none' }} />
              <input type="text" placeholder="Account Number" style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', outline: 'none' }} />
              <input type="text" placeholder="IFSC Code" style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '12px' }}>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', background: 'var(--primary-color)', color: '#fff', fontWeight: '600', cursor: 'pointer' }}>Verify & Save</button>
            </div>
          </>
        );

      case 'tax_approvals':
        return (
          <>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: '600' }}>Tax Declarations Approvals</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem' }}>Review pending investment proofs submitted by employees.</p>
            <div style={{ padding: '20px', textAlign: 'center', background: '#fff', borderRadius: '8px', border: '1px dashed var(--input-border)', marginBottom: '24px' }}>
              <i className="fa-solid fa-check-double" style={{ fontSize: '32px', color: '#10b981', marginBottom: '16px' }}></i>
              <p style={{ color: 'var(--text-secondary)' }}>All caught up! No pending proofs to approve.</p>
            </div>
            <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer' }}>Close</button>
          </>
        );

      case 'bulk_delete_bonus':
        return (
          <>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem', color: '#dc2626', fontWeight: '600' }}>Bulk Delete Bonus</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem' }}>This action will permanently delete all un-disbursed bonuses in the system.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '12px' }}>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid var(--input-border)', background: '#fff', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', background: '#dc2626', color: '#fff', fontWeight: '600', cursor: 'pointer' }}>Confirm Deletion</button>
            </div>
          </>
        );

      case 'tds_override':
      case 'pf_override':
      case 'esi_override':
      case 'pt_override':
      case 'lwf_override':
        return renderOverrideForm(getTitle());

      case 'manage_it_due_date':
      case 'manage_proof_due_date':
        return renderDatePickerForm(getTitle());

      case 'import_financial':
      case 'import_investment':
      case 'import_bonuses':
      case 'import_salaries':
        return renderImportForm(getTitle());

      default:
        return null;
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px'
    }}>
      <div style={{ 
        padding: '32px', borderRadius: '12px', width: '100%', maxWidth: '520px',
        backgroundColor: '#e5e7eb', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        animation: 'slideUp 0.3s ease-out'
      }}>
        {renderContent()}
      </div>
    </div>
  );
}
