const DEFAULT_API_BASE = (() => {
  const { hostname, protocol } = window.location;

  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8081';
  }

  if (hostname === 'synoracare-frontend.onrender.com') {
    return 'https://synoracare-backend.onrender.com';
  }

  if (hostname === 'synoracare.com' || hostname === 'www.synoracare.com') {
    return 'https://synoracare-backend.onrender.com';
  }

  if (hostname.startsWith('api.')) {
    return `${protocol}//${hostname}`;
  }

  return `${protocol}//api.${hostname.replace(/^www\./, '')}`;
})();

const API_BASE = window.SYNORACARE_CONFIG?.API_BASE || window.CAREGUIDE_CONFIG?.API_BASE || DEFAULT_API_BASE;
const DEMO_TOGGLE_ALLOWED_EMAILS = new Set(['terrasample@yahoo.com']);
let token = '';
let currentUser = null;
let roleViewOverride = null;
let clientsCache = [];
let usersCache = [];
let selectedTrainingContext = 'pre_shift';
let legalExportPayload = null;
let selectedPatientTab = 'care';
let currentPatientWorkspace = { clientId: '', entries: [] };
let currentPage = '';
let currentTrackerFeed = [];
let trackerStatusFilter = '';
let demoMode = localStorage.getItem('synoracare_demo_mode') === '1' || new URLSearchParams(window.location.search).get('demo') === '1';
if (demoMode) localStorage.setItem('synoracare_demo_mode', '1');

// Shift management
let currentShift = null;
let shiftStartTime = null;
const OFFLINE_ENTRIES_KEY = 'synoracare_offline_entries';
const CURRENT_SHIFT_KEY = 'synoracare_current_shift';

const DEMO_CLIENTS = [
  { _id: 'demo-client-1', displayName: 'Jordan Miles', externalId: 'SC-1001' },
  { _id: 'demo-client-2', displayName: 'Avery Brooks', externalId: 'SC-1002' },
  { _id: 'demo-client-3', displayName: 'Taylor Reed', externalId: 'SC-1003' }
];
const DEMO_CLIENTS_STORAGE_KEY = 'synoracare_demo_clients';

const DEMO_USERS = [
  { _id: 'demo-user-1', fullName: 'Nia Carter', role: 'dsp' },
  { _id: 'demo-user-2', fullName: 'Isaiah Moore', role: 'dsp' },
  { _id: 'demo-user-3', fullName: 'Camila James', role: 'supervisor' }
];

const ROLE_PREVIEW_USERS = {
  dsp: { _id: 'demo-login-dsp', fullName: 'Nia Carter', email: 'preview.dsp@synoracare.demo', role: 'dsp' },
  supervisor: { _id: 'demo-login-supervisor', fullName: 'Camila James', email: 'preview.supervisor@synoracare.demo', role: 'supervisor' },
  org_admin: { _id: 'demo-login-org-admin', fullName: 'Alex Rivera', email: 'preview.orgadmin@synoracare.demo', role: 'org_admin' }
};

const DEMO_TRACKER_SUMMARY = {
  pending: 6,
  escalated: 1,
  completed: 18
};

const DEMO_TRACKER_ENTRIES = [
  {
    _id: 'demo-tracker-1',
    summary: 'Morning medication verification pending for Jordan Miles.',
    status: 'pending',
    eventType: 'medication',
    priority: 'high',
    dueAt: new Date(Date.now() + 45 * 60 * 1000).toISOString()
  },
  {
    _id: 'demo-tracker-2',
    summary: 'Behavior escalation debrief required after afternoon event.',
    status: 'escalated',
    eventType: 'behavior',
    priority: 'critical',
    dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  },
  {
    _id: 'demo-tracker-3',
    summary: 'ADL support log completed and signed by assigned DSP.',
    status: 'completed',
    eventType: 'adl',
    priority: 'medium',
    dueAt: new Date(Date.now() - 90 * 60 * 1000).toISOString()
  }
];

function getDemoClients() {
  // Always use the defined DEMO_CLIENTS for consistency
  return DEMO_CLIENTS.map((client) => ({ ...client }));
}

function saveDemoClients(clients) {
  try {
    localStorage.setItem(DEMO_CLIENTS_STORAGE_KEY, JSON.stringify(clients));
  } catch {
    // Ignore storage failures in private/incognito contexts.
  }
}

function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach((page) => {
    page.style.display = page.id === pageId ? '' : 'none';
  });
  currentPage = pageId;
  document.querySelectorAll('.nav-item[data-nav-target]').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.navTarget === pageId);
  });
  const main = document.querySelector('.main-content');
  if (main) main.scrollTop = 0;
}

const ROLE_TRAINING = {
  guest: {
    label: 'Guest',
    checklist: [
      'Use bootstrap only for first-time setup.',
      'If your org already exists, request account creation from an admin.',
      'Never use shared credentials for PHI workflows.'
    ],
    policy: [
      'No PHI should be entered before authenticated session starts.',
      'All user access must map to least-privilege roles.',
      'Security events are audited after login.'
    ]
  },
  dsp: {
    label: 'DSP',
    checklist: [
      'Confirm assigned client before documenting actions.',
      'Use tracker entries for meds, ADLs, and incident signals in real time.',
      'Escalate uncertainty to supervisor before acting outside plan.'
    ],
    policy: [
      'Only access assigned clients unless emergency break-glass is approved.',
      'Do not copy PHI into external apps or personal notes.',
      'Document factual observations, not assumptions.'
    ]
  },
  supervisor: {
    label: 'Supervisor',
    checklist: [
      'Review escalated tracker items at shift handoff.',
      'Validate assignment windows and remove stale access quickly.',
      'Coach DSP entries toward concise, objective language.'
    ],
    policy: [
      'Break-glass usage must include a specific emergency reason.',
      'Audit suspicious repeated denied-access attempts.',
      'Retain decision traceability for compliance reviews.'
    ]
  },
  org_admin: {
    label: 'Org Admin',
    checklist: [
      'Provision users with minimum required role.',
      'Rotate temporary passwords at onboarding completion.',
      'Review inactive accounts and expired assignments weekly.'
    ],
    policy: [
      'Enforce role-based access by job function.',
      'Keep HIPAA/security policy links updated and accessible.',
      'Validate audit retention and incident response workflow.'
    ]
  },
  super_admin: {
    label: 'Super Admin',
    checklist: [
      'Validate org setup and emergency workflows quarterly.',
      'Run access-control checks against production-like scenarios.',
      'Confirm model outputs remain grounded in approved documents.'
    ],
    policy: [
      'Maintain shared-responsibility controls and legal review cadence.',
      'Track platform-level security alerts to closure.',
      'Document control changes that impact PHI handling.'
    ]
  }
};

const CONTEXT_TRAINING_TIPS = {
  pre_shift: [
    'Confirm assigned clients and active assignment windows before first task.',
    'Review high-priority tracker items from previous shift handoff.',
    'Check that emergency escalation contacts are current.'
  ],
  documentation: [
    'Write timestamped, objective notes with direct observations.',
    'Attach relevant doc type (ISP/MAR/behavior) before uploading.',
    'Avoid including unrelated PHI in free-text fields.'
  ],
  grounded_qa: [
    'Ask focused, client-specific questions tied to known routines.',
    'If answer confidence is low, cross-check source citations before action.',
    'Escalate to supervisor when instructions conflict across documents.'
  ],
  escalation: [
    'Escalate immediately for safety risks, med uncertainty, or behavior instability.',
    'Use break-glass only for active emergency scenarios and document reason clearly.',
    'Create tracker entries for incident timeline and follow-up ownership.'
  ]
};

const CONTEXT_TRAINING_VARIANTS = {
  pre_shift: {
    checklist: [
      'Verify staffing coverage, shift assignments, and high-risk clients before opening tasks.',
      'Pre-stage MAR and ISP references for the first two clients on shift.'
    ],
    policy: [
      'Do not begin direct support tasks until handoff is acknowledged in tracker.',
      'Flag any staffing or assignment mismatch before med-pass start.'
    ]
  },
  documentation: {
    checklist: [
      'Capture objective notes in chronological order with exact time stamps.',
      'Attach source document type (ISP, MAR, behavior) for every critical entry.'
    ],
    policy: [
      'Use neutral language only; avoid inferred diagnoses or speculation.',
      'Close each note with follow-up owner and deadline where applicable.'
    ]
  },
  grounded_qa: {
    checklist: [
      'Ask one client-specific operational question per prompt to keep answers precise.',
      'Confirm citation-backed answer before executing medication or behavior steps.'
    ],
    policy: [
      'Any uncited or conflicting answer requires supervisor confirmation before action.',
      'Log all high-impact Q&A outcomes in tracker for audit traceability.'
    ]
  },
  escalation: {
    checklist: [
      'Start escalation timer immediately and document first action within two minutes.',
      'Record who was notified, when, and what instruction was given.'
    ],
    policy: [
      'Break-glass events must include emergency reason and closure note.',
      'Escalation entries cannot be deleted; only status-updated with final disposition.'
    ]
  }
};

const ROLE_HIDDEN_SECTIONS = {
  dsp: [
    'bootstrapSection',
    'createUserSection',
    'createClientSection',
    'assignmentSection',
    'uploadSection',
    'auditSection',
    'legalRecordsSection'
  ],
  supervisor: ['bootstrapSection', 'createUserSection'],
  org_admin: ['bootstrapSection'],
  super_admin: []
};

function createSampleDocText() {
  return [
    'Client: Sample Care Client',
    'ISP Summary:',
    '- Two-staff assist required for shower transfer.',
    '- Use calm verbal prompts before touch.',
    '- Maintain privacy with towel coverage.',
    'Medication Schedule:',
    '- 8:00 AM medication round.',
    '- 8:00 PM medication round.',
    'Escalation:',
    '- If refusal or agitation occurs, notify supervisor immediately.'
  ].join('\n');
}

