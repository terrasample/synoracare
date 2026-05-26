const SYSTEM_ROLES = ['dsp', 'supervisor', 'org_admin', 'super_admin'];

const DEFAULT_ROLE_DISPLAY_LABELS = {
  dsp: 'Direct Support Professional',
  supervisor: 'Supervisor',
  org_admin: 'Organization Admin',
  super_admin: 'Super Admin'
};

const ROLE_PERMISSIONS = {
  dsp: [
    'clients:assigned:read',
    'tracker:entry:create',
    'tracker:entry:read',
    'ask:approved_guidance:read',
    'shifts:handoff:create',
    'shifts:own:read'
  ],
  supervisor: [
    'clients:assigned:read',
    'clients:all:read',
    'users:read',
    'assignments:read',
    'tracker:entry:create',
    'tracker:entry:read',
    'tracker:entry:review',
    'documents:upload',
    'assignments:create',
    'ask:approved_guidance:read',
    'audit:org:read',
    'reports:export',
    'shifts:handoff:create',
    'shifts:all:read',
    'legal_records:export'
  ],
  org_admin: [
    'clients:all:read',
    'clients:create',
    'clients:update',
    'users:read',
    'users:invite',
    'users:password_reset',
    'assignments:read',
    'assignments:create',
    'documents:upload',
    'tracker:entry:read',
    'ask:approved_guidance:read',
    'audit:org:read',
    'role_labels:update',
    'reports:export',
    'shifts:all:read',
    'legal_records:export'
  ],
  super_admin: [
    'clients:all:read',
    'clients:create',
    'clients:update',
    'clients:archive',
    'clients:delete',
    'users:read',
    'users:invite',
    'users:password_reset',
    'assignments:read',
    'assignments:create',
    'documents:upload',
    'tracker:entry:read',
    'ask:approved_guidance:read',
    'audit:org:read',
    'role_labels:update',
    'reports:export',
    'shifts:all:read',
    'legal_records:export'
  ]
};

function getPermissionsForRole(role) {
  const normalizedRole = String(role || '').trim();
  return ROLE_PERMISSIONS[normalizedRole] ? [...ROLE_PERMISSIONS[normalizedRole]] : [];
}

function canRole(role, permission) {
  return getPermissionsForRole(role).includes(String(permission || '').trim());
}

function sanitizeRoleDisplayLabels(rawLabels) {
  if (!rawLabels || typeof rawLabels !== 'object') {
    return {};
  }

  const sanitized = {};
  for (const role of SYSTEM_ROLES) {
    const incoming = rawLabels[role];
    if (typeof incoming !== 'string') continue;

    const trimmed = incoming.trim();
    if (!trimmed) continue;

    // Keep labels short so nav and badges do not overflow.
    sanitized[role] = trimmed.slice(0, 60);
  }

  return sanitized;
}

function mergeRoleDisplayLabels(rawLabels) {
  return {
    ...DEFAULT_ROLE_DISPLAY_LABELS,
    ...sanitizeRoleDisplayLabels(rawLabels)
  };
}

function getRoleDisplayLabel(role, rawLabels) {
  const labels = mergeRoleDisplayLabels(rawLabels);
  const normalizedRole = String(role || '').trim();
  return labels[normalizedRole] || normalizedRole || 'Unknown Role';
}

module.exports = {
  SYSTEM_ROLES,
  ROLE_PERMISSIONS,
  DEFAULT_ROLE_DISPLAY_LABELS,
  getPermissionsForRole,
  canRole,
  sanitizeRoleDisplayLabels,
  mergeRoleDisplayLabels,
  getRoleDisplayLabel
};
