import React, { useState } from 'react';
import { api } from '../../services/api';
import { Modal } from './leaveBalanceUi';
import { fmtDays } from './leaveBalanceUtils';

// Upload the "EL and Sunday working" Excel register → preview every change → confirm (one transaction).
export default function LeaveImportModal({ onClose, onImported }) {
    const [file, setFile] = useState(null);
    const [plan, setPlan] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const preview = async () => {
        if (!file) return;
        setBusy(true);
        setError('');
        setPlan(null);
        try {
            setPlan(await api.previewLeaveImport(file));
        } catch (err) {
            setError(err.message || 'Could not read the file.');
        } finally {
            setBusy(false);
        }
    };

    const confirmImport = async () => {
        if (!plan || busy) return;
        setBusy(true);
        setError('');
        try {
            const res = await api.applyLeaveImport(file, plan.fileHash);
            onImported(res.duplicate ? 'This file was already imported. Nothing changed.' : `Imported ${res.employees} employees (${res.rowsWritten} ledger entries).`);
        } catch (err) {
            setError(`${err.message || 'Import failed.'} Nothing was saved.`);
            setBusy(false);
        }
    };

    const changed = plan ? plan.items.filter((i) => i.difference !== 0) : [];

    return (
        <Modal
            title="Import leave register from Excel"
            onClose={busy ? () => {} : onClose}
            footer={<>
                <button className="lb-btn" onClick={onClose} disabled={busy}>Cancel</button>
                {plan && !plan.alreadyImported && plan.blockingErrors === 0 && plan.items.length > 0 && (
                    <button className="lb-btn lb-btn-primary" onClick={confirmImport} disabled={busy}>
                        {busy ? <><i className="fa-solid fa-spinner fa-spin"></i> Importing…</> : <><i className="fa-solid fa-file-import"></i> Import {plan.items.length} employees</>}
                    </button>
                )}
            </>}
        >
            <div className="lb-muted" style={{ fontSize: '0.82rem' }}>
                Use the “EL and Sunday working” sheet. It fills in Jan–Sep history only for employees who have none in the portal yet
                (for example new joiners); employees whose months are already entered are never changed by an import, correct them month by month with Edit.
                From {plan?.ledgerStartMonth || 'the ledger start'} onward the portal calculates balances from approved leave requests, so those months in the sheet are ignored.
            </div>
            <div className="lb-form-row">
                <label className="lb-field" style={{ flex: 1 }}>
                    <span>Excel file (.xlsx)</span>
                    <input className="lb-input" type="file" accept=".xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] || null); setPlan(null); setError(''); }} style={{ paddingTop: 6 }} />
                </label>
                <button className="lb-btn" onClick={preview} disabled={!file || busy}>
                    {busy && !plan ? <><i className="fa-solid fa-spinner fa-spin"></i> Reading…</> : <><i className="fa-solid fa-magnifying-glass"></i> Preview</>}
                </button>
            </div>
            {error && <div className="lb-error-text" role="alert">{error}</div>}

            {plan && (
                <>
                    {plan.alreadyImported && <div className="lb-badge lb-badge-amber" style={{ alignSelf: 'flex-start' }}>This exact file was already imported.</div>}
                    {plan.blockingErrors > 0 && <div className="lb-error-text">Some cells are not numbers. Fix them in Excel and preview again.</div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span className="lb-badge lb-badge-green">{plan.items.length} to import</span>
                        {plan.skipped?.length > 0 && <span className="lb-badge lb-badge-grey">{plan.skipped.length} already have history (not changed)</span>}
                        <span className="lb-badge lb-badge-purple">{changed.length} balances change</span>
                        {plan.unmatched.length > 0 && <span className="lb-badge lb-badge-red">{plan.unmatched.length} not found</span>}
                        {plan.notInSheet.length > 0 && <span className="lb-badge lb-badge-grey">{plan.notInSheet.length} active employees not in sheet</span>}
                    </div>

                    {plan.items.length === 0 && (
                        <div className="lb-muted" style={{ fontSize: '0.82rem' }}>Nothing to import: every employee in this sheet already has history in the portal.</div>
                    )}
                    {plan.items.length > 0 && <div className="lb-table-wrap" style={{ border: '1px solid var(--border-glass)', borderRadius: 10, maxHeight: 320 }}>
                        <table className="lb-table">
                            <thead><tr><th>Employee</th><th style={{ textAlign: 'right' }}>EL (imported)</th><th style={{ textAlign: 'right' }}>Sunday</th><th style={{ textAlign: 'right' }}>Current opening</th><th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>Available after</th></tr></thead>
                            <tbody>
                                {plan.items.map((i) => (
                                    <tr key={i.employeeId} className={i.difference !== 0 ? 'lb-cell-changed' : ''}>
                                        <td><strong>{i.empCode}</strong> {i.name}{i.matchedBy === 'name' && <span className="lb-badge lb-badge-amber" style={{ marginLeft: 6 }}>sheet: {i.sheetCode}</span>}</td>
                                        <td className="lb-num" style={{ textAlign: 'right' }}>{fmtDays(i.importedEl + i.importedCarry)}</td>
                                        <td className="lb-num lb-purple" style={{ textAlign: 'right' }}>{fmtDays(i.importedSpecial)}</td>
                                        <td className="lb-num" style={{ textAlign: 'right' }}>{fmtDays(i.currentOpening)}</td>
                                        <td className={`lb-num ${i.difference < 0 ? 'lb-red' : i.difference > 0 ? 'lb-green' : 'lb-muted'}`} style={{ textAlign: 'right' }}>{i.difference > 0 ? '+' : ''}{fmtDays(i.difference)}</td>
                                        <td className="lb-num lb-green" style={{ textAlign: 'right' }}>{fmtDays(i.newAvailable)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>}

                    {plan.skipped?.length > 0 && (
                        <div className="lb-muted" style={{ fontSize: '0.8rem' }}>Already have history (not changed): {plan.skipped.map((s) => `${s.empCode} ${s.name}`).join(', ')}</div>
                    )}
                    {plan.unmatched.length > 0 && (
                        <div className="lb-error-text">Not found in the portal (skipped): {plan.unmatched.map((u) => `${u.code} ${u.name} (row ${u.row})`).join(', ')}</div>
                    )}
                    {plan.notInSheet.length > 0 && (
                        <div className="lb-muted" style={{ fontSize: '0.8rem' }}>Not in the sheet (balances unchanged): {plan.notInSheet.map((e) => `${e.empCode} ${e.name}`).join(', ')}</div>
                    )}
                    {plan.warnings.length > 0 && (
                        <details style={{ fontSize: '0.8rem' }}>
                            <summary>{plan.warnings.length} note{plan.warnings.length === 1 ? '' : 's'}</summary>
                            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                                {plan.warnings.map((w, k) => <li key={k}>Row {w.row} ({w.code}): {w.message}</li>)}
                            </ul>
                        </details>
                    )}
                </>
            )}
        </Modal>
    );
}
