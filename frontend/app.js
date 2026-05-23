const DEFAULT_API_BASE = (() => {
  const { hostname, protocol } = window.location;

  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8081';
  }

  if (hostname === 'synoracare-frontend.onrender.com') {
    return 'https://synoracare-backend.onrender.com';
  }

  if (hostname.startsWith('api.')) {
    return `${protocol}//${hostname}`;
  }

  return `${protocol}//api.${hostname.replace(/^www\./, '')}`;
})();

const API_BASE = window.SYNORACARE_CONFIG?.API_BASE || window.CAREGUIDE_CONFIG?.API_BASE || DEFAULT_API_BASE;
let token = '';
let currentUser = null;
let clientsCache = [];
let usersCache = [];
let selectedTrainingContext = 'pre_shift';
let legalExportPayload = null;
let selectedPatientTab = 'care';
let currentPatientWorkspace = { clientId: '', entries: [] };
let currentPage = '';
const DEMO_MODE = new URLSearchParams(window.location.search).get('demo') === '1';

const DEMO_CLIENTS = [
  { _id: 'demo-client-1', displayName: 'Jordan Miles', externalId: 'SC-1001' },
  { _id: 'demo-client-2', displayName: 'Avery Brooks', externalId: 'SC-1002' },
  { _id: 'demo-client-3', displayName: 'Taylor Reed', externalId: 'SC-1003' }
];