function attachFileToUploadInput(file) {
  const input = document.querySelector('#uploadForm input[name="document"]');
  if (!input) throw new Error('Upload file input not found');

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
}

function setUploadDefaults() {
  const titleInput = document.querySelector('#uploadForm input[name="title"]');
  const docTypeInput = document.querySelector('#uploadForm select[name="docType"]');
  if (titleInput && !titleInput.value.trim()) {
    titleInput.value = 'Sample ISP Test Document';
  }
  if (docTypeInput) {
    docTypeInput.value = 'isp';
  }
}

function generateSampleTxtFile() {
  const text = createSampleDocText();
  const file = new File([text], 'sample-synoracare-isp.txt', { type: 'text/plain' });
  attachFileToUploadInput(file);
  setUploadDefaults();
  setOutput('uploadOutput', 'Sample TXT loaded. Select a client and click Upload.');
}

function generateSamplePdfFile() {
  const jsPdfNS = window.jspdf;
  if (!jsPdfNS || !jsPdfNS.jsPDF) {
    throw new Error('PDF generator not available. Refresh and try again.');
  }

  const doc = new jsPdfNS.jsPDF();
  const lines = createSampleDocText().split('\n');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(lines, 14, 20);

  const blob = doc.output('blob');
  const file = new File([blob], 'sample-synoracare-isp.pdf', { type: 'application/pdf' });
  attachFileToUploadInput(file);
  setUploadDefaults();
  setOutput('uploadOutput', 'Sample PDF loaded. Select a client and click Upload.');
}

function setOutput(id, data) {
  const el = document.getElementById(id);
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

let toastTimer = null;
function showToast(message, type = 'error') {
  const text = String(message || '').trim();
  if (!text) return;

  let container = document.getElementById('appToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'appToastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  container.innerHTML = '';
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = text;
  container.appendChild(toast);

  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    if (container) container.innerHTML = '';
    toastTimer = null;
  }, 3600);
}

function updateSession() {
  const info = document.getElementById('sessionInfo');
  const logoutBtn = document.getElementById('logoutBtn');
  const roleSwitcher = document.getElementById('demoRoleSwitcher');
  const activeRole = getActiveRole();

  if (!currentUser) {
    info.textContent = 'Not logged in';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (roleSwitcher) roleSwitcher.style.display = 'none';
    roleViewOverride = null;
    syncDemoToggle();
    applyRoleMode('guest');
    renderTraining('guest', selectedTrainingContext);
    saveCurrentShift(null);
    return;
  }

  info.textContent = roleViewOverride
    ? `${currentUser.fullName} | ${currentUser.role} (viewing as ${activeRole})`
    : `${currentUser.fullName} | ${currentUser.role}`;
  if (logoutBtn) logoutBtn.style.display = '';

  if (roleSwitcher) {
    if (currentUser.role === 'super_admin') {
      roleSwitcher.style.display = '';
      roleSwitcher.value = activeRole;
      roleSwitcher.title = 'Role view';
      roleSwitcher.setAttribute('aria-label', 'Role view');
    } else {
      roleSwitcher.style.display = 'none';
    }
  }

  applyRoleMode(activeRole);
  syncDemoToggle();
  renderTraining(activeRole, selectedTrainingContext);
  loadCurrentShift();
  updateShiftUI();
  renderHomeSection();
}

function canToggleDemoMode() {
  if (!currentUser) return true;
  return DEMO_TOGGLE_ALLOWED_EMAILS.has(String(currentUser.email || '').toLowerCase());
}

function syncDemoToggle() {
  const wrap = document.getElementById('demoModeToggleWrap');
  const toggle = document.getElementById('demoModeToggle');
  const loginWrap = document.getElementById('loginDemoModeToggleWrap');
  const loginToggle = document.getElementById('loginDemoModeToggle');
  const allowed = canToggleDemoMode();

  if (wrap) wrap.style.display = allowed ? '' : 'none';
  if (loginWrap) loginWrap.style.display = allowed ? '' : 'none';
  if (toggle) toggle.checked = demoMode;
  if (loginToggle) loginToggle.checked = demoMode;
}

function setDemoMode(nextMode) {
  demoMode = Boolean(nextMode);
  localStorage.setItem('synoracare_demo_mode', demoMode ? '1' : '0');
  syncDemoToggle();
  
  // Refresh data without reloading, so the user stays on the current page
  const page = currentPage;
  Promise.all([
    refreshClients(),
    refreshUsers(),
    loadTrackerSummary(),
    loadTrackerFeed()
  ]).then(() => {
    // Re-render current section if it needs fresh data
    if (page === 'homeSection') renderHomeSection();
    else if (page === 'trackerSection') renderTrackerFeed(currentTrackerFeed || []);
  }).catch((err) => {
    console.error('Error refreshing data after demo mode toggle:', err);
  });
}

function applyRoleMode(role) {
  // Remove all previous mode/role classes
  document.body.classList.remove(
    'guest-mode', 'auth-mode',
    'role-dsp', 'role-supervisor', 'role-org_admin', 'role-super_admin', 'role-guest'
  );
  document.body.classList.remove('sidebar-open');

  if (!currentUser) {
    document.body.classList.add('guest-mode', 'role-guest');
    // Show only the login page; hide everything else
    document.querySelectorAll('.page').forEach((page) => {
      page.style.display = page.id === 'loginSection' ? '' : 'none';
    });
    currentPage = 'guest';
    return;
  }

  document.body.classList.add('auth-mode', `role-${role}`);
  navigateTo('homeSection');
}

function renderTraining(role, context) {
  const training = ROLE_TRAINING[role] || ROLE_TRAINING.guest;
  const contextTips = CONTEXT_TRAINING_TIPS[context] || CONTEXT_TRAINING_TIPS.pre_shift;
  const contextVariant = CONTEXT_TRAINING_VARIANTS[context] || CONTEXT_TRAINING_VARIANTS.pre_shift;
  const checklistItems = [...training.checklist.slice(0, 1), ...contextVariant.checklist];
  const policyItems = [...training.policy.slice(0, 1), ...contextVariant.policy];

  const roleHeader = document.getElementById('trainingRoleHeader');
  if (roleHeader) {
    roleHeader.textContent = `Role Focus: ${training.label}`;
  }

  const checklist = document.getElementById('trainingChecklist');
  if (checklist) {
    checklist.innerHTML = checklistItems.map((item) => `<li>${safeText(item)}</li>`).join('');
  }

  const policy = document.getElementById('trainingPolicyReminders');
  if (policy) {
    policy.innerHTML = policyItems.map((item) => `<li>${safeText(item)}</li>`).join('');
  }

  const tips = document.getElementById('trainingContextTips');
  if (tips) {
    tips.innerHTML = contextTips.map((item) => `<li>${safeText(item)}</li>`).join('');
  }

  document.querySelectorAll('.training-context-btn').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.trainingContext === context);
  });
}

function setSelectOptions(selectId, options, placeholder) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const previous = select.value;
  select.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = placeholder;
  select.appendChild(defaultOption);

  options.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });

  const hasPrevious = options.some((item) => item.value === previous);
  select.value = hasPrevious ? previous : '';
}

function syncClientPickers() {
  const options = clientsCache.map((client) => ({
    value: client._id,
    label: `${client.displayName} (${client.externalId || 'no-ext-id'})`
  }));

  setSelectOptions('assignmentClientId', options, 'Select Client');
  setSelectOptions('uploadClientId', options, 'Select Client');
  setSelectOptions('askClientId', options, 'Select Client');
  setSelectOptions('breakGlassClientId', options, 'Select Client');
  setSelectOptions('trackerClientId', options, 'Select Client');
  setSelectOptions('legalRecordsClientId', options, 'Select Client');
  setSelectOptions('patientWorkspaceClientId', options, 'Select Client');
}

async function loadTrackerFeed() {
  try {
    const query = trackerStatusFilter ? `?limit=50&status=${encodeURIComponent(trackerStatusFilter)}` : '?limit=50';
    const data = await api(`/api/tracker${query}`);
    const entries = data.entries || [];
    if (demoMode && entries.length === 0) {
      renderTrackerFeed(
        trackerStatusFilter ? DEMO_TRACKER_ENTRIES.filter((entry) => entry.status === trackerStatusFilter) : DEMO_TRACKER_ENTRIES
      );
      return;
    }
    renderTrackerFeed(entries);
  } catch (error) {
    if (demoMode) {
      renderTrackerFeed(
        trackerStatusFilter ? DEMO_TRACKER_ENTRIES.filter((entry) => entry.status === trackerStatusFilter) : DEMO_TRACKER_ENTRIES
      );
      return;
    }
    throw error;
  }
}

async function loadTrackerSummary() {
  try {
    const data = await api('/api/tracker/summary');
    renderTrackerSummary(data);
  } catch (error) {
    if (demoMode) {
      renderTrackerSummary(DEMO_TRACKER_SUMMARY);
      return;
    }
    throw error;
  }
}

