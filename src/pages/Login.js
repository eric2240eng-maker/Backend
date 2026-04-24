import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../config/api';
import { useAuth } from '../context/AuthContext';
import './FullDashboard.css';

const Login = () => {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false); // New state for password toggle
  
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // --- ENHANCED CLIENT-SIDE VALIDATION ---
    if (!form.email || !form.password) {
      setError('Please fill in both the email and password fields.'); // More specific message
      return;
    }
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Please enter a valid email address.');
      return;
    }
    // --- END VALIDATION ---

    try {
      setLoading(true);
      const res = await api.post('/api/auth/login', form);
      const user = res.data?.user;
      if (user) {
        login(user);
        navigate('/dashboard', { replace: true });
      } else {
         // Should generally not happen if backend is correct, but good safety
         setError('Login attempt failed with an unexpected response.');
      }
    } catch (err) {
      // --- IMPROVED ERROR HANDLING ---
      // Use a more descriptive default message for failed login
      const msg = err.response?.data?.message || 'Login failed. Please check your email and password.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="full-dashboard-container">
      <div className="full-dashboard-header">
        <h1>Login</h1>
        <p>Sign in to access your air quality dashboard.</p>
      </div>

      <div className="card" style={{ maxWidth: 480, margin: '0 auto' }}>
        <form onSubmit={handleSubmit} className="settings-form">
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
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                name="password"
                // Toggle the type based on showPassword state
                type={showPassword ? 'text' : 'password'} 
                value={form.password}
                onChange={handleChange}
                placeholder="Your password"
              />
              {/* Password visibility toggle button */}
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#666',
                  padding: '5px',
                  lineHeight: '1',
                }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {/* Replace with an actual eye icon for better UX */}
                {showPassword ? '👁️' : '🔒'} 
              </button>
            </div>
          </div>

          {error && <p style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</p>}

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
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

        <p style={{ marginTop: 12, fontSize: 14 }}>
          No account yet? <Link to="/signup">Create one</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;