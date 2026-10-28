import React, { useState, useEffect } from 'react';

export default function HolidayCalendarModal({ isOpen, onClose, onHolidaysUpdated }) {
  const [calendars, setCalendars] = useState(() => {
    try {
      const saved = localStorage.getItem('hrms_location_holiday_calendars');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });

  const [activeCalId, setActiveCalId] = useState(() => {
    try {
      const saved = localStorage.getItem('hrms_location_holiday_calendars');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id;
      }
    } catch {}
    return null;
  });

  // Views: 'HOME' | 'SELECT_CALENDAR' | 'CALENDAR_DETAIL' | 'ADD_CALENDAR'
  const [currentView, setCurrentView] = useState('HOME');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Add Holiday Form State
  const [showAddHolidayModal, setShowAddHolidayModal] = useState(false);
  const [newHolidayTitle, setNewHolidayTitle] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayType, setNewHolidayType] = useState('Gazetted Holiday');
  const [newHolidayDesc, setNewHolidayDesc] = useState('');

  // Add Calendar / Location Form State
  const [newCalName, setNewCalName] = useState('');
  const [newCalLocation, setNewCalLocation] = useState('');
  const [newCalState, setNewCalState] = useState('');
  const [cloneFromId, setCloneFromId] = useState('');

  // Fetch true database records on mount & when opened
  useEffect(() => {
    const fetchDbCalendars = async () => {
      try {
        const res = await fetch(`/api/v1/holidays/calendars`);
        if (res.ok) {
          const dbData = await res.json();
          if (Array.isArray(dbData) && dbData.length > 0) {
            setCalendars(dbData);
            localStorage.setItem('hrms_location_holiday_calendars', JSON.stringify(dbData));
            setActiveCalId(prev => {
              if (prev && dbData.some(c => c.id === prev)) return prev;
              return dbData[0].id;
            });
            if (onHolidaysUpdated) {
              onHolidaysUpdated(dbData[0].holidays || []);
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch calendars from DB:', err);
      }
    };
    if (isOpen) {
      fetchDbCalendars();
    }
  }, [isOpen]);

  useEffect(() => {
    try {
      localStorage.setItem('hrms_location_holiday_calendars', JSON.stringify(calendars));
      if (calendars && calendars.length > 0) {
        fetch(`/api/v1/holidays/calendars/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calendars })
        }).catch(err => console.warn('Background calendar sync error:', err));
      }
    } catch (e) {
      console.error('Failed to save calendars:', e);
    }
  }, [calendars]);

  if (!isOpen) return null;

  const activeCalendar = calendars.find(c => c.id === activeCalId) || calendars[0] || null;

  const getDayName = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  };

  const handleSelectCalendar = (calId) => {
    setActiveCalId(calId);
    setCurrentView('CALENDAR_DETAIL');
    const selected = calendars.find(c => c.id === calId);
    if (selected && onHolidaysUpdated) {
      onHolidaysUpdated(selected.holidays || []);
    }
  };

  const handleAddHoliday = (e) => {
    e.preventDefault();
    if (!activeCalendar) {
      alert('Please select or create a location calendar first.');
      return;
    }
    if (!newHolidayTitle.trim() || !newHolidayDate) {
      alert('Please provide holiday name and date.');
      return;
    }

    const dayName = getDayName(newHolidayDate);
    const newHol = {
      id: `h-custom-${Date.now()}`,
      title: newHolidayTitle.trim(),
      date: newHolidayDate,
      day: dayName,
      type: newHolidayType,
      description: newHolidayDesc.trim() || 'Official Location Holiday'
    };

    const updated = calendars.map(cal => {
      if (cal.id === activeCalendar.id) {
        const sorted = [...(cal.holidays || []), newHol].sort((a, b) => new Date(a.date) - new Date(b.date));
        return { ...cal, holidays: sorted };
      }
      return cal;
    });

    setCalendars(updated);
    if (onHolidaysUpdated) {
      const updatedActive = updated.find(c => c.id === activeCalendar.id);
      if (updatedActive) onHolidaysUpdated(updatedActive.holidays || []);
    }

    setNewHolidayTitle('');
    setNewHolidayDate('');
    setNewHolidayDesc('');
    setShowAddHolidayModal(false);
  };

  const handleDeleteHoliday = (holidayId) => {
    if (!activeCalendar) return;
    if (!window.confirm('Are you sure you want to remove this holiday from this calendar?')) return;

    const updated = calendars.map(cal => {
      if (cal.id === activeCalendar.id) {
        return { ...cal, holidays: (cal.holidays || []).filter(h => h.id !== holidayId) };
      }
      return cal;
    });

    setCalendars(updated);
    if (onHolidaysUpdated) {
      const updatedActive = updated.find(c => c.id === activeCalendar.id);
      if (updatedActive) onHolidaysUpdated(updatedActive.holidays || []);
    }
  };

  const handleCreateCalendar = (e) => {
    e.preventDefault();
    if (!newCalName.trim() || !newCalLocation.trim()) {
      alert('Please provide calendar name and location.');
      return;
    }

    let initialHolidays = [];
    if (cloneFromId) {
      const source = calendars.find(c => c.id === cloneFromId);
      if (source) {
        initialHolidays = JSON.parse(JSON.stringify(source.holidays || [])).map(h => ({
          ...h,
          id: `h-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
        }));
      }
    }

    const newCal = {
      id: `cal-custom-${Date.now()}`,
      name: newCalName.trim(),
      location: newCalLocation.trim(),
      state: newCalState.trim() || newCalLocation.trim(),
      year: 2026,
      isDefault: calendars.length === 0,
      holidays: initialHolidays
    };

    const updated = [...calendars, newCal];
    setCalendars(updated);
    setActiveCalId(newCal.id);
    setCurrentView('CALENDAR_DETAIL');

    if (onHolidaysUpdated) {
      onHolidaysUpdated(newCal.holidays);
    }

    setNewCalName('');
    setNewCalLocation('');
    setNewCalState('');
    setCloneFromId('');
  };

  const handleDeleteCalendar = async (calId, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this location calendar?')) return;

    try {
      await fetch(`/api/v1/holidays/calendars/${calId}`, {
        method: 'DELETE'
      }).catch(err => console.warn('Delete calendar API error:', err));
    } catch (err) {
      console.warn('Delete request failed:', err);
    }

    const updated = calendars.filter(c => c.id !== calId);
    setCalendars(updated);
    localStorage.setItem('hrms_location_holiday_calendars', JSON.stringify(updated));

    if (activeCalId === calId) {
      const nextActive = updated[0]?.id || null;
      setActiveCalId(nextActive);
      if (onHolidaysUpdated) {
        onHolidaysUpdated(updated[0]?.holidays || []);
      }
    }
  };

  const filteredHolidays = (activeCalendar?.holidays || []).filter(h => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (h.title && h.title.toLowerCase().includes(term)) ||
      (h.date && h.date.toLowerCase().includes(term)) ||
      (h.type && h.type.toLowerCase().includes(term)) ||
      (h.day && h.day.toLowerCase().includes(term))
    );
  });

  const getHolidayTypeBadge = (type) => {
    const t = (type || '').toLowerCase();
    if (t.includes('national')) {
      return { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe', label: 'National Holiday' };
    }
    if (t.includes('state') || t.includes('regional')) {
      return { bg: '#faf5ff', color: '#9333ea', border: '#e9d5ff', label: 'Regional Holiday' };
    }
    if (t.includes('festival')) {
      return { bg: '#fdf2f8', color: '#db2777', border: '#fbcfe8', label: 'Festival Holiday' };
    }
    if (t.includes('optional') || t.includes('restricted')) {
      return { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: 'Optional Holiday' };
    }
    return { bg: '#ecfdf5', color: '#059669', border: '#a7f3d0', label: 'Gazetted Holiday' };
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      animation: 'fadeIn 0.25s ease-out'
    }}>
      <div style={{
        background: 'var(--bg-glass, #ffffff)',
        width: '100%',
        maxWidth: currentView === 'HOME' ? '720px' : '980px',
        maxHeight: '90vh',
        borderRadius: '24px',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid var(--border-glass, #e2e8f0)',
        transition: 'all 0.3s ease'
      }}>
        
        {/* Modal Header */}
        <div style={{
          padding: '20px 28px',
          borderBottom: '1px solid var(--border-glass, #f1f5f9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--table-header, #f8fafc)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              boxShadow: '0 6px 18px rgba(139, 92, 246, 0.3)'
            }}>
              <i className="fa-solid fa-calendar-days"></i>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0, color: 'var(--text-primary, #0f172a)' }}>
                  {currentView === 'HOME' && 'Holiday & Calendar Management'}
                  {currentView === 'SELECT_CALENDAR' && 'Select Location Calendar'}
                  {currentView === 'CALENDAR_DETAIL' && (activeCalendar?.name || 'Holiday Schedule')}
                  {currentView === 'ADD_CALENDAR' && 'Add New Location Calendar'}
                </h3>
                {currentView === 'CALENDAR_DETAIL' && activeCalendar && (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    background: '#ede9fe',
                    color: '#6d28d9',
                    padding: '2px 8px',
                    borderRadius: '20px'
                  }}>
                    {activeCalendar?.year || 2026}
                  </span>
                )}
              </div>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0 0' }}>
                {currentView === 'HOME' && 'Configure and manage location-based holiday schedules'}
                {currentView === 'SELECT_CALENDAR' && 'Choose an existing location calendar to view or update its holidays'}
                {currentView === 'CALENDAR_DETAIL' && (activeCalendar ? `${activeCalendar.holidays?.length || 0} Holidays configured for ${activeCalendar.location}` : 'No calendar selected')}
                {currentView === 'ADD_CALENDAR' && 'Create a custom holiday schedule for a new branch, office, or location'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {currentView !== 'HOME' && (
              <button
                onClick={() => setCurrentView('HOME')}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  color: '#475569',
                  padding: '7px 14px',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <i className="fa-solid fa-arrow-left"></i> Back
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                border: 'none',
                background: '#f1f5f9',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1 }}>

          {/* VIEW 1: HOME (Choice Screen) */}
          {currentView === 'HOME' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {activeCalendar ? (
                <div style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '16px',
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>Active Location Calendar</span>
                    <h4 style={{ margin: '4px 0 0 0', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>{activeCalendar.name}</h4>
                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#8b5cf6', fontWeight: '600' }}>
                      {activeCalendar.holidays?.length || 0} Holidays Configured
                    </p>
                  </div>
                  <button
                    onClick={() => setCurrentView('CALENDAR_DETAIL')}
                    style={{
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '8px 18px',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 4px 12px rgba(139, 92, 246, 0.25)'
                    }}
                  >
                    View Schedule <i className="fa-solid fa-chevron-right" style={{ fontSize: '10px' }}></i>
                  </button>
                </div>
              ) : (
                <div style={{
                  background: '#faf5ff',
                  border: '1px dashed #c084fc',
                  borderRadius: '16px',
                  padding: '20px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>🗓️</div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: '800', color: '#581c87' }}>No Holiday Calendars Added Yet</h4>
                  <p style={{ margin: 0, fontSize: '12px', color: '#7e22ce' }}>
                    Click <b>Add Calendar / Location</b> below to create your organization's first location holiday calendar.
                  </p>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                
                {/* Button Option 1: Select Calendar */}
                <div
                  onClick={() => {
                    if (calendars.length === 0) {
                      setCurrentView('ADD_CALENDAR');
                    } else {
                      setCurrentView('SELECT_CALENDAR');
                    }
                  }}
                  style={{
                    border: '2px solid #e2e8f0',
                    borderRadius: '18px',
                    padding: '24px',
                    cursor: 'pointer',
                    background: '#ffffff',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#8b5cf6';
                    e.currentTarget.style.boxShadow = '0 12px 28px rgba(139, 92, 246, 0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#e2e8f0';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '14px',
                    background: '#ede9fe',
                    color: '#7c3aed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px'
                  }}>
                    <i className="fa-solid fa-list-check"></i>
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>Select Calendar</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>
                      {calendars.length > 0
                        ? `Browse all ${calendars.length} location holiday calendars and manage their schedules.`
                        : 'No calendars exist yet. Click here to add your first calendar.'}
                    </p>
                  </div>
                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '6px', color: '#7c3aed', fontSize: '13px', fontWeight: '700' }}>
                    {calendars.length > 0 ? 'Browse Calendars' : 'Create First Calendar'} <i className="fa-solid fa-arrow-right" style={{ fontSize: '11px' }}></i>
                  </div>
                </div>

                {/* Button Option 2: Add Calendar */}
                <div
                  onClick={() => setCurrentView('ADD_CALENDAR')}
                  style={{
                    border: '2px solid #e2e8f0',
                    borderRadius: '18px',
                    padding: '24px',
                    cursor: 'pointer',
                    background: '#ffffff',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#10b981';
                    e.currentTarget.style.boxShadow = '0 12px 28px rgba(16, 185, 129, 0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#e2e8f0';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '14px',
                    background: '#d1fae5',
                    color: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px'
                  }}>
                    <i className="fa-solid fa-calendar-plus"></i>
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>Add Calendar / Location</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>
                      Create a new holiday calendar for a specific city, branch, or office location.
                    </p>
                  </div>
                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '6px', color: '#059669', fontSize: '13px', fontWeight: '700' }}>
                    Create New Calendar <i className="fa-solid fa-plus" style={{ fontSize: '11px' }}></i>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW 2: SELECT CALENDAR (Location Calendars Directory) */}
          {currentView === 'SELECT_CALENDAR' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#1e293b' }}>
                  Location Calendars ({calendars.length})
                </h4>
                <button
                  onClick={() => setCurrentView('ADD_CALENDAR')}
                  style={{
                    background: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    padding: '7px 16px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                  }}
                >
                  <i className="fa-solid fa-plus"></i> Add New Location
                </button>
              </div>

              {calendars.length === 0 ? (
                <div style={{
                  padding: '50px 20px',
                  textAlign: 'center',
                  background: '#f8fafc',
                  borderRadius: '16px',
                  border: '1px dashed #cbd5e1'
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '10px' }}>🗓️</div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: '800', color: '#1e293b' }}>No Calendars Found</h4>
                  <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#64748b' }}>
                    You have not created any location holiday calendars yet.
                  </p>
                  <button
                    onClick={() => setCurrentView('ADD_CALENDAR')}
                    style={{
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '8px 20px',
                      borderRadius: '10px',
                      fontSize: '13px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)'
                    }}
                  >
                    + Create Your First Calendar
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                  {calendars.map((cal) => (
                    <div
                      key={cal.id}
                      onClick={() => handleSelectCalendar(cal.id)}
                      style={{
                        border: activeCalId === cal.id ? '2px solid #8b5cf6' : '1px solid #e2e8f0',
                        borderRadius: '16px',
                        padding: '20px',
                        cursor: 'pointer',
                        background: activeCalId === cal.id ? '#faf5ff' : '#ffffff',
                        position: 'relative',
                        boxShadow: activeCalId === cal.id ? '0 10px 24px rgba(139, 92, 246, 0.15)' : '0 2px 8px rgba(0,0,0,0.03)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <span style={{
                          fontSize: '11px',
                          fontWeight: '700',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: '#ede9fe',
                          color: '#6d28d9'
                        }}>
                          📍 {cal.location}
                        </span>
                        
                        <button
                          onClick={(e) => handleDeleteCalendar(cal.id, e)}
                          title="Delete Calendar"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '4px',
                            fontSize: '13px'
                          }}
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>

                      <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>{cal.name}</h4>
                      <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#64748b' }}>State: {cal.state} • Year: {cal.year}</p>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '12px' }}>
                        <span style={{ fontSize: '13px', fontWeight: '800', color: '#8b5cf6' }}>
                          {(cal.holidays || []).length} Holidays
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          View Schedule <i className="fa-solid fa-chevron-right" style={{ fontSize: '10px' }}></i>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VIEW 3: CALENDAR DETAIL (Keka Holiday Schedule) */}
          {currentView === 'CALENDAR_DETAIL' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              
              {/* Controls Bar */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                background: '#f8fafc',
                padding: '14px 18px',
                borderRadius: '16px',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '260px' }}>
                  
                  {/* Location Switcher Dropdown */}
                  {calendars.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: '#475569' }}>Location:</span>
                      <select
                        value={activeCalId || ''}
                        onChange={(e) => handleSelectCalendar(e.target.value)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          fontSize: '12px',
                          fontWeight: '700',
                          color: '#0f172a',
                          background: '#ffffff',
                          cursor: 'pointer'
                        }}
                      >
                        {calendars.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.location} ({(c.holidays || []).length} Holidays)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Search Bar */}
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      type="text"
                      placeholder="Search holiday by name, date, type..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 12px 6px 32px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '12px',
                        outline: 'none'
                      }}
                    />
                    <i className="fa-solid fa-magnifying-glass" style={{
                      position: 'absolute',
                      left: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#94a3b8',
                      fontSize: '12px'
                    }}></i>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    onClick={() => setCurrentView('SELECT_CALENDAR')}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: '700',
                      color: '#475569',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <i className="fa-solid fa-location-dot"></i> Switch Calendar
                  </button>

                  <button
                    onClick={() => setShowAddHolidayModal(true)}
                    style={{
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '7px 16px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                    }}
                  >
                    <i className="fa-solid fa-plus"></i> Add Holiday
                  </button>
                </div>
              </div>

              {/* Add Holiday Form Modal Overlay */}
              {showAddHolidayModal && (
                <div style={{
                  background: '#f1f5f9',
                  border: '2px dashed #8b5cf6',
                  borderRadius: '16px',
                  padding: '20px',
                  animation: 'fadeIn 0.2s ease-out'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#1e293b' }}>
                      ➕ Add New Holiday to {activeCalendar?.location || 'Location'} Calendar
                    </h4>
                    <button
                      onClick={() => setShowAddHolidayModal(false)}
                      style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '14px' }}
                    >
                      ✕
                    </button>
                  </div>

                  <form onSubmit={handleAddHoliday} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '12px', alignItems: 'flex-end' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Holiday Title / Festival *</label>
                      <input
                        type="text"
                        placeholder="e.g. Independence Day 🇮🇳"
                        value={newHolidayTitle}
                        onChange={(e) => setNewHolidayTitle(e.target.value)}
                        required
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Date *</label>
                      <input
                        type="date"
                        value={newHolidayDate}
                        onChange={(e) => setNewHolidayDate(e.target.value)}
                        required
                        style={{ width: '100%', padding: '7px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Category</label>
                      <select
                        value={newHolidayType}
                        onChange={(e) => setNewHolidayType(e.target.value)}
                        style={{ width: '100%', padding: '7px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                      >
                        <option value="Gazetted Holiday">Gazetted Holiday</option>
                        <option value="National Holiday">National Holiday</option>
                        <option value="Festival Holiday">Festival Holiday</option>
                        <option value="State Holiday">Regional / State Holiday</option>
                        <option value="Optional Holiday">Optional / Restricted Holiday</option>
                      </select>
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Description / Notes (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. National holiday celebrating independence"
                        value={newHolidayDesc}
                        onChange={(e) => setNewHolidayDesc(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setShowAddHolidayModal(false)}
                        style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', background: '#10b981', color: '#ffffff', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                      >
                        Save Holiday
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Holiday List Table (Keka Style) */}
              <div style={{
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                overflow: 'hidden',
                background: '#ffffff'
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '700', color: '#475569', width: '140px' }}>Date</th>
                      <th style={{ padding: '12px 16px', fontSize: '12px', fontWeight: '700', color: '#475569', width: '110px' }}>Day</th>
                      <th style={{ padding: '12px 16px', fontSize: '12px', fontWeight: '700', color: '#475569' }}>Holiday Name</th>
                      <th style={{ padding: '12px 16px', fontSize: '12px', fontWeight: '700', color: '#475569', width: '160px' }}>Type</th>
                      <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '700', color: '#475569', width: '80px', textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHolidays.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                          No holidays in this calendar. Click <b>+ Add Holiday</b> above to insert your first holiday.
                        </td>
                      </tr>
                    ) : (
                      filteredHolidays.map((h) => {
                        const badge = getHolidayTypeBadge(h.type);
                        const dObj = new Date(h.date);
                        const formattedDate = !isNaN(dObj.getTime())
                          ? dObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
                          : h.date;

                        return (
                          <tr
                            key={h.id}
                            style={{
                              borderBottom: '1px solid #f1f5f9',
                              transition: 'background 0.15s ease'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                          >
                            <td style={{ padding: '14px 20px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{
                                  background: '#f1f5f9',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: '800',
                                  color: '#0f172a'
                                }}>
                                  📅 {formattedDate}
                                </div>
                              </div>
                            </td>

                            <td style={{ padding: '14px 16px', fontSize: '12px', fontWeight: '600', color: '#64748b' }}>
                              {h.day || getDayName(h.date)}
                            </td>

                            <td style={{ padding: '14px 16px' }}>
                              <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>
                                {h.title}
                              </div>
                              {h.description && (
                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                  {h.description}
                                </div>
                              )}
                            </td>

                            <td style={{ padding: '14px 16px' }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                fontWeight: '700',
                                background: badge.bg,
                                color: badge.color,
                                border: `1px solid ${badge.border}`
                              }}>
                                {badge.label}
                              </span>
                            </td>

                            <td style={{ padding: '14px 20px', textAlign: 'center' }}>
                              <button
                                onClick={() => handleDeleteHoliday(h.id)}
                                title="Remove Holiday"
                                style={{
                                  background: '#fee2e2',
                                  border: 'none',
                                  color: '#ef4444',
                                  width: '28px',
                                  height: '28px',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '12px',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                <i className="fa-solid fa-trash"></i>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          )}

          {/* VIEW 4: ADD CALENDAR / LOCATION */}
          {currentView === 'ADD_CALENDAR' && (
            <div style={{ maxWidth: '600px', margin: '0 auto' }}>
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '18px',
                padding: '24px'
              }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>
                  Create New Location Holiday Calendar
                </h4>

                <form onSubmit={handleCreateCalendar} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
                      Calendar Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Head Office (Delhi / NCR) Calendar 2026"
                      value={newCalName}
                      onChange={(e) => setNewCalName(e.target.value)}
                      required
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
                        City / Location *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Delhi / NCR"
                        value={newCalLocation}
                        onChange={(e) => setNewCalLocation(e.target.value)}
                        required
                        style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
                        State
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Delhi"
                        value={newCalState}
                        onChange={(e) => setNewCalState(e.target.value)}
                        style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                      />
                    </div>
                  </div>

                  {calendars.length > 0 && (
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
                        Initial Holiday Template
                      </label>
                      <select
                        value={cloneFromId}
                        onChange={(e) => setCloneFromId(e.target.value)}
                        style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                      >
                        <option value="">Start Empty (No pre-filled holidays)</option>
                        {calendars.map(c => (
                          <option key={c.id} value={c.id}>
                            Clone from {c.name} ({(c.holidays || []).length} Holidays)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
                    <button
                      type="button"
                      onClick={() => setCurrentView('HOME')}
                      style={{
                        padding: '10px 20px',
                        borderRadius: '10px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        fontSize: '13px',
                        fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      style={{
                        padding: '10px 24px',
                        borderRadius: '10px',
                        border: 'none',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        color: '#ffffff',
                        fontSize: '13px',
                        fontWeight: '800',
                        cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)'
                      }}
                    >
                      Create Calendar
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