function safeText(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatDate(value) {
  if (!value) return 'n/a';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'n/a';
  return d.toLocaleString();
}

function renderTrackerFeed(entries) {
  currentTrackerFeed = entries;
  const feed = document.getElementById('trackerFeed');
  if (!feed) return;

  if (!entries.length) {
    const filterLabel = trackerStatusFilter ? ` ${trackerStatusFilter}` : '';
    feed.innerHTML = `<p class="tracker-empty">No${filterLabel} tracker events yet for your accessible clients.</p>`;
    return;
  }

  feed.innerHTML = entries
    .map((entry) => {
      const details = entry.details ? `<p class="tracker-details">${safeText(entry.details)}</p>` : '';
      const hasPhoto = Boolean(entry.photo && entry.photo.contentType);
      const photoCaption = entry.photoCaption ? `<p class="tracker-photo-caption">Photo: ${safeText(entry.photoCaption)}</p>` : '';
      const photoAction = hasPhoto
        ? `<button type="button" class="tracker-action tracker-photo-btn" data-view-photo="${safeText(entry._id)}">View Photo Evidence</button>`
        : '';
      return `
        <article class="tracker-item">
          <div class="tracker-top">
            <p class="tracker-summary">${safeText(entry.summary)}</p>
            <code>${safeText(entry.status)}</code>
          </div>
          <p class="tracker-meta">
            type: ${safeText(entry.eventType)} | priority: ${safeText(entry.priority)} | due: ${safeText(formatDate(entry.dueAt))}
          </p>
          ${details}
          ${photoCaption}
          <div class="tracker-actions">
            <button type="button" class="tracker-action pending" data-entry-id="${safeText(entry._id)}" data-status="pending">Set Pending</button>
            <button type="button" class="tracker-action completed" data-entry-id="${safeText(entry._id)}" data-status="completed">Set Completed</button>
            <button type="button" class="tracker-action escalated" data-entry-id="${safeText(entry._id)}" data-status="escalated">Set Escalated</button>
            ${photoAction}
          </div>
        </article>
      `;
    })
    .join('');
}

function setTrackerStatusFilter(status) {
  trackerStatusFilter = status || '';
  return Promise.all([loadTrackerSummary(), loadTrackerFeed()]);
}

async function openTrackerPhoto(entryId) {
  const response = await fetch(`${API_BASE}/api/tracker/${encodeURIComponent(entryId)}/photo`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Could not load tracker photo');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');

  // Revoke later to avoid leaking object URLs while keeping time to load new tab.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function updateTrackerStatus(entryId, status) {
  return api(`/api/tracker/${entryId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
}

function syncUserPicker() {
  const options = usersCache.map((user) => ({
    value: user._id,
    label: `${user.fullName} (${user.role})`
  }));
  setSelectOptions('assignmentUserId', options, 'Select User');
  setSelectOptions('resetPasswordUserId', options, 'Select Team Member');
}

async function refreshClients() {
  if (demoMode) {
    clientsCache = getDemoClients();
    syncClientPickers();
    renderClientList(clientsCache);
    return;
  }

  try {
    const data = await api('/api/clients');
    clientsCache = data.clients || [];
    syncClientPickers();
    renderClientList(clientsCache);
  } catch (error) {
    console.error('Error loading clients:', error);
    // Fall back to demo clients if API fails
    clientsCache = getDemoClients();
    syncClientPickers();
    renderClientList(clientsCache);
  }
}

async function refreshUsers() {
  try {
    const data = await api('/api/assignments/users');
    usersCache = data.users || [];
    if (demoMode && usersCache.length === 0) {
      usersCache = DEMO_USERS;
    }
    syncUserPicker();
    renderUserList(usersCache);
  } catch (error) {
    usersCache = demoMode ? DEMO_USERS : [];
    syncUserPicker();
    const list = document.getElementById('usersList');
    if (list && !demoMode) list.innerHTML = `<p class="empty-state">Could not load team: ${safeText(error.message)}</p>`;
    if (list && demoMode) renderUserList(usersCache);
  }
}

async function refreshAllPickers() {
  if (!token) return;
  await refreshClients();
  if (currentUser && ['super_admin', 'org_admin', 'supervisor'].includes(currentUser.role)) {
    await refreshUsers();
  }
}

// Offline storage for tracker entries
function saveOfflineEntry(entry) {
  try {
    const entries = JSON.parse(localStorage.getItem(OFFLINE_ENTRIES_KEY) || '[]');
    entries.push({ ...entry, savedAt: new Date().toISOString(), synced: false });
    localStorage.setItem(OFFLINE_ENTRIES_KEY, JSON.stringify(entries));
  } catch (e) {
    console.error('Failed to save offline entry:', e);
  }
}

function getActiveRole() {
  return currentUser ? (roleViewOverride || currentUser.role) : 'guest';
}

function getOfflineEntries() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_ENTRIES_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function clearOfflineEntries() {
  localStorage.removeItem(OFFLINE_ENTRIES_KEY);
}

async function syncOfflineEntries() {
  const entries = getOfflineEntries();
  if (entries.length === 0 || !navigator.onLine) return;

  for (const entry of entries.filter(e => !e.synced)) {
    try {
      await api('/tracker', { method: 'POST', body: JSON.stringify(entry) });
      entry.synced = true;
    } catch (error) {
      console.error('Failed to sync entry:', error);
      break;
    }
  }
  localStorage.setItem(OFFLINE_ENTRIES_KEY, JSON.stringify(entries));
}

// Shift management
function saveCurrentShift(shift) {
  try {
    if (shift) {
      localStorage.setItem(CURRENT_SHIFT_KEY, JSON.stringify(shift));
      currentShift = shift;
      shiftStartTime = new Date(shift.startedAt);
    } else {
      localStorage.removeItem(CURRENT_SHIFT_KEY);
      currentShift = null;
      shiftStartTime = null;
    }
  } catch (e) {
    console.error('Failed to save shift:', e);
  }
}

function loadCurrentShift() {
  try {
    const saved = localStorage.getItem(CURRENT_SHIFT_KEY);
    if (saved) {
      currentShift = JSON.parse(saved);
      shiftStartTime = new Date(currentShift.startedAt);
      return currentShift;
    }
  } catch (e) {
    console.error('Failed to load shift:', e);
  }
  return null;
}

async function startShift(clientId, scheduledEndTime = null) {
  if (!token) throw new Error('Not authenticated');
  try {
    const result = await api('/api/shifts', {
      method: 'POST',
      body: JSON.stringify({ clientId, scheduledEndTime })
    });
    saveCurrentShift(result.shift);
    updateShiftUI();
    return result.shift;
  } catch (error) {
    console.error('Failed to start shift:', error);
    throw error;
  }
}

async function endShift() {
  if (!currentShift) throw new Error('No active shift');
  try {
    const result = await api(`/api/shifts/${currentShift._id}/end`, {
      method: 'POST'
    });
    saveCurrentShift(null);
    updateShiftUI();
    showShiftReport(result.report);
    return result;
  } catch (error) {
    console.error('Failed to end shift:', error);
    throw error;
  }
}

function updateShiftUI() {
  const widget = document.getElementById('shiftTimerWidget');
  const startBtn = document.getElementById('startShiftBtn');
  const endBtn = document.getElementById('endShiftBtn');

  if (!widget) return;

  if (currentShift && currentShift.status === 'active') {
    startBtn.style.display = 'none';
    endBtn.style.display = '';
    updateShiftTimer();
    setInterval(updateShiftTimer, 1000);
  } else {
    startBtn.style.display = '';
    endBtn.style.display = 'none';
    if (widget) widget.textContent = '';
  }
}

function updateShiftTimer() {
  if (!currentShift || !shiftStartTime) return;
  const widget = document.getElementById('shiftTimerWidget');
  if (!widget) return;

  const elapsed = Date.now() - shiftStartTime.getTime();
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  
  widget.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function showShiftReport(report) {
  const modal = document.getElementById('shiftReportModal');
  if (!modal) return;

  const summary = modal.querySelector('.shift-report-summary');
  const entries = modal.querySelector('.shift-report-entries');
  const escalations = modal.querySelector('.shift-report-escalations');

  if (summary) {
    summary.innerHTML = `
      <p>${safeText(report.summary)}</p>
      <div class="metrics">
        <span>Entries: ${report.entriesSnapshot.length}</span>
        <span>Escalations: ${report.escalations.length}</span>
        <span>Completion: ${report.performanceMetrics.completionRate}%</span>
        <span>Duration: ${Math.round(report.totalDuration / 60000)} min</span>
      </div>
    `;
  }

  if (entries && report.entriesSnapshot.length > 0) {
    entries.innerHTML = report.entriesSnapshot.map(e => `
      <div class="entry-item" data-priority="${e.priority}" data-status="${e.status}">
        <span class="entry-type">${e.eventType}</span>
        <span class="entry-summary">${safeText(e.summary)}</span>
        <span class="entry-status">${e.status}</span>
      </div>
    `).join('');
  }

  if (escalations && report.escalations.length > 0) {
    escalations.innerHTML = report.escalations.map(e => `
      <div class="escalation-item">
        <span class="escalation-icon">⚠️</span>
        <span>${safeText(e.summary)}</span>
      </div>
    `).join('');
  }

  modal.style.display = 'flex';
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) {
      token = '';
      currentUser = null;
      roleViewOverride = null;
      updateSession();
      throw new Error('Session expired. Please sign in again.');
    }
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function renderHomeSection() {
  if (!currentUser) return;
  const role = getActiveRole();

  const welcomeTitle = document.getElementById('homeWelcomeTitle');
  const welcomeRole = document.getElementById('homeWelcomeRole');
  if (welcomeTitle) welcomeTitle.textContent = `Welcome back, ${currentUser.fullName}`;

  const roleLabels = {
    dsp: 'Direct Support Professional',
    supervisor: 'Supervisor',
    org_admin: 'Organization Admin',
    super_admin: 'Super Admin'
  };
  if (welcomeRole) welcomeRole.textContent = roleLabels[role] || role;

  const actionsByRole = {
    dsp: [
      { label: 'Ask Grounded Q&A', target: 'askSection' },
      { label: 'Log Event', target: 'trackerSection' },
      { label: 'Emergency Access', target: 'breakGlassSection' },
      { label: 'My Training', target: 'trainingSection' }
    ],
    supervisor: [
      { label: 'Review Tracker', target: 'trackerSection' },
      { label: 'Upload Document', target: 'uploadSection' },
      { label: 'Assign DSP', target: 'assignmentSection' },
      { label: 'Audit Log', target: 'auditSection' }
    ],
    org_admin: [
      { label: 'Add Client', target: 'createClientSection' },
      { label: 'Assign DSP', target: 'assignmentSection' },
      { label: 'Legal Export', target: 'legalRecordsSection' },
      { label: 'Audit Log', target: 'auditSection' }
    ],
    super_admin: [
      { label: 'Add Team Member', target: 'createUserSection' },
      { label: 'Add Client', target: 'createClientSection' },
      { label: 'Assign DSP', target: 'assignmentSection' },
      { label: 'Legal Export', target: 'legalRecordsSection' },
      { label: 'Audit Log', target: 'auditSection' }
    ]
  };

  const homeActions = document.getElementById('homeActions');
  if (homeActions) {
    const actions = actionsByRole[role] || actionsByRole.dsp;
    homeActions.innerHTML = actions
      .map((a) => `<button type="button" class="quick-action-btn" data-nav-target="${safeText(a.target)}">${safeText(a.label)}</button>`)
      .join('');
  }

  try {
    const summaryData = await api('/api/tracker/summary');
    const homeStats = document.getElementById('homeStats');
    if (homeStats) {
      homeStats.innerHTML = `
        <button type="button" class="stat-chip stat-clickable" data-nav-target="createClientSection" aria-label="View clients"><span class="stat-value stat-value-home" style="color:#0f172a;">${clientsCache.length}</span><span class="stat-label">Clients</span></button>
        <button type="button" class="stat-chip stat-warn stat-clickable" data-nav-target="trackerSection" data-tracker-status="pending" aria-label="View pending tracker entries"><span class="stat-value stat-value-home stat-value-warn" style="color:#92400e;">${summaryData.pending || 0}</span><span class="stat-label">Pending</span></button>
        <button type="button" class="stat-chip stat-danger stat-clickable" data-nav-target="trackerSection" data-tracker-status="escalated" aria-label="View escalated tracker entries"><span class="stat-value stat-value-home stat-value-danger" style="color:#b91c1c;">${summaryData.escalated || 0}</span><span class="stat-label">Escalated</span></button>
        <button type="button" class="stat-chip stat-ok stat-clickable" data-nav-target="trackerSection" data-tracker-status="completed" aria-label="View completed tracker entries"><span class="stat-value stat-value-home stat-value-ok" style="color:#166534;">${summaryData.completed || 0}</span><span class="stat-label">Completed</span></button>
      `;
    }

    const homeAlerts = document.getElementById('homeAlerts');
    if (homeAlerts) {
      if (clientsCache.length === 0 && ['org_admin', 'super_admin'].includes(role)) {
        homeAlerts.innerHTML = `<div class="onboard-hint"><strong>Get started:</strong> Add your first client below, then assign a DSP to begin care tracking.<button type="button" class="quick-action-btn" data-scroll-target="createClientSection" style="margin-left:12px;">Add First Client →</button></div>`;
      } else if ((summaryData.escalated || 0) > 0) {
        try {
          const feedData = await api('/api/tracker?limit=20');
          const escalated = (feedData.entries || []).filter((e) => e.status === 'escalated').slice(0, 3);
          if (escalated.length) {
            homeAlerts.innerHTML = `
              <p class="alerts-heading">Escalated Items Requiring Attention</p>
              ${escalated.map((e) => `
                <div class="alert-item">
                  <span class="alert-badge">ESCALATED</span>
                  <span class="alert-summary">${safeText(e.summary)}</span>
                  <span class="alert-meta">${safeText(e.eventType)} · ${safeText(formatDate(e.dueAt))}</span>
                </div>
              `).join('')}
            `;
          }
        } catch (_e) {}
      } else {
        homeAlerts.innerHTML = '';
      }
    }
  } catch (_e) {
    // Stats are non-critical — home section still renders
  }
}

function renderAskAnswer(data) {
  const messages = document.getElementById('chatMessages');
  if (!messages) return;

  // Remove typing indicator
  const typing = messages.querySelector('.chat-typing');
  if (typing) typing.remove();

  const answer = typeof data === 'string' ? data : (data?.answer || 'No answer returned.');
  const sources = Array.isArray(data?.sources)
    ? data.sources
    : (Array.isArray(data?.citations) ? data.citations : []);
  const structured = data?.structured || null;
  const missingSections = Array.isArray(data?.missingSections) ? data.missingSections : [];
  const escalationRequired = Boolean(data?.escalationRequired);

  const formatStructuredBlock = (value, emptyLabel = 'Not found in active documents.') => {
    const text = String(value || '').trim();
    if (!text) return `<p class="isp-empty">${safeText(emptyLabel)}</p>`;
    return `<p>${safeText(text).replace(/\n/g, '<br>')}</p>`;
  };

  const structuredHtml = structured
    ? `<div class="isp-brief">
        ${escalationRequired ? `<div class="isp-escalation-banner"><strong>Escalation required:</strong> ${safeText(data?.escalationMessage || 'Missing required guidance. Escalate before proceeding.')}</div>` : ''}
        <div class="isp-grid">
          <article class="isp-card"><h4>Dietary Restrictions</h4>${formatStructuredBlock(structured.diet)}</article>
          <article class="isp-card"><h4>Allergies</h4>${formatStructuredBlock(structured.allergies)}</article>
          <article class="isp-card"><h4>Behavior Notes</h4>${formatStructuredBlock(structured.behavior)}</article>
          <article class="isp-card"><h4>Assistance Protocols</h4>${formatStructuredBlock(structured.protocols)}</article>
        </div>
        ${missingSections.length ? `<p class="isp-missing">Missing sections: ${safeText(missingSections.join(', '))}</p>` : ''}
      </div>`
    : '';

  const sourcesHtml = sources.length
    ? `<div class="chat-sources">${sources.map((s) => `<span class="source-tag">${safeText(s.sourceFileName || s.title || s.docType || 'document')}</span>`).join('')}</div>`
    : '';

  const bubble = document.createElement('div');
  bubble.className = 'chat-message chat-message-ai';
  bubble.innerHTML = `<div class="chat-bubble"><div class="chat-bubble-text">${safeText(answer).replace(/\n/g, '<br>')}</div>${structuredHtml}${sourcesHtml}</div>`;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

function getSelectedAskClient() {
  const select = document.getElementById('askClientId');
  if (!select) return { clientId: '', clientName: 'this client' };
  const clientId = select.value || '';
  const option = select.options[select.selectedIndex];
  const label = option ? String(option.textContent || '').trim() : '';
  const clientName = label ? label.split('(')[0].trim() : 'this client';
  return { clientId, clientName };
}

async function requestMealAssistSnapshot() {
  const { clientId, clientName } = getSelectedAskClient();
  if (!clientId) {
    showToast('Please select a client first.', 'info');
    return;
  }

  const messages = document.getElementById('chatMessages');
  const userQuestion = `How should I assist ${clientName} with meals?`;

  const welcome = messages?.querySelector('.chat-welcome-state');
  if (welcome) welcome.remove();

  if (messages) {
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-message chat-message-user';
    userBubble.innerHTML = `<div class="chat-bubble"><div class="chat-bubble-text">${safeText(userQuestion)}</div></div>`;
    messages.appendChild(userBubble);

    const typing = document.createElement('div');
    typing.className = 'chat-message chat-message-ai chat-typing';
    typing.innerHTML = '<div class="chat-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
  }

  try {
    const data = await api('/api/ask/isp-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId })
    });
    renderAskAnswer(data);
  } catch (err) {
    renderAskAnswer(err.message);
  }
}

function renderAuditFeed(data) {
  const feed = document.getElementById('auditFeed');
  if (!feed) return;

  const events = data.events || data.auditEvents || (Array.isArray(data) ? data : []);

  if (!events.length) {
    feed.innerHTML = '<p class="empty-state">No audit events yet.</p>';
    return;
  }

  feed.innerHTML = events.map((ev) => `
    <div class="audit-event">
      <div class="audit-event-header">
        <span class="audit-event-type">${safeText(ev.eventType || ev.type || 'event')}</span>
        <span class="audit-event-time">${safeText(formatDate(ev.createdAt))}</span>
      </div>
      <p class="audit-event-user">${safeText(ev.userId?.fullName || String(ev.userId || 'system'))}</p>
    </div>
  `).join('');
}

function renderClientList(clients) {
  const list = document.getElementById('clientsList');
  if (!list) return;

  if (!clients || !clients.length) {
    list.innerHTML = '<p class="empty-state">No clients yet. Add your first client above.</p>';
    return;
  }

  list.innerHTML = clients.map((c) => `
    <div class="data-item">
      <span class="data-item-label">${safeText(c.displayName)}</span>
      <span class="data-item-meta">${safeText(c.externalId || '—')}</span>
    </div>
  `).join('');
}

function renderUserList(users) {
  const list = document.getElementById('usersList');
  if (!list) return;

  if (!users || !users.length) {
    list.innerHTML = '<p class="empty-state">No staff yet.</p>';
    return;
  }

  list.innerHTML = users.map((u) => `
    <div class="data-item">
      <span class="data-item-label">${safeText(u.fullName)}</span>
      <span class="data-item-meta data-item-role role-${safeText(u.role)}">${safeText(u.role)}</span>
      <span class="data-item-meta">${safeText(u.status || 'active')}</span>
      <span class="data-item-email">${safeText(u.email)}</span>
    </div>
  `).join('');
}

function renderTrackerSummary(data) {
  const container = document.getElementById('trackerSummaryCards');
  if (!container) return;

  container.innerHTML = `
    <div class="summary-stat"><span class="summary-stat-value">${data.total || 0}</span><span class="summary-stat-label">Total</span></div>
    <div class="summary-stat stat-warn"><span class="summary-stat-value">${data.pending || 0}</span><span class="summary-stat-label">Pending</span></div>
    <div class="summary-stat stat-ok"><span class="summary-stat-value">${data.completed || 0}</span><span class="summary-stat-label">Completed</span></div>
    <div class="summary-stat stat-danger"><span class="summary-stat-value">${data.escalated || 0}</span><span class="summary-stat-label">Escalated</span></div>
    <div class="summary-stat stat-overdue"><span class="summary-stat-value">${data.overdue || 0}</span><span class="summary-stat-label">Overdue</span></div>
  `;
}

function entryMatchesTab(entry, tab) {
  const textBlob = `${entry.summary || ''} ${entry.details || ''}`.toLowerCase();
  if (tab === 'care') {
    return ['adl', 'handoff', 'note'].includes(entry.eventType) || !entry.eventType;
  }
  if (tab === 'nutrition') {
    return /meal|nutrition|diet|fluid|hydrate|food/.test(textBlob);
  }
  if (tab === 'medications') {
    return entry.eventType === 'medication';
  }
  if (tab === 'behavior') {
    return ['behavior', 'incident'].includes(entry.eventType);
  }
  if (tab === 'safety') {
    return entry.status === 'escalated' || entry.priority === 'urgent' || entry.priority === 'high';
  }
  return true;
}

function renderPatientTabContent() {
  const container = document.getElementById('patientTabContent');
  if (!container) return;

  if (!currentPatientWorkspace.clientId) {
    container.innerHTML = '<p class="empty-state">Select a patient and click Load Patient.</p>';
    return;
  }

  if (selectedPatientTab === 'legal') {
    container.innerHTML = `
      <div class="patient-items">
        <div class="patient-item">
          <p class="patient-item-title">Legal & Compliance Records</p>
          <p class="patient-item-meta">Use the Legal Records Export section below to generate a retention-filtered package for legal review.</p>
          <p class="patient-item-meta">Tip: set the same patient in Legal Records Export for this request.</p>
        </div>
      </div>
    `;
    return;
  }

  const filtered = currentPatientWorkspace.entries.filter((entry) => entryMatchesTab(entry, selectedPatientTab));
  if (!filtered.length) {
    container.innerHTML = '<p class="empty-state">No matching records for this tab yet.</p>';
    return;
  }

  container.innerHTML = `<div class="patient-items">${filtered.slice(0, 50).map((entry) => `
      <article class="patient-item">
        <p class="patient-item-title">${safeText(entry.summary || 'Untitled entry')}</p>
        <p class="patient-item-meta">Type: ${safeText(entry.eventType || 'n/a')} | Status: ${safeText(entry.status || 'n/a')} | Priority: ${safeText(entry.priority || 'n/a')}</p>
        <p class="patient-item-meta">Updated: ${safeText(formatDate(entry.updatedAt || entry.createdAt))}</p>
      </article>
    `).join('')}</div>`;
}

async function loadPatientWorkspace() {
  const select = document.getElementById('patientWorkspaceClientId');
  const clientId = select ? select.value : '';
  if (!clientId) {
    currentPatientWorkspace = { clientId: '', entries: [] };
    renderPatientTabContent();
    return;
  }

  const data = await api(`/api/tracker?clientId=${encodeURIComponent(clientId)}&limit=200`);
  currentPatientWorkspace = {
    clientId,
    entries: data.entries || []
  };
  renderPatientTabContent();
}

function renderLegalRecordsSummary(data) {
  const list = document.getElementById('legalRecordsSummary');
  const downloadBtn = document.getElementById('downloadLegalExportBtn');
  if (!list || !downloadBtn) return;

  if (!data || !data.exportMeta) {
    legalExportPayload = null;
    downloadBtn.disabled = true;
    list.innerHTML = '<p class="empty-state">Generate an export to preview legal retention filtering and record counts.</p>';
    return;
  }

  legalExportPayload = data;
  downloadBtn.disabled = false;

  const policy = data.exportMeta.retentionPolicy || {};
  const counts = data.counts || {};
  list.innerHTML = `
    <div class="data-item">
      <div class="data-item-stack">
        <span class="data-item-label">Retention Policy</span>
        <span class="data-item-meta">State: ${safeText(policy.stateCode || 'UNKNOWN')} | Years: ${safeText(policy.years || 'n/a')} | Source: ${safeText(policy.source || 'n/a')}</span>
        <span class="data-item-meta">Cutoff: ${safeText(formatDate(policy.cutoffDate))}</span>
      </div>
    </div>
    <div class="data-item">
      <div class="data-item-stack">
        <span class="data-item-label">Export Counts</span>
        <span class="data-item-meta">Documents: ${safeText(counts.documents || 0)} | Tracker Entries: ${safeText(counts.trackerEntries || 0)} | Audit Events: ${safeText(counts.auditEvents || 0)}</span>
      </div>
    </div>
    <div class="data-item">
      <div class="data-item-stack">
        <span class="data-item-label">Client</span>
        <span class="data-item-meta">${safeText(data.client?.displayName || 'Unknown')}</span>
      </div>
    </div>
  `;
}

async function fetchAndShowVersion() {
  try {
    const data = await fetch(`${API_BASE}/api/status`).then((r) => r.json());
    const badge = document.getElementById('versionBadge');
    if (badge && data.version) {
      badge.textContent = `v${data.version}`;
      badge.title = `Build: ${data.buildDate || 'dev'} · Uptime: ${Math.floor(data.uptime || 0)}s`;
      badge.style.display = '';
    }
  } catch (_e) {
    // Version badge is non-critical
  }
}

document.getElementById('bootstrapForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const payload = Object.fromEntries(form.entries());
    const data = await api('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    token = data.token;
    currentUser = data.user;
    roleViewOverride = null;
    updateSession();
    await refreshAllPickers();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Password eye toggle
const pwEyeBtn = document.getElementById('pwEyeBtn');
const loginPwInput = document.getElementById('loginPasswordInput');
const loginEmailInput = document.getElementById('loginEmail');
const loginRolePreviewSelect = document.getElementById('loginRolePreview');
const eyeOpenIcon = document.getElementById('eyeOpenIcon');
const eyeClosedIcon = document.getElementById('eyeClosedIcon');
if (pwEyeBtn && loginPwInput) {
  pwEyeBtn.addEventListener('click', () => {
    const isPassword = loginPwInput.type === 'password';
    loginPwInput.type = isPassword ? 'text' : 'password';
    if (eyeOpenIcon) eyeOpenIcon.style.display = isPassword ? 'none' : '';
    if (eyeClosedIcon) eyeClosedIcon.style.display = isPassword ? '' : 'none';
  });
}

function syncRolePreviewLoginState() {
  if (!loginRolePreviewSelect || !loginEmailInput || !loginPwInput) return;
  const usingPreview = Boolean(loginRolePreviewSelect.value);

  loginEmailInput.disabled = usingPreview;
  loginPwInput.disabled = usingPreview;
  loginEmailInput.required = !usingPreview;
  loginPwInput.required = !usingPreview;

  if (pwEyeBtn) pwEyeBtn.disabled = usingPreview;
  if (usingPreview && loginPwInput.type !== 'password') {
    loginPwInput.type = 'password';
    if (eyeOpenIcon) eyeOpenIcon.style.display = '';
    if (eyeClosedIcon) eyeClosedIcon.style.display = 'none';
  }
}

loginRolePreviewSelect?.addEventListener('change', () => {
  syncRolePreviewLoginState();
});
syncRolePreviewLoginState();

// Forgot password
const forgotPwBtn = document.getElementById('forgotPwBtn');
const forgotPasswordPanel = document.getElementById('forgotPasswordPanel');
const forgotPasswordForm = document.getElementById('forgotPasswordForm');
const forgotPasswordOutput = document.getElementById('forgotPasswordOutput');
const adminRecoveryToggle = document.getElementById('adminRecoveryToggle');
const accountRecoveryPanel = document.getElementById('accountRecoveryPanel');
const accountRecoveryForm = document.getElementById('accountRecoveryForm');
const accountRecoveryOutput = document.getElementById('accountRecoveryOutput');
const inviteAcceptPanel = document.getElementById('inviteAcceptPanel');
const inviteAcceptForm = document.getElementById('inviteAcceptForm');
const inviteAcceptOutput = document.getElementById('inviteAcceptOutput');

if (adminRecoveryToggle) {
  adminRecoveryToggle.addEventListener('click', () => {
    if (!accountRecoveryPanel) return;
    const isHidden = accountRecoveryPanel.style.display === 'none' || !accountRecoveryPanel.style.display;
    accountRecoveryPanel.style.display = isHidden ? '' : 'none';
    if (isHidden && forgotPasswordPanel) forgotPasswordPanel.style.display = 'none';
  });
}

if (forgotPwBtn) {
  forgotPwBtn.addEventListener('click', () => {
    if (!forgotPasswordPanel) {
      showToast('Please contact your organization administrator for account support.', 'info');
      return;
    }

    const isHidden = forgotPasswordPanel.style.display === 'none' || !forgotPasswordPanel.style.display;
    forgotPasswordPanel.style.display = isHidden ? '' : 'none';
    if (isHidden && accountRecoveryPanel) accountRecoveryPanel.style.display = 'none';

    if (isHidden && forgotPasswordForm) {
      const loginEmail = document.getElementById('loginEmail');
      const forgotEmailInput = forgotPasswordForm.querySelector('input[name="email"]');
      if (loginEmail && forgotEmailInput && !forgotEmailInput.value) {
        forgotEmailInput.value = loginEmail.value;
      }
      forgotEmailInput?.focus();
    }
  });
}

forgotPasswordForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  const params = new URLSearchParams(window.location.search);
  const suppliedToken = String(payload.resetToken || params.get('resetToken') || '').trim();
  try {
    let resetToken = suppliedToken;

    if (!resetToken) {
      if (forgotPasswordOutput) forgotPasswordOutput.textContent = 'Issuing one-time reset token...';

      const request = await api('/api/auth/forgot-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: payload.email })
      });

      if (!request.resetToken) {
        if (forgotPasswordOutput) {
          forgotPasswordOutput.textContent = 'If the account exists, a reset link/token has been issued.';
        }
        showToast('If the account exists, reset instructions were sent.', 'info');
        return;
      }

      resetToken = request.resetToken;
    }

    if (forgotPasswordOutput) forgotPasswordOutput.textContent = 'Completing password reset...';

    await api('/api/auth/forgot-password/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: payload.email,
        resetToken,
        newPassword: payload.newPassword
      })
    });

    if (forgotPasswordOutput) {
      forgotPasswordOutput.textContent = 'Password updated. You can now sign in with your new password.';
    }
    showToast('Password reset successful. Please sign in.', 'success');
    e.target.reset();
  } catch (err) {
    if (forgotPasswordOutput) forgotPasswordOutput.textContent = `Reset failed: ${err.message}`;
    showToast(err.message, 'error');
  }
});

accountRecoveryForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());

  try {
    if (accountRecoveryOutput) {
      accountRecoveryOutput.textContent = 'Issuing one-time reset token...';
    }

    const tokenResponse = await api('/api/auth/recover-account/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: payload.email,
        recoveryKey: payload.recoveryKey,
        fullName: payload.fullName
      })
    });

    if (accountRecoveryOutput) {
      accountRecoveryOutput.textContent = 'Reset token issued. Completing password reset...';
    }

    const data = await api('/api/auth/recover-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: payload.email,
        newPassword: payload.newPassword,
        resetToken: tokenResponse.resetToken,
        fullName: payload.fullName
      })
    });

    token = data.token;
    currentUser = data.user;
    roleViewOverride = null;
    if (accountRecoveryOutput) {
      accountRecoveryOutput.textContent = 'Password reset successful. Signing you in...';
    }
    showToast('Password reset successful. You are now signed in.', 'success');
    updateSession();
    await refreshAllPickers();
    e.target.reset();
    if (accountRecoveryPanel) accountRecoveryPanel.style.display = 'none';
  } catch (err) {
    if (accountRecoveryOutput) {
      accountRecoveryOutput.textContent = `Recovery failed: ${err.message}`;
    }
    showToast(err.message, 'error');
  }
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  const previewRole = String(document.getElementById('loginRolePreview')?.value || '').trim();

  if (previewRole) {
    const previewUser = ROLE_PREVIEW_USERS[previewRole];
    if (!previewUser) {
      showToast('Selected preview role is not available.', 'error');
      return;
    }

    // Role preview is always demo-mode and intentionally excludes super admin.
    setDemoMode(true);
    token = `demo-preview-${previewRole}`;
    currentUser = { ...previewUser };
    roleViewOverride = null;
    updateSession();
    await refreshAllPickers();
    showToast(`Signed in as preview ${previewUser.role.replace('_', ' ')}`, 'success');
    return;
  }

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    token = data.token;
    currentUser = data.user;
    roleViewOverride = null;
    updateSession();
    await refreshAllPickers();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('demoRequestForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(e.target).entries());
  const formData = {
    organizationName: raw.orgName,
    contactName: raw.contactName,
    email: raw.contactEmail,
    phone: raw.contactPhone,
    requestType: raw.requestType,
    message: raw.message,
    source: 'landing_page'
  };
  try {
    await api('/api/contact/demo-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    showToast('Demo request submitted successfully. We will contact you soon!', 'success');
    e.target.reset();
  } catch (err) {
    showToast(`Error submitting demo request: ${err.message}`, 'error');
  }
});

document.getElementById('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  const output = document.getElementById('userInviteOutput');
  try {
    const data = await api('/api/assignments/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (output) {
      output.innerHTML = `Invite created for ${safeText(data.user?.fullName || payload.fullName)}. Share this link: <a href="${safeText(data.inviteLink)}" target="_blank" rel="noopener noreferrer">${safeText(data.inviteLink)}</a>`;
    }
    e.target.reset();
    await refreshUsers();
  } catch (err) {
    if (output) output.textContent = `Error: ${err.message}`;
  }
});

inviteAcceptForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('inviteToken');
  if (!inviteToken) {
    showToast('Invite token missing from URL.', 'error');
    return;
  }

  try {
    if (inviteAcceptOutput) inviteAcceptOutput.textContent = 'Activating account...';
    const data = await api('/api/auth/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken,
        fullName: payload.fullName,
        password: payload.password,
        acceptTerms: payload.acceptTerms === 'on'
      })
    });

    token = data.token;
    currentUser = data.user;
    updateSession();
    await refreshAllPickers();
    if (inviteAcceptOutput) inviteAcceptOutput.textContent = 'Account activated. Signing in...';
    showToast('Welcome to SynoraCare. Your account is now active.', 'success');
    params.delete('inviteToken');
    params.delete('email');
    window.history.replaceState({}, document.title, `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`);
  } catch (err) {
    if (inviteAcceptOutput) inviteAcceptOutput.textContent = `Activation failed: ${err.message}`;
    showToast(err.message, 'error');
  }
});

function initializeInviteAndResetFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('inviteToken');
  const email = params.get('email');
  const resetToken = params.get('resetToken');

  if (inviteToken && inviteAcceptPanel && inviteAcceptForm) {
    inviteAcceptPanel.style.display = '';
    if (forgotPasswordPanel) forgotPasswordPanel.style.display = 'none';
    if (accountRecoveryPanel) accountRecoveryPanel.style.display = 'none';
    const emailInput = inviteAcceptForm.querySelector('input[name="email"]');
    if (emailInput && email) emailInput.value = email;
    const nameInput = inviteAcceptForm.querySelector('input[name="fullName"]');
    nameInput?.focus();
    return;
  }

  if (resetToken && forgotPasswordPanel && forgotPasswordForm) {
    forgotPasswordPanel.style.display = '';
    if (accountRecoveryPanel) accountRecoveryPanel.style.display = 'none';
    const emailInput = forgotPasswordForm.querySelector('input[name="email"]');
    if (emailInput && email) emailInput.value = email;
    const passwordInput = forgotPasswordForm.querySelector('input[name="newPassword"]');
    passwordInput?.focus();
  }
}

document.getElementById('clientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());

  if (demoMode) {
    const demoClients = getDemoClients();
    const nextClient = {
      _id: `demo-client-${Date.now()}`,
      displayName: String(payload.displayName || '').trim() || 'Demo Client',
      externalId: String(payload.externalId || '').trim() || `SC-DEMO-${demoClients.length + 1001}`
    };
    demoClients.unshift(nextClient);
    saveDemoClients(demoClients);
    clientsCache = demoClients;
    syncClientPickers();
    renderClientList(clientsCache);
    e.target.reset();
    showToast('Demo client added successfully.', 'success');
    if (currentUser) {
      renderHomeSection().catch(() => {});
    }
    return;
  }

  try {
    await api('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await refreshClients();
  } catch (err) {
    const list = document.getElementById('clientsList');
    if (list) list.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('refreshClientsBtn').addEventListener('click', async () => {
  try {
    await refreshClients();
  } catch (err) {
    const list = document.getElementById('clientsList');
    if (list) list.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('refreshUsersBtn').addEventListener('click', async () => {
  try {
    await refreshUsers();
  } catch (err) {
    const list = document.getElementById('usersList');
    if (list) list.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('refreshAssignmentsClientsBtn').addEventListener('click', async () => {
  try {
    await refreshClients();
  } catch (err) {
    const list = document.getElementById('clientsList');
    if (list) list.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('refreshUploadClientsBtn').addEventListener('click', async () => {
  try {
    await refreshClients();
  } catch (err) {
    // non-critical, pickers already populated from cache
  }
});

document.getElementById('refreshAskClientsBtn').addEventListener('click', async () => {
  try {
    await refreshClients();
  } catch (err) {
    // non-critical
  }
});

document.getElementById('sampleTxtBtn').addEventListener('click', () => {
  try {
    generateSampleTxtFile();
  } catch (err) {
    setOutput('uploadOutput', err.message);
  }
});

document.getElementById('samplePdfBtn').addEventListener('click', () => {
  try {
    generateSamplePdfFile();
  } catch (err) {
    setOutput('uploadOutput', err.message);
  }
});

document.getElementById('trainingContextRow').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-training-context]');
  if (!button) return;

  selectedTrainingContext = button.dataset.trainingContext;
  renderTraining(getActiveRole(), selectedTrainingContext);
});

document.getElementById('assignmentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  try {
    const data = await api('/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    setOutput('assignmentOutput', data);
    await refreshClients();
  } catch (err) {
    setOutput('assignmentOutput', err.message);
  }
});

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  try {
    const response = await fetch(`${API_BASE}/api/documents/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    setOutput('uploadOutput', data);
  } catch (err) {
    setOutput('uploadOutput', err.message);
  }
});

