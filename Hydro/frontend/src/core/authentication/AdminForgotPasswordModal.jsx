import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function AdminForgotPasswordModal({ isOpen, onClose, onPasswordResetSuccess }) {
  const [step, setStep] = useState(1); // 1: Email, 2: OTP, 3: New Password, 4: Success
  const [identifier, setIdentifier] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [autoSigningIn, setAutoSigningIn] = useState(false);

  const otpInputRefs = useRef([]);
  const navigate = useNavigate();

  const authBaseUrl = (import.meta.env && import.meta.env.VITE_API_URL)
    ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/auth`
    : `/api/v1/auth`;

  // Countdown timer for resending OTP
  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Focus first OTP box when entering Step 2
  useEffect(() => {
    if (step === 2 && otpInputRefs.current[0]) {
      setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  // Reset modal state when closed or opened
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setError('');
      setOtpDigits(['', '', '', '', '', '']);
      setNewPassword('');
      setConfirmPassword('');
      setAutoSigningIn(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Step 1: Request OTP
  const handleRequestOtp = async (e) => {
    if (e) e.preventDefault();
    if (!identifier.trim()) {
      setError('Please enter your email or employee ID.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await axios.post(`${authBaseUrl}/otp/request`, {
        identifier: identifier.trim()
      });

      setMaskedEmail(res.data.maskedEmail || identifier);
      setStep(2);
      setResendCooldown(60);
      setOtpDigits(['', '', '', '', '', '']);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Handle single OTP digit input
  const handleOtpChange = (index, val) => {
    const clean = val.replace(/\D/g, ''); // Numbers only
    const newDigits = [...otpDigits];

    if (clean.length > 1) {
      const pasted = clean.slice(0, 6).split('');
      pasted.forEach((char, i) => {
        if (index + i < 6) newDigits[index + i] = char;
      });
      setOtpDigits(newDigits);
      const nextIdx = Math.min(5, index + pasted.length);
      otpInputRefs.current[nextIdx]?.focus();
      return;
    }

    newDigits[index] = clean;
    setOtpDigits(newDigits);

    if (clean && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pastedData) return;

    const newDigits = [...otpDigits];
    pastedData.split('').forEach((char, i) => {
      newDigits[i] = char;
    });
    setOtpDigits(newDigits);

    const focusIdx = Math.min(5, pastedData.length);
    otpInputRefs.current[focusIdx]?.focus();
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    const fullOtp = otpDigits.join('');

    if (fullOtp.length < 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await axios.post(`${authBaseUrl}/otp/verify`, {
        identifier: identifier.trim(),
        otp: fullOtp
      });

      setResetToken(res.data.resetToken);
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Set New Password & Seamless Auto-Login
  const handleResetPassword = async (e) => {
    if (e) e.preventDefault();

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-type.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await axios.post(`${authBaseUrl}/otp/reset-password`, {
        resetToken,
        newPassword
      });

      // Seamless Auto-Login: store session tokens immediately
      if (res.data?.token && res.data?.user) {
        const { user, token } = res.data;
        localStorage.setItem('adminUser', JSON.stringify(user));
        localStorage.setItem('adminToken', token);
        localStorage.setItem('token', token);
        localStorage.setItem('username', user.name || user.email);

        setAutoSigningIn(true);
        setStep(4);

        setTimeout(() => {
          if (onPasswordResetSuccess) {
            onPasswordResetSuccess(res.data);
          }
          onClose();
          navigate('/');
        }, 1200);
      } else {
        setStep(4);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  const isPasswordValid = newPassword.length >= 8;
  const doPasswordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;

  return (
    <div className="otp-modal-overlay" style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.72)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '16px',
      boxSizing: 'border-box',
      animation: 'fadeIn 0.2s ease-out'
    }}>
      <div className="otp-modal-card" style={{
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '430px',
        boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.8)',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        animation: 'scaleIn 0.2s ease-out',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
      }}>
        {/* Header Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 22px',
          borderBottom: '1px solid #f1f5f9',
          background: '#f8fafc'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <div style={{
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              background: 'rgba(37, 99, 235, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#2563eb'
            }}>
              <i className="fa-solid fa-shield-halved" style={{ fontSize: '15px' }}></i>
            </div>
            <div>
              <span style={{ fontSize: '13.5px', fontWeight: '700', color: '#0f172a', letterSpacing: '-0.2px' }}>
                Account Security Recovery
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'none',
              border: 'none',
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              color: '#64748b',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f1f5f9';
              e.currentTarget.style.color = '#0f172a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#64748b';
            }}
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px 26px 28px' }}>
          {error && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#dc2626',
              borderRadius: '10px',
              padding: '11px 14px',
              fontSize: '13px',
              marginBottom: '18px',
              lineHeight: 1.45,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '9px'
            }}>
              <i className="fa-solid fa-circle-exclamation" style={{ marginTop: '2px', fontSize: '14px' }}></i>
              <div style={{ flex: 1 }}>{error}</div>
            </div>
          )}

          {/* STEP 1: Enter Identifier */}
          {step === 1 && (
            <form onSubmit={handleRequestOtp}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: '700', color: '#0f172a', letterSpacing: '-0.3px' }}>
                Forgot Password?
              </h3>
              <p style={{ margin: '0 0 22px 0', fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
                Enter your registered Email or Employee ID. We will send a secure 6-digit verification code.
              </p>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '7px' }}>
                  Email or Employee ID
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
                    type="text"
                    required
                    placeholder="e.g. employee@company.com"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
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
                    autoFocus
                  />
                </div>
              </div>

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
                  fontSize: '13.5px',
                  fontWeight: '600',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.75 : 1,
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
                  transition: 'background-color 0.15s ease'
                }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#2563eb'; }}
              >
                {loading ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fa-solid fa-circle-notch fa-spin"></i> Sending Code...
                  </span>
                ) : 'Send Verification Code →'}
              </button>
            </form>
          )}

          {/* STEP 2: Enter 6-digit OTP */}
          {step === 2 && (
            <form onSubmit={handleVerifyOtp}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: '700', color: '#0f172a', letterSpacing: '-0.3px' }}>
                Verify Security Code
              </h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
                We sent a 6-digit code to <strong style={{ color: '#0f172a' }}>{maskedEmail}</strong>. Enter it below to proceed:
              </p>

              {/* 6 Digit Inputs */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: '20px'
              }} onPaste={handleOtpPaste}>
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (otpInputRefs.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    style={{
                      width: '48px',
                      height: '52px',
                      textAlign: 'center',
                      fontSize: '22px',
                      fontWeight: '700',
                      fontFamily: 'monospace',
                      borderRadius: '10px',
                      border: digit ? '2px solid #2563eb' : '1px solid #cbd5e1',
                      background: digit ? '#eff6ff' : '#f8fafc',
                      color: '#1e3a8a',
                      outline: 'none',
                      boxSizing: 'border-box',
                      transition: 'border-color 0.15s ease, background 0.15s ease'
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#2563eb';
                      e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.12)';
                    }}
                    onBlur={(e) => {
                      if (!digit) e.target.style.borderColor = '#cbd5e1';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={loading || otpDigits.join('').length < 6}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontSize: '13.5px',
                  fontWeight: '600',
                  cursor: (loading || otpDigits.join('').length < 6) ? 'not-allowed' : 'pointer',
                  opacity: (loading || otpDigits.join('').length < 6) ? 0.6 : 1,
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
                  marginBottom: '16px',
                  transition: 'background-color 0.15s ease'
                }}
                onMouseEnter={(e) => { if (!loading && otpDigits.join('').length === 6) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                onMouseLeave={(e) => { if (!loading && otpDigits.join('').length === 6) e.currentTarget.style.backgroundColor = '#2563eb'; }}
              >
                {loading ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fa-solid fa-circle-notch fa-spin"></i> Verifying...
                  </span>
                ) : 'Verify Code & Proceed'}
              </button>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '12.5px',
                color: '#64748b'
              }}>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    cursor: 'pointer',
                    padding: 0,
                    fontWeight: '600',
                    fontSize: '12.5px'
                  }}
                >
                  ← Change Email / ID
                </button>

                {resendCooldown > 0 ? (
                  <span style={{ color: '#94a3b8' }}>Resend code in {resendCooldown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRequestOtp(null)}
                    disabled={loading}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      cursor: 'pointer',
                      padding: 0,
                      fontWeight: '600',
                      fontSize: '12.5px'
                    }}
                  >
                    Resend Code
                  </button>
                )}
              </div>
            </form>
          )}

          {/* STEP 3: Enter New Password */}
          {step === 3 && (
            <form onSubmit={handleResetPassword}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: '700', color: '#0f172a', letterSpacing: '-0.3px' }}>
                Set New Password
              </h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
                Your identity is verified. Create a new strong password for your account:
              </p>

              {/* New Password Input */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: '#334155' }}>
                    New Password
                  </label>
                  {newPassword && (
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      color: isPasswordValid ? '#10b981' : '#f59e0b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <i className={`fa-solid ${isPasswordValid ? 'fa-check' : 'fa-circle-info'}`}></i>
                      {isPasswordValid ? '8+ chars' : 'At least 8 chars'}
                    </span>
                  )}
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
                    required
                    placeholder="Minimum 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '11px 40px 11px 38px',
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
                    autoFocus
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

              {/* Confirm Password Input */}
              <div style={{ marginBottom: '22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: '#334155' }}>
                    Confirm New Password
                  </label>
                  {confirmPassword && (
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      color: doPasswordsMatch ? '#10b981' : '#ef4444',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <i className={`fa-solid ${doPasswordsMatch ? 'fa-check' : 'fa-xmark'}`}></i>
                      {doPasswordsMatch ? 'Passwords match' : 'Passwords do not match'}
                    </span>
                  )}
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
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    placeholder="Re-type your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '11px 40px 11px 38px',
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
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    title={showConfirmPassword ? 'Hide password' : 'Show password'}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
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
                    <i className={`fa-solid ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || !newPassword || !confirmPassword || newPassword !== confirmPassword || newPassword.length < 8}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontSize: '13.5px',
                  fontWeight: '600',
                  cursor: (loading || !newPassword || newPassword !== confirmPassword || newPassword.length < 8) ? 'not-allowed' : 'pointer',
                  opacity: (loading || !newPassword || newPassword !== confirmPassword || newPassword.length < 8) ? 0.6 : 1,
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
                  transition: 'background-color 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  if (!loading && newPassword === confirmPassword && newPassword.length >= 8) {
                    e.currentTarget.style.backgroundColor = '#1d4ed8';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && newPassword === confirmPassword && newPassword.length >= 8) {
                    e.currentTarget.style.backgroundColor = '#2563eb';
                  }
                }}
              >
                {loading ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fa-solid fa-circle-notch fa-spin"></i> Saving Password...
                  </span>
                ) : 'Save New Password & Sign In'}
              </button>
            </form>
          )}

          {/* STEP 4: Success Message & Seamless Auto-Login */}
          {step === 4 && (
            <div style={{ textAlign: 'center', padding: '16px 8px' }}>
              <div style={{
                width: '56px',
                height: '56px',
                background: 'rgba(16, 185, 129, 0.12)',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#10b981',
                fontSize: '28px',
                marginBottom: '16px'
              }}>
                <i className="fa-solid fa-circle-check"></i>
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '700', color: '#0f172a', letterSpacing: '-0.3px' }}>
                Password Updated!
              </h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '13.5px', color: '#64748b', lineHeight: 1.5 }}>
                {autoSigningIn
                  ? 'Your new password is saved. Signing you into the platform automatically...'
                  : 'Your account password has been updated. You can now access your dashboard.'}
              </p>

              {autoSigningIn ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  color: '#2563eb',
                  fontWeight: '600',
                  fontSize: '13px'
                }}>
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                  <span>Redirecting to Dashboard...</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate('/');
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#2563eb',
                    color: '#ffffff',
                    fontSize: '13.5px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)'
                  }}
                >
                  Go to Dashboard
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
