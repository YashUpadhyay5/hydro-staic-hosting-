import React from 'react';

export default function PayRunActivitySidebar({ selectedRun, activities = [] }) {

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Activity Logs Card */}
      <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px' }}>
        <h4 style={{ margin: '0 0 16px 0', fontSize: '0.9rem', fontWeight: 700 }}>Recent Activity</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {activities.map((act, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '10px', fontSize: '0.75rem', borderLeft: '2px solid var(--accent-primary)', paddingLeft: '8px' }}>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>{act.user}</strong>: {act.action}
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', marginTop: '2px' }}>{act.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Help Resources Card */}
      <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px' }}>
        <h4 style={{ margin: '0 0 16px 0', fontSize: '0.9rem', fontWeight: 700 }}>Help Resources</h4>
        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.75rem', color: 'var(--accent-primary)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <li>
            <a href="#" style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.preventDefault()}>
              How to overwrite statutory contributions & deductions?
            </a>
          </li>
          <li>
            <a href="#" style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.preventDefault()}>
              How to release payslips to employees?
            </a>
          </li>
          <li>
            <a href="#" style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.preventDefault()}>
              How to download salary bulk upload format for bank transfer?
            </a>
          </li>
          <li>
            <a href="#" style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.preventDefault()}>
              How to run an off-cycle payroll?
            </a>
          </li>
        </ul>
      </div>

    </div>
  );
}