document.getElementById('askForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientId = document.getElementById('askClientId')?.value || '';
  const questionEl = e.target.querySelector('textarea[name="question"]');
  const question = questionEl ? questionEl.value.trim() : '';

  if (!clientId) {
    showToast('Please select a client first.', 'info');
    return;
  }

  const messages = document.getElementById('chatMessages');

  // Remove welcome state on first message
  const welcome = messages?.querySelector('.chat-welcome-state');
  if (welcome) welcome.remove();

  // Append user bubble
  if (messages) {
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-message chat-message-user';
    userBubble.innerHTML = `<div class="chat-bubble"><div class="chat-bubble-text">${safeText(question)}</div></div>`;
    messages.appendChild(userBubble);
    messages.scrollTop = messages.scrollHeight;
  }

  // Append typing indicator
  if (messages) {
    const typing = document.createElement('div');
    typing.className = 'chat-message chat-message-ai chat-typing';
    typing.innerHTML = '<div class="chat-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
  }

  // Clear input
  if (questionEl) questionEl.value = '';

  try {
    const data = await api('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, question })
    });
    renderAskAnswer(data);
  } catch (err) {
    renderAskAnswer(err.message);
  }
});

// Sync askClientId into the form
document.getElementById('askClientId')?.addEventListener('change', () => {
  // No-op: clientId read directly from select on submit
});

