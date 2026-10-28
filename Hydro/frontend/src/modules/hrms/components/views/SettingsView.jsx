import LoadingSpinner from '../LoadingSpinner';
import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

// Helper function to format 24-hr time ('08:30') to 12-hr AM/PM ('08:30 AM')
const formatTo12Hr = (timeStr) => {
  if (!timeStr) return '--:--';
  if (timeStr.includes('AM') || timeStr.includes('PM')) return timeStr;
  const parts = timeStr.split(':');
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1] ? parts[1].trim() : '00';
  if (isNaN(hours)) return timeStr;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const formattedHours = hours < 10 ? `0${hours}` : hours;
  return `${formattedHours}:${minutes} ${ampm}`;
};

// Helper function to guarantee HTML5 input time compliance ('HH:mm')
const ensureTimeFormat = (val, defaultVal = '08:30') => {
  if (!val || typeof val !== 'string') return defaultVal;
  const trimmed = val.trim();
  if (/^\d{1,2}$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    const padded = num < 10 ? `0${num}` : `${num}`;
    return `${padded}:00`;
  }
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const parts = trimmed.split(':');
    const h = parseInt(parts[0], 10);
    const paddedH = h < 10 ? `0${h}` : `${h}`;
    return `${paddedH}:${parts[1]}`;
  }
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed.substring(0, 5);
  }
  return defaultVal;
};

