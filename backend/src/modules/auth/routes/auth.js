const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Employee = require('../../../shared/models/Employee');
const { calculateEarnedLeaves } = require('../../../core/utils/leaveCalculator');
const { comparePassword, hashPassword, validatePasswordStrength } = require('../services/authService');
const { loginRateLimiter } = require('../../../core/middleware/rateLimiter');
const verifyToken = require('../../../core/middleware/verifyToken');

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

module.exports = router;