// Chat starter buttons
document.getElementById('chatMessages')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.chat-starter-btn');
  if (!btn) return;

  if (btn.dataset.quickAssist === 'meal') {
    requestMealAssistSnapshot();
    return;
  }

  const textarea = document.querySelector('#askForm textarea');
  if (textarea) {
    textarea.value = btn.dataset.question;
    textarea.focus();
  }
});

document.getElementById('loadAuditBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/audit?limit=100');
    renderAuditFeed(data);
  } catch (err) {
    const feed = document.getElementById('auditFeed');
    if (feed) feed.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('refreshTrackerBtn').addEventListener('click', async () => {
  try {
    await loadTrackerFeed();
  } catch (err) {
    const feed = document.getElementById('trackerFeed');
    if (feed) feed.innerHTML = `<p class="tracker-empty">${safeText(err.message)}</p>`;
  }
});

document.getElementById('refreshTrackerSummaryBtn').addEventListener('click', async () => {
  try {
    await loadTrackerSummary();
  } catch (err) {
    const container = document.getElementById('trackerSummaryCards');
    if (container) container.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('trackerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  try {
    const response = await fetch(`${API_BASE}/api/tracker`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Try to save offline if network error
      if (!navigator.onLine || response.status >= 500) {
        const entry = Object.fromEntries(formData.entries());
        saveOfflineEntry(entry);
        const feed = document.getElementById('trackerFeed');
        if (feed) feed.innerHTML = `<p class="tracker-empty">Entry saved offline. Will sync when connection restored.</p>`;
        e.target.reset();
        return;
      }
      throw new Error(data.error || 'Failed to create tracker entry');
    }

    e.target.reset();
    await loadTrackerFeed();
    await loadTrackerSummary();
  } catch (err) {
    // On network error, save offline
    if (!navigator.onLine) {
      const entry = Object.fromEntries(formData.entries());
      saveOfflineEntry(entry);
      const feed = document.getElementById('trackerFeed');
      if (feed) feed.innerHTML = `<p class="tracker-empty">Entry saved offline. Will sync when connection restored.</p>`;
      e.target.reset();
      return;
    }
    const feed = document.getElementById('trackerFeed');
    if (feed) feed.innerHTML = `<p class="tracker-empty">${safeText(err.message)}</p>`;
  }
});

document.getElementById('trackerStatusForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  try {
    await updateTrackerStatus(payload.entryId, payload.status);
    await loadTrackerFeed();
    await loadTrackerSummary();
  } catch (err) {
    const feed = document.getElementById('trackerFeed');
    if (feed) feed.innerHTML = `<p class="tracker-empty">${safeText(err.message)}</p>`;
  }
});

