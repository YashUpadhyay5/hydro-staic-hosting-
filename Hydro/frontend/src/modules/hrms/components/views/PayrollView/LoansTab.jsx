import React from 'react';

export default function LoansTab({
  employees,
  loans,
  loanEmp,
  setLoanEmp,
  loanAmount,
  setLoanAmount,
  loanTenure,
  setLoanTenure,
  handleCreateLoan
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
      <div className="card glass" style={{ padding: '20px', borderRadius: '12px', height: 'fit-content' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Issue Advance / Personal Loan</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Employee</label>
            <select
              value={loanEmp}
              onChange={e => setLoanEmp(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
            >
              <option value="">Select...</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Principal Amount (₹)</label>
            <input
              type="number"
              value={loanAmount}
              onChange={e => setLoanAmount(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Tenure (Months)</label>
            <input
              type="number"
              value={loanTenure}
              onChange={e => setLoanTenure(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
          <button className="btn btn-primary" onClick={handleCreateLoan}>Approve Advance</button>
        </div>
      </div>

      <div className="card glass" style={{ padding: '24px', borderRadius: '12px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem' }}>Active Loan Repayment Ledger</h3>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left' }}>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>EMPLOYEE</th>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>LOAN ADVANCE</th>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>MONTHLY EMI</th>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>OUTSTANDING</th>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {loans.map(loan => (
              <tr key={loan.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                <td style={{ padding: '12px', fontWeight: 600 }}>{loan.employee ? loan.employee.name : loan.employeeId}</td>
                <td style={{ padding: '12px' }}>₹{loan.principalAmount.toLocaleString()}</td>
                <td style={{ padding: '12px' }}>₹{loan.emiAmount.toLocaleString()}</td>
                <td style={{ padding: '12px', fontWeight: 600 }}>₹{loan.remainingBalance.toLocaleString()}</td>
                <td style={{ padding: '12px' }}>
                  <span style={{
                    padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                    background: loan.status === 'CLOSED' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    color: loan.status === 'CLOSED' ? '#10b981' : '#f59e0b'
                  }}>{loan.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
