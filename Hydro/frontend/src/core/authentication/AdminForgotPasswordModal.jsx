import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

export default function AdminForgotPasswordModal({ isOpen, onClose, onPasswordResetSuccess }) {
  const [step, setStep] = useState(1); // 1: Email, 2: OTP, 3: New Password, 4: Success
  const [identifier, setIdentifier] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const otpInputRefs = useRef([]);

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
      // Pasted multiple digits
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

    // Auto-advance to next input
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

  // Step 3: Set New Password
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
      await axios.post(`${authBaseUrl}/otp/reset-password`, {
        resetToken,
        newPassword
      });

      setStep(4);
      if (onPasswordResetSuccess) {
        onPasswordResetSuccess(identifier);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="otp-modal-overlay" style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '16px',
      boxSizing: 'border-box'
    }}>
      <div className="otp-modal-card" style={{
        backgroundColor: '#ffffff',
        borderRadius: '20px',
        width: '100%',
        maxWidth: '440px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        animation: 'fadeInScale 0.2s ease-out'
      }}>
        {/* Header Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid #f1f5f9',
          background: '#f8fafc'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🛡️</span>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>
              Account Security Recovery
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              color: '#64748b',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '4px'
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px 24px 28px' }}>
          {error && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#dc2626',
              borderRadius: '10px',
              padding: '10px 14px',
              fontSize: '12.5px',
              marginBottom: '18px',
              lineHeight: 1.4
            }}>
              {error}
            </div>
          )}

          {/* STEP 1: Enter Identifier */}
          {step === 1 && (
            <form onSubmit={handleRequestOtp}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>
                Forgot Password?
              </h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b', lineHeight: 1.45 }}>
                Enter your registered Gmail or Employee ID. We will send a 6-digit verification code to recover your account.
              </p>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                  Registered Email or Employee ID
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '15px', color: '#94a3b8' }}>
                    ✉️
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. anshup@gmail.com"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '12px 14px 12px 38px',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '14px',
                      outline: 'none',
                      transition: 'border-color 0.15s ease'
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
                  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)'
                }}
              >
                {loading ? 'Sending Verification Code...' : 'Send Verification Code →'}
              </button>
            </form>
          )}

          {/* STEP 2: Enter 6-digit OTP */}
          {step === 2 && (
            <form onSubmit={handleVerifyOtp}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>
                Enter 6-Digit Code
              </h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b', lineHeight: 1.45 }}>
                We sent a security code to <strong>{maskedEmail}</strong>. Enter it below to verify your identity:
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
                      height: '56px',
                      textAlign: 'center',
                      fontSize: '24px',
                      fontWeight: '800',
                      fontFamily: 'monospace',
                      borderRadius: '10px',
                      border: digit ? '2px solid #2563eb' : '1.5px solid #cbd5e1',
                      background: digit ? '#eff6ff' : '#f8fafc',
                      color: '#1e3a8a',
                      outline: 'none',
                      boxSizing: 'border-box'
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
                  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: (loading || otpDigits.join('').length < 6) ? 'not-allowed' : 'pointer',
                  opacity: (loading || otpDigits.join('').length < 6) ? 0.6 : 1,
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
                  marginBottom: '16px'
                }}
              >
                {loading ? 'Verifying Code...' : 'Verify Code & Proceed'}
              </button>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '12px',
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
                    fontWeight: '600'
                  }}
                >
                  ← Change Email / ID
                </button>

                {resendCooldown > 0 ? (
                  <span>Resend code in {resendCooldown}s</span>
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
                      fontWeight: '600'
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
              <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>
                Set New Password
              </h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b', lineHeight: 1.45 }}>
                Your identity has been verified. Create a strong password for your account:
              </p>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                  New Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Minimum 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '12px 42px 12px 14px',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      fontSize: '16px',
                      cursor: 'pointer',
                      color: '#64748b'
                    }}
                  >
                    {showPassword ? '👁️' : '🙈'}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                  Confirm New Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Re-type your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '14px',
                    outline: 'none'
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !newPassword || newPassword !== confirmPassword}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: (loading || !newPassword || newPassword !== confirmPassword) ? 'not-allowed' : 'pointer',
                  opacity: (loading || !newPassword || newPassword !== confirmPassword) ? 0.6 : 1,
                  boxShadow: '0 4px 12px rgba(22, 163, 74, 0.25)'
                }}
              >
                {loading ? 'Updating Password...' : 'Save New Password & Sign In'}
              </button>
            </form>
          )}

          {/* STEP 4: Success Message */}
          {step === 4 && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{
                width: '64px',
                height: '64px',
                background: '#dcfce7',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '32px',
                marginBottom: '16px'
              }}>
                ✅
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '19px', fontWeight: '700', color: '#0f172a' }}>
                Password Reset Successfully!
              </h3>
              <p style={{ margin: '0 0 24px 0', fontSize: '13.5px', color: '#64748b', lineHeight: 1.5 }}>
                Your account password has been updated securely. You can now log in to the portal with your new password.
              </p>
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)'
                }}
              >
                Proceed to Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
