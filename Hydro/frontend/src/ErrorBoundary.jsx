import React from 'react';

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary caught error]:', error, errorInfo);

        const msg = String(error?.message || '').toLowerCase();
        const isChunkError = 
            msg.includes('failed to fetch dynamically imported module') ||
            msg.includes('importing a module script failed') ||
            msg.includes('unexpected token \'<\'') ||
            msg.includes('chunkloaderror') ||
            msg.includes('loading chunk');

        if (isChunkError) {
            const hasRetried = sessionStorage.getItem('hrms_chunk_reload_attempt');
            if (!hasRetried) {
                sessionStorage.setItem('hrms_chunk_reload_attempt', 'true');
                // Purge caches and auto-reload once to fetch fresh chunks
                if ('caches' in window) {
                    caches.keys().then(names => {
                        return Promise.all(names.map(name => caches.delete(name)));
                    }).catch(() => {});
                }
                window.location.reload();
            }
        }
    }

    handleReload = () => {
        sessionStorage.removeItem('hrms_chunk_reload_attempt');
        if ('caches' in window) {
            caches.keys().then(names => {
                return Promise.all(names.map(name => caches.delete(name)));
            }).then(() => {
                window.location.reload();
            }).catch(() => {
                window.location.reload();
            });
        } else {
            window.location.reload();
        }
    };

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    minHeight: '100vh',
                    width: '100vw',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--bg-primary, #f8fafc)',
                    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
                    padding: '20px',
                    boxSizing: 'border-box'
                }}>
                    <div style={{
                        maxWidth: '460px',
                        width: '100%',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '16px',
                        padding: '32px 24px',
                        textAlign: 'center',
                        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.06)'
                    }}>
                        <div style={{ fontSize: '42px', marginBottom: '16px' }}>🔄</div>

                        <h2 style={{ margin: '0 0 8px 0', fontSize: '1.25rem', color: '#0f172a', fontWeight: 700 }}>
                            Fresh Application Update Ready
                        </h2>
                        <p style={{ margin: '0 0 24px 0', fontSize: '0.9rem', color: '#64748b', lineHeight: 1.5 }}>
                            A newer version of the portal has been deployed. Click below to refresh your browser and load the latest interface.
                        </p>
                        <button 
                            onClick={this.handleReload}
                            style={{
                                background: '#2563eb',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '10px',
                                padding: '10px 24px',
                                fontSize: '0.92rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'background 0.2s',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.background = '#1d4ed8'}
                            onMouseOut={(e) => e.currentTarget.style.background = '#2563eb'}
                        >
                            <span>Reload & Update</span>
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
