const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Employee = require('../../../shared/models/Employee');
const { calculateEarnedLeaves } = require('../../../core/utils/leaveCalculator');
const { comparePassword, hashPassword, validatePasswordStrength } = require('../services/authService');
const { loginRateLimiter } = require('../../../core/middleware/rateLimiter');
const verifyToken = require('../../../core/middleware/verifyToken');
const crypto = require('crypto');
const OtpVerification = require('../../../shared/models/OtpVerification');
const EmailService = require('../../../core/services/EmailService');
const { Op } = require('sequelize');

function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [userPart, domain] = email.split('@');
  if (userPart.length <= 2) return `${userPart[0]}*@${domain}`;
  return `${userPart[0]}${'*'.repeat(Math.max(1, userPart.length - 2))}${userPart[userPart.length - 1]}@${domain}`;
}

// POST /api/auth/login (With Rate Limiter & bcrypt validation)
router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = await Employee.findOne({ where: { email: cleanEmail } });

    if (!user) {
      if (req.recordFailedAttempt) req.recordFailedAttempt();
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      if (req.recordFailedAttempt) req.recordFailedAttempt();
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.status === 'PAST') {
      return res.status(403).json({ error: 'Your account has been deactivated. Access denied.' });
    }

    // Automatically detect if request originates from Mobile App (Expo, React Native, OkHttp, CFNetwork, Android, iOS)
    const userAgent = String(req.headers['user-agent'] || '').toLowerCase();
    const clientHeader = String(req.headers['x-client-type'] || req.headers['x-platform'] || '').toLowerCase();

    const isMobileAppRequest = 
      clientHeader === 'mobile' ||
      userAgent.includes('expo') ||
      userAgent.includes('reactnative') ||
      userAgent.includes('okhttp') ||
      userAgent.includes('cfnetwork') ||
      userAgent.includes('dart') ||
      userAgent.includes('android') ||
      userAgent.includes('iphone') ||
      userAgent.includes('mobile') ||
      req.body.isMobileAppRequest === true ||
      req.body.clientType === 'mobile';

    // Block Mobile App Only (EMPLOYEE) accounts ONLY from web dashboard login
    const userRole = String(user.role || '').toUpperCase();
    if (userRole === 'EMPLOYEE' && !isMobileAppRequest) {
      return res.status(403).json({ 
        error: 'Mobile app accounts (EMPLOYEE) are not permitted to log in to the web management dashboard. Please use the Hydro Mobile Application.' 
      });
    }

    // Reset rate limiter on successful authentication
    if (req.clearFailedAttempts) req.clearFailedAttempts();

    // Auto-migrate legacy plain text password to bcrypt hash on successful login
    if (!user.password.startsWith('$2a$') && !user.password.startsWith('$2b$') && !user.password.startsWith('$2y$')) {
      user.password = await hashPassword(password);
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'super_secret_hrms_token_key_2026',
      { expiresIn: '365d' }
    );

    user.currentToken = token;
    const dynamicLeaves = calculateEarnedLeaves(user.joiningDate || user.createdAt);
    const rawAllowed = user.allowed_leaves !== undefined ? user.allowed_leaves : user.allowedLeaves;
    const allowedLeavesCalc = (rawAllowed !== null && rawAllowed !== undefined && rawAllowed !== '' && !isNaN(Number(rawAllowed)))
      ? Number(rawAllowed)
      : dynamicLeaves;

    // Leave figures come from the Leave Balances ledger so the mobile app matches the web portal.
    let leaveBalance = null;
    try {
      const LeaveBalanceService = require('../../hrms/leave/services/LeaveBalanceService');
      leaveBalance = (await LeaveBalanceService.getBalanceSnapshots([user])).get(user.id) || null;
    } catch (balanceErr) {
      console.warn('Login: leave ledger unavailable, using legacy figures:', balanceErr.message);
    }

    const isOffice = String(user.designation || '').trim().toUpperCase() === 'OFFICE';
    return res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        designation: user.designation,
        primaryWorkMode: isOffice ? 'office' : 'field',
        canSwitchMode: isOffice,
        allowedLeaves: leaveBalance ? leaveBalance.credited : allowedLeavesCalc,
        consumedLeaves: leaveBalance ? leaveBalance.consumed : (user.consumedLeaves || 0),
        availableLeaves: leaveBalance ? leaveBalance.available : Math.max(0, allowedLeavesCalc - (user.consumedLeaves || 0)),
        leaveBalance
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'An unexpected authentication error occurred.' });
  }
});

// POST /api/auth/change-password (Authenticated User)
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    const userId = req.user && req.user.id;
    const user = await Employee.findByPk(userId);

    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect current password.' });
    }

    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      return res.status(400).json({ error: strengthCheck.message });
    }

    user.password = await hashPassword(newPassword);
    await user.save();

    return res.status(200).json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/otp/request - Request 6-digit verification code for password reset