const DEMO_USERS = [
  { _id: 'demo-user-1', fullName: 'Nia Carter', role: 'dsp' },
  { _id: 'demo-user-2', fullName: 'Isaiah Moore', role: 'dsp' },
  { _id: 'demo-user-3', fullName: 'Camila James', role: 'supervisor' }
];

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
  if (!currentUser) {
    info.textContent = 'Not logged in';
    if (logoutBtn) logoutBtn.style.display = 'none';
    applyRoleMode('guest');
    renderTraining('guest', selectedTrainingContext);
    return;
  }
  info.textContent = `${currentUser.fullName} | ${currentUser.role}`;
  if (logoutBtn) logoutBtn.style.display = '';
  applyRoleMode(currentUser.role);
  renderTraining(currentUser.role, selectedTrainingContext);
  renderHomeSection();
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
    const data = await api('/api/tracker?limit=50');
    const entries = data.entries || [];
    if (DEMO_MODE && entries.length === 0) {
      renderTrackerFeed(DEMO_TRACKER_ENTRIES);
      return;
    }
    renderTrackerFeed(entries);
  } catch (error) {
    if (DEMO_MODE) {
      renderTrackerFeed(DEMO_TRACKER_ENTRIES);
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
    if (DEMO_MODE) {
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
  const feed = document.getElementById('trackerFeed');
  if (!feed) return;

  if (!entries.length) {
    feed.innerHTML = '<p class="tracker-empty">No tracker events yet for your accessible clients.</p>';
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
  try {
    const data = await api('/api/clients');
    clientsCache = data.clients || [];
    if (DEMO_MODE && clientsCache.length === 0) {
      clientsCache = DEMO_CLIENTS;
    }
    syncClientPickers();
    renderClientList(clientsCache);
  } catch (error) {
    console.error('Error loading clients:', error);
    clientsCache = DEMO_MODE ? DEMO_CLIENTS : [];
    syncClientPickers();
    const list = document.getElementById('clientsList');
    if (list && !DEMO_MODE) list.innerHTML = `<p class="empty-state">Could not load clients: ${safeText(error.message)}</p>`;
    if (list && DEMO_MODE) renderClientList(clientsCache);
  }
}

async function refreshUsers() {
  try {
    const data = await api('/api/assignments/users');
    usersCache = data.users || [];
    if (DEMO_MODE && usersCache.length === 0) {
      usersCache = DEMO_USERS;
    }
    syncUserPicker();
    renderUserList(usersCache);
  } catch (error) {
    usersCache = DEMO_MODE ? DEMO_USERS : [];
    syncUserPicker();
    const list = document.getElementById('usersList');
    if (list && !DEMO_MODE) list.innerHTML = `<p class="empty-state">Could not load team: ${safeText(error.message)}</p>`;
    if (list && DEMO_MODE) renderUserList(usersCache);
  }
}

async function refreshAllPickers() {
  if (!token) return;
  await refreshClients();
  if (currentUser && ['super_admin', 'org_admin', 'supervisor'].includes(currentUser.role)) {
    await refreshUsers();
  }
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
      updateSession();
      throw new Error('Session expired. Please sign in again.');
    }
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function renderHomeSection() {
  if (!currentUser) return;
  const role = currentUser.role;

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
      { label: 'Add Team Member', target: 'createUserSection' },
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
        <div class="stat-chip"><span class="stat-value">${clientsCache.length}</span><span class="stat-label">Clients</span></div>
        <div class="stat-chip stat-warn"><span class="stat-value">${summaryData.pending || 0}</span><span class="stat-label">Pending</span></div>
        <div class="stat-chip stat-danger"><span class="stat-value">${summaryData.escalated || 0}</span><span class="stat-label">Escalated</span></div>
        <div class="stat-chip stat-ok"><span class="stat-value">${summaryData.completed || 0}</span><span class="stat-label">Completed</span></div>
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
  const sources = Array.isArray(data?.sources) ? data.sources : [];

  const sourcesHtml = sources.length
    ? `<div class="chat-sources">${sources.map((s) => `<span class="source-tag">${safeText(s.title || s.docType || 'document')}</span>`).join('')}</div>`
    : '';

  const bubble = document.createElement('div');
  bubble.className = 'chat-message chat-message-ai';
  bubble.innerHTML = `<div class="chat-bubble"><div class="chat-bubble-text">${safeText(answer).replace(/\n/g, '<br>')}</div>${sourcesHtml}</div>`;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
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
    list.innerHTML = '<p class="empty-state">No team members yet.</p>';
    return;
  }

  list.innerHTML = users.map((u) => `
    <div class="data-item">
      <span class="data-item-label">${safeText(u.fullName)}</span>
      <span class="data-item-meta data-item-role role-${safeText(u.role)}">${safeText(u.role)}</span>
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
    updateSession();
    await refreshAllPickers();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Password eye toggle
const pwEyeBtn = document.getElementById('pwEyeBtn');
const loginPwInput = document.getElementById('loginPasswordInput');
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

// Forgot password
const forgotPwBtn = document.getElementById('forgotPwBtn');
const accountRecoveryPanel = document.getElementById('accountRecoveryPanel');
const accountRecoveryForm = document.getElementById('accountRecoveryForm');
const accountRecoveryOutput = document.getElementById('accountRecoveryOutput');
if (forgotPwBtn) {
  forgotPwBtn.addEventListener('click', () => {
    if (!accountRecoveryPanel) {
      showToast('Please contact your organization administrator to reset your password.', 'info');
      return;
    }

    const isHidden = accountRecoveryPanel.style.display === 'none' || !accountRecoveryPanel.style.display;
    accountRecoveryPanel.style.display = isHidden ? '' : 'none';

    if (isHidden && accountRecoveryForm) {
      const loginEmail = document.getElementById('loginEmail');
      const recoveryEmailInput = accountRecoveryForm.querySelector('input[name="email"]');
      if (loginEmail && recoveryEmailInput && !recoveryEmailInput.value) {
        recoveryEmailInput.value = loginEmail.value;
      }
      recoveryEmailInput?.focus();
    }
  });
}

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
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    token = data.token;
    currentUser = data.user;
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
  try {
    const data = await api('/api/assignments/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await refreshUsers();
  } catch (err) {
    const list = document.getElementById('usersList');
    if (list) list.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('clientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  try {
    const data = await api('/api/clients', {
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
  renderTraining(currentUser ? currentUser.role : 'guest', selectedTrainingContext);
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
    if (!response.ok) throw new Error(data.error || 'Failed to create tracker entry');

    e.target.reset();
    await loadTrackerFeed();
    await loadTrackerSummary();
  } catch (err) {
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

updateSession();
fetchAndShowVersion();
