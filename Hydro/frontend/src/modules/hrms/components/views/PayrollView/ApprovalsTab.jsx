import React from 'react';

export default function ApprovalsTab({ components }) {
  return (
    <div className="card glass" style={{ padding: '24px', borderRadius: '12px' }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem' }}>Global Formula-based Components</h3>
      <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-glass)', textAlign: 'left' }}>
            <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>ID</th>
            <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>NAME</th>
            <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>TYPE</th>
            <th style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>FORMULA / RULE</th>
          </tr>
        </thead>
        <tbody>
          {components.map(comp => (
            <tr key={comp.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
              <td style={{ padding: '12px', fontWeight: 600 }}>{comp.id}</td>
              <td style={{ padding: '12px' }}>{comp.name}</td>
              <td style={{ padding: '12px' }}>{comp.type}</td>
              <td style={{ padding: '12px', color: 'var(--accent-primary)', fontFamily: 'monospace' }}>
                {comp.calculationType === 'FORMULA' ? comp.formula : 'Flat Rate / Manual Override'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
