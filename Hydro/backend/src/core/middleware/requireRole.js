const requireRole = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    }

    const userRole = String(req.user.role || 'EMPLOYEE').toUpperCase();

    // SUPER_ADMIN and ADMIN have full global unrestricted access
    if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') {
      return next();
    }

    const normalizedAllowed = allowedRoles.map(r => String(r).toUpperCase());
    if (normalizedAllowed.includes(userRole)) {
      return next();
    }

    return res.status(403).json({
      error: 'FORBIDDEN_ACCESS',
      message: 'Access Denied: You do not have authority to modify employee records or perform financial operations.'
    });
  };
};

module.exports = requireRole;