export default function SettingsView() {
  const cachedSettings = api.getCached('/settings');
  const cachedAcks = api.getCached('/acknowledgments');

  const [loading, setLoading] = useState(() => !cachedSettings);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [toast, setToast] = useState(null);
  const [isDirty, setIsDirty] = useState(false);

  // Form State
  const [configVersion, setConfigVersion] = useState(() => cachedSettings?.config_version || 1);
  const [punchInStart, setPunchInStart] = useState(() => ensureTimeFormat(cachedSettings?.punch_in_start, '08:30'));
  const [punchInEnd, setPunchInEnd] = useState(() => ensureTimeFormat(cachedSettings?.punch_in_end, '10:00'));
  const [punchOutTime, setPunchOutTime] = useState(() => ensureTimeFormat(cachedSettings?.punch_out_time, '18:00'));

  const [locationProvider, setLocationProvider] = useState(() => cachedSettings?.location_provider || 'GPS Only');
  const [gpsRatioCount, setGpsRatioCount] = useState(() => Number(cachedSettings?.gps_ratio_count || 1));
  const [cellularRatioCount, setCellularRatioCount] = useState(() => Number(cachedSettings?.cellular_ratio_count || 2));
  const [locationUpdateInterval, setLocationUpdateInterval] = useState(() => cachedSettings?.location_update_interval || '30 Seconds');
  const [customIntervalSeconds, setCustomIntervalSeconds] = useState(45);
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Extended Shift Engine & Threshold State
  const [graceMinutes, setGraceMinutes] = useState(() => cachedSettings?.grace_minutes !== undefined ? Number(cachedSettings.grace_minutes) : 15);
  const [halfDayMinutes, setHalfDayMinutes] = useState(() => cachedSettings?.half_day_minutes !== undefined ? Number(cachedSettings.half_day_minutes) : 240);
  const [fullDayMinutes, setFullDayMinutes] = useState(() => cachedSettings?.full_day_minutes !== undefined ? Number(cachedSettings.full_day_minutes) : 480);
  const [minWorkingMinutes, setMinWorkingMinutes] = useState(() => cachedSettings?.min_working_minutes !== undefined ? Number(cachedSettings.min_working_minutes) : 240);
  const [maxWorkingMinutes, setMaxWorkingMinutes] = useState(() => cachedSettings?.max_working_minutes !== undefined ? Number(cachedSettings.max_working_minutes) : 720);
  const [overtimeThresholdMinutes, setOvertimeThresholdMinutes] = useState(() => cachedSettings?.overtime_threshold_minutes !== undefined ? Number(cachedSettings.overtime_threshold_minutes) : 480);
  const [autoSyncIntervalSeconds, setAutoSyncIntervalSeconds] = useState(() => cachedSettings?.auto_sync_interval_seconds !== undefined ? Number(cachedSettings.auto_sync_interval_seconds) : 30);
  const [allowCrossDay, setAllowCrossDay] = useState(() => cachedSettings?.allow_cross_day !== undefined ? Boolean(cachedSettings.allow_cross_day) : true);

  // Audit Logs State
  const [acknowledgments, setAcknowledgments] = useState(() => Array.isArray(cachedAcks) ? cachedAcks : []);
  const [loadingAck, setLoadingAck] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');

  useEffect(() => {
    fetchSettings();
    fetchAcknowledgments();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchSettings = async () => {
    if (!cachedSettings) setLoading(true);
    try {
      const data = await api.getSettings();
      if (data) {
        setConfigVersion(data.config_version || 1);
        setPunchInStart(ensureTimeFormat(data.punch_in_start, '08:30'));
        setPunchInEnd(ensureTimeFormat(data.punch_in_end, '10:00'));
        setPunchOutTime(ensureTimeFormat(data.punch_out_time, '18:00'));
        setLocationProvider(data.location_provider || 'GPS Only');
        setGpsRatioCount(Number(data.gps_ratio_count || 1));
        setCellularRatioCount(Number(data.cellular_ratio_count || 2));
        
        const rawInterval = data.location_update_interval || '30 Seconds';
        const strInterval = String(rawInterval).trim();
        const presets = ['10 Seconds', '30 Seconds', '60 Seconds', '300 Seconds'];

        if (!presets.includes(strInterval)) {
          setIsCustomMode(true);
          const num = parseInt(strInterval, 10);
          const validNum = (!isNaN(num) && num > 0) ? num : 900;
          setCustomIntervalSeconds(validNum);
          setLocationUpdateInterval(`${validNum} Seconds`);
        } else {
          setIsCustomMode(false);
          setLocationUpdateInterval(strInterval);
        }

        setGraceMinutes(data.grace_minutes !== undefined ? Number(data.grace_minutes) : 15);
        setHalfDayMinutes(data.half_day_minutes !== undefined ? Number(data.half_day_minutes) : 240);
        setFullDayMinutes(data.full_day_minutes !== undefined ? Number(data.full_day_minutes) : 480);
        setMinWorkingMinutes(data.min_working_minutes !== undefined ? Number(data.min_working_minutes) : 240);
        setMaxWorkingMinutes(data.max_working_minutes !== undefined ? Number(data.max_working_minutes) : 720);
        setOvertimeThresholdMinutes(data.overtime_threshold_minutes !== undefined ? Number(data.overtime_threshold_minutes) : 480);
        setAutoSyncIntervalSeconds(data.auto_sync_interval_seconds !== undefined ? Number(data.auto_sync_interval_seconds) : 30);
        setAllowCrossDay(data.allow_cross_day !== undefined ? Boolean(data.allow_cross_day) : true);

        setIsDirty(false);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
      showToast('Failed to load system settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchAcknowledgments = async () => {
    setLoadingAck(true);
    try {
      const data = await api.getAcknowledgments();
      if (Array.isArray(data)) setAcknowledgments(data);
    } catch (err) {
      console.error('Failed to load legal acknowledgments:', err);
    } finally {
      setLoadingAck(false);
    }
  };

  const buildPayload = () => ({
    punch_in_start: punchInStart,
    punch_in_end: punchInEnd,
    punch_out_time: punchOutTime,
    location_provider: locationProvider,
    gps_ratio_count: gpsRatioCount,
    cellular_ratio_count: cellularRatioCount,
    location_update_interval: locationUpdateInterval,
    grace_minutes: graceMinutes,
    half_day_minutes: halfDayMinutes,
    full_day_minutes: fullDayMinutes,
    min_working_minutes: minWorkingMinutes,
    max_working_minutes: maxWorkingMinutes,
    overtime_threshold_minutes: overtimeThresholdMinutes,
    auto_sync_interval_seconds: autoSyncIntervalSeconds,
    allow_cross_day: allowCrossDay
  });

  const handleSaveAttendance = async (e) => {
    if (e) e.preventDefault();
    setSavingAttendance(true);
    try {
      const res = await api.updateSettings(buildPayload());
      if (res && res.config_version) setConfigVersion(res.config_version);
      setIsDirty(false);
      showToast(`Shift policy & thresholds updated (Config v${res?.config_version || configVersion + 1})`);
    } catch (err) {
      showToast(err.message || 'Failed to save attendance settings', 'error');
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleSaveLocation = async (e) => {
    if (e) e.preventDefault();
    setSavingLocation(true);
    try {
      const res = await api.updateSettings(buildPayload());
      if (res && res.config_version) setConfigVersion(res.config_version);
      setIsDirty(false);
      showToast(`Location engine & telemetry protocol updated (Config v${res?.config_version || configVersion + 1})`);
    } catch (err) {
      showToast(err.message || 'Failed to update location settings', 'error');
    } finally {
      setSavingLocation(false);
    }
  };

  const applyPreset = (start, end, out) => {
    setPunchInStart(start);
    setPunchInEnd(end);
    setPunchOutTime(out);
    setIsDirty(true);
  };

  const markDirty = (setter, val) => {
    setter(val);
    setIsDirty(true);
  };

  const filteredAcknowledgments = acknowledgments.filter(item => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      (item.employee_name && item.employee_name.toLowerCase().includes(query)) ||
      (item.employee_email && item.employee_email.toLowerCase().includes(query)) ||
      (item.user_id && item.user_id.toLowerCase().includes(query)) ||
      (item.device_info && item.device_info.toLowerCase().includes(query)) ||
      (item.ip_address && item.ip_address.toLowerCase().includes(query))
    );
    if (!matchesSearch) return false;
    if (activeFilter === 'ACCEPTED') return item.status === 'ACCEPTED';
    if (activeFilter === 'V1') return item.terms_version === 'v1.0';
    return true;
  });

  if (loading) return <LoadingSpinner message="Loading System Settings..." minHeight="400px" />;

    return (
    <div id="settings-view" className="view active custom-scrollbar" style={{ height: '100%', minHeight: 0, flex: 1, overflowY: 'auto', width: '100%', maxWidth: 'none', margin: '0', padding: '20px 24px 40px 24px', boxSizing: 'border-box', fontFamily: 'Inter, system-ui, -apple-system, sans-serif', color: 'var(--text-primary)' }}>
      
      {/* Toast Notification Banner */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '28px',
          right: '32px',
          zIndex: 9999,
          background: toast.type === 'error' ? '#EF4444' : '#10B981',
          color: '#ffffff',
          padding: '14px 24px',
          borderRadius: '12px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)',
          fontWeight: 600,
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <i className={toast.type === 'error' ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-check'} style={{ fontSize: '18px' }}></i>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Status Indicators & Controls */}
      {isDirty && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px', marginBottom: '16px' }}>
          <div style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 700, border: '1px solid rgba(245, 158, 11, 0.3)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }}></span>
            <span>Unsaved Changes</span>
          </div>
        </div>
      )}

      {/* 4 STRIPE-STYLE KPI SUMMARY CARDS IN ONE ROW */}
      <div className="kpi-grid-mobile" style={{ marginBottom: '24px' }}>
        
        {/* Card 1: Attendance Policy */}
        <div className="glass" style={{ background: 'var(--bg-glass)', borderRadius: '16px', padding: '20px 24px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Attendance Shift Policy</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(37, 99, 235, 0.15)', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fa-regular fa-clock" style={{ fontSize: '18px' }}></i>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-primary)' }}>{formatTo12Hr(punchInStart)} - {formatTo12Hr(punchOutTime)}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>Grace Period: {graceMinutes} mins</div>
          </div>
        </div>

        {/* Card 2: Check-In Window */}
        <div className="glass" style={{ background: 'var(--bg-glass)', borderRadius: '16px', padding: '20px 24px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Shift Thresholds</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(37, 99, 235, 0.15)', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fa-solid fa-calendar-check" style={{ fontSize: '18px' }}></i>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-primary)' }}>{halfDayMinutes / 60}h / {fullDayMinutes / 60}h</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>Half Day / Full Day Threshold</div>
          </div>
        </div>

        {/* Card 3: GPS Engine Protocol */}
        <div className="glass" style={{ background: 'var(--bg-glass)', borderRadius: '16px', padding: '20px 24px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GPS & Ratio Protocol</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fa-solid fa-location-crosshairs" style={{ fontSize: '18px' }}></i>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>{locationProvider}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {locationProvider === 'GPS + Cellular' ? `Ratio: ${gpsRatioCount} GPS : ${cellularRatioCount} Cell` : `Interval: ${locationUpdateInterval}`}
            </div>
          </div>
        </div>

        {/* Card 4: Legal Records */}
        <div className="glass" style={{ background: 'var(--bg-glass)', borderRadius: '16px', padding: '20px 24px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Night Shift Protocol</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fa-solid fa-moon" style={{ fontSize: '18px' }}></i>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>{allowCrossDay ? 'Cross-Day Enabled' : 'Day Shift Only'}</div>
            <div style={{ fontSize: '13px', color: '#34d399', fontWeight: 600, marginTop: '4px' }}>Overtime Threshold: {overtimeThresholdMinutes / 60} hrs</div>
          </div>
        </div>

      </div>

      {/* SYMMETRICAL EQUAL-WIDTH 3-COLUMN DESKTOP GRID LAYOUT (1fr 1fr 1fr) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', alignItems: 'stretch' }}>
        
        {/* LEFT COLUMN: SHIFT ENGINE & ATTENDANCE POLICY */}
        <div className="glass" style={{ background: 'var(--bg-glass)', borderRadius: '16px', padding: '28px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-glass)' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'rgba(37, 99, 235, 0.15)', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="fa-regular fa-clock" style={{ fontSize: '20px' }}></i>
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>Universal ShiftEngine</h2>
                <p style={{ margin: '3px 0 0 0', fontSize: '14px', color: 'var(--text-muted)' }}>Configure shift windows, grace period & overtime rules</p>
              </div>
            </div>

            {/* Segmented Shift Presets */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
                Shift Policy Presets
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => applyPreset('08:30', '10:00', '18:00')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '20px',
                    border: punchInStart === '08:30' ? '1px solid #2563EB' : '1px solid var(--border-glass)',
                    background: punchInStart === '08:30' ? '#2563EB' : 'var(--input-bg)',
                    color: punchInStart === '08:30' ? '#FFFFFF' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Day Shift (08:30 AM)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('22:00', '23:30', '06:00')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '20px',
                    border: punchInStart === '22:00' ? '1px solid #2563EB' : '1px solid var(--border-glass)',
                    background: punchInStart === '22:00' ? '#2563EB' : 'var(--input-bg)',
                    color: punchInStart === '22:00' ? '#FFFFFF' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Night Shift (10:00 PM)
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveAttendance} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Field 1: Punch-In Start & End */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Shift Start
                  </label>
                  <input
                    type="time"
                    value={punchInStart}
                    onChange={(e) => markDirty(setPunchInStart, e.target.value)}
                    style={{ width: '100%', height: '42px', padding: '0 12px', borderRadius: '10px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', colorScheme: 'dark', fontSize: '14px', fontWeight: 500, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Shift Target Out
                  </label>
                  <input
                    type="time"
                    value={punchOutTime}
                    onChange={(e) => markDirty(setPunchOutTime, e.target.value)}
                    style={{ width: '100%', height: '42px', padding: '0 12px', borderRadius: '10px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', colorScheme: 'dark', fontSize: '14px', fontWeight: 500, boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Grace Period & Overtime Threshold */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Grace Time (Minutes)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={graceMinutes}
                    onChange={(e) => markDirty(setGraceMinutes, parseInt(e.target.value, 10) || 0)}
                    style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Overtime Threshold (Mins)
                  </label>
                  <input
                    type="number"
                    min="60"
                    value={overtimeThresholdMinutes}
                    onChange={(e) => markDirty(setOvertimeThresholdMinutes, parseInt(e.target.value, 10) || 480)}
                    style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Half Day & Full Day Minutes */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Half Day (Mins)
                  </label>
                  <input
                    type="number"
                    min="60"
                    value={halfDayMinutes}
                    onChange={(e) => markDirty(setHalfDayMinutes, parseInt(e.target.value, 10) || 240)}
                    style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Full Day Target (Mins)
                  </label>
                  <input
                    type="number"
                    min="120"
                    value={fullDayMinutes}
                    onChange={(e) => markDirty(setFullDayMinutes, parseInt(e.target.value, 10) || 480)}
                    style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Cross-Day Shift Toggle */}
              <div style={{ padding: '12px 14px', background: 'var(--input-bg)', borderRadius: '10px', border: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Allow Cross-Day / Night Shifts</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Supports shifts crossing midnight (e.g. 10 PM to 6 AM)</div>
                </div>
                <input
                  type="checkbox"
                  checked={allowCrossDay}
                  onChange={(e) => markDirty(setAllowCrossDay, e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2563EB' }}
                />
              </div>

              {/* Save Button */}
              <button
                type="submit"
                disabled={savingAttendance || loading}
                style={{
                  height: '46px',
                  borderRadius: '12px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: savingAttendance ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  marginTop: '6px'
                }}
              >
                {savingAttendance ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-floppy-disk"></i>}
                <span>{savingAttendance ? 'Saving Engine...' : `Save Shift Rules (v${configVersion})`}</span>
              </button>

            </form>
          </div>
        </div>

        {/* CENTER COLUMN: GPS & RATIO SETTINGS */}
        <div className="glass" style={{ background: 'var(--bg-glass)', borderRadius: '16px', padding: '28px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-glass)' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="fa-solid fa-location-crosshairs" style={{ fontSize: '20px' }}></i>
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>GPS & Telemetry Engine</h2>
                <p style={{ margin: '3px 0 0 0', fontSize: '14px', color: 'var(--text-muted)' }}>Configure provider modes, ping ratios & update frequency</p>
              </div>
            </div>

            <form onSubmit={handleSaveLocation} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Selectable Option Cards for Provider */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  Location Provider Protocol
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { val: 'GPS Only', title: 'GPS Only', desc: 'Strict High Accuracy (First ping strictly GPS)' },
                    { val: 'Cellular Only', title: 'Cellular Only', desc: 'Network tower location (Maximum battery saving)' },
                    { val: 'GPS Preferred', title: 'GPS Preferred', desc: 'Balanced battery efficiency & accuracy' },
                    { val: 'GPS + Cellular', title: 'GPS + Cellular (Ratio Based Sequence)', desc: 'Interleaved ratio sequence after Clock In' }
                  ].map((p) => {
                    const isSelected = locationProvider === p.val;
                    return (
                      <div
                        key={p.val}
                        onClick={() => markDirty(setLocationProvider, p.val)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '10px',
                          border: isSelected ? '2px solid #2563EB' : '1px solid var(--border-glass)',
                          background: isSelected ? 'rgba(37, 99, 235, 0.15)' : 'var(--input-bg)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: isSelected ? '#60a5fa' : 'var(--text-primary)' }}>
                            {p.title}
                          </div>
                          <div style={{ fontSize: '11px', color: isSelected ? 'var(--text-secondary)' : 'var(--text-muted)', marginTop: '1px' }}>{p.desc}</div>
                        </div>
                        <div style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          border: isSelected ? '5px solid #2563EB' : '2px solid var(--border-glass)',
                          background: isSelected ? '#FFFFFF' : 'transparent',
                          flexShrink: 0
                        }}></div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Custom Ping Ratio Sequence (Visible when GPS + Cellular is selected) */}
              {locationProvider === 'GPS + Cellular' && (
                <div style={{ padding: '14px', background: 'var(--input-bg)', borderRadius: '12px', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Custom Ping Ratio Sequence</h4>
                    <span style={{ fontSize: '11px', fontWeight: 700, background: 'rgba(37, 99, 235, 0.25)', color: '#60a5fa', padding: '2px 8px', borderRadius: '10px' }}>Active</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '2px' }}>
                        GPS Pings Count
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={gpsRatioCount}
                        onChange={(e) => markDirty(setGpsRatioCount, Math.max(1, parseInt(e.target.value, 10) || 1))}
                        style={{ width: '100%', height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '2px' }}>
                        Cellular Pings Count
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={cellularRatioCount}
                        onChange={(e) => markDirty(setCellularRatioCount, Math.max(1, parseInt(e.target.value, 10) || 1))}
                        style={{ width: '100%', height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--border-glass)', background: 'var(--bg-dark)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700, boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  {/* Execution Preview Box */}
                  <div style={{ padding: '8px 10px', background: 'rgba(37, 99, 235, 0.12)', borderRadius: '8px', border: '1px solid rgba(37, 99, 235, 0.25)', fontSize: '11px', color: '#93c5fd', lineHeight: 1.4 }}>
                    💡 <strong>Execution Preview:</strong> Clock In ➔ <strong>Strict GPS Anchor</strong> ➔ {gpsRatioCount} GPS ➔ {cellularRatioCount} Cell ➔ Repeat
                  </div>
                </div>
              )}

              {/* Segmented Control for Update Interval */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Location Update Interval
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(60px, 1fr))', gap: '4px', background: 'var(--input-bg)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-glass)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  {[
                    { val: '10 Seconds', label: '10s', badge: 'Ultra' },
                    { val: '30 Seconds', label: '30s', badge: 'Realtime' },
                    { val: '60 Seconds', label: '60s', badge: 'Standard' },
                    { val: '300 Seconds', label: '300s', badge: '5 Min' },
                    { val: 'Custom', label: 'Custom', badge: 'Set Custom' }
                  ].map((i) => {
                    const isPresetSelected = i.val === 'Custom' 
                      ? isCustomMode 
                      : (!isCustomMode && locationUpdateInterval === i.val);

                    return (
                      <button
                        key={i.val}
                        type="button"
                        onClick={() => {
                          if (i.val === 'Custom') {
                            setIsCustomMode(true);
                            markDirty(setLocationUpdateInterval, `${customIntervalSeconds} Seconds`);
                          } else {
                            setIsCustomMode(false);
                            markDirty(setLocationUpdateInterval, i.val);
                          }
                        }}
                        style={{
                          padding: '6px 2px',
                          borderRadius: '6px',
                          border: 'none',
                          background: isPresetSelected ? 'rgba(37, 99, 235, 0.3)' : 'transparent',
                          boxShadow: isPresetSelected ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                          cursor: 'pointer',
                          textAlign: 'center'
                        }}
                      >
                        <div style={{ fontSize: '12px', fontWeight: 700, color: isPresetSelected ? '#60a5fa' : 'var(--text-secondary)' }}>
                          {i.label}
                        </div>
                        <div style={{ fontSize: '9px', fontWeight: 600, color: isPresetSelected ? '#60a5fa' : 'var(--text-muted)' }}>
                          {i.badge}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Interactive Custom Input Box (Renders when Custom Mode is Active) */}
                {isCustomMode && (
                  <div style={{ marginTop: '12px', padding: '12px', background: 'var(--input-bg)', borderRadius: '10px', border: '1px solid var(--border-glass)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Enter Custom Interval (Seconds)
                      </label>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#60a5fa', background: 'rgba(37, 99, 235, 0.25)', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(37, 99, 235, 0.3)' }}>
                        {(() => {
                          const num = parseInt(customIntervalSeconds, 10) || 30;
                          if (num >= 60) {
                            const mins = (num / 60).toFixed(1).replace('.0', '');
                            return `${num}s (${mins} Min${mins === '1' ? '' : 's'})`;
                          }
                          return `${num}s`;
                        })()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input 
                        type="number"
                        min="1"
                        max="3600"
                        value={customIntervalSeconds}
                        onChange={(e) => {
                          const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                          setCustomIntervalSeconds(val);
                          markDirty(setLocationUpdateInterval, `${val} Seconds`);
                        }}
                        placeholder="e.g. 15, 45, 120, 600"
                        style={{
                          flex: 1,
                          height: '38px',
                          padding: '0 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-glass)',
                          background: 'var(--bg-dark)',
                          color: 'var(--text-primary)',
                          fontSize: '14px',
                          fontWeight: 700,
                          outline: 'none'
                        }}
                      />
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>Seconds</span>
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#fbbf24', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <i className="fa-solid fa-circle-info"></i>
                      <span>Click green <strong>"Update Protocol"</strong> button below to save {customIntervalSeconds}s to database.</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Save Button */}
              <button
                type="submit"
                disabled={savingLocation || loading}
                style={{
                  height: '46px',
                  borderRadius: '12px',
                  background: '#10B981',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: savingLocation ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  marginTop: '6px'
                }}
              >
                {savingLocation ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-satellite-dish"></i>}
                <span>{savingLocation ? 'Updating Protocol...' : `Update Protocol (v${configVersion})`}</span>
              </button>

            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: LEGAL COMPLIANCE */}
        <div className="glass" style={{ background: 'var(--bg-glass)', borderRadius: '16px', padding: '28px', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-glass)' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="fa-solid fa-shield-halved" style={{ fontSize: '20px' }}></i>
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>Legal Compliance</h2>
                <p style={{ margin: '3px 0 0 0', fontSize: '14px', color: 'var(--text-muted)' }}>Signed privacy disclosures & audit logs</p>
              </div>
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div style={{ position: 'relative' }}>
                <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '14px' }}></i>
                <input
                  type="text"
                  placeholder="Search Employee, ID, IP..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    height: '42px',
                    padding: '0 14px 0 38px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-glass)',
                    fontSize: '13px',
                    background: 'var(--input-bg)',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', background: 'var(--input-bg)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-glass)', gap: '2px' }}>
                  <button
                    type="button"
                    onClick={() => setActiveFilter('ALL')}
                    style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: activeFilter === 'ALL' ? 'rgba(37, 99, 235, 0.3)' : 'transparent', color: activeFilter === 'ALL' ? '#60a5fa' : 'var(--text-muted)', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                  >
                    All ({acknowledgments.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveFilter('ACCEPTED')}
                    style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: activeFilter === 'ACCEPTED' ? 'rgba(34, 197, 94, 0.3)' : 'transparent', color: activeFilter === 'ACCEPTED' ? '#4ade80' : 'var(--text-muted)', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                  >
                    Accepted
                  </button>
                </div>

                <button
                  type="button"
                  onClick={fetchAcknowledgments}
                  style={{ padding: '6px 12px', borderRadius: '8px', background: 'var(--input-bg)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', fontWeight: 600, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <i className={loadingAck ? 'fa-solid fa-arrows-rotate fa-spin' : 'fa-solid fa-arrows-rotate'}></i>
                  <span>Sync</span>
                </button>
              </div>
            </div>

            {/* Audit Log Content Container */}
            <div className="custom-scrollbar" style={{ maxHeight: '380px', overflowY: 'auto', borderRadius: '12px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)' }}>
              {loadingAck ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '22px', color: '#c084fc', marginBottom: '8px', display: 'block' }}></i>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>Fetching audit records...</span>
                </div>
              ) : filteredAcknowledgments.length === 0 ? (
                /* Enterprise Empty State */
                <div style={{ padding: '36px 20px', textAlign: 'center' }}>
                  <div style={{ width: '52px', height: '52px', borderRadius: '16px', background: 'var(--bg-glass)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto' }}>
                    <i className="fa-solid fa-file-signature" style={{ fontSize: '22px' }}></i>
                  </div>
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>No Audit Records</h4>
                  <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Signed privacy disclosures and legal agreements will appear here once employees complete them.
                  </p>
                  <button
                    type="button"
                    onClick={fetchAcknowledgments}
                    style={{ marginTop: '16px', padding: '8px 16px', borderRadius: '8px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Refresh Records
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {filteredAcknowledgments.map((item) => (
                    <div key={item.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>{item.employee_name}</span>
                        <span style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
                          ✓ {item.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{item.employee_email} ({item.user_id})</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {new Date(item.accepted_at).toLocaleString()} • IP: {item.ip_address}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

      </div>

      {/* FLOATING STICKY SAVE BAR */}
      {isDirty && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9000,
          background: 'var(--bg-glass)',
          border: '1px solid var(--border-glass)',
          color: 'var(--text-primary)',
          padding: '14px 28px',
          borderRadius: '16px',
          boxShadow: '0 10px 35px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          animation: 'slideUp 0.3s ease-out'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#F59E0B' }}></span>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Unsaved changes (Will create Config v{configVersion + 1})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={fetchSettings}
              style={{ background: 'transparent', border: '1px solid var(--border-glass)', color: 'var(--text-muted)', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleSaveAttendance}
              style={{ background: '#2563EB', border: 'none', color: '#FFFFFF', padding: '8px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(37,99,235,0.4)' }}
            >
              Save & Increment Version
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
