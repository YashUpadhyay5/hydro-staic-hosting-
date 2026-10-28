import React from 'react';

export default function BenefitsTab({
  employees,
  reimbursements,
  claimEmp,
  setClaimEmp,
  claimCategory,
  setClaimCategory,
  claimTitle,
  setClaimTitle,
  claimAmount,
  setClaimAmount,
  handleCreateClaim,
  handleUpdateClaim
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.5fr', gap: '20px' }}>
      <div className="card glass" style={{ padding: '20px', borderRadius: '12px', height: 'fit-content' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Log Out-of-Pocket Claim</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Employee</label>
            <select
              value={claimEmp}
              onChange={e => setClaimEmp(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
            >
              <option value="">Select...</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Category</label>
            <select
              value={claimCategory}
              onChange={e => setClaimCategory(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
            >
              <option value="TRAVEL">Travel / Fuel</option>
              <option value="BROADBAND">Broadband / Mobile</option>
              <option value="MEDICAL">Medical allowance</option>
              <option value="OTHER">Other / Miscellaneous</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Title</label>
            <input
              type="text"
              value={claimTitle}
              onChange={e => setClaimTitle(e.target.value)}
              placeholder="e.g. Client lunch receipt"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Amount (₹)</label>
            <input
              type="number"
              value={claimAmount}
              onChange={e => setClaimAmount(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
          <button className="btn btn-primary" onClick={handleCreateClaim}>Submit Claim</button>
        </div>
      </div>

      <div className="card glass" style={{ padding: '24px', borderRadius: '12px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem' }}>Pending Claims & Reimbursements</h3>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left' }}>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>EMPLOYEE</th>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>CLAIM TITLE</th>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>CATEGORY</th>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>AMOUNT</th>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>STATUS</th>
              <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'right' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {reimbursements.map(claim => (
              <tr key={claim.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                <td style={{ padding: '12px', fontWeight: 600 }}>{claim.employee ? claim.employee.name : claim.employeeId}</td>
                <td style={{ padding: '12px' }}>{claim.title}</td>
                <td style={{ padding: '12px', fontSize: '0.8rem' }}>{claim.category}</td>
                <td style={{ padding: '12px', fontWeight: 600 }}>₹{claim.amount.toLocaleString()}</td>
                <td style={{ padding: '12px' }}>
                  <span style={{
                    padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                    background: claim.status === 'APPROVED' ? 'rgba(16, 185, 129, 0.1)' : claim.status === 'REJECTED' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    color: claim.status === 'APPROVED' ? '#10b981' : claim.status === 'REJECTED' ? '#ef4444' : '#f59e0b'
                  }}>{claim.status}</span>
                </td>
                <td style={{ padding: '12px', textAlign: 'right' }}>
                  {claim.status === 'PENDING' && (
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                      <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '0.7rem', background: '#10b981' }} onClick={() => handleUpdateClaim(claim.id, 'APPROVED')}>
                        Approve
                      </button>
                      <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.7rem', color: '#ef4444', borderColor: '#ef4444' }} onClick={() => handleUpdateClaim(claim.id, 'REJECTED')}>
                        Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
