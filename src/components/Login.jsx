import React, { useState } from 'react';
import { Mail, Lock, Check, Flower } from 'lucide-react';
import { dbService } from '../services/dbService';

export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const { user, profile } = await dbService.login(email, password);
      setSuccess('Logged in successfully!');
      setTimeout(() => {
        onLoginSuccess(user, profile);
      }, 800);
    } catch (err) {
      setError(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div className="logo-group" style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>
            <Flower size={36} className="logo-icon" />
            <span className="logo-text">HortTrack</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Attendance & Background Location Verifier
          </p>
        </div>

        <h2 className="card-title" style={{ textAlign: 'center' }}>Sign In</h2>
        <p className="card-subtitle" style={{ textAlign: 'center' }}>
          Enter your details to log in to your portal
        </p>

        {error && (
          <div className="alert alert-danger">
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="alert alert-success">
            <Check size={18} />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="input-container">
              <input
                type="email"
                className="form-input"
                placeholder="name@horttrack.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Mail className="input-icon" size={18} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="input-container">
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Lock className="input-icon" size={18} />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '1rem' }}>
            {loading ? <div className="spinner" style={{ width: '18px', height: '18px' }} /> : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Contact your administrator to get access.
        </p>
      </div>
    </div>
  );
}