document.getElementById('trackerFeed').addEventListener('click', async (e) => {
  const photoButton = e.target.closest('button[data-view-photo]');
  if (photoButton) {
    try {
      await openTrackerPhoto(photoButton.dataset.viewPhoto);
    } catch (err) {
      const feed = document.getElementById('trackerFeed');
      if (feed) feed.innerHTML = `<p class="tracker-empty">${safeText(err.message)}</p>`;
    }
    return;
  }

  const button = e.target.closest('button[data-entry-id][data-status]');
  if (!button) return;

  try {
    await updateTrackerStatus(button.dataset.entryId, button.dataset.status);
    await loadTrackerFeed();
    await loadTrackerSummary();
  } catch (err) {
    const feed = document.getElementById('trackerFeed');
    if (feed) feed.innerHTML = `<p class="tracker-empty">${safeText(err.message)}</p>`;
  }
});

document.getElementById('breakGlassForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  try {
    const data = await api('/api/assignments/break-glass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    setOutput('breakGlassOutput', data);
    await refreshClients();
  } catch (err) {
    setOutput('breakGlassOutput', err.message);
  }
});

document.getElementById('legalRecordsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(e.target).entries());
  const payload = {
    clientId: raw.clientId,
    stateCode: String(raw.stateCode || '').trim().toUpperCase(),
    includeAudit: raw.includeAudit === 'on'
  };

  if (raw.retentionYearsOverride) {
    payload.retentionYearsOverride = Number(raw.retentionYearsOverride);
  }

  try {
    const data = await api('/api/legal-records/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    renderLegalRecordsSummary(data);
  } catch (err) {
    const list = document.getElementById('legalRecordsSummary');
    if (list) list.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
    legalExportPayload = null;
    const downloadBtn = document.getElementById('downloadLegalExportBtn');
    if (downloadBtn) downloadBtn.disabled = true;
  }
});

