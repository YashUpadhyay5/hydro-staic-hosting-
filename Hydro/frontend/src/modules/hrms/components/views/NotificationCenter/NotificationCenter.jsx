import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { api } from '../../../services/api';

const NotificationCenter = () => {
  const cachedHistory = api.getCached('/notifications/history');
  const cachedStats = api.getCached('/notifications/stats');
  const cachedLogs = api.getCached('/notifications/logs');
  const cachedEmployees = api.getCached('/employees');

  const [stats, setStats] = useState(() => (cachedStats?.success && cachedStats?.data) ? cachedStats.data : { 
    totalNotifications: 0, 
    sentNotifications: 0, 
    failedNotifications: 0, 
    pendingNotifications: 0, 
    totalDevices: 0 
  });
  const [history, setHistory] = useState(() => (cachedHistory?.success && Array.isArray(cachedHistory?.data)) ? cachedHistory.data : []);
  const [logs, setLogs] = useState(() => (cachedLogs?.success && Array.isArray(cachedLogs?.data)) ? cachedLogs.data : []);
  const [employees, setEmployees] = useState(() => Array.isArray(cachedEmployees) ? cachedEmployees : (cachedEmployees?.data || []));
  const [loading, setLoading] = useState(() => !cachedHistory);
  const [tabIndex, setTabIndex] = useState(0); // 0 = History, 1 = Detailed Logs

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL'); // ALL, TODAY, WEEK, MONTH
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Developer Test Panel State
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [testData, setTestData] = useState({
    employeeId: '',
    title: '',
    body: ''
  });
  const [sendingStatus, setSendingStatus] = useState(''); // '', 'sending', 'success', 'failed'
  const [testResult, setTestResult] = useState(null);
  const [fabHovered, setFabHovered] = useState(false);

  const token = localStorage.getItem('adminToken');
  const headers = { Authorization: `Bearer ${token}` };

  const getApiUrl = (endpoint) => {
    return `/api${endpoint}`;
  };

  const fetchStats = async () => {
    try {
      const res = await api.getNotificationStats();
      if (res && res.success) {
        setStats(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const fetchHistory = async () => {
    if (!history.length) setLoading(true);
    try {
      const res = await api.getNotificationHistory();
      if (res && res.success) {
        setHistory(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    if (!logs.length) setLoading(true);
    try {
      const res = await api.getNotificationLogs();
      if (res && res.success) {
        setLogs(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const res = await api.getEmployees();
      if (Array.isArray(res)) {
        setEmployees(res);
      } else if (res && Array.isArray(res.data)) {
        setEmployees(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch employees:', err);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchHistory();
    fetchEmployees();
  }, []);

  const handleTabChange = (index) => {
    setTabIndex(index);
    setCurrentPage(1);
    if (index === 0) fetchHistory();
    if (index === 1) fetchLogs();
  };

  // Notification sending functions for test panel
  const handleSendNotification = async () => {
    if (!testData.employeeId) {
      alert('Please select an employee or choose "Send to All Employees".');
      return;
    }
    if (!testData.title || !testData.body) {
      alert('Please fill out both Title and Message.');
      return;
    }

    setSendingStatus('sending');
    setTestResult(null);
    try {
      if (testData.employeeId === 'ALL_EMPLOYEES') {
        const promises = employees.map(emp => 
          axios.post(getApiUrl('/notifications/send'), {
            employeeId: emp.id,
            title: testData.title,
            body: testData.body,
            priority: 'high',
            channel: 'Attendance'
          }, { headers }).catch(err => ({ error: true, empName: emp.name, message: err.message }))
        );

        const results = await Promise.all(promises);
        const failures = results.filter(r => r && r.error);

        setSendingStatus(failures.length === 0 ? 'success' : 'failed');
        setTestResult({
          message: `Broadcast complete for ${employees.length} employees`,
          successCount: employees.length - failures.length,
          failureCount: failures.length,
          details: results
        });
      } else {
        const endpoint = '/notifications/send';
        const payload = {
          employeeId: testData.employeeId,
          title: testData.title,
          body: testData.body,
          priority: 'high',
          channel: 'Attendance'
        };

        const res = await axios.post(getApiUrl(endpoint), payload, { headers });
        setSendingStatus('success');
        setTestResult(res.data);
      }

      fetchStats();
      if (tabIndex === 0) fetchHistory();
      if (tabIndex === 1) fetchLogs();
    } catch (err) {
      setSendingStatus('failed');
      setTestResult(err.response?.data || { error: 'Unknown server error occured' });
    }
  };

  // Filter and search logic
  const getFilteredData = () => {
    const dataList = tabIndex === 0 ? history : logs;
    return dataList.filter(item => {
      // Search term
      const titleMatch = item.title ? item.title.toLowerCase().includes(searchTerm.toLowerCase()) : false;
      const bodyMatch = item.body ? item.body.toLowerCase().includes(searchTerm.toLowerCase()) : false;
      const docMatch = item.documentId ? item.documentId.toLowerCase().includes(searchTerm.toLowerCase()) : false;
      const idMatch = item.id ? item.id.toLowerCase().includes(searchTerm.toLowerCase()) : false;
      const searchMatch = searchTerm === '' || titleMatch || bodyMatch || docMatch || idMatch;

      // Status Filter
      const statusMatch = statusFilter === 'ALL' || item.status === statusFilter;

      // Date Filter
      let dateMatch = true;
      if (dateFilter !== 'ALL') {
        const itemDate = new Date(item.createdAt || item.sentAt || Date.now());
        const today = new Date();
        if (dateFilter === 'TODAY') {
          dateMatch = itemDate.toDateString() === today.toDateString();
        } else if (dateFilter === 'WEEK') {
          const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateMatch = itemDate >= oneWeekAgo;
        } else if (dateFilter === 'MONTH') {
          const oneMonthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateMatch = itemDate >= oneMonthAgo;
        }
      }

      return searchMatch && statusMatch && dateMatch;
    });
  };

  const filteredData = getFilteredData();
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Custom Chart Visualization (pure SVG based)
  const totalSent = stats.sentNotifications || 0;
  const totalFailed = stats.failedNotifications || 0;
  const successRate = totalSent + totalFailed > 0 ? Math.round((totalSent / (totalSent + totalFailed)) * 100) : 100;

  return (
    <div style={{ minHeight: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', color: 'var(--text-primary)', animation: 'fadeIn 0.5s ease-out' }}>

      {/* KPI Cards Grid */}
      <div className="stats-grid kpi-grid-mobile">
        
        <div className="stat-card glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#3b82f622', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            <i className="fa-solid fa-bell"></i>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', fontWeight: '600', margin: 0 }}>Total Sent</p>
            <h3 style={{ fontSize: '24px', fontWeight: '800', margin: '4px 0 0' }}>{stats.sentNotifications}</h3>
          </div>
        </div>

        <div className="stat-card glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#ef444422', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            <i className="fa-solid fa-circle-xmark"></i>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', fontWeight: '600', margin: 0 }}>Failed</p>
            <h3 style={{ fontSize: '24px', fontWeight: '800', margin: '4px 0 0' }}>{stats.failedNotifications}</h3>
          </div>
        </div>

        <div className="stat-card glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#f59e0b22', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            <i className="fa-solid fa-clock"></i>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', fontWeight: '600', margin: 0 }}>Pending</p>
            <h3 style={{ fontSize: '24px', fontWeight: '800', margin: '4px 0 0' }}>{stats.pendingNotifications}</h3>
          </div>
        </div>

        <div className="stat-card glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#10b98122', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            <i className="fa-solid fa-clipboard-list"></i>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', fontWeight: '600', margin: 0 }}>Total Campaigns</p>
            <h3 style={{ fontSize: '24px', fontWeight: '800', margin: '4px 0 0' }}>{stats.totalNotifications}</h3>
          </div>
        </div>

        <div className="stat-card glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#8b5cf622', color: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            <i className="fa-solid fa-mobile-screen"></i>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', fontWeight: '600', margin: 0 }}>Total Devices</p>
            <h3 style={{ fontSize: '24px', fontWeight: '800', margin: '4px 0 0' }}>{stats.totalDevices}</h3>
          </div>
        </div>

      </div>

      {/* Chart Block */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        
        {/* Success Rate SVG Gauge */}
        <div className="glass" style={{ padding: '24px', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
          <h4 style={{ margin: 0, width: '100%', fontSize: '16px', fontWeight: '700' }}>Delivery Success Rate</h4>
          <div style={{ position: 'relative', width: '150px', height: '150px' }}>
            <svg width="150" height="150" viewBox="0 0 150 150">
              <circle cx="75" cy="75" r="60" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
              <circle 
                cx="75" cy="75" r="60" fill="none" stroke="var(--primary-color)" strokeWidth="12" 
                strokeDasharray={377} strokeDashoffset={377 - (377 * successRate) / 100}
                strokeLinecap="round" transform="rotate(-90 75 75)"
                style={{ transition: 'stroke-dashoffset 0.8s ease-in-out' }}
              />
            </svg>
            <div style={{ position: 'absolute', top: 0, left: 0, width: '150px', height: '150px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '28px', fontWeight: '800' }}>{successRate}%</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Delivered</span>
            </div>
          </div>
        </div>

        {/* Custom Sparkline Chart */}
        <div className="glass" style={{ padding: '24px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>Delivery Volume</h4>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', height: '100px', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '5px' }}>
            {history.slice(0, 7).reverse().map((item, idx) => {
              const heightPct = Math.min(100, Math.max(15, (item.recipientCount || 1) * 15));
              return (
                <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <div 
                    style={{ 
                      width: '100%', 
                      height: `${heightPct}px`, 
                      background: 'var(--primary-gradient)', 
                      borderRadius: '4px 4px 0 0',
                      transition: 'height 0.5s ease'
                    }} 
                    title={`${item.recipientCount} recipients`}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '35px', textAlign: 'center' }}>
                    {new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              );
            })}
            {history.length === 0 && (
              <div style={{ width: '100%', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>No campaigns to visualize</div>
            )}
          </div>
        </div>

      </div>

      {/* Main Tabs and Grid Panel */}
      <div className="glass" style={{ borderRadius: '16px', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        
        {/* Tab Headers & Action Button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)', padding: '6px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex' }}>
            <button 
              onClick={() => handleTabChange(0)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: tabIndex === 0 ? '3px solid var(--primary-color)' : '3px solid transparent',
                color: tabIndex === 0 ? 'var(--primary-color)' : 'var(--text-muted)',
                padding: '12px 20px',
                fontSize: '15px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Campaign History
            </button>
            <button 
              onClick={() => handleTabChange(1)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: tabIndex === 1 ? '3px solid var(--primary-color)' : '3px solid transparent',
                color: tabIndex === 1 ? 'var(--primary-color)' : 'var(--text-muted)',
                padding: '12px 20px',
                fontSize: '15px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Detailed Device Logs
            </button>
          </div>

          <button 
            onClick={() => setTestPanelOpen(true)}
            style={{
              background: 'linear-gradient(135deg, #4f46e5, #3730a3)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              fontWeight: '700',
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '6px',
              boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
              transition: 'all 0.2s ease'
            }}
          >
            <i className="fa-solid fa-paper-plane"></i>
            <span>Send Notification</span>
          </button>
        </div>

        {/* Filter Toolbar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', padding: '20px', background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          
          <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
            <input 
              type="text" 
              placeholder="Search notifications..."
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              style={{
                width: '100%',
                padding: '10px 12px 10px 35px',
                background: 'rgba(0,0,0,0.1)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                outline: 'none'
              }}
            />
            <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }}></i>
          </div>

          <select 
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
            style={{
              padding: '10px 15px',
              background: 'rgba(0,0,0,0.1)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="ALL">All Statuses</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
            <option value="PENDING">Pending</option>
          </select>

          <select 
            value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setCurrentPage(1); }}
            style={{
              padding: '10px 15px',
              background: 'rgba(0,0,0,0.1)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="ALL">All Time</option>
            <option value="TODAY">Today</option>
            <option value="WEEK">This Week</option>
            <option value="MONTH">This Month</option>
          </select>

        </div>

        {/* Data Table */}
        <div className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', padding: 0, border: 'none', borderRadius: 0, boxShadow: 'none', background: 'transparent' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: '24px', marginRight: '8px' }}></i> Loading data...
            </div>
          ) : (
            <>
            <div className="desktop-table-view">
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--table-header, #fafafb)' }}>
                <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)' }}>
                  {tabIndex === 0 ? (
                    <>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Campaign Title</th>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Body Snippet</th>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Channel</th>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Recipients</th>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Status</th>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Sent Time</th>
                    </>
                  ) : (
                    <>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Firebase Message ID</th>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Employee</th>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Status</th>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Error Details</th>
                      <th style={{ padding: '15px 20px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '13px' }}>Time</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    {tabIndex === 0 ? (
                      <>
                        <td style={{ padding: '15px 20px', fontWeight: '700' }}>
                          <div>{item.title}</div>
                          {item.recipient?.name && (
                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginTop: '2px' }}>
                              Target: <span style={{ color: '#4f46e5' }}>{item.recipient.name}</span>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '15px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>{item.body ? item.body.substring(0, 50) : '-'}</td>
                        <td style={{ padding: '15px 20px' }}>
                          <span style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}>
                            {item.channel}
                          </span>
                        </td>
                        <td style={{ padding: '15px 20px', fontSize: '13px' }}>
                          {(() => {
                            let recLabel = item.recipientName;
                            if (!recLabel && item.recipient?.name) {
                              recLabel = `${item.recipient.name} (${item.recipient.empCode || item.recipient.id})`;
                            }
                            if (!recLabel && item.targetId) {
                              const found = (employees || []).find(e => e.id === item.targetId || e.empCode === item.targetId);
                              if (found) recLabel = `${found.name} (${found.empCode || found.id})`;
                              else if (item.target === 'ALL') recLabel = 'All Employees';
                              else recLabel = String(item.targetId);
                            }
                            if (!recLabel) recLabel = item.target === 'ALL' ? 'All Employees' : 'System';

                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <i className="fa-solid fa-user" style={{ fontSize: '11px', color: '#6366f1' }}></i>
                                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{recLabel}</span>
                                </div>
                                {item.breachDetails && (
                                  <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 600 }}>
                                    📍 {item.breachDetails.distanceMeters ? `${(item.breachDetails.distanceMeters / 1000).toFixed(1)} km outside ` : 'Outside '}{item.breachDetails.nearestGeofence}
                                  </div>
                                )}
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  Delivery: <span style={{ color: '#10b981', fontWeight: 700 }}>{item.successCount || 0}</span> / <span style={{ color: '#ef4444', fontWeight: 700 }}>{item.failureCount || 0}</span> ({item.recipientCount || 0})
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ padding: '15px 20px' }}>
                          <span 
                            style={{ 
                              padding: '4px 8px', 
                              borderRadius: '6px', 
                              fontSize: '11px', 
                              fontWeight: '700',
                              background: item.status === 'SENT' ? '#10b98122' : item.status === 'FAILED' ? '#ef444422' : '#f59e0b22',
                              color: item.status === 'SENT' ? '#10b981' : item.status === 'FAILED' ? '#ef4444' : '#f59e0b'
                            }}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td style={{ padding: '15px 20px', fontSize: '13px', color: 'var(--text-muted)' }}>
                          {item.sentTime ? new Date(item.sentTime).toLocaleString() : new Date(item.createdAt).toLocaleString()}
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '15px 20px', fontFamily: 'monospace', fontSize: '12px' }}>{item.firebaseMessageId || 'N/A'}</td>
                        <td style={{ padding: '15px 20px', fontWeight: '600' }}>
                          {(() => {
                            const emp = item.employee || (employees || []).find(e => e.id === item.employeeId || e.empCode === item.employeeId);
                            if (emp) {
                              return (
                                <div>
                                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{emp.name}</span>
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>
                                    {emp.empCode || item.employeeId} {emp.department ? `• ${emp.department}` : ''}
                                  </span>
                                </div>
                              );
                            }
                            return item.employeeId || 'System';
                          })()}
                        </td>
                        <td style={{ padding: '15px 20px' }}>
                          <span 
                            style={{ 
                              padding: '4px 8px', 
                              borderRadius: '6px', 
                              fontSize: '11px', 
                              fontWeight: '700',
                              background: item.status === 'SENT' ? '#10b98122' : '#ef444422',
                              color: item.status === 'SENT' ? '#10b981' : '#ef4444'
                            }}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td style={{ padding: '15px 20px', color: '#ef4444', fontSize: '12px' }}>{item.error || 'None'}</td>
                        <td style={{ padding: '15px 20px', fontSize: '13px', color: 'var(--text-muted)' }}>
                          {new Date(item.createdAt).toLocaleString()}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {paginatedData.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No records found matching filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>

            {/* Mobile Touch Cards for Notifications */}
            <div className="mobile-cards-only" style={{ padding: '12px' }}>
              {paginatedData.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No records found matching filters.
                </div>
              ) : (
                paginatedData.map((item, idx) => {
                  if (tabIndex === 0) {
                    let recLabel = item.recipientName;
                    if (!recLabel && item.recipient?.name) {
                      recLabel = `${item.recipient.name} (${item.recipient.empCode || item.recipient.id})`;
                    }
                    if (!recLabel && item.targetId) {
                      const found = (employees || []).find(e => e.id === item.targetId || e.empCode === item.targetId);
                      if (found) recLabel = `${found.name} (${found.empCode || found.id})`;
                      else if (item.target === 'ALL') recLabel = 'All Employees';
                      else recLabel = String(item.targetId);
                    }
                    if (!recLabel) recLabel = item.target === 'ALL' ? 'All Employees' : 'System';

                    return (
                      <div key={idx} className="mobile-record-card">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</h4>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: item.status === 'SENT' ? '#10b98122' : item.status === 'FAILED' ? '#ef444422' : '#f59e0b22',
                            color: item.status === 'SENT' ? '#10b981' : item.status === 'FAILED' ? '#ef4444' : '#f59e0b'
                          }}>
                            {item.status}
                          </span>
                        </div>

                        <div>
                          <span style={{
                            background: '#e0f2fe',
                            color: '#0284c7',
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <i className="fa-solid fa-user" style={{ fontSize: '9px' }}></i> {recLabel}
                          </span>
                        </div>

                        {item.body && (
                          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                            {item.body}
                          </p>
                        )}

                        {item.breachDetails && (
                          <div style={{ fontSize: '11.5px', color: '#d97706', fontWeight: 600 }}>
                            📍 {item.breachDetails.distanceMeters ? `${(item.breachDetails.distanceMeters / 1000).toFixed(1)} km outside ` : 'Outside '}{item.breachDetails.nearestGeofence}
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)', paddingTop: '6px', borderTop: '1px solid var(--border-glass, #e2e8f0)' }}>
                          <span>Channel: <b>{item.channel}</b></span>
                          <span>{item.sentTime ? new Date(item.sentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    );
                  } else {
                    const emp = item.employee || (employees || []).find(e => e.id === item.employeeId || e.empCode === item.employeeId);
                    return (
                      <div key={idx} className="mobile-record-card">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{emp?.name || item.employeeId || 'System'}</h4>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{emp?.empCode || item.employeeId}</span>
                          </div>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: item.status === 'SENT' ? '#10b98122' : '#ef444422',
                            color: item.status === 'SENT' ? '#10b981' : '#ef4444'
                          }}>
                            {item.status}
                          </span>
                        </div>

                        {item.firebaseMessageId && (
                          <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                            FCM: {item.firebaseMessageId}
                          </div>
                        )}

                        {item.error && item.error !== 'None' && (
                          <div style={{ fontSize: '11.5px', color: '#ef4444' }}>
                            Error: {item.error}
                          </div>
                        )}

                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>
                          {new Date(item.createdAt).toLocaleString()}
                        </div>
                      </div>
                    );
                  }
                })
              )}
            </div>
            </>
          )}
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', borderTop: '1px solid var(--border-color)', flexShrink: 0, background: 'rgba(255,255,255,0.02)' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Showing Page {currentPage} of {totalPages} ({filteredData.length} records)
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-color)',
                  color: currentPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                }}
              >
                Previous
              </button>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-color)',
                  color: currentPage === totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Developer Test Panel Modal */}
      {testPanelOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="glass" style={{ width: '90%', maxWidth: '500px', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border-color)', animation: 'scaleUp 0.3s ease-out' }}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>Send Test Notification</h3>
              <button 
                onClick={() => setTestPanelOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            {/* Modal Scroll Content */}
            <div style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '5px', fontWeight: '600' }}>Select Employee *</label>
                <select 
                  value={testData.employeeId}
                  onChange={e => setTestData({...testData, employeeId: e.target.value})}
                  style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none' }}
                >
                  <option value="">-- Choose Target Employee --</option>
                  <option value="ALL_EMPLOYEES" style={{ fontWeight: 'bold', color: '#4f46e5' }}>📢 Send to All Employees (Broadcast)</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name} ({emp.empCode || emp.id})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '5px', fontWeight: '600' }}>Notification Title *</label>
                <input 
                  type="text" 
                  value={testData.title}
                  onChange={e => setTestData({...testData, title: e.target.value})}
                  placeholder="e.g. Attendance Check"
                  style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '5px', fontWeight: '600' }}>Message Body *</label>
                <textarea 
                  value={testData.body}
                  onChange={e => setTestData({...testData, body: e.target.value})}
                  placeholder="Enter the push notification message text here..."
                  rows={4}
                  style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', resize: 'vertical' }}
                />
              </div>

              {/* Status Real-time Feedbacks */}
              {sendingStatus && (
                <div style={{
                  padding: '12px 15px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  background: sendingStatus === 'sending' ? '#3b82f622' : sendingStatus === 'success' ? '#10b98122' : '#ef444422',
                  color: sendingStatus === 'sending' ? '#3b82f6' : sendingStatus === 'success' ? '#10b981' : '#ef4444',
                  border: `1px solid ${sendingStatus === 'sending' ? '#3b82f644' : sendingStatus === 'success' ? '#10b98144' : '#ef444444'}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  {sendingStatus === 'sending' && <i className="fa-solid fa-spinner fa-spin"></i>}
                  {sendingStatus === 'success' && <i className="fa-solid fa-circle-check"></i>}
                  {sendingStatus === 'failed' && <i className="fa-solid fa-circle-exclamation"></i>}
                  {sendingStatus === 'sending' ? 'Sending push notification...' : sendingStatus === 'success' ? 'Sent successfully!' : 'Failed to deliver notification.'}
                </div>
              )}

              {testResult && (
                <div style={{ background: '#0e1117', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '15px', overflowX: 'auto' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>Server Logs:</span>
                  <pre style={{ margin: 0, fontSize: '11px', color: '#888', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                </div>
              )}

            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '20px', borderTop: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.01)' }}>
              <button 
                onClick={() => setTestPanelOpen(false)}
                style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSendNotification} 
                disabled={sendingStatus === 'sending'}
                style={{ background: 'var(--primary-color)', border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 20px', cursor: 'pointer', fontWeight: '600' }}
              >
                Send Notification
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default NotificationCenter;
