import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Compass, ShieldAlert, CheckCircle, Clock, Battery } from 'lucide-react';
import { dbService, calculateDistance } from '../services/dbService';

export default function Dashboard({ user, profile, onLogout }) {
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [activeSession, setActiveSession] = useState(null);
  
  // GPS Coordinates state
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const [trackingGps, setTrackingGps] = useState(false);

  // Geofencing and check-in configuration
  const [distanceToClient, setDistanceToClient] = useState(null);
  const maxGeofenceDistance = 100; // 100 meters, as requested!
  const isWithinRange = distanceToClient !== null && distanceToClient <= maxGeofenceDistance;

  const [locationLogs, setLocationLogs] = useState([]);
  const [batteryLevel, setBatteryLevel] = useState(0.85); // fallback battery level simulation
  
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Refs for tracking active session pings
  const pingIntervalRef = useRef(null);
  const gpsWatchRef = useRef(null);

  // Load clients and active session
  useEffect(() => {
    fetchClients();
    fetchActiveSession();
    startGpsTracking();
    detectBattery();

    return () => {
      stopGpsTracking();
      stopPingScheduler();
    };
  }, []);

  // Update client distance when client changes or GPS location updates
  useEffect(() => {
    if (selectedClientId && latitude !== null && longitude !== null) {
      const client = clients.find(c => c.id === selectedClientId);
      if (client) {
        const dist = calculateDistance(latitude, longitude, client.latitude, client.longitude);
        setDistanceToClient(dist);
      }
    } else {
      setDistanceToClient(null);
    }
  }, [selectedClientId, latitude, longitude, clients]);

  // Handle periodic location pings while checked in
  useEffect(() => {
    if (activeSession) {
      startPingScheduler();
      fetchLocationLogs(activeSession.id);
    } else {
      stopPingScheduler();
      setLocationLogs([]);
    }
  }, [activeSession]);

  // Battery API detection
  const detectBattery = () => {
    if (navigator.getBattery) {
      navigator.getBattery().then((bat) => {
        setBatteryLevel(bat.level);
        bat.addEventListener('levelchange', () => {
          setBatteryLevel(bat.level);
        });
      });
    }
  };

  const fetchClients = async () => {
    try {
      const data = await dbService.getAssignedClients(profile.id);
      setClients(data);
      if (data.length > 0) {
        setSelectedClientId(data[0].id);
      }
    } catch (err) {
      setErrorMessage('Failed to load assigned sites.');
    }
  };

  const fetchActiveSession = async () => {
    try {
      const session = await dbService.getActiveSession(profile.id);
      setActiveSession(session);
      if (session) {
        setSelectedClientId(session.client_id);
      }
    } catch (err) {
      setErrorMessage('Failed to check active shift status.');
    }
  };

  const fetchLocationLogs = async (sessionId) => {
    try {
      const logs = await dbService.getLocationLogs(sessionId);
      setLocationLogs(logs);
    } catch (err) {
      console.error('Error loading location logs:', err);
    }
  };

  // Start watching location using browser Geolocation API
  const startGpsTracking = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your device.');
      return;
    }

    setTrackingGps(true);
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);
        setGpsAccuracy(position.coords.accuracy);
        setGpsError('');
        
        dbService.getAssignedClients(profile.id).then(setClients);
      },
      (err) => {
        setGpsError(`GPS Error: ${err.message}. Make sure Location is enabled.`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const stopGpsTracking = () => {
    if (gpsWatchRef.current) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
    setTrackingGps(false);
  };

  // Check-In handler
  const handleCheckIn = async () => {
    if (latitude === null || longitude === null) {
      setErrorMessage('Cannot check in. GPS location not acquired yet.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const session = await dbService.checkIn(selectedClientId, latitude, longitude, maxGeofenceDistance);
      setActiveSession(session);
      setStatusMessage('Successfully Checked In!');
      
      // Fire initial background location ping immediately on check-in
      await dbService.logLocation(session.id, latitude, longitude, batteryLevel);
      fetchLocationLogs(session.id);
    } catch (err) {
      setErrorMessage(err.message || 'Check-in failed.');
    } finally {
      setLoading(false);
    }
  };

  // Check-Out handler
  const handleCheckOut = async () => {
    if (!activeSession) return;
    if (latitude === null || longitude === null) {
      setErrorMessage('GPS location not acquired. Check-out will log last known GPS.');
    }

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const lat = latitude || activeSession.check_in_latitude;
      const lng = longitude || activeSession.check_in_longitude;
      
      // Perform check out in DB
      await dbService.checkOut(activeSession.id, lat, lng);
      
      // Fire final background location log
      await dbService.logLocation(activeSession.id, lat, lng, batteryLevel);
      
      setActiveSession(null);
      setDistanceToClient(null);
      setStatusMessage('Successfully Checked Out! Shift ended.');
    } catch (err) {
      setErrorMessage(err.message || 'Check-out failed.');
    } finally {
      setLoading(false);
    }
  };

  // Background Geolocation Scheduler (Interval simulation)
  const startPingScheduler = () => {
    stopPingScheduler(); // Clear previous first

    const intervalMs = 3600000; // 1 hour

    pingIntervalRef.current = setInterval(async () => {
      // Fetch fresh GPS position for the ping
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (!activeSession) return;
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          
          try {
            await dbService.logLocation(activeSession.id, lat, lng, batteryLevel);
            fetchLocationLogs(activeSession.id);
            console.log('Location logged successfully:', { lat, lng });
          } catch (e) {
            console.error('Failed to log location in background:', e);
          }
        },
        (err) => {
          console.warn('Could not retrieve GPS for hourly log:', err);
        },
        { enableHighAccuracy: true }
      );
    }, intervalMs);
  };

  const stopPingScheduler = () => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  };

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700' }}>Hello, {profile.full_name}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Role: Field Representative</p>
      </div>

      {statusMessage && (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="alert alert-danger">
          <ShieldAlert size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Geofencing Warn System */}
      {!activeSession && selectedClientId && distanceToClient !== null && (
        <>
          {isWithinRange ? (
            <div className="alert alert-success" style={{ margin: '1rem 0' }}>
              <MapPin size={18} />
              <span>Location verified! You are inside the geofence ({Math.round(distanceToClient)}m away). Ready to Check In.</span>
            </div>
          ) : (
            <div className="alert alert-danger" style={{ margin: '1rem 0' }}>
              <ShieldAlert size={18} />
              <div>
                <strong>Out of Range!</strong>
                <p style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  You are {Math.round(distanceToClient)}m away. Check-in is locked until you are within {maxGeofenceDistance}m.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Active Shift details banner */}
      {activeSession && (
        <div className="alert alert-info" style={{ margin: '1rem 0' }}>
          <Clock size={18} />
          <div>
            <strong>Active Shift Session</strong>
            <p style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
              Checked in at <strong>{activeSession.client_name}</strong> since {new Date(activeSession.check_in_time).toLocaleTimeString()}
            </p>
          </div>
        </div>
      )}

      {/* Main Form Fields */}
      {clients.length === 0 && !activeSession ? (
        <div className="alert alert-danger" style={{ margin: '1rem 0' }}>
          <ShieldAlert size={18} />
          <span>You have no assigned sites. Contact your administrator to be assigned to a location.</span>
        </div>
      ) : (
        <div className="form-group">
          <label className="form-label">Select Client Site</label>
          <div className="input-container">
            <select
              className="form-select"
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              disabled={!!activeSession}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <MapPin className="input-icon" size={18} />
          </div>
          {selectedClientId && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', paddingLeft: '0.25rem' }}>
              📍 {clients.find(c => c.id === selectedClientId)?.address}
            </p>
          )}
        </div>
      )}

      {/* Pulse Check-in Circle Button */}
      <div className="check-in-container">
        <div className={`pulse-btn-wrapper ${activeSession ? 'checked-in' : 'checked-out'}`}>
          <div className="pulse-bg"></div>
          <button
            className="pulse-btn"
            disabled={loading || (latitude === null && !activeSession) || (!isWithinRange && !activeSession)}
            onClick={activeSession ? handleCheckOut : handleCheckIn}
          >
            <Compass size={32} />
            <span>{activeSession ? 'Check Out' : 'Check In'}</span>
          </button>
        </div>
        
        {latitude === null && !activeSession && (
          <span style={{ fontSize: '0.8rem', color: 'var(--warning)', marginTop: '0.75rem' }}>
            🛰️ Waiting for GPS lock...
          </span>
        )}
      </div>

      {/* GPS Status Box */}
      <div className="gps-status-box">
        <h4 style={{ fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Device telemetry
        </h4>
        <div className="status-row">
          <span className="status-label">Signal Accuracy</span>
          <span className={`status-value ${gpsError ? 'danger' : gpsAccuracy < 10 ? 'success' : 'warning'}`}>
            {gpsError ? 'OFFLINE' : gpsAccuracy ? `${Math.round(gpsAccuracy)} meters` : 'Acquiring...'}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">Coordinates</span>
          <span className="status-value neutral">
            {latitude !== null ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : 'N/A'}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">Battery Monitored</span>
          <span className="status-value neutral" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Battery size={14} color={batteryLevel < 0.2 ? 'red' : 'green'} />
            {Math.round(batteryLevel * 100)}%
          </span>
        </div>
      </div>

      {/* Active Session Location Logs (Hourly Pings list) */}
      {activeSession && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Shift Pings Log ({locationLogs.length})
            </h4>
          </div>
          
          <div className="log-list" style={{ maxHeight: '150px' }}>
            {locationLogs.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem 0' }}>
                Waiting for background location ping...
              </p>
            ) : (
              [...locationLogs].reverse().map((log, idx) => (
                <div key={log.id || idx} className="log-item" style={{ padding: '0.5rem 0.75rem' }}>
                  <div className="log-meta">
                    <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span>🔋 {log.battery_level}%</span>
                  </div>
                  <div className="log-details" style={{ fontSize: '0.8rem' }}>
                    <span>Ping #{locationLogs.length - idx}</span>
                    <span style={{ color: 'var(--primary)' }}>
                      {log.latitude.toFixed(5)}, {log.longitude.toFixed(5)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

    </div>
  );
}
