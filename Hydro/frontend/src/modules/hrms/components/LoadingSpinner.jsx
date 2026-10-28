import React from 'react';

export default function LoadingSpinner({ message = 'Loading data...', minHeight = '320px', size = 52, overlay = false }) {
  const containerStyle = overlay ? {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999
  } : {
    width: '100%',
    minHeight: minHeight,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    padding: '32px 16px',
    backgroundColor: 'transparent'
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes hydroSpinnerRotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes hydroSpinnerDash {
          0% { stroke-dasharray: 1, 150; stroke-dashoffset: 0; }
          50% { stroke-dasharray: 90, 150; stroke-dashoffset: -35; }
          100% { stroke-dasharray: 90, 150; stroke-dashoffset: -124; }
        }
        @keyframes hydroPulseFade {
          0%, 100% { opacity: 0.6; transform: scale(0.98); }
          50% { opacity: 1; transform: scale(1.02); }
        }
      `}</style>
      
      <div style={{ position: 'relative', width: `${size}px`, height: `${size}px`, animation: 'hydroPulseFade 2s infinite ease-in-out' }}>
        <svg 
          viewBox="0 0 50 50" 
          style={{ 
            width: '100%', 
            height: '100%', 
            animation: 'hydroSpinnerRotate 1.4s linear infinite' 
          }}
        >
          <defs>
            <linearGradient id="hydroSpinnerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="50%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
          {/* Subtle background track */}
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke="rgba(99, 102, 241, 0.15)"
            strokeWidth="4"
          />
          {/* Animated gradient ring */}
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke="url(#hydroSpinnerGradient)"
            strokeWidth="4"
            strokeLinecap="round"
            style={{
              animation: 'hydroSpinnerDash 1.5s ease-in-out infinite'
            }}
          />
        </svg>
      </div>

      {message && (
        <span style={{ 
          fontSize: '0.9rem', 
          fontWeight: 600, 
          color: 'var(--text-secondary, #64748b)', 
          letterSpacing: '0.02em',
          textAlign: 'center'
        }}>
          {message}
        </span>
      )}
    </div>
  );
}
