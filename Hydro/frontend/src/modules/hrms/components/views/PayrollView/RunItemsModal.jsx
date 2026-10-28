import React from 'react';

export default function RunItemsModal({ show, onClose, selectedRun, runItems }) {
  if (!show || !selectedRun) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 1000, padding: '20px'
    }}>
      <div className="glass" style={{
        background: 'var(--bg-main)', border: '1px solid var(--border-glass)',
        padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '1000px',
        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0 }}>Processing Breakdown: Pay Cycle {selectedRun.month}</h3>
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left' }}>
                <th style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>EMPLOYEE</th>
                <th style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>PAID DAYS</th>
                <th style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>GROSS</th>
                <th style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>EPF DEDUCTION</th>
                <th style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>TDS TAX</th>
                <th style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>NET SALARY</th>
                <th style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {runItems.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)', fontSize: '0.85rem' }}>
                  <td style={{ padding: '10px' }}>
                    <strong>{item.employee ? item.employee.name : item.employeeId}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.employeeId}</div>
                  </td>
                  <td style={{ padding: '10px' }}>{item.workedDays} days ({item.lopDays} LOP)</td>
                  <td style={{ padding: '10px' }}>₹{item.grossEarned.toLocaleString()}</td>
                  <td style={{ padding: '10px' }}>₹{(item.deductionsBreakdown.EPF_EE || 0).toLocaleString()}</td>
                  <td style={{ padding: '10px' }}>₹{(item.deductionsBreakdown.TDS || 0).toLocaleString()}</td>
                  <td style={{ padding: '10px', fontWeight: 600, color: '#10b981' }}>₹{item.netSalary.toLocaleString()}</td>
                  <td style={{ padding: '10px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 700,
                      background: item.status === 'COMPLETED' ? 'rgba(16, 185, 129, 0.15)' : item.status === 'SKIPPED_EXIT' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: item.status === 'COMPLETED' ? '#10b981' : item.status === 'SKIPPED_EXIT' ? '#d97706' : '#ef4444'
                    }}>
                      {item.status === 'SKIPPED_EXIT' ? 'SKIPPED (EXITED)' : item.status}
                    </span>
                    {item.status === 'SKIPPED_EXIT' && (
                      <div style={{ fontSize: '0.7rem', color: '#d97706', marginTop: '4px' }}>
                        {item.errorLog || 'Deactivated employee - recorded without salary disbursement'}
                      </div>
                    )}
                    {item.status === 'FAILED' && (
                      <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '4px' }}>
                        {item.errorLog}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
