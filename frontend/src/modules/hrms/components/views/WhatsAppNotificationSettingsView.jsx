import LoadingSpinner from '../LoadingSpinner';
import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

export default function WhatsAppNotificationSettingsView() {
  const cachedSettings = api.getCached('/notifications/whatsapp/settings');
  const cachedLogs = api.getCached('/notifications/whatsapp/logs');

  const [loading, setLoading] = useState(() => !cachedSettings);
  const [setting, setSetting] = useState(() => cachedSettings?.setting || {
    enabled: true,
    scheduledTime: '12:00',
    timezone: 'Asia/Kolkata',
    templateName: 'daily_attendance_summary',
    sendOnHolidays: false,
    sendOnWeekoffs: false
  });
  const [recipients, setRecipients] = useState(() => cachedSettings?.recipients || []);
  const [logs, setLogs] = useState(() => cachedLogs?.logs || []);
  const [todaySummary, setTodaySummary] = useState(() => cachedLogs?.summaryToday || null);

  const [newRecipientType, setNewRecipientType] = useState('ROLE');
  const [newTargetRole, setNewTargetRole] = useState('MANAGER');
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const fetchSettingsAndLogs = async () => {
    try {
      const [res, logsRes] = await Promise.all([
        api.request('/notifications/whatsapp/settings'),
        api.request('/notifications/whatsapp/logs')
      ]);
      if (res && res.setting) {
        setSetting(res.setting);
      }
      if (res && res.recipients) {
        setRecipients(res.recipients);
      }
      if (logsRes && logsRes.logs) {
        setLogs(logsRes.logs);
      }
      if (logsRes && logsRes.summaryToday) {
        setTodaySummary(logsRes.summaryToday);
      }
    } catch (err) {
      console.error('Error loading WhatsApp settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettingsAndLogs();
  }, []);

  const handleSaveSettings = async () => {
    try {
      setActionMessage('Saving settings...');
      await api.request('/notifications/whatsapp/settings', {
        method: 'PUT',
        body: JSON.stringify(setting)
      });
      setActionMessage('✅ Settings saved successfully!');
      setTimeout(() => setActionMessage(''), 3000);
      fetchSettingsAndLogs();
    } catch (err) {
      console.error('Save error:', err);
      setActionMessage('❌ Failed to save settings');
    }
  };

  const handleAddRecipient = async (e) => {
    e.preventDefault();
    try {
      setActionMessage('Adding recipient...');
      await api.request('/notifications/whatsapp/recipients', {
        method: 'POST',
        body: JSON.stringify({
          recipientType: newRecipientType,
          targetRole: newRecipientType === 'ROLE' ? newTargetRole : null,
          phoneNumber: newRecipientType === 'CUSTOM_NUMBER' ? newPhone : null,
          name: newName || (newRecipientType === 'ROLE' ? `${newTargetRole} Group` : newPhone)
        })
      });
      setNewPhone('');
      setNewName('');
      setActionMessage('✅ Recipient added!');
      setTimeout(() => setActionMessage(''), 3000);
      fetchSettingsAndLogs();
    } catch (err) {
      console.error('Add error:', err);
      setActionMessage('❌ Failed to add recipient');
    }
  };

  const handleDeleteRecipient = async (id) => {
    if (!window.confirm('Are you sure you want to remove this recipient?')) return;
    try {
      await api.request(`/notifications/whatsapp/recipients/${id}`, {
        method: 'DELETE'
      });
      fetchSettingsAndLogs();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleSendTest = async () => {
    try {
      setActionMessage('🧪 Sending Test WhatsApp Summary...');
      await api.request('/notifications/whatsapp/test', {
        method: 'POST'
      });
      setActionMessage('✅ Test WhatsApp summary dispatched!');
      setTimeout(() => setActionMessage(''), 4000);
      fetchSettingsAndLogs();
    } catch (err) {
      console.error('Test error:', err);
      setActionMessage('❌ Test dispatch failed');
    }
  };

  const handleTriggerManual = async () => {
    try {
      setActionMessage('⚡ Triggering Manual Summary Dispatch...');
      await api.request('/notifications/whatsapp/trigger', {
        method: 'POST'
      });
      setActionMessage("✅ Today's WhatsApp Summary job executed!");
      setTimeout(() => setActionMessage(''), 4000);
      fetchSettingsAndLogs();
    } catch (err) {
      console.error('Trigger error:', err);
      setActionMessage('❌ Manual trigger failed');
    }
  };

  if (loading) return <LoadingSpinner message="Loading WhatsApp Configuration..." minHeight="400px" />;

    return (
    <div className="custom-scrollbar" style={{ padding: '24px', background: 'transparent', minHeight: '100vh', fontFamily: 'Inter, sans-serif', color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>
            📱 WhatsApp Attendance Summary Notifications
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '14px' }}>
            Automated production 12:00 PM IST WhatsApp Business attendance notifications & recipient configuration
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleSendTest}
            style={{
              padding: '10px 16px',
              background: '#f59e0b',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            🧪 Send Test WhatsApp
          </button>
          <button
            onClick={handleTriggerManual}
            style={{
              padding: '10px 16px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            ⚡ Trigger Today Summary
          </button>
        </div>
      </div>

      {actionMessage && (
        <div style={{ padding: '12px 16px', background: 'rgba(37, 99, 235, 0.15)', color: '#93c5fd', borderRadius: '8px', marginBottom: '20px', fontWeight: 600, border: '1px solid rgba(37, 99, 235, 0.3)' }}>
          {actionMessage}
        </div>
      )}

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        {/* Card 1: Configuration Settings */}
        <div className="glass" style={{ background: 'var(--bg-glass)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
            ⚙️ Schedule & Template Configuration
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Automated Daily Notification (12:00 PM IST):</span>
              <input
                type="checkbox"
                checked={setting.enabled}
                onChange={(e) => setSetting({ ...setting, enabled: e.target.checked })}
                style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#2563eb' }}
              />
            </label>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                SCHEDULED TIME & TIMEZONE
              </label>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input
                  type="text"
                  value={setting.scheduledTime}
                  onChange={(e) => setSetting({ ...setting, scheduledTime: e.target.value })}
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border-glass)', borderRadius: '6px', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                />
                <input
                  type="text"
                  value={setting.timezone}
                  onChange={(e) => setSetting({ ...setting, timezone: e.target.value })}
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border-glass)', borderRadius: '6px', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                APPROVED WHATSAPP TEMPLATE NAME
              </label>
              <input
                type="text"
                value={setting.templateName}
                onChange={(e) => setSetting({ ...setting, templateName: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-glass)', borderRadius: '6px', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>

            <button
              onClick={handleSaveSettings}
              style={{
                marginTop: '8px',
                padding: '10px 16px',
                background: '#10b981',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Save Notification Settings
            </button>
          </div>
        </div>

        {/* Card 2: Today's Live Summary Card */}
        <div className="glass" style={{ background: 'var(--bg-glass)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
            📊 Today's Live Attendance Metrics ({todaySummary?.date || 'Today'})
          </h3>

          {todaySummary ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: 'var(--input-bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>TOTAL EMPLOYEES</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>{todaySummary.totalEmployees}</div>
              </div>
              <div style={{ background: 'rgba(34, 197, 94, 0.15)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                <div style={{ fontSize: '11px', color: '#4ade80', fontWeight: 700 }}>PRESENT</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#22c55e' }}>{todaySummary.present}</div>
              </div>
              <div style={{ background: 'rgba(239, 68, 68, 0.15)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                <div style={{ fontSize: '11px', color: '#f87171', fontWeight: 700 }}>ABSENT</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#ef4444' }}>{todaySummary.absent}</div>
              </div>
              <div style={{ background: 'rgba(245, 158, 11, 0.15)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                <div style={{ fontSize: '11px', color: '#fbbf24', fontWeight: 700 }}>ATTENDANCE %</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#f59e0b' }}>{todaySummary.attendancePercentage}%</div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>Loading today metrics...</div>
          )}
        </div>
      </div>

      {/* Recipient Management Section */}
      <div className="glass" style={{ background: 'var(--bg-glass)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
          👥 Notification Recipients Configurator
        </h3>

        <form onSubmit={handleAddRecipient} style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
          <select
            value={newRecipientType}
            onChange={(e) => setNewRecipientType(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--border-glass)', borderRadius: '6px', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
          >
            <option value="ROLE" style={{ background: '#1a1a1c', color: '#f9fafb' }}>By Role (Manager / HR / Account)</option>
            <option value="CUSTOM_NUMBER" style={{ background: '#1a1a1c', color: '#f9fafb' }}>Custom Phone Number</option>
          </select>

          {newRecipientType === 'ROLE' ? (
            <select
              value={newTargetRole}
              onChange={(e) => setNewTargetRole(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid var(--border-glass)', borderRadius: '6px', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
            >
              <option value="MANAGER" style={{ background: '#1a1a1c', color: '#f9fafb' }}>MANAGER</option>
              <option value="HR" style={{ background: '#1a1a1c', color: '#f9fafb' }}>HR</option>
              <option value="ACCOUNT" style={{ background: '#1a1a1c', color: '#f9fafb' }}>ACCOUNT</option>
            </select>
          ) : (
            <input
              type="text"
              placeholder="+917668976193"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid var(--border-glass)', borderRadius: '6px', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none' }}
              required
            />
          )}

          <input
            type="text"
            placeholder="Recipient Label Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--border-glass)', borderRadius: '6px', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none', flex: 1 }}
          />

          <button
            type="submit"
            style={{ padding: '8px 16px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
          >
            Add Recipient
          </button>
        </form>

        {/* Recipients Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)', textAlign: 'left' }}>
              <th style={{ padding: '10px', color: 'var(--text-muted)', background: 'var(--table-header)' }}>Type</th>
              <th style={{ padding: '10px', color: 'var(--text-muted)', background: 'var(--table-header)' }}>Target Role / Number</th>
              <th style={{ padding: '10px', color: 'var(--text-muted)', background: 'var(--table-header)' }}>Label Name</th>
              <th style={{ padding: '10px', color: 'var(--text-muted)', background: 'var(--table-header)' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border-glass)' }}>
                <td style={{ padding: '10px', color: 'var(--text-primary)' }}><b>{r.recipientType}</b></td>
                <td style={{ padding: '10px', color: 'var(--text-primary)' }}>{r.recipientType === 'ROLE' ? r.targetRole : r.phoneNumber}</td>
                <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{r.name}</td>
                <td style={{ padding: '10px' }}>
                  <button
                    onClick={() => handleDeleteRecipient(r.id)}
                    style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 700 }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Audit Log & History Table */}
      <div className="glass" style={{ background: 'var(--bg-glass)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
          📜 Delivery History & Audit Logs
        </h3>

        <div className="custom-scrollbar" style={{ maxHeight: '380px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-glass)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ background: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)', textAlign: 'left' }}>
                <th style={{ padding: '12px 10px', background: 'var(--table-header)', color: 'var(--text-muted)' }}>Date</th>
                <th style={{ padding: '12px 10px', background: 'var(--table-header)', color: 'var(--text-muted)' }}>Recipient</th>
                <th style={{ padding: '12px 10px', background: 'var(--table-header)', color: 'var(--text-muted)' }}>Execution Type</th>
                <th style={{ padding: '12px 10px', background: 'var(--table-header)', color: 'var(--text-muted)' }}>Status</th>
                <th style={{ padding: '12px 10px', background: 'var(--table-header)', color: 'var(--text-muted)' }}>Message WAMID / Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border-glass)' }}>
                  <td style={{ padding: '10px', color: 'var(--text-primary)' }}>{log.businessDate}</td>
                  <td style={{ padding: '10px', color: 'var(--text-primary)' }}>{log.recipientName} ({log.recipientPhone})</td>
                  <td style={{ padding: '10px', color: 'var(--text-primary)' }}><b>{log.executionType}</b></td>
                  <td style={{ padding: '10px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      fontSize: '11px',
                      background: log.status === 'SENT' ? 'rgba(34, 197, 94, 0.2)' : log.status === 'FAILED' ? 'rgba(239, 68, 68, 0.2)' : 'var(--input-bg)',
                      color: log.status === 'SENT' ? '#4ade80' : log.status === 'FAILED' ? '#f87171' : 'var(--text-muted)',
                      border: `1px solid ${log.status === 'SENT' ? 'rgba(34, 197, 94, 0.3)' : log.status === 'FAILED' ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-glass)'}`
                    }}>
                      {log.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {log.messageWamid || log.errorMessage || 'N/A'}
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
