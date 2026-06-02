const SYSTEM_ROLES = ['dsp', 'supervisor', 'org_admin', 'super_admin'];

const DEFAULT_ROLE_DISPLAY_LABELS = {
  dsp: 'Direct Support Professional',
  supervisor: 'Supervisor',
  org_admin: 'Organization Admin',
  super_admin: 'Super Admin'
};

const POLICY_MANAGER_PERMISSIONS = [
  'policies:create',
  'policies:update',
  'policies:archive',
  'policies:submit_review',
  'policies:approve',
  'policies:history:read',
  'policies:rollback',
  'policies:read_receipts'
];

const ROLE_PERMISSIONS = {
  dsp: [
    'clients:assigned:read',
    'tracker:entry:create',
    'tracker:entry:read',
    'ask:approved_guidance:read',
    'shifts:handoff:create',
    'shifts:own:read',
    'policies:read',
    'policies:ack',
    'policies:notifications:read'
  ],
  supervisor: [
    'clients:assigned:read',
    'clients:create',
    'clients:update',
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
    'legal_records:export',
    'homes:read',
    'homes:update',
    'policies:read',
    'policies:ack',
    'policies:notifications:read'
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
    'legal_records:export',
    'homes:read',
    'homes:create',
    'homes:update',
    'homes:manage',
    'users:permissions:update',
    'policies:read',
    'policies:ack',
    'policies:notifications:read'
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
    'legal_records:export',
    'homes:read',
    'homes:create',
    'homes:update',
    'homes:archive',
    'homes:manage',
    'users:permissions:update',
    'policies:read',
    'policies:ack',
    'policies:notifications:read',
    ...POLICY_MANAGER_PERMISSIONS
  ]
};

const KNOWN_PERMISSIONS = Array.from(new Set(Object.values(ROLE_PERMISSIONS).flat()));

function getPermissionsForRole(role) {
  const normalizedRole = String(role || '').trim();
  return ROLE_PERMISSIONS[normalizedRole] ? [...ROLE_PERMISSIONS[normalizedRole]] : [];
}

function normalizeCustomPermissions(customPermissions) {
  if (!Array.isArray(customPermissions)) return [];
  return Array.from(new Set(
    customPermissions
      .map((permission) => String(permission || '').trim())
      .filter(Boolean)
      .filter((permission) => KNOWN_PERMISSIONS.includes(permission) || permission.startsWith('policies:'))
  ));
}

function getEffectivePermissionsForUser(user) {
  const rolePermissions = getPermissionsForRole(user?.role);
  const customPermissions = normalizeCustomPermissions(user?.customPermissions);
  return Array.from(new Set([...rolePermissions, ...customPermissions]));
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
  POLICY_MANAGER_PERMISSIONS,
  KNOWN_PERMISSIONS,
  DEFAULT_ROLE_DISPLAY_LABELS,
  getPermissionsForRole,
  getEffectivePermissionsForUser,
  normalizeCustomPermissions,
  canRole,
  sanitizeRoleDisplayLabels,
  mergeRoleDisplayLabels,
  getRoleDisplayLabel
};