document.getElementById('downloadLegalExportBtn')?.addEventListener('click', () => {
  if (!legalExportPayload) return;

  const stamp = new Date().toISOString().replaceAll(':', '-');
  const fileName = `synoracare-legal-export-${stamp}.json`;
  const blob = new Blob([JSON.stringify(legalExportPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
});

document.getElementById('loadPatientWorkspaceBtn')?.addEventListener('click', async () => {
  try {
    await loadPatientWorkspace();
  } catch (err) {
    const container = document.getElementById('patientTabContent');
    if (container) container.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('patientTabRow')?.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-patient-tab]');
  if (!button) return;

  selectedPatientTab = button.dataset.patientTab;
  document.querySelectorAll('.patient-tab-btn').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.patientTab === selectedPatientTab);
  });
  renderPatientTabContent();
});

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  token = '';
  currentUser = null;
  roleViewOverride = null;
  clientsCache = [];
  usersCache = [];
  legalExportPayload = null;
  currentPatientWorkspace = { clientId: '', entries: [] };
  selectedPatientTab = 'care';
  const downloadBtn = document.getElementById('downloadLegalExportBtn');
  if (downloadBtn) downloadBtn.disabled = true;
  ['usersList', 'clientsList', 'auditFeed', 'trackerSummaryCards', 'trackerFeed', 'homeStats', 'homeActions', 'homeAlerts', 'legalRecordsSummary', 'patientTabContent'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  updateSession();
});

// Shift management listeners
document.getElementById('startShiftBtn')?.addEventListener('click', async () => {
  const clientId = clientsCache[0]?._id;
  if (!clientId) {
    alert('No clients available. Please refresh your assignments.');
    return;
  }
  try {
    await startShift(clientId);
    alert('Shift started!');
  } catch (error) {
    alert(`Failed to start shift: ${error.message}`);
  }
});

document.getElementById('endShiftBtn')?.addEventListener('click', async () => {
  try {
    const result = await endShift();
    alert('Shift ended! Report generated.');
  } catch (error) {
    alert(`Failed to end shift: ${error.message}`);
  }
});

// Shift report modal close button
document.querySelector('#shiftReportModal .modal-close')?.addEventListener('click', () => {
  document.getElementById('shiftReportModal').style.display = 'none';
});

document.getElementById('demoModeToggle')?.addEventListener('change', (e) => {
  if (!canToggleDemoMode()) {
    syncDemoToggle();
    return;
  }
  setDemoMode(e.target.checked);
});

document.getElementById('loginDemoModeToggle')?.addEventListener('change', (e) => {
  if (!canToggleDemoMode()) {
    syncDemoToggle();
    return;
  }
  setDemoMode(e.target.checked);
});

