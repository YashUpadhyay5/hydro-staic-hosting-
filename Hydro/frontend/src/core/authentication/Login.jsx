import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AdminForgotPasswordModal from './AdminForgotPasswordModal';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
    const navigate = useNavigate();

    React.useEffect(() => {
        localStorage.removeItem('adminUser');
        localStorage.removeItem('adminToken');
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const loginUrl = (import.meta.env && import.meta.env.VITE_API_URL)
                ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/auth/login`
                : `/api/v1/auth/login`;

            const response = await axios.post(loginUrl, {
                email: email.trim(),
                password
            });
            const { user, token } = response.data;
            if (user && token) {
                localStorage.setItem('adminUser', JSON.stringify(user));
                localStorage.setItem('adminToken', token);
                localStorage.setItem('token', token);
                localStorage.setItem('username', user.name || user.email);
                
                navigate('/');
            } else {
                throw new Error("Invalid response from server.");
            }
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Invalid email or password.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page-container" style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            background: 'linear-gradient(145deg, #f8fafc 0%, #f1f5f9 100%)',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        }}>
            <div className="login-card" style={{
                width: '100%',
                maxWidth: '420px',
                padding: '40px 36px',
                background: '#ffffff',
                borderRadius: '16px',
                boxShadow: '0 20px 40px -12px rgba(15, 23, 42, 0.1), 0 0 0 1px #e2e8f0',
                border: '1px solid #e2e8f0',
                boxSizing: 'border-box'
            }}>
                {/* Header with clean SVG Shield */}
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{
                        width: '52px',
                        height: '52px',
                        borderRadius: '14px',
                        background: 'rgba(37, 99, 235, 0.08)',
                        border: '1px solid rgba(37, 99, 235, 0.15)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '16px',
                        color: '#2563eb'
                    }}>
                        <i className="fa-solid fa-shield-halved" style={{ fontSize: '24px' }}></i>
                    </div>
                    <h2 style={{
                        fontSize: '22px',
                        fontWeight: '700',
                        color: '#0f172a',
                        margin: '0 0 6px 0',
                        letterSpacing: '-0.4px'
                    }}>
                        Enterprise Platform
                    </h2>
                    <p style={{
                        fontSize: '13.5px',
                        color: '#64748b',
                        margin: 0,
                        lineHeight: 1.45
                    }}>
                        Sign in to access your modules
                    </p>
                </div>

                {/* Login Form */}
                <form onSubmit={handleSubmit} autoComplete="off">
                    {/* Email Input */}
                    <div style={{ marginBottom: '18px' }}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '7px' }}>
                            Email Address
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{
                                position: 'absolute',
                                left: '14px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: '#94a3b8',
                                fontSize: '14px',
                                pointerEvents: 'none'
                            }}>
                                <i className="fa-regular fa-envelope"></i>
                            </span>
                            <input 
                                type="email" 
                                placeholder="name@company.com" 
                                required
                                autoComplete="username"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '11px 14px 11px 40px',
                                    borderRadius: '10px',
                                    border: '1px solid #cbd5e1',
                                    fontSize: '13.5px',
                                    outline: 'none',
                                    color: '#0f172a',
                                    background: '#ffffff',
                                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
                                }}
                                onFocus={(e) => {
                                    e.target.style.borderColor = '#2563eb';
                                    e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)';
                                }}
                                onBlur={(e) => {
                                    e.target.style.borderColor = '#cbd5e1';
                                    e.target.style.boxShadow = 'none';
                                }}
                            />
                        </div>
                    </div>

                    {/* Password Input */}
                    <div style={{ marginBottom: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                            <label style={{ fontSize: '12px', fontWeight: '600', color: '#334155' }}>
                                Password
                            </label>
                            <button
                                type="button"
                                onClick={() => setIsForgotModalOpen(true)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#2563eb',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    padding: '0',
                                    transition: 'color 0.15s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.color = '#1d4ed8'}
                                onMouseLeave={(e) => e.target.style.color = '#2563eb'}
                            >
                                Forgot Password?
                            </button>
                        </div>
                        <div style={{ position: 'relative' }}>
                            <span style={{
                                position: 'absolute',
                                left: '14px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: '#94a3b8',
                                fontSize: '14px',
                                pointerEvents: 'none'
                            }}>
                                <i className="fa-solid fa-lock"></i>
                            </span>
                            <input 
                                type={showPassword ? 'text' : 'password'} 
                                placeholder="Enter your password" 
                                required
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '11px 40px 11px 40px',
                                    borderRadius: '10px',
                                    border: '1px solid #cbd5e1',
                                    fontSize: '13.5px',
                                    outline: 'none',
                                    color: '#0f172a',
                                    background: '#ffffff',
                                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
                                }}
                                onFocus={(e) => {
                                    e.target.style.borderColor = '#2563eb';
                                    e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)';
                                }}
                                onBlur={(e) => {
                                    e.target.style.borderColor = '#cbd5e1';
                                    e.target.style.boxShadow = 'none';
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                title={showPassword ? 'Hide password' : 'Show password'}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                style={{
                                    position: 'absolute',
                                    right: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    padding: '4px',
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    color: '#64748b',
                                    lineHeight: 1
                                }}
                            >
                                <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div style={{
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            color: '#dc2626',
                            borderRadius: '8px',
                            padding: '10px 12px',
                            fontSize: '12.5px',
                            marginBottom: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <i className="fa-solid fa-circle-exclamation"></i>
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '10px',
                            border: 'none',
                            background: '#2563eb',
                            color: '#ffffff',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.75 : 1,
                            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
                            transition: 'background-color 0.15s ease',
                            marginTop: '8px'
                        }}
                        onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                        onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#2563eb'; }}
                    >
                        {loading ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                <i className="fa-solid fa-circle-notch fa-spin"></i> Signing In...
                            </span>
                        ) : 'Sign In'}
                    </button>
                </form>

                <AdminForgotPasswordModal
                    isOpen={isForgotModalOpen}
                    onClose={() => setIsForgotModalOpen(false)}
                    onPasswordResetSuccess={(resetData) => {
                        setIsForgotModalOpen(false);
                        if (resetData?.token && resetData?.user) {
                            navigate('/');
                        } else if (typeof resetData === 'string') {
                            setEmail(resetData);
                        }
                    }}
                />
            </div>
        </div>
    );
}
