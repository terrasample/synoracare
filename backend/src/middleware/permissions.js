const { getEffectivePermissionsForUser } = require('../config/accessControl');

function requirePermissions(...requiredPermissions) {
  const expected = requiredPermissions.map((permission) => String(permission || '').trim()).filter(Boolean);

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (expected.length === 0) return next();

    const effectivePermissions = getEffectivePermissionsForUser(req.user);
    const hasAll = expected.every((permission) => effectivePermissions.includes(permission));
    if (!hasAll) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return next();
  };
}

module.exports = { requirePermissions };
