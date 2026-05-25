import React, { useState, useEffect } from 'react';
import { Flower, Cloud, CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { dbService } from './services/dbService';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // Offline sync queue state
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState('');

  // Monitor network online/offline state & manage queue syncs
  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(navigator.onLine);
      if (navigator.onLine) {
        handleTriggerSync();
      }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    const queuePollInterval = setInterval(() => {
      setQueueCount(dbService.getQueueLength());
    }, 5000);

    setQueueCount(dbService.getQueueLength());

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      clearInterval(queuePollInterval);
    };
  }, []);

  // Fetch current session on mount
  useEffect(() => {
    const loadSession = async () => {
      try {
        const session = await dbService.getCurrentUser();
        if (session) {
          setUser(session.user);
          setProfile(session.profile);
        }
      } catch (err) {
        console.error('Error fetching session:', err);
      } finally {
        setLoading(false);
      }
    };
    loadSession();
  }, []);

  // Sync handler
  const handleTriggerSync = async () => {
    if (!navigator.onLine) return;
    
    const count = dbService.getQueueLength();
    if (count === 0) return;

    setSyncing(true);
    setSyncSuccess('');
    
    try {
      const { syncedCount } = await dbService.syncOfflineQueue();
      if (syncedCount > 0) {
        setSyncSuccess(`Synced ${syncedCount} offline records to cloud!`);
        setQueueCount(dbService.getQueueLength());
        setTimeout(() => setSyncSuccess(''), 4000);
      }
    } catch (err) {
      console.error('Offline queue sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleLoginSuccess = (currentUser, currentProfile) => {
    setUser(currentUser);
    setProfile(currentProfile);
  };

  const handleLogout = async () => {
    await dbService.logout();
    setUser(null);
    setProfile(null);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '1rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Initializing application...</span>
      </div>
    );
  }

  return (
    <div className={`app-container ${profile?.role === 'admin' ? 'admin-wide' : ''}`}>
      {/* Top Header bar */}
      <header className="app-header">
        <div className="logo-group">
          <Flower className="logo-icon" size={24} />
          <span className="logo-text">HortTrack</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* Online/Offline Status Indicator */}
          <div 
            className="user-widget" 
            style={{ 
              fontSize: '0.75rem', 
              color: isOnline ? 'var(--primary)' : 'var(--danger)',
              borderColor: isOnline ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
              background: isOnline ? 'rgba(16,185,129,0.03)' : 'rgba(239,68,68,0.03)' 
            }}
          >
            {isOnline ? <Cloud size={14} /> : <CloudOff size={14} />}
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </div>

          {profile && (
            <>
              <div className="user-widget">
                <span className="user-dot" style={{ backgroundColor: profile.role === 'admin' ? 'var(--secondary)' : 'var(--primary)' }}></span>
                <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>
                  {profile.full_name.split(' ')[0]}
                </span>
              </div>
              <button
                className="btn btn-secondary"
                onClick={handleLogout}
                style={{ width: 'auto', padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
              >
                Log Out
              </button>
            </>
          )}
        </div>
      </header>

      {/* Sync Queue Banners */}
      {queueCount > 0 && (
        <div 
          className="alert" 
          style={{ 
            background: 'rgba(245,158,11,0.1)', 
            border: '1px solid rgba(245,158,11,0.3)', 
            color: '#fef08a',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
            padding: '0.75rem 1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={18} className="logo-icon" style={{ color: 'var(--warning)' }} />
            <span style={{ fontSize: '0.85rem' }}>
              <strong>{queueCount} unsynced records</strong> cached locally due to weak network.
            </span>
          </div>
          <button 
            className="btn btn-secondary"
            disabled={syncing || !isOnline}
            style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
            onClick={handleTriggerSync}
          >
            <RefreshCw size={12} className={syncing ? 'spinner' : ''} style={{ border: 'none', animationDuration: '2s' }} />
            <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        </div>
      )}

      {syncSuccess && (
        <div className="alert alert-success" style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem' }}>
          <span>{syncSuccess}</span>
        </div>
      )}

      {/* Main Content Body */}
      <main style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
        {!user ? (
          <Login onLoginSuccess={handleLoginSuccess} />
        ) : (
          <>
            {profile.role === 'admin' ? (
              <AdminPanel user={user} profile={profile} />
            ) : (
              <Dashboard user={user} profile={profile} onLogout={handleLogout} />
            )}
          </>
        )}
      </main>

      <footer style={{ marginTop: '3rem', padding: '1rem 0', textAlign: 'center', borderTop: '1px solid var(--card-border)' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
          HortTrack Verification System &copy; {new Date().getFullYear()} &bull; Secure GPS Tracker &bull; v1.0
        </p>
      </footer>
    </div>
  );
}
