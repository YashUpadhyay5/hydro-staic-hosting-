import React from 'react';

export default function PayRunCycleSelector({ runs, selectedRun, onSelectRun, onDeleteRun }) {
  const formatCycle = (monthStr) => {
    if (!monthStr) return { title: 'Unknown Cycle', period: '01 - End of Month', shortMonth: 'Month' };
    const [year, month] = monthStr.split('-').map(Number);
    const dateObj = new Date(year, (month || 1) - 1, 1);
    const monthName = dateObj.toLocaleString('en-US', { month: 'long' });
    const shortMonth = dateObj.toLocaleString('en-US', { month: 'short' });
    const lastDay = new Date(year, month || 1, 0).getDate();
    return {
      title: `${monthName} ${year}`,
      shortMonth,
      year,
      period: `01 ${shortMonth} - ${lastDay} ${shortMonth} ${year}`
    };
  };

  const cycles = runs.map(run => {
    let statusLabel = 'UPCOMING';
    let statusColor = 'var(--text-secondary)';
    let statusBg = 'rgba(255, 255, 255, 0.05)';

    if (run.status === 'PAID' || run.status === 'COMPLETED') {
      statusLabel = 'COMPLETED';
      statusColor = '#10b981';
      statusBg = 'rgba(16, 185, 129, 0.15)';
    } else if (run.status === 'PROCESSING') {
      statusLabel = 'PROCESSING';
      statusColor = '#3b82f6';
      statusBg = 'rgba(59, 130, 246, 0.15)';
    } else if (run.status === 'APPROVED') {
      statusLabel = 'APPROVED';
      statusColor = '#8b5cf6';
      statusBg = 'rgba(139, 92, 246, 0.15)';
    } else if (run.status === 'DRAFT') {
      statusLabel = 'CURRENT';
      statusColor = 'var(--accent-primary, #4f46e5)';
      statusBg = 'rgba(79, 70, 229, 0.12)';
    }

    const { title, period } = formatCycle(run.month);

    return {
      ...run,
      title,
      period,
      statusLabel,
      statusColor,
      statusBg
    };
  });

  return (
    <div style={{
      display: 'flex',
      gap: '14px',
      overflowX: 'auto',
      paddingBottom: '10px',
      marginBottom: '20px',
      borderBottom: '1px solid var(--border-glass)'
    }}>
      {cycles.map(cycle => {
        const isSelected = selectedRun && selectedRun.id === cycle.id;
        return (
          <div
            key={cycle.id}
            onClick={() => onSelectRun(cycle)}
            style={{
              flex: '0 0 170px',
              padding: '14px 16px',
              borderRadius: '10px',
              background: isSelected ? 'rgba(79, 70, 229, 0.14)' : 'rgba(255,255,255,0.03)',
              border: isSelected ? '2px solid var(--accent-primary, #4f46e5)' : '1px solid var(--border-glass)',
              cursor: 'pointer',
              textAlign: 'center',
              boxShadow: isSelected ? '0 4px 12px rgba(79, 70, 229, 0.18)' : 'none',
              transition: 'all 0.2s ease-in-out',
              position: 'relative'
            }}
          >
            {onDeleteRun && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteRun(cycle.id);
                }}
                title={`Delete ${cycle.title} pay run`}
                style={{
                  position: 'absolute',
                  top: '6px',
                  right: '8px',
                  background: '#fee2e2',
                  border: '1px solid #fca5a5',
                  color: '#dc2626',
                  fontSize: '0.7rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0.7,
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
              >
                ×
              </button>
            )}
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: isSelected ? 'var(--accent-primary, #4f46e5)' : 'var(--text-primary)', letterSpacing: '-0.2px' }}>
              {cycle.title}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: '4px 0 10px 0', fontWeight: 500 }}>
              {cycle.period}
            </div>
            <span style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: '12px',
              background: cycle.statusBg,
              color: cycle.statusColor,
              letterSpacing: '0.3px',
              textTransform: 'uppercase'
            }}>
              {cycle.statusLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
