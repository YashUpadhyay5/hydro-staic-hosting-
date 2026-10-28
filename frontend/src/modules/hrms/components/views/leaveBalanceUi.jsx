import React, { useEffect, useRef, useState } from 'react';
import { initials } from './leaveBalanceUtils';

// Shared helpers for the Leave Balances pages.

export function Avatar({ name, photo, large = false }) {
    const [failed, setFailed] = useState(false);
    return (
        <span className={`lb-avatar${large ? ' lb-avatar-lg' : ''}`} aria-hidden="true">
            {photo && !failed ? <img src={photo} alt="" onError={() => setFailed(true)} /> : initials(name)}
        </span>
    );
}

export function SummaryCard({ icon, tone, label, value, hint }) {
    return (
        <div className={`glass lb-card lb-tone-${tone}`}>
            <div className="lb-card-icon"><i className={`fa-solid ${icon}`}></i></div>
            <div style={{ minWidth: 0 }}>
                <div className="lb-card-label">{label}</div>
                <div className="lb-card-value">{value}</div>
                {hint && <div className="lb-card-hint">{hint}</div>}
            </div>
        </div>
    );
}

/** Accessible modal: Esc closes, focus moves into the dialog and returns on close. */
export function Modal({ title, onClose, children, footer }) {
    const ref = useRef(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    useEffect(() => {
        const previous = document.activeElement;
        const first = ref.current?.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
        first?.focus();
        const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            previous?.focus?.();
        };
    }, []);
    return (
        <div className="lb-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="lb-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
                <div className="lb-modal-head">
                    <h3>{title}</h3>
                    <button className="lb-btn lb-btn-sm" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className="lb-modal-body">{children}</div>
                {footer && <div className="lb-modal-head" style={{ borderTop: '1px solid var(--border-glass)', borderBottom: 'none', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
            </div>
        </div>
    );
}

