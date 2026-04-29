import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../config/api';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const [form,         setForm]         = useState({ email: '', password: '' });
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { login }  = useAuth();
  const navigate   = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.email || !form.password) {
      setError('Please fill in both email and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Please enter a valid email address.');
      return;
    }
    try {
      setLoading(true);
      const res  = await api.post('/api/auth/login', form);
      const user = res.data?.user;
      if (user) {
        login(user);
        navigate('/dashboard', { replace: true });
      } else {
        setError('Unexpected response from server.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const enterAsGuest = () => {
    login({ id: 'guest', name: 'Guest User', email: 'guest@local' });
    navigate('/dashboard', { replace: true });
  };

  return (
    <div style={styles.page}>
      {/* Ambient blobs */}
      <div style={{ ...styles.blob, top:'-120px', left:'-80px',  background:'radial-gradient(circle, rgba(0,229,160,0.18) 0%, transparent 70%)' }} />
      <div style={{ ...styles.blob, bottom:'-80px', right:'-60px', background:'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)' }} />

      <div style={styles.card}>
        {/* Logo / brand */}
        <div style={styles.brand}>
          <div style={styles.logoBox}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2"/>
              <path d="M12 7v5l3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div style={styles.brandName}>AirQuality Pro</div>
            <div style={styles.brandSub}>Environmental Intelligence</div>
          </div>
        </div>

        <h1 style={styles.title}>Welcome back</h1>
        <p style={styles.subtitle}>Sign in to access your live air quality dashboard</p>

        <form onSubmit={handleSubmit} noValidate style={{ width:'100%' }}>
          {/* Email */}
          <div style={styles.fieldGroup}>
            <label style={styles.label} htmlFor="login-email">Email address</label>
            <div style={styles.inputWrapper}>
              <span style={styles.inputIcon}>✉</span>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={handleChange}
                placeholder="you@example.com"
                style={styles.input}
                onFocus={e => e.target.parentNode.style.borderColor = '#00e5a0'}
                onBlur={e  => e.target.parentNode.style.borderColor = 'rgba(255,255,255,0.12)'}
              />
            </div>
          </div>

          {/* Password */}
          <div style={styles.fieldGroup}>
            <label style={styles.label} htmlFor="login-password">Password</label>
            <div style={styles.inputWrapper}>
              <span style={styles.inputIcon}>🔐</span>
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={form.password}
                onChange={handleChange}
                placeholder="Your password"
                style={{ ...styles.input, paddingRight:'48px' }}
                onFocus={e => e.target.parentNode.style.borderColor = '#00e5a0'}
                onBlur={e  => e.target.parentNode.style.borderColor = 'rgba(255,255,255,0.12)'}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={styles.eyeBtn}>
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={styles.errorBox}>
              <span>⚠</span> {error}
            </div>
          )}

          {/* Submit */}
          <button type="submit" disabled={loading} style={{ ...styles.btnPrimary, opacity: loading ? 0.7 : 1 }}>
            {loading
              ? <><span style={styles.spinner} /> Signing in…</>
              : 'Sign In'}
          </button>
        </form>

        {/* Divider */}
        <div style={styles.divider}>
          <div style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <div style={styles.dividerLine} />
        </div>

        {/* Guest */}
        <button type="button" onClick={enterAsGuest} style={styles.btnGhost}>
          Continue as Guest
        </button>

        {/* Footer link */}
        <p style={styles.footerText}>
          Don't have an account?{' '}
          <Link to="/signup" style={styles.link}>Create one</Link>
        </p>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #070d1c 0%, #0b1328 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Inter', system-ui, sans-serif",
    padding: '24px',
    position: 'relative',
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    width: '500px',
    height: '500px',
    borderRadius: '50%',
    pointerEvents: 'none',
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '24px',
    padding: '44px 40px',
    width: '100%',
    maxWidth: '440px',
    boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0px',
    position: 'relative',
    zIndex: 1,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '28px',
  },
  logoBox: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #00e5a0, #06b6d4)',
    boxShadow: '0 4px 20px rgba(0,229,160,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#e8eef8',
    letterSpacing: '-0.01em',
  },
  brandSub: {
    fontSize: '11px',
    color: '#00e5a0',
    fontWeight: '600',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginTop: '1px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '800',
    color: '#e8eef8',
    letterSpacing: '-0.02em',
    margin: '0 0 8px',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(232,238,248,0.5)',
    margin: '0 0 28px',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  fieldGroup: {
    width: '100%',
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: 'rgba(232,238,248,0.7)',
    marginBottom: '7px',
    letterSpacing: '0.01em',
  },
  inputWrapper: {
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    position: 'relative',
  },
  inputIcon: {
    padding: '0 10px 0 14px',
    fontSize: '15px',
    opacity: 0.5,
    pointerEvents: 'none',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#e8eef8',
    fontSize: '14px',
    padding: '12px 12px 12px 0',
    fontFamily: 'inherit',
    width: '100%',
  },
  eyeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 12px',
    fontSize: '16px',
    opacity: 0.6,
    position: 'absolute',
    right: 0,
    top: '50%',
    transform: 'translateY(-50%)',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.4)',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#fca5a5',
    marginBottom: '16px',
    width: '100%',
  },
  btnPrimary: {
    width: '100%',
    padding: '13px',
    borderRadius: '10px',
    border: 'none',
    background: 'linear-gradient(135deg, #00e5a0, #06b6d4)',
    color: '#012d1a',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    letterSpacing: '0.02em',
    boxShadow: '0 4px 20px rgba(0,229,160,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontFamily: 'inherit',
    transition: 'box-shadow 0.2s, transform 0.15s',
    marginTop: '4px',
  },
  spinner: {
    display: 'inline-block',
    width: '16px',
    height: '16px',
    border: '2px solid rgba(1,45,26,0.4)',
    borderTopColor: '#012d1a',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    margin: '20px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(255,255,255,0.08)',
  },
  dividerText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '500',
  },
  btnGhost: {
    width: '100%',
    padding: '12px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'transparent',
    color: 'rgba(232,238,248,0.65)',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.2s, border-color 0.2s',
    letterSpacing: '0.01em',
  },
  footerText: {
    fontSize: '13px',
    color: 'rgba(232,238,248,0.45)',
    marginTop: '20px',
    textAlign: 'center',
  },
  link: {
    color: '#00e5a0',
    fontWeight: '600',
    textDecoration: 'none',
  },
};

export default Login;