import React, { useState, useEffect, useRef } from 'react';
import { Plus, User, MapPin, Database, Download, Pencil, Trash2, Users, UserPlus, ChevronDown, ChevronUp, Mail, Lock, X, Activity, RefreshCw, Clock } from 'lucide-react';
import { dbService } from '../services/dbService';

export default function AdminPanel({ user, profile }) {
  const [activeTab, setActiveTab] = useState('sites');

  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  // Add member form
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('employee');
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [memberSuccess, setMemberSuccess] = useState('');
  // Expand / edit employee
  const [expandedEmpId, setExpandedEmpId] = useState(null);
  const [editEmpName, setEditEmpName] = useState('');
  const [editEmpRole, setEditEmpRole] = useState('');
  const [editEmpLoading, setEditEmpLoading] = useState(false);
  const [editEmpError, setEditEmpError] = useState('');
  // Site assignments
  const [empSites, setEmpSites] = useState({});
  const [siteLoading, setSiteLoading] = useState(false);
  const [addSiteId, setAddSiteId] = useState('');
  const [siteError, setSiteError] = useState('');
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [selectedSessionLogs, setSelectedSessionLogs] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  // Create/edit client form state
  const [editingClient, setEditingClient] = useState(null);
  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientLat, setClientLat] = useState('');
  const [clientLng, setClientLng] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Live View state
  const [activeCheckIns, setActiveCheckIns] = useState([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState('');
  const liveIntervalRef = useRef(null);

  useEffect(() => {
    fetchClients();
    fetchEmployees();
    fetchAttendanceLogs();
  }, []);

  // Start/stop auto-refresh when switching to/from Live tab
  useEffect(() => {
    if (activeTab === 'live') {
      fetchActiveCheckIns();
      liveIntervalRef.current = setInterval(fetchActiveCheckIns, 30000);
    } else {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    }
    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    };
  }, [activeTab]);

  const fetchActiveCheckIns = async () => {
    setLiveLoading(true);
    try {
      const data = await dbService.getActiveCheckIns();
      setActiveCheckIns(data);
      setLastRefreshed(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('Failed to load active check-ins:', err);
    } finally {
      setLiveLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const data = await dbService.getEmployees();
      setEmployees(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateMember = async (e) => {
    e.preventDefault();
    setMemberError('');
    setMemberSuccess('');
    setMemberLoading(true);
    try {
      await dbService.createEmployee(newMemberEmail, newMemberPassword, newMemberName, newMemberRole, profile.id);
      setMemberSuccess(`Account created for ${newMemberName}. They will receive a confirmation email at ${newMemberEmail}.`);
      setNewMemberName('');
      setNewMemberEmail('');
      setNewMemberPassword('');
      setNewMemberRole('employee');
      setShowAddMember(false);
      fetchEmployees();
    } catch (err) {
      setMemberError(err.message || 'Failed to create account.');
    } finally {
      setMemberLoading(false);
    }
  };

  const handleToggleEmployee = async (emp) => {
    if (expandedEmpId === emp.id) {
      setExpandedEmpId(null);
      setEditEmpError('');
      setSiteError('');
      return;
    }
    setExpandedEmpId(emp.id);
    setEditEmpName(emp.full_name);
    setEditEmpRole(emp.role);
    setEditEmpError('');
    setSiteError('');
    setAddSiteId('');
    if (!empSites[emp.id]) {
      setSiteLoading(true);
      try {
        const sites = await dbService.getEmployeeSites(emp.id);
        setEmpSites(prev => ({ ...prev, [emp.id]: sites }));
      } catch (err) {
        console.error(err);
      } finally {
        setSiteLoading(false);
      }
    }
  };

  const handleSaveEmployee = async (empId) => {
    setEditEmpLoading(true);
    setEditEmpError('');
    try {
      await dbService.updateEmployee(empId, editEmpName, editEmpRole);
      setEmployees(prev => prev.map(e => e.id === empId ? { ...e, full_name: editEmpName, role: editEmpRole } : e));
      setExpandedEmpId(null);
    } catch (err) {
      setEditEmpError(err.message || 'Failed to save changes.');
    } finally {
      setEditEmpLoading(false);
    }
  };

  const handleDeleteEmployee = async (emp) => {
    if (!window.confirm(`Delete "${emp.full_name}"? This will permanently remove their account and all session history.`)) return;
    try {
      await dbService.deleteEmployee(emp.id);
      setEmployees(prev => prev.filter(e => e.id !== emp.id));
      if (expandedEmpId === emp.id) setExpandedEmpId(null);
    } catch (err) {
      setEditEmpError(err.message || 'Failed to delete employee.');
    }
  };

  const handleAssignSite = async (empId) => {
    if (!addSiteId) return;
    setSiteLoading(true);
    setSiteError('');
    try {
      await dbService.assignSite(empId, addSiteId);
      const newClient = clients.find(c => c.id === addSiteId);
      setEmpSites(prev => ({ ...prev, [empId]: [...(prev[empId] || []), newClient] }));
      setAddSiteId('');
    } catch (err) {
      setSiteError(err.message || 'Failed to assign site. Check that the RLS policy has been updated in Supabase.');
    } finally {
      setSiteLoading(false);
    }
  };

  const handleRemoveSite = async (empId, clientId) => {
    setSiteLoading(true);
    setSiteError('');
    try {
      await dbService.removeSiteAssignment(empId, clientId);
      setEmpSites(prev => ({ ...prev, [empId]: prev[empId].filter(s => s.id !== clientId) }));
    } catch (err) {
      setSiteError(err.message || 'Failed to remove site.');
    } finally {
      setSiteLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const data = await dbService.getClients();
      setClients(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAttendanceLogs = async () => {
    try {
      const data = await dbService.getAttendanceLogs();
      setAttendanceLogs(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteClient = async (client) => {
    if (!window.confirm(`Delete "${client.name}"? This cannot be undone.`)) return;
    setError('');
    try {
      await dbService.deleteClient(client.id);
      setSuccess(`"${client.name}" removed.`);
      fetchClients();
    } catch (err) {
      setError(err.message || 'Failed to delete client.');
    }
  };

  const handleEditClient = (client) => {
    setEditingClient(client);
    setClientName(client.name);
    setClientAddress(client.address || '');
    setClientLat(String(client.latitude));
    setClientLng(String(client.longitude));
    setError('');
    setSuccess('');
  };

  const handleCancelEdit = () => {
    setEditingClient(null);
    setClientName('');
    setClientAddress('');
    setClientLat('');
    setClientLng('');
    setError('');
    setSuccess('');
  };

  const handleAddClient = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (!clientName || !clientLat || !clientLng) {
      setError('Client name, latitude, and longitude are required.');
      setLoading(false);
      return;
    }

    try {
      if (editingClient) {
        await dbService.updateClient(
          editingClient.id,
          clientName,
          clientAddress,
          parseFloat(clientLat),
          parseFloat(clientLng)
        );
        setSuccess(`Client "${clientName}" updated successfully.`);
        setEditingClient(null);
      } else {
        await dbService.addClient(
          clientName,
          clientAddress,
          parseFloat(clientLat),
          parseFloat(clientLng)
        );
        setSuccess(`Client "${clientName}" added successfully.`);
      }
      setClientName('');
      setClientAddress('');
      setClientLat('');
      setClientLng('');
      fetchClients();
    } catch (err) {
      setError(err.message || 'Failed to save client.');
    } finally {
      setLoading(false);
    }
  };

  const handleViewSessionPings = async (session) => {
    try {
      setSelectedSessionId(session.id);
      const data = await dbService.getLocationLogs(session.id);
      setSelectedSessionLogs(data);
    } catch (err) {
      console.error('Error loading session pings:', err);
    }
  };

  const handleExportCSV = () => {
    if (attendanceLogs.length === 0) {
      setError('No logs available to export.');
      return;
    }

    const headers = [
      'Representative',
      'Client Site',
      'Date',
      'Check-In Time',
      'Check-In Lat/Lng',
      'Check-Out Time',
      'Check-Out Lat/Lng',
      'Duration (Mins)'
    ];

    const rows = attendanceLogs.map((log) => {
      const workerName = `"${log.employee_name.replace(/"/g, '""')}"`;
      const clientName = `"${log.client_name.replace(/"/g, '""')}"`;
      const dateStr = formatDate(log.check_in_time);
      const checkInTime = formatTime(log.check_in_time);
      const checkInCoords = `"${log.check_in_latitude || 0}, ${log.check_in_longitude || 0}"`;
      const checkOutTime = log.check_out_time ? formatTime(log.check_out_time) : 'Active Shift';
      const checkOutCoords = log.check_out_time
        ? `"${log.check_out_latitude || 0}, ${log.check_out_longitude || 0}"`
        : '"N/A"';
      let durationMins = 'In Progress';
      if (log.check_out_time) {
        const diffMs = new Date(log.check_out_time) - new Date(log.check_in_time);
        durationMins = Math.floor(diffMs / 60000);
      }
      return [workerName, clientName, dateStr, checkInTime, checkInCoords, checkOutTime, checkOutCoords, durationMins].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `horttrack_attendance_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setSuccess('Exported attendance report successfully.');
  };

  const formatTime = (isoString) => {
    if (!isoString) return 'Active Now';
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (isoString) => {
    return new Date(isoString).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const calculateDuration = (inTime, outTime) => {
    if (!outTime) return 'In Progress';
    const diffMs = new Date(outTime) - new Date(inTime);
    const diffMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  const getElapsed = (checkInTime) => {
    const diffMs = Date.now() - new Date(checkInTime);
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  const handleUseCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setClientLat(pos.coords.latitude.toFixed(6));
          setClientLng(pos.coords.longitude.toFixed(6));
          setSuccess('Populated coordinates with your current position.');
        },
        (err) => {
          setError(`Unable to get location: ${err.message}`);
        }
      );
    } else {
      setError('Geolocation is not supported by your browser.');
    }
  };

  return (
    <div>
      {/* Tab Navigation */}
      <div className="tab-nav">
        <button className={`tab-btn ${activeTab === 'sites' ? 'active' : ''}`} onClick={() => setActiveTab('sites')}>
          <MapPin size={15} /> Sites
        </button>
        <button className={`tab-btn ${activeTab === 'team' ? 'active' : ''}`} onClick={() => setActiveTab('team')}>
          <Users size={15} /> Team
        </button>
        <button className={`tab-btn ${activeTab === 'attendance' ? 'active' : ''}`} onClick={() => setActiveTab('attendance')}>
          <Database size={15} /> Attendance
        </button>
        <button className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
          <Activity size={15} /> Live View
        </button>
      </div>

      {/* SITES TAB */}
      {activeTab === 'sites' && (
        <div className="card" style={{ padding: '1.5rem', maxWidth: '600px', margin: '0 auto' }}>
          <h3 className="card-title" style={{ fontSize: '1.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {editingClient ? <Pencil size={20} className="logo-icon" /> : <Plus size={20} className="logo-icon" />}
            <span>{editingClient ? `Editing: ${editingClient.name}` : 'Add Client Location'}</span>
          </h3>
          <p className="card-subtitle">Define target client GPS coordinates to configure the geofence barrier.</p>

          {error && <div className="alert alert-danger" style={{ padding: '0.75rem' }}>{error}</div>}
          {success && <div className="alert alert-success" style={{ padding: '0.75rem' }}>{success}</div>}

          <form onSubmit={handleAddClient}>
            <div className="form-group">
              <label className="form-label">Client / Estate Name</label>
              <div className="input-container">
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Royal Botanical Garden"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  required
                />
                <User className="input-icon" size={16} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Address</label>
              <div className="input-container">
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. MG Road, Bengaluru"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                />
                <MapPin className="input-icon" size={16} />
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label">Coordinates</label>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={handleUseCurrentLocation}
                >
                  Use My Location
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <input
                  type="number"
                  step="0.000001"
                  className="form-input"
                  style={{ paddingLeft: '1rem' }}
                  placeholder="Latitude"
                  value={clientLat}
                  onChange={(e) => setClientLat(e.target.value)}
                  required
                />
                <input
                  type="number"
                  step="0.000001"
                  className="form-input"
                  style={{ paddingLeft: '1rem' }}
                  placeholder="Longitude"
                  value={clientLng}
                  onChange={(e) => setClientLng(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading
                  ? <div className="spinner" style={{ width: '18px', height: '18px' }} />
                  : editingClient ? 'Save Changes' : 'Register Client Location'}
              </button>
              {editingClient && (
                <button type="button" className="btn btn-secondary" onClick={handleCancelEdit} style={{ width: 'auto', padding: '0 1rem' }}>
                  Cancel
                </button>
              )}
            </div>
          </form>

          <div style={{ marginTop: '2rem' }}>
            <h4 className="form-label" style={{ marginBottom: '0.75rem' }}>Registered Geofences ({clients.length})</h4>
            <div className="log-list" style={{ maxHeight: '300px' }}>
              {clients.map((c) => (
                <div key={c.id} className="log-item" style={{ padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: '600', color: '#fff' }}>{c.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.2rem 0' }}>
                      {c.address || 'No address specified'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      🌐 {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)} (100m Geofence)
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ width: 'auto', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                      onClick={() => handleEditClient(c)}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ width: 'auto', padding: '0.25rem 0.6rem', fontSize: '0.75rem', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}
                      onClick={() => handleDeleteClient(c)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TEAM TAB */}
      {activeTab === 'team' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <h3 className="card-title" style={{ fontSize: '1.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 0 }}>
              <Users size={20} className="logo-icon" />
              <span>Team Members</span>
            </h3>
            <button
              className="btn btn-primary"
              style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              onClick={() => { setShowAddMember(v => !v); setMemberError(''); setMemberSuccess(''); }}
            >
              {showAddMember ? <ChevronUp size={14} /> : <UserPlus size={14} />}
              {showAddMember ? 'Cancel' : 'Add Member'}
            </button>
          </div>
          <p className="card-subtitle">All registered accounts. Change a member's role using the dropdown.</p>

          {memberSuccess && <div className="alert alert-success" style={{ padding: '0.75rem', marginBottom: '1rem' }}>{memberSuccess}</div>}
          {memberError && <div className="alert alert-danger" style={{ padding: '0.75rem', marginBottom: '1rem' }}>{memberError}</div>}

          {showAddMember && (
            <form onSubmit={handleCreateMember} style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--card-border)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>New Account</p>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <div className="input-container">
                  <input type="text" className="form-input" placeholder="e.g. Rajesh Kumar" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} required />
                  <User className="input-icon" size={16} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <div className="input-container">
                  <input type="email" className="form-input" placeholder="name@horttrack.com" value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} required />
                  <Mail className="input-icon" size={16} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Temporary Password</label>
                <div className="input-container">
                  <input type="password" className="form-input" placeholder="Min. 6 characters" value={newMemberPassword} onChange={(e) => setNewMemberPassword(e.target.value)} minLength={6} required />
                  <Lock className="input-icon" size={16} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-select" value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value)}>
                  <option value="employee">Field Worker</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={memberLoading} style={{ marginTop: '0.25rem' }}>
                {memberLoading ? <div className="spinner" style={{ width: '16px', height: '16px' }} /> : 'Create Account'}
              </button>
            </form>
          )}

          <div className="log-list" style={{ maxHeight: '600px' }}>
            {employees.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
                No team members found.
              </p>
            ) : (
              employees.map((emp) => {
                const isExpanded = expandedEmpId === emp.id;
                const assignedSites = empSites[emp.id] || [];
                const unassignedClients = clients.filter(c => !assignedSites.find(s => s.id === c.id));

                return (
                  <div key={emp.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <div
                      className="log-item"
                      style={{ padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: 'none' }}
                      onClick={() => handleToggleEmployee(emp)}
                    >
                      <div>
                        <div style={{ fontWeight: '600', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="user-dot" style={{ backgroundColor: emp.role === 'admin' ? 'var(--secondary)' : 'var(--primary)' }} />
                          {emp.full_name}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          {emp.role === 'admin' ? 'Admin' : 'Field Worker'} &bull; Joined {new Date(emp.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                          {emp.created_by && (() => {
                            const creator = employees.find(e => e.id === emp.created_by);
                            return creator ? ` · Added by ${creator.full_name.split(' ')[0]}` : null;
                          })()}
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp size={16} color="var(--text-secondary)" /> : <ChevronDown size={16} color="var(--text-secondary)" />}
                    </div>

                    {isExpanded && (
                      <div style={{ padding: '0 0.75rem 1rem', background: 'rgba(255,255,255,0.02)' }}>
                        {editEmpError && <div className="alert alert-danger" style={{ padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.8rem' }}>{editEmpError}</div>}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: '0.72rem' }}>Full Name</label>
                            <input type="text" className="form-input" value={editEmpName} onChange={(e) => setEditEmpName(e.target.value)} style={{ fontSize: '0.85rem' }} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: '0.72rem' }}>Role</label>
                            <select className="form-select" value={editEmpRole} onChange={(e) => setEditEmpRole(e.target.value)} style={{ fontSize: '0.85rem' }}>
                              <option value="employee">Field Worker</option>
                              <option value="admin">Admin</option>
                            </select>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                          <button className="btn btn-primary" style={{ width: 'auto', padding: '0.3rem 0.85rem', fontSize: '0.8rem' }} disabled={editEmpLoading} onClick={() => handleSaveEmployee(emp.id)}>
                            {editEmpLoading ? <div className="spinner" style={{ width: '14px', height: '14px' }} /> : 'Save Changes'}
                          </button>
                          <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.3rem 0.85rem', fontSize: '0.8rem', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={() => handleDeleteEmployee(emp)}>
                            <Trash2 size={13} /> Delete Account
                          </button>
                        </div>

                        <div>
                          <p style={{ fontSize: '0.72rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Assigned Sites</p>
                          {siteError && <div className="alert alert-danger" style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem', marginBottom: '0.5rem' }}>{siteError}</div>}
                          {siteLoading ? (
                            <div className="spinner" style={{ width: '16px', height: '16px' }} />
                          ) : (
                            <>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem', minHeight: '28px' }}>
                                {assignedSites.length === 0 ? (
                                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No sites assigned yet.</span>
                                ) : (
                                  assignedSites.map(site => (
                                    <span key={site.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(16,185,129,0.12)', color: 'var(--primary)', fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '999px', border: '1px solid rgba(16,185,129,0.25)' }}>
                                      {site.name}
                                      <button onClick={() => handleRemoveSite(emp.id, site.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, display: 'flex' }}>
                                        <X size={11} />
                                      </button>
                                    </span>
                                  ))
                                )}
                              </div>
                              {unassignedClients.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                  <select className="form-select" value={addSiteId} onChange={(e) => setAddSiteId(e.target.value)} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}>
                                    <option value="">Select a site to assign…</option>
                                    {unassignedClients.map(c => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                  </select>
                                  <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.3rem 0.7rem', fontSize: '0.8rem', flexShrink: 0 }} disabled={!addSiteId || siteLoading} onClick={() => handleAssignSite(emp.id)}>
                                    <Plus size={13} /> Assign
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ATTENDANCE TAB */}
      {activeTab === 'attendance' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h3 className="card-title" style={{ fontSize: '1.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 0 }}>
                <Database size={20} className="logo-icon" />
                <span>Attendance Logs</span>
              </h3>
            </div>
            <button className="btn btn-primary" style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={handleExportCSV}>
              <Download size={16} />
              <span>Export to CSV</span>
            </button>
          </div>
          <p className="card-subtitle" style={{ marginBottom: '1.5rem' }}>Review check-in entries, check-out validations, and hourly location pings.</p>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Representative</th>
                  <th>Client Location</th>
                  <th>Date</th>
                  <th>Check In / Out</th>
                  <th>Duration</th>
                  <th>Photo</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {attendanceLogs.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                      No shifts logged in database yet.
                    </td>
                  </tr>
                ) : (
                  attendanceLogs.map((log) => (
                    <tr key={log.id} style={{ background: selectedSessionId === log.id ? 'rgba(255,255,255,0.05)' : 'none' }}>
                      <td>
                        <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span className="user-dot" style={{ width: '6px', height: '6px', opacity: log.check_out_time ? 0.3 : 1 }}></span>
                          {log.employee_name || 'Field Employee'}
                        </div>
                      </td>
                      <td>{log.client_name || 'Client Site'}</td>
                      <td>{formatDate(log.check_in_time)}</td>
                      <td>
                        <span style={{ color: 'var(--primary)' }}>{formatTime(log.check_in_time)}</span>
                        <span style={{ color: 'var(--text-secondary)' }}> → </span>
                        <span style={{ color: log.check_out_time ? 'var(--text-secondary)' : 'var(--warning)' }}>
                          {log.check_out_time ? formatTime(log.check_out_time) : 'On Duty'}
                        </span>
                      </td>
                      <td>{calculateDuration(log.check_in_time, log.check_out_time)}</td>
                      <td>
                        {log.check_in_photo_url ? (
                          <a href={log.check_in_photo_url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={log.check_in_photo_url}
                              alt="Check-in selfie"
                              style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(16,185,129,0.4)', display: 'block' }}
                            />
                          </a>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', width: 'auto' }} onClick={() => handleViewSessionPings(log)}>
                          Inspect Pings
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {selectedSessionId && (
            <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid var(--card-border)', borderRadius: '8px', background: 'rgba(255,255,255,0.01)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#fff' }}>Device Pings Audit Log</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Showing GPS telemetry captured from worker device during shift.</p>
                </div>
                <button className="btn btn-secondary" style={{ fontSize: '0.75rem', width: 'auto', padding: '0.25rem 0.5rem' }} onClick={() => setSelectedSessionId(null)}>
                  Close Audit
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Time Captured</th>
                        <th>Coordinates (Lat/Lng)</th>
                        <th>Battery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSessionLogs.length === 0 ? (
                        <tr>
                          <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            No background telemetry records written for this shift.
                          </td>
                        </tr>
                      ) : (
                        selectedSessionLogs.map((ping, idx) => (
                          <tr key={ping.id || idx}>
                            <td>{new Date(ping.timestamp).toLocaleTimeString()}</td>
                            <td style={{ color: 'var(--primary)', fontFamily: 'monospace' }}>
                              {ping.latitude.toFixed(6)}, {ping.longitude.toFixed(6)}
                            </td>
                            <td>🔋 {ping.battery_level}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="map-placeholder">
                  <div className="map-radar">
                    <div className="map-sweep"></div>
                  </div>
                  <div style={{ zIndex: 1 }}>
                    <p style={{ color: '#fff', fontSize: '0.85rem', fontWeight: '600' }}>GPS Telemetry Plotter</p>
                    <p style={{ fontSize: '0.75rem' }}>
                      {selectedSessionLogs.length > 0
                        ? `Plotted ${selectedSessionLogs.length} coordinates for this employee.`
                        : 'Waiting for coordinates mapping...'}
                    </p>
                  </div>
                  {selectedSessionLogs.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.2rem', zIndex: 1 }}>
                      <span style={{ fontSize: '0.7rem', background: 'rgba(16,185,129,0.2)', color: 'var(--primary)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                        Start: {selectedSessionLogs[0].latitude.toFixed(4)}, {selectedSessionLogs[0].longitude.toFixed(4)}
                      </span>
                      {selectedSessionLogs.length > 1 && (
                        <span style={{ fontSize: '0.7rem', background: 'rgba(99,102,241,0.2)', color: 'var(--secondary)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                          Last: {selectedSessionLogs[selectedSessionLogs.length - 1].latitude.toFixed(4)}, {selectedSessionLogs[selectedSessionLogs.length - 1].longitude.toFixed(4)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* LIVE VIEW TAB */}
      {activeTab === 'live' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h3 className="card-title" style={{ fontSize: '1.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <Activity size={20} className="logo-icon" />
                <span>Live Check-Ins</span>
                {activeCheckIns.length > 0 && (
                  <span style={{ fontSize: '0.8rem', fontWeight: '700', background: 'rgba(16,185,129,0.15)', color: 'var(--primary)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '999px', padding: '0.1rem 0.6rem' }}>
                    {activeCheckIns.length} on duty
                  </span>
                )}
              </h3>
              <p className="card-subtitle">Employees currently checked in. Auto-refreshes every 30 seconds.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {lastRefreshed && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Updated {lastRefreshed}
                </span>
              )}
              <button
                className="btn btn-secondary"
                onClick={fetchActiveCheckIns}
                disabled={liveLoading}
                style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <RefreshCw size={14} className={liveLoading ? 'spinner' : ''} style={{ border: 'none', animationDuration: '1.5s' }} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {liveLoading && activeCheckIns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 0' }}>
              <div className="spinner" style={{ width: '28px', height: '28px', margin: '0 auto 1rem' }} />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading active sessions…</p>
            </div>
          ) : activeCheckIns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 0' }}>
              <Activity size={40} style={{ color: 'var(--text-muted)', opacity: 0.4, marginBottom: '1rem' }} />
              <p style={{ color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '0.25rem' }}>No one is currently checked in</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Active sessions will appear here once a field worker checks in.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
              {activeCheckIns.map((session) => (
                <div
                  key={session.id}
                  style={{
                    padding: '1.1rem',
                    border: '1px solid rgba(16,185,129,0.2)',
                    borderRadius: '12px',
                    background: 'rgba(16,185,129,0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}
                >
                  {/* Employee name + role */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span
                      style={{
                        width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                        backgroundColor: 'var(--primary)',
                        boxShadow: '0 0 0 3px rgba(16,185,129,0.25)',
                        animation: 'pulse 2s infinite'
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: '700', color: '#fff', fontSize: '0.95rem' }}>{session.employee_name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                        {session.employee_role === 'admin' ? 'Admin' : 'Field Worker'}
                      </div>
                    </div>
                  </div>

                  {/* Site */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <MapPin size={14} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <div style={{ fontWeight: '600', color: '#fff', fontSize: '0.85rem' }}>{session.client_name}</div>
                      {session.client_address && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{session.client_address}</div>
                      )}
                    </div>
                  </div>

                  {/* Check-in time + elapsed */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      <Clock size={13} />
                      <span>In since {formatTime(session.check_in_time)}</span>
                    </div>
                    <span style={{
                      fontSize: '0.75rem', fontWeight: '700',
                      background: 'rgba(16,185,129,0.12)', color: 'var(--primary)',
                      padding: '0.15rem 0.55rem', borderRadius: '999px',
                      border: '1px solid rgba(16,185,129,0.2)'
                    }}>
                      {getElapsed(session.check_in_time)}
                    </span>
                  </div>

                  {/* GPS coordinates */}
                  {session.check_in_latitude && session.check_in_longitude && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace', borderTop: '1px solid var(--card-border)', paddingTop: '0.6rem' }}>
                      📍 {session.check_in_latitude.toFixed(5)}, {session.check_in_longitude.toFixed(5)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
