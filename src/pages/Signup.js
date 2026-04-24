import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../config/api';
import { useAuth } from '../context/AuthContext';
import './FullDashboard.css';

const Signup = () => {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Client-side validation
    if (!form.name || !form.email || !form.password) {
      setError('Please fill in all fields.');
      return;
    }

    try {
      setLoading(true);
      const res = await api.post('/api/auth/signup', form);
      setSuccess(res.data?.message || 'Signup successful');
      setForm({ name: '', email: '', password: '' });
    } catch (err) {
      console.error('Signup frontend error:', err);

      // Network-level issues
      if (err.message === 'Network Error' || err.code === 'ECONNABORTED') {
        setError('Network error: could not reach server. Confirm backend is running on port 5000.');
        return;
      }

      const backendMsg = err.response?.data?.message;
      const status = err.response?.status;

      if (backendMsg) {
        if (status === 409) {
          setError('This email address is already registered. Please log in.');
        } else if (status === 400) {
          setError(`Invalid data: ${backendMsg}`);
        } else if (status === 500) {
          setError(`Server error: ${backendMsg}`);
        } else {
          setError(`Signup failed: ${backendMsg}${status ? ` (status ${status})` : ''}`);
        }
      } else if (status) {
        setError(`Unexpected error (status ${status})`);
      } else {
        setError('Error signing up');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="full-dashboard-container">
      <div className="full-dashboard-header">
        <h1>User Signup</h1>
        <p>Create an account to personalize your air quality dashboard.</p>
      </div>

      <div className="card" style={{ maxWidth: 480, margin: '0 auto' }}>
        <form onSubmit={handleSubmit} className="settings-form">
          <div className="form-group">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              placeholder="Your name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              placeholder="At least 6 characters"
            />
          </div>

          {error && <p style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</p>}
          {success && <p style={{ color: 'var(--success)', marginBottom: 8 }}>{success}</p>}

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Signing up...' : 'Sign up'}
          </button>

          <button
            type="button"
            onClick={() => {
              login({ id: 'guest', name: 'Guest User', email: 'guest@local' });
              navigate('/dashboard', { replace: true });
            }}
            style={{
              marginTop: 12,
              width: '100%',
              padding: '10px',
              border: '1px solid var(--border)',
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: '4px',
              fontSize: '14px',
              color: 'var(--text-secondary)',
            }}
          >
            Skip for now (Guest)
          </button>
        </form>
      </div>
    </div>
  );
};

export default Signup;