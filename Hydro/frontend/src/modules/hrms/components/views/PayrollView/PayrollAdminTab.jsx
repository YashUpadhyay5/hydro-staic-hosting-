import React, { useState } from 'react';
import PayrollAdminModals from './PayrollAdminModals';

export default function PayrollAdminTab({
  employees,
  selectedEmployee,
  setSelectedEmployee,
  ctcInput,
  setCtcInput,
  grossInput,
  setGrossInput,
  effectiveFromInput,
  setEffectiveFromInput,
  handleCreateStructure,
  onNavigateTab
}) {
  const [activeModal, setActiveModal] = useState(null);

  const overridesList = [
    { id: 'salary_component', label: 'Employee Salary Component Override', sub: 'Update details of employee salary components such as Basic, HRA, etc.' },
    { id: 'tds_override', label: 'TDS (Tax Deduction at Source) Override', sub: 'Override TDS amount employees for a selected range of months' },
    { id: 'pf_override', label: 'PF (Provident Fund) Override - Employer and Employee Share, including VPF', sub: 'Override employee, employer and voluntary share of PF to be deducted monthly' },
    { id: 'esi_override', label: 'ESI (Employee State Insurance) Deduction Override', sub: 'Override employee and employer share of ESI to be deducted for a selected range of months' },
    { id: 'pt_override', label: 'PT (Professional Tax) Deduction Override', sub: 'Override PT amount to be deducted for a selected range of months' },
    { id: 'lwf_override', label: 'LWF (Labour Welfare Fund) Override', sub: 'Override employee and employer share of LWF to be deducted for a selected range of months' },
    { id: 'bulk_delete_bonus', label: 'Bulk Delete Bonus', sub: 'Can be used to delete pending bonus for employees in bulk' },
  ];

  const payrollStatusList = [
    { id: 'payroll_status', label: 'Payroll Status', sub: 'Enable/Disable payroll status of employees' },
    { id: 'tax_regime', label: 'Income Tax Regime of Employees', sub: 'View or Update current IT Regime of employees' },
    { id: 'payment_details', label: 'Employee Payment Details and Bank Verification', sub: 'View or update employee payment information and verify bank details' },
  ];

  const taxDeclarationsList = [
    { id: 'tax_approvals', label: 'Income Tax Declarations Approvals', sub: 'Verify proof submitted & approve/reject IT declarations done by employees' },
    { id: 'manage_it_due_date', label: 'Manage IT declaration due date on employee level', sub: 'Lock and unlock IT declaration window for selected employees' },
    { id: 'manage_proof_due_date', label: 'Manage Proof submission due date on employee level', sub: 'Lock and unlock Proof submission window for selected employees' },
  ];

  const payrollImportsList = [
    { id: 'import_financial', label: 'Import Financial Information', sub: 'Add/Update financial details and compliance information of multiple employees in bulk using Excel file Import' },
    { id: 'import_investment', label: 'Import Investment Declaration', sub: 'Add/Update declared amount of investment u/s 123 (Formerly 80C), 124 (Formerly 80D), etc. for multiple employees using Excel file Import' },
    { id: 'import_bonuses', label: 'Import Bonuses with Payout Date', sub: 'Add bonus amount for multiple employees, with payout dates, in bulk using Excel file' },
    { id: 'import_salaries', label: 'Import Salaries with Effective Date', sub: 'Add salary revisions of multiple employees in bulk, using Excel file' },
  ];

  const renderList = (items, startIndex = 1) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {items.map((item, index) => (
        <div 
          key={item.id}
          className="admin-list-item"
          onClick={() => {
            if (item.id === 'pt_override' && onNavigateTab) {
              onNavigateTab('professional-tax');
            } else {
              setActiveModal(item.id);
            }
          }}
          style={{ 
            padding: '12px 16px', 
            borderRadius: '8px', 
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            gap: '12px'
          }}
        >
          <span style={{ color: 'var(--primary-color)', fontWeight: '600' }}>{startIndex + index}.</span>
          <div>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', color: 'var(--primary-color)' }}>{item.label}</h4>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{item.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ padding: '0 12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
        
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Overrides Card */}
          <div className="card glass" style={{ padding: '24px', borderRadius: '12px' }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '1.1rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
              Overrides (Salary Components/Contributions/TDS)
            </h3>
            {renderList(overridesList)}
          </div>

          {/* Payroll Status Card */}
          <div className="card glass" style={{ padding: '24px', borderRadius: '12px' }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '1.1rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
              Payroll Status, Tax Regime & Financial Details
            </h3>
            {renderList(payrollStatusList)}
          </div>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Income Tax Declarations Card */}
          <div className="card glass" style={{ padding: '24px', borderRadius: '12px' }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '1.1rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
              Income Tax Declarations
            </h3>
            <div style={{ padding: '12px 16px', background: 'rgba(6, 182, 212, 0.08)', borderRadius: '8px', marginBottom: '20px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Need tax declarations? <span style={{ color: 'var(--primary-color)', fontWeight: '600', cursor: 'pointer' }}>Click here</span> to learn how to download them.
            </div>
            {renderList(taxDeclarationsList)}
          </div>

          {/* Payroll Imports Card */}
          <div className="card glass" style={{ padding: '24px', borderRadius: '12px' }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '1.1rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
              Payroll Imports
            </h3>
            {renderList(payrollImportsList)}
          </div>
        </div>

      </div>

      <style>{`
        .admin-list-item:hover {
          background: var(--icon-bg);
          transform: translateX(4px);
        }
      `}</style>

      {/* Dynamic Modals */}
      <PayrollAdminModals 
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        employees={employees}
        selectedEmployee={selectedEmployee}
        setSelectedEmployee={setSelectedEmployee}
        ctcInput={ctcInput}
        setCtcInput={setCtcInput}
        grossInput={grossInput}
        setGrossInput={setGrossInput}
        effectiveFromInput={effectiveFromInput}
        setEffectiveFromInput={setEffectiveFromInput}
        handleCreateStructure={handleCreateStructure}
      />
    </div>
  );
}

