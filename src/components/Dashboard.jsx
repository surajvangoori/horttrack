import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Compass, ShieldAlert, CheckCircle, Clock, Battery, Camera, RotateCcw, X } from 'lucide-react';
import { dbService, calculateDistance } from '../services/dbService';

const compressImage = (file) => new Promise((resolve) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const MAX_WIDTH = 1024;
    const scale = Math.min(1, MAX_WIDTH / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(resolve, 'image/jpeg', 0.72);
  };
  img.src = url;
});

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

  // Geofencing
  const [distanceToClient, setDistanceToClient] = useState(null);
  const maxGeofenceDistance = 100;
  const isWithinRange = distanceToClient !== null && distanceToClient <= maxGeofenceDistance;

  const [locationLogs, setLocationLogs] = useState([]);
  const [batteryLevel, setBatteryLevel] = useState(0.85);

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Photo capture state
  const [photoStep, setPhotoStep] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [photoCompressing, setPhotoCompressing] = useState(false);
  const cameraInputRef = useRef(null);

  const pingIntervalRef = useRef(null);
  const gpsWatchRef = useRef(null);

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

  // Revoke object URL when photo preview changes to avoid memory leaks
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

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

  useEffect(() => {
    if (activeSession) {
      startPingScheduler();
      fetchLocationLogs(activeSession.id);
    } else {
      stopPingScheduler();
      setLocationLogs([]);
    }
  }, [activeSession]);

  const detectBattery = () => {
    if (navigator.getBattery) {
      navigator.getBattery().then((bat) => {
        setBatteryLevel(bat.level);
        bat.addEventListener('levelchange', () => setBatteryLevel(bat.level));
      });
    }
  };

  const fetchClients = async () => {
    try {
      const data = await dbService.getAssignedClients(profile.id);
      setClients(data);
      if (data.length > 0) setSelectedClientId(data[0].id);
    } catch (err) {
      setErrorMessage('Failed to load assigned sites.');
    }
  };

  const fetchActiveSession = async () => {
    try {
      const session = await dbService.getActiveSession(profile.id);
      setActiveSession(session);
      if (session) setSelectedClientId(session.client_id);
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

  const startGpsTracking = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your device.');
      return;
    }
    setTrackingGps(true);
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
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

  // Step 1: validate GPS + geofence, then open photo capture (online) or check in directly (offline)
  const handleCheckIn = () => {
    if (latitude === null || longitude === null) {
      setErrorMessage('Cannot check in. GPS location not acquired yet.');
      return;
    }
    setErrorMessage('');
    setStatusMessage('');

    if (!navigator.onLine) {
      // Offline — skip photo, queue check-in directly
      handleConfirmCheckIn(null);
      return;
    }

    setPhotoStep(true);
  };

  // Step 2: called after photo is taken (or null if offline)
  const handleConfirmCheckIn = async (photoBlob) => {
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const session = await dbService.checkIn(selectedClientId, latitude, longitude, maxGeofenceDistance);
      setActiveSession(session);

      // Upload photo if we have one and the session is real (not a temp offline ID)
      if (photoBlob && navigator.onLine && !session.id.startsWith('sess-temp-')) {
        try {
          const photoUrl = await dbService.uploadCheckInPhoto(photoBlob, profile.id, session.id);
          await dbService.savePhotoUrl(session.id, photoUrl);
        } catch (photoErr) {
          console.warn('Photo upload failed (check-in still recorded):', photoErr);
        }
      }

      setStatusMessage('Successfully Checked In!');
      clearPhotoState();

      await dbService.logLocation(session.id, latitude, longitude, batteryLevel);
      fetchLocationLogs(session.id);
    } catch (err) {
      setErrorMessage(err.message || 'Check-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoCompressing(true);
    try {
      const compressed = await compressImage(file);
      const previewUrl = URL.createObjectURL(compressed);
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      setCapturedPhoto(compressed);
      setPhotoPreviewUrl(previewUrl);
    } finally {
      setPhotoCompressing(false);
    }
    // Reset so the same file can be re-selected on retake
    e.target.value = '';
  };

  const handleRetakePhoto = () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setCapturedPhoto(null);
    setPhotoPreviewUrl('');
    // Re-open the camera
    setTimeout(() => cameraInputRef.current?.click(), 50);
  };

  const handleCancelPhotoStep = () => {
    clearPhotoState();
  };

  const clearPhotoState = () => {
    setPhotoStep(false);
    setCapturedPhoto(null);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl('');
  };

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
      await dbService.checkOut(activeSession.id, lat, lng);
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

  const startPingScheduler = () => {
    stopPingScheduler();
    pingIntervalRef.current = setInterval(async () => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (!activeSession) return;
          try {
            await dbService.logLocation(activeSession.id, position.coords.latitude, position.coords.longitude, batteryLevel);
            fetchLocationLogs(activeSession.id);
          } catch (e) {
            console.error('Failed to log location in background:', e);
          }
        },
        (err) => console.warn('Could not retrieve GPS for hourly log:', err),
        { enableHighAccuracy: true }
      );
    }, 3600000);
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

      {/* Geofencing status */}
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

      {/* Active shift banner */}
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

      {/* Client selector */}
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

      {/* ── PHOTO CAPTURE STEP ── */}
      {photoStep && !activeSession && (
        <div style={{
          margin: '1rem 0',
          padding: '1.5rem',
          border: '1px solid var(--card-border)',
          borderRadius: '14px',
          background: 'rgba(255,255,255,0.02)',
          textAlign: 'center'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div style={{ textAlign: 'left' }}>
              <p style={{ fontWeight: '700', color: '#fff', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Camera size={16} style={{ color: 'var(--primary)' }} /> Selfie Required
              </p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                {capturedPhoto ? 'Looking good! Confirm to check in.' : 'Take a photo to verify your identity.'}
              </p>
            </div>
            <button
              onClick={handleCancelPhotoStep}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', display: 'flex' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Hidden file input — front camera */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="user"
            style={{ display: 'none' }}
            onChange={handlePhotoCapture}
          />

          {!capturedPhoto ? (
            /* Camera trigger */
            <div>
              <button
                onClick={() => cameraInputRef.current?.click()}
                disabled={photoCompressing}
                style={{
                  width: '100px', height: '100px', borderRadius: '50%',
                  border: '2px dashed rgba(16,185,129,0.4)',
                  background: 'rgba(16,185,129,0.07)',
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '0.4rem', margin: '0 auto 1rem',
                  transition: 'border-color 0.2s, background 0.2s'
                }}
              >
                {photoCompressing
                  ? <div className="spinner" style={{ width: '24px', height: '24px' }} />
                  : <Camera size={28} style={{ color: 'var(--primary)' }} />
                }
              </button>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {photoCompressing ? 'Compressing…' : 'Tap to open camera'}
              </p>
            </div>
          ) : (
            /* Preview + confirm */
            <div>
              <img
                src={photoPreviewUrl}
                alt="Check-in selfie preview"
                style={{
                  width: '120px', height: '120px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '3px solid var(--primary)',
                  margin: '0 auto 1.25rem',
                  display: 'block'
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <button
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={() => handleConfirmCheckIn(capturedPhoto)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                >
                  {loading
                    ? <div className="spinner" style={{ width: '18px', height: '18px' }} />
                    : <><CheckCircle size={16} /> Confirm Check In</>
                  }
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={loading}
                  onClick={handleRetakePhoto}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                >
                  <RotateCcw size={14} /> Retake
                </button>
              </div>
            </div>
          )}

          {!navigator.onLine && (
            <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '1rem' }}>
              Offline — photo will be skipped. Check-in will be queued.
            </p>
          )}
        </div>
      )}

      {/* Pulse Check-in / Check-out button — hidden during photo step */}
      {!photoStep && (
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
      )}

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
    </div>
  );
}