document.getElementById('resetPasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  const output = document.getElementById('resetPasswordOutput');
  try {
    const data = await api(`/api/assignments/users/${encodeURIComponent(payload.userId)}/reset-password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: payload.newPassword })
    });
    if (output) output.textContent = `Password reset for ${data.user?.fullName || 'user'}.`;
    e.target.reset();
  } catch (err) {
    if (output) output.textContent = `Error: ${err.message}`;
  }
});

document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-nav-target]');
  if (navBtn) {
    const trackerStatus = navBtn.dataset.trackerStatus || '';
    if (trackerStatus) {
      setTrackerStatusFilter(trackerStatus);
    }
    navigateTo(navBtn.dataset.navTarget);
    if (window.innerWidth <= 900) document.body.classList.remove('sidebar-open');
    return;
  }

  if (window.innerWidth <= 900 && document.body.classList.contains('sidebar-open')) {
    const clickedSidebar = e.target.closest('#appSidebar');
    const clickedToggle = e.target.closest('#sidebarToggle');
    if (!clickedSidebar && !clickedToggle) {
      document.body.classList.remove('sidebar-open');
    }
  }

  const scrollBtn = e.target.closest('[data-scroll-target]');
  if (scrollBtn) {
    const targetSection = document.getElementById(scrollBtn.dataset.scrollTarget);
    if (targetSection) targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

document.getElementById('sidebarToggle')?.addEventListener('click', () => {
  if (window.innerWidth <= 900) {
    document.body.classList.toggle('sidebar-open');
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 900) {
    document.body.classList.remove('sidebar-open');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.body.classList.remove('sidebar-open');
});

// Auto-grow chat textarea
document.querySelector('#askForm textarea')?.addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

// Voice-to-Text functionality
let voiceRecognition = null;
function initVoiceToText() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported');
    return;
  }
  voiceRecognition = new SpeechRecognition();
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = true;
  voiceRecognition.lang = 'en-US';
  
  voiceRecognition.onstart = function() {
    document.getElementById('voiceStatus').style.display = 'flex';
    document.getElementById('voiceStatusText').textContent = 'Listening...';
  };
  
  voiceRecognition.onresult = function(e) {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    const summaryInput = document.querySelector('#trackerForm input[name="summary"]');
    if (summaryInput) {
      summaryInput.value = transcript.charAt(0).toUpperCase() + transcript.slice(1);
      summaryInput.dispatchEvent(new Event('change'));
    }
  };
  
  voiceRecognition.onerror = function(e) {
    document.getElementById('voiceStatusText').textContent = `Error: ${e.error}`;
  };
  
  voiceRecognition.onend = function() {
    document.getElementById('voiceStatus').style.display = 'none';
  };
}

document.getElementById('voiceToTextBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  if (!voiceRecognition) initVoiceToText();
  if (voiceRecognition) voiceRecognition.start();
});

// Copy from Yesterday functionality
async function loadYesterdayEntries() {
  const clientId = document.querySelector('#trackerForm select[name="clientId"]').value;
  if (!clientId) {
    alert('Please select a client first');
    return;
  }
  
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(yesterday);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const data = await api(`/api/tracker/entries?clientId=${clientId}&status=completed&limit=50`);
    const yesterdayEntries = (data.entries || []).filter(e => {
      const entryDate = new Date(e.createdAt);
      return entryDate >= yesterday && entryDate < tomorrow;
    });
    
    if (yesterdayEntries.length === 0) {
      document.getElementById('copyFromYesterdayContainer').style.display = 'none';
      return;
    }
    
    const list = document.getElementById('yesterdayEntriesList');
    list.innerHTML = '';
    yesterdayEntries.forEach(entry => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'yesterday-entry-option';
      btn.textContent = `${entry.eventType.toUpperCase()} - ${entry.summary}`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector('#trackerForm input[name="summary"]').value = entry.summary;
        document.querySelector('#trackerForm select[name="eventType"]').value = entry.eventType;
        document.querySelector('#trackerForm select[name="priority"]').value = entry.priority || 'normal';
        if (entry.details) document.querySelector('#trackerForm textarea[name="details"]').value = entry.details;
        document.getElementById('copyFromYesterdayContainer').style.display = 'none';
      });
      list.appendChild(btn);
    });
    
    document.getElementById('copyFromYesterdayContainer').style.display = 'block';
  } catch (error) {
    console.error('Failed to load yesterday entries:', error);
  }
}

document.getElementById('copyYesterdayBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  loadYesterdayEntries();
});

// Who's Working cards
async function renderWhosWorking() {
  const container = document.getElementById('whosWorkingCards');
  if (!container) return;
  
  try {
    const data = await api('/api/shifts/summary/today');
    if (!data.activeShifts || data.activeShifts.length === 0) {
      container.innerHTML = '<p style="color: var(--muted); font-size: 12px; padding: 8px;">No active shifts</p>';
      return;
    }
    
    let html = '';
    for (const shift of data.activeShifts) {
      const dspName = shift.userId?.fullName || 'Unknown DSP';
      const clientName = shift.clientId?.displayName || 'Unknown Client';
      const startTime = new Date(shift.startedAt);
      const now = new Date();
      const durationMins = Math.round((now - startTime) / 60000);
      
      // Get entry count for this shift
      const entryData = await api(`/api/tracker/entries?clientId=${shift.clientId._id || shift.clientId}&limit=1`).catch(() => ({ entries: [] }));
      const entryCount = entryData.entries?.length || 0;
      
      html += `
        <div class="whos-working-card active">
          <div class="whos-working-dsp-name">👤 ${safeText(dspName)}</div>
          <div class="whos-working-client">📋 ${safeText(clientName)}</div>
          <div class="whos-working-time">⏱️ ${durationMins} min</div>
          <div class="whos-working-entry-count">📝 ${entryCount} entries logged</div>
        </div>
      `;
    }
    container.innerHTML = html;
  } catch (error) {
    console.error('Failed to render Who\'s Working:', error);
    if (demoMode) {
      container.innerHTML = `
        <div class="whos-working-card active">
          <div class="whos-working-dsp-name">👤 Nia Carter</div>
          <div class="whos-working-client">📋 Jordan Miles</div>
          <div class="whos-working-time">⏱️ 45 min</div>
          <div class="whos-working-entry-count">📝 8 entries logged</div>
        </div>
        <div class="whos-working-card active">
          <div class="whos-working-dsp-name">👤 Isaiah Moore</div>
          <div class="whos-working-client">📋 Avery Brooks</div>
          <div class="whos-working-time">⏱️ 23 min</div>
          <div class="whos-working-entry-count">📝 3 entries logged</div>
        </div>
      `;
    }
  }
}

// Shift Monitor Dashboard
let shiftMonitorAutoRefresh = false;
let shiftMonitorInterval = null;

async function loadShiftMonitor() {
  try {
    const data = await api('/api/shifts/summary/today');
    
    document.getElementById('activeShiftCount').textContent = data.activeCount || 0;
    document.getElementById('endedShiftCount').textContent = data.endedCount || 0;
    document.getElementById('totalEntriesCount').textContent = data.totalEntries || 0;
    document.getElementById('escalationCount').textContent = data.escalations || 0;
    
    const container = document.getElementById('activeShiftsContainer');
    if (!container) return;
    
    if (!data.activeShifts || data.activeShifts.length === 0) {
      container.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--muted);">No active shifts</p>';
      return;
    }
    
    let html = '';
    for (const shift of data.activeShifts) {
      const dspName = shift.userId?.fullName || 'Unknown';
      const clientName = shift.clientId?.displayName || 'Unknown';
      const startTime = new Date(shift.startedAt);
      const now = new Date();
      const durationHours = ((now - startTime) / (1000 * 60 * 60)).toFixed(1);
      
      const hasEscalations = (data.escalations || 0) > 0;
      html += `
        <div class="active-shift-card ${hasEscalations ? 'has-escalations' : ''}">
          <div class="shift-card-header">
            <div>
              <div class="shift-card-dsp">${safeText(dspName)}</div>
              <div class="shift-card-client">${safeText(clientName)}</div>
            </div>
            <span class="shift-card-badge">ACTIVE</span>
          </div>
          <div class="shift-card-time">Started ${durationHours}h ago</div>
          <div class="shift-card-metrics">
            <span class="shift-card-metric">📝 ${data.totalEntries} entries</span>
            ${hasEscalations ? `<span class="shift-card-metric escalated">⚠️ ${data.escalations} escalations</span>` : ''}
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
  } catch (error) {
    console.error('Failed to load shift monitor:', error);
    if (demoMode) {
      document.getElementById('activeShiftCount').textContent = '2';
      document.getElementById('endedShiftCount').textContent = '3';
      document.getElementById('totalEntriesCount').textContent = '24';
      document.getElementById('escalationCount').textContent = '1';
      
      const container = document.getElementById('activeShiftsContainer');
      if (container) {
        container.innerHTML = `
          <div class="active-shift-card">
            <div class="shift-card-header">
              <div>
                <div class="shift-card-dsp">Nia Carter</div>
                <div class="shift-card-client">Jordan Miles</div>
              </div>
              <span class="shift-card-badge">ACTIVE</span>
            </div>
            <div class="shift-card-time">Started 2.5h ago</div>
            <div class="shift-card-metrics">
              <span class="shift-card-metric">📝 12 entries</span>
            </div>
          </div>
          <div class="active-shift-card">
            <div class="shift-card-header">
              <div>
                <div class="shift-card-dsp">Isaiah Moore</div>
                <div class="shift-card-client">Avery Brooks</div>
              </div>
              <span class="shift-card-badge">ACTIVE</span>
            </div>
            <div class="shift-card-time">Started 1.2h ago</div>
            <div class="shift-card-metrics">
              <span class="shift-card-metric">📝 8 entries</span>
            </div>
          </div>
        `;
      }
    }
  }
}

document.getElementById('refreshShiftMonitorBtn')?.addEventListener('click', () => {
  loadShiftMonitor();
});

document.getElementById('autoRefreshToggle')?.addEventListener('click', (e) => {
  shiftMonitorAutoRefresh = !shiftMonitorAutoRefresh;
  e.target.textContent = shiftMonitorAutoRefresh ? 'Auto: ON' : 'Auto: OFF';
  
  if (shiftMonitorAutoRefresh) {
    loadShiftMonitor();
    shiftMonitorInterval = setInterval(loadShiftMonitor, 10000);
  } else if (shiftMonitorInterval) {
    clearInterval(shiftMonitorInterval);
    shiftMonitorInterval = null;
  }
});

// Load Who's Working when tracker section is shown
const originalNavigateTo = window.navigateTo;
window.navigateTo = function(pageId) {
  originalNavigateTo.call(this, pageId);
  if (pageId === 'trackerSection') {
    renderWhosWorking();
    // Show/hide copy from yesterday container based on client selection
    const clientSelect = document.querySelector('#trackerForm select[name="clientId"]');
    if (clientSelect) {
      clientSelect.addEventListener('change', () => {
        setTimeout(loadYesterdayEntries, 100);
      });
    }
  } else if (pageId === 'shiftMonitorSection') {
    loadShiftMonitor();
  }
};

// Demo mode role switcher
document.getElementById('demoRoleSwitcher')?.addEventListener('change', async (e) => {
  if (!currentUser || currentUser.role !== 'super_admin') {
    showToast('Only super admins can switch roles.', 'error');
    return;
  }

  const newRole = e.target.value;
  if (!newRole) return;

  roleViewOverride = newRole === 'super_admin' ? null : newRole;
  updateSession();
  await refreshAllPickers();
  showToast(`Viewing as ${getActiveRole().replace('_', ' ')} role`, 'success');
});

updateSession();
initializeInviteAndResetFromUrl();
fetchAndShowVersion();
