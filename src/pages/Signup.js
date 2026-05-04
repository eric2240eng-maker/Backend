import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../config/api';
import { useAuth } from '../context/AuthContext';

const Signup = () => {
  const [form,    setForm]    = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [showPw,  setShowPw]  = useState(false);

  const { login } = useAuth();
  const navigate  = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const passwordStrength = (pw) => {
    if (!pw) return { score: 0, label: '', color: 'transparent' };
    let score = 0;
    if (pw.length >= 8)            score++;
    if (/[A-Z]/.test(pw))          score++;
    if (/[0-9]/.test(pw))          score++;
    if (/[^A-Za-z0-9]/.test(pw))   score++;
    const map = [
      { label: 'Too short',  color: '#ef4444' },
      { label: 'Weak',       color: '#f97316' },
      { label: 'Fair',       color: '#f59e0b' },
      { label: 'Strong',     color: '#10b981' },
      { label: 'Very strong',color: '#00e5a0' },
    ];
    return { score, ...map[score] };
  };

  const pwStr = passwordStrength(form.password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!form.name || !form.email || !form.password) {
      setError('Please fill in all fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    try {
      setLoading(true);
      const res = await api.post('/api/auth/signup', form);
      setSuccess(res.data?.message || 'Account created! You can now log in.');
      setForm({ name: '', email: '', password: '' });
    } catch (err) {
      const status = err.response?.status;
      const msg    = err.response?.data?.message;
      if (status === 409)                  setError('This email is already registered.');
      else if (msg)                        setError(msg);
      else if (err.code === 'ERR_NETWORK') setError('Cannot reach server. Check your connection.');
      else if (err.message === 'Network Error') setError('Cannot reach server. Check your connection.');
      else                                 setError(`Signup failed: ${err.message || 'Please try again.'}`);
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
      <div style={{ ...styles.blob, top:'-100px', right:'-60px',  background:'radial-gradient(circle, rgba(139,92,246,0.16) 0%, transparent 70%)' }} />
      <div style={{ ...styles.blob, bottom:'-60px', left:'-80px', background:'radial-gradient(circle, rgba(0,229,160,0.14) 0%, transparent 70%)' }} />

      <div style={styles.card}>
        {/* Brand */}
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

        <h1 style={styles.title}>Create your account</h1>
        <p style={styles.subtitle}>Monitor air quality data from anywhere, in real time</p>

        {success ? (
          <div style={styles.successBox}>
            <div style={{ marginBottom:'12px', display:'flex', justifyContent:'center' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#00e5a0" strokeWidth="2"/>
                <path d="M7 12l3.5 3.5L17 8" stroke="#00e5a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ fontWeight:'700', fontSize:'16px', marginBottom:'6px' }}>Account Created!</div>
            <div style={{ fontSize:'13px', color:'rgba(255,255,255,0.6)', marginBottom:'20px' }}>{success}</div>
            <Link to="/login" style={styles.btnPrimaryLink}>Go to Login</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate style={{ width:'100%' }}>
            {/* Name */}
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="su-name">Full name</label>
              <div style={styles.inputWrapper}>
                <span style={styles.inputIcon}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </span>
                <input id="su-name" name="name" type="text" autoComplete="name"
                  value={form.name} onChange={handleChange} placeholder="Your name"
                  style={styles.input}
                  onFocus={e => e.target.parentNode.style.borderColor = '#00e5a0'}
                  onBlur={e  => e.target.parentNode.style.borderColor = 'rgba(255,255,255,0.12)'} />
              </div>
            </div>

            {/* Email */}
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="su-email">Email address</label>
              <div style={styles.inputWrapper}>
                <span style={styles.inputIcon}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2"/>
                    <path d="M2 8l10 7 10-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </span>
                <input id="su-email" name="email" type="email" autoComplete="email"
                  value={form.email} onChange={handleChange} placeholder="you@example.com"
                  style={styles.input}
                  onFocus={e => e.target.parentNode.style.borderColor = '#00e5a0'}
                  onBlur={e  => e.target.parentNode.style.borderColor = 'rgba(255,255,255,0.12)'} />
              </div>
            </div>

            {/* Password */}
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="su-password">Password</label>
              <div style={styles.inputWrapper}>
                <span style={styles.inputIcon}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2"/>
                    <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </span>
                <input id="su-password" name="password" type={showPw ? 'text' : 'password'}
                  autoComplete="new-password" value={form.password} onChange={handleChange}
                  placeholder="At least 6 characters"
                  style={{ ...styles.input, paddingRight:'48px' }}
                  onFocus={e => e.target.parentNode.style.borderColor = '#00e5a0'}
                  onBlur={e  => e.target.parentNode.style.borderColor = 'rgba(255,255,255,0.12)'} />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  style={styles.eyeBtn}>
                  {showPw
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2"/>
                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                  }
                </button>
              </div>

              {/* Strength bar */}
              {form.password && (
                <div style={{ marginTop:'8px' }}>
                  <div style={{ display:'flex', gap:'4px' }}>
                    {[0,1,2,3].map(i => (
                      <div key={i} style={{ flex:1, height:'3px', borderRadius:'2px',
                        background: i < pwStr.score ? pwStr.color : 'rgba(255,255,255,0.1)',
                        transition:'background 0.3s' }} />
                    ))}
                  </div>
                  <div style={{ fontSize:'11px', color: pwStr.color, marginTop:'4px', fontWeight:'600' }}>
                    {pwStr.label}
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div style={styles.errorBox}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                  <circle cx="12" cy="12" r="10" stroke="#fca5a5" strokeWidth="2"/>
                  <line x1="12" y1="8" x2="12" y2="12" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="12" cy="16" r="1" fill="#fca5a5"/>
                </svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading}
              style={{ ...styles.btnPrimary, opacity: loading ? 0.7 : 1 }}>
              {loading
                ? <><span style={styles.spinner} /> Creating account…</>
                : 'Create Account'}
            </button>
          </form>
        )}

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

        <p style={styles.footerText}>
          Already have an account?{' '}
          <Link to="/login" style={styles.link}>Sign in</Link>
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
    fontSize: '26px',
    fontWeight: '800',
    color: '#e8eef8',
    letterSpacing: '-0.02em',
    margin: '0 0 8px',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: '13px',
    color: 'rgba(232,238,248,0.5)',
    margin: '0 0 24px',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  fieldGroup: {
    width: '100%',
    marginBottom: '14px',
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
    transition: 'border-color 0.2s',
    position: 'relative',
  },
  inputIcon: {
    padding: '0 10px 0 14px',
    opacity: 0.5,
    pointerEvents: 'none',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    color: '#e8eef8',
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
    opacity: 0.6,
    position: 'absolute',
    right: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    alignItems: 'center',
    color: '#e8eef8',
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
    marginBottom: '14px',
    width: '100%',
  },
  successBox: {
    textAlign: 'center',
    padding: '20px 0',
    width: '100%',
    color: '#e8eef8',
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
    marginTop: '4px',
  },
  btnPrimaryLink: {
    display: 'inline-block',
    padding: '12px 32px',
    borderRadius: '10px',
    border: 'none',
    background: 'linear-gradient(135deg, #00e5a0, #06b6d4)',
    color: '#012d1a',
    fontSize: '14px',
    fontWeight: '700',
    textDecoration: 'none',
    letterSpacing: '0.02em',
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

export default Signup;