const { getPermissionsForRole } = require('../config/accessControl');

function requirePermissions(...requiredPermissions) {
  const expected = requiredPermissions.map((permission) => String(permission || '').trim()).filter(Boolean);

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (expected.length === 0) return next();

    const rolePermissions = getPermissionsForRole(req.user.role);
    const hasAll = expected.every((permission) => rolePermissions.includes(permission));
    if (!hasAll) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return next();
  };
}

module.exports = { requirePermissions };