router.post('/otp/request', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Email or Employee ID is required.' });
    }

    const cleanInput = String(identifier).trim().toLowerCase();

    // Find employee by email or employee id / code
    const user = await Employee.findOne({
      where: {
        [Op.or]: [
          { email: cleanInput },
          { id: identifier.trim() },
          { empCode: identifier.trim() }
        ]
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'No account found matching the provided details.' });
    }

    if (user.status === 'PAST') {
      return res.status(403).json({ error: 'This account has been deactivated. Please contact HR.' });
    }

    if (!user.email || !user.email.includes('@')) {
      return res.status(400).json({ error: 'No valid Gmail/Email registered for this account. Please contact an Administrator.' });
    }

    const userEmail = user.email.toLowerCase().trim();

    // Rate Limiting: 1 request per 60 seconds
    const recentOtp = await OtpVerification.findOne({
      where: {
        email: userEmail,
        purpose: 'PASSWORD_RESET',
        createdAt: { [Op.gt]: new Date(Date.now() - 60 * 1000) }
      },
      order: [['createdAt', 'DESC']]
    });

    if (recentOtp) {
      const waitSeconds = Math.max(1, 60 - Math.floor((Date.now() - new Date(recentOtp.createdAt).getTime()) / 1000));
      return res.status(429).json({ 
        error: `Please wait ${waitSeconds} seconds before requesting a new code.` 
      });
    }

    // Rate Limiting: Max 5 requests in last 15 minutes
    const recentCount = await OtpVerification.count({
      where: {
        email: userEmail,
        purpose: 'PASSWORD_RESET',
        createdAt: { [Op.gt]: new Date(Date.now() - 15 * 60 * 1000) }
      }
    });

    if (recentCount >= 5) {
      return res.status(429).json({ 
        error: 'Too many password reset requests. Please try again in 15 minutes.' 
      });
    }

    // Invalidate any existing unused OTPs for this email
    await OtpVerification.update(
      { isUsed: true },
      { where: { email: userEmail, isUsed: false } }
    );

    // Generate 6-digit cryptographic OTP
    const rawOtp = String(crypto.randomInt(100000, 1000000));
    const hashedOtp = await hashPassword(rawOtp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await OtpVerification.create({
      employeeId: user.id,
      email: userEmail,
      otpHash: hashedOtp,
      purpose: 'PASSWORD_RESET',
      expiresAt
    });

    // Send email via EmailService
    const emailRes = await EmailService.sendPasswordOtp({
      to: userEmail,
      name: user.name,
      otp: rawOtp,
      purpose: 'PASSWORD_RESET'
    });

    if (!emailRes.success) {
      console.warn('⚠️ [Auth OTP] Email dispatch warning:', emailRes.error);
    }

    return res.status(200).json({
      message: 'Verification code sent successfully to your registered email.',
      maskedEmail: maskEmail(userEmail),
      identifier: userEmail
    });
  } catch (error) {
    console.error('❌ OTP request error:', error);
    return res.status(500).json({ error: 'Failed to process verification code request.' });
  }
});

// POST /api/auth/otp/verify - Verify 6-digit code and generate single-use resetToken
router.post('/otp/verify', async (req, res) => {
  try {
    const { identifier, otp } = req.body;
    if (!identifier || !otp) {
      return res.status(400).json({ error: 'Identifier and OTP code are required.' });
    }

    const cleanInput = String(identifier).trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    // Resolve user's registered email
    const user = await Employee.findOne({
      where: {
        [Op.or]: [
          { email: cleanInput },
          { id: identifier.trim() },
          { empCode: identifier.trim() }
        ]
      }
    });

    const userEmail = user ? user.email.toLowerCase().trim() : cleanInput;

    const record = await OtpVerification.findOne({
      where: {
        email: userEmail,
        purpose: 'PASSWORD_RESET',
        isUsed: false,
        expiresAt: { [Op.gt]: new Date() }
      },
      order: [['createdAt', 'DESC']]
    });

    if (!record) {
      return res.status(400).json({ error: 'Verification code has expired or is invalid. Please request a new one.' });
    }

    // Check attempts limit (max 5 attempts)
    if (record.attempts >= 5) {
      record.isUsed = true;
      await record.save();
      return res.status(400).json({ error: 'Too many failed attempts. This code has been invalidated. Please request a new one.' });
    }

    const isMatch = await comparePassword(cleanOtp, record.otpHash);
    if (!isMatch) {
      record.attempts += 1;
      await record.save();
      const remaining = Math.max(0, 5 - record.attempts);
      return res.status(400).json({ 
        error: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` 
      });
    }

    // Code verified: Generate single-use resetToken valid for 15 minutes
    const resetToken = crypto.randomBytes(32).toString('hex');
    record.isUsed = true;
    record.resetToken = resetToken;
    await record.save();

    return res.status(200).json({
      message: 'Code verified successfully.',
      resetToken
    });
  } catch (error) {
    console.error('❌ OTP verify error:', error);
    return res.status(500).json({ error: 'Failed to verify code.' });
  }
});

// POST /api/auth/otp/reset-password - Complete password reset using verified resetToken
router.post('/otp/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required.' });
    }

    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      return res.status(400).json({ error: strengthCheck.message });
    }

    // Find valid reset token updated within last 15 minutes
    const record = await OtpVerification.findOne({
      where: {
        resetToken: resetToken.trim(),
        updatedAt: { [Op.gt]: new Date(Date.now() - 15 * 60 * 1000) }
      }
    });

    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired password reset session. Please request a new code.' });
    }

    const user = await Employee.findByPk(record.employeeId) || await Employee.findOne({ where: { email: record.email } });
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    // Hash new password and create fresh session token for seamless auto-login
    user.password = await hashPassword(newPassword);
    
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'super_secret_hrms_token_key_2026',
      { expiresIn: '365d' }
    );
    user.currentToken = token;
    await user.save();

    // Consume the resetToken so it cannot be reused
    record.resetToken = null;
    await record.save();

    console.log(`🔐 [Auth] Password successfully reset via OTP with auto-login for ${user.email} (${user.id})`);

    const isOffice = String(user.designation || '').trim().toUpperCase() === 'OFFICE';
    return res.status(200).json({
      success: true,
      message: 'Your password has been reset successfully! Signing you in...',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        designation: user.designation,
        primaryWorkMode: isOffice ? 'office' : 'field',
        canSwitchMode: isOffice
      },
      token
    });
  } catch (error) {
    console.error('❌ Password reset error:', error);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

module.exports = router;
