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
const AUTH_SESSION_STORAGE_KEY = 'synoracare_auth_session_v1';
const DEFAULT_ROLE_DISPLAY_LABELS = {
  dsp: 'Direct Support Professional',
  supervisor: 'Supervisor',
  org_admin: 'Organization Admin',
  super_admin: 'Super Admin'
};
const ROLE_PERMISSION_FALLBACK = {
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
let token = '';
let currentUser = null;
let roleViewOverride = null;
let orgRoleDisplayLabels = { ...DEFAULT_ROLE_DISPLAY_LABELS };
let authContextLoadedForToken = '';
let clientsCache = [];
let usersCache = [];
let selectedTrainingContext = 'pre_shift';
let selectedAskPromptPhase = 'pre_shift';
let selectedAskPromptGroup = '';
let isAskPromptLibraryCollapsed = false;
let askPromptSearchTerm = '';
let legalExportPayload = null;
let currentReportPayload = null;
let selectedPatientTab = 'care';
let currentPatientWorkspace = { clientId: '', entries: [] };
let currentPage = '';
let currentTrackerFeed = [];
let trackerStatusFilter = '';
const chatSourceRegistry = new Map();
let demoMode = localStorage.getItem('synoracare_demo_mode') === '1' || new URLSearchParams(window.location.search).get('demo') === '1';
if (demoMode) localStorage.setItem('synoracare_demo_mode', '1');

// Demo mode is reserved for authenticated super admins.
function isDemo() {
  if (!demoMode) return false;
  if (!currentUser) return false;
  return canUseRoleSwitcher();
}

function persistAuthSession() {
  try {
    if (!token || !currentUser) {
      localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      return;
    }

    localStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify({
        token,
        currentUser,
        roleViewOverride: canUseRoleSwitcher() ? roleViewOverride : null
      })
    );
  } catch {
    // Ignore storage failures in private/incognito contexts.
  }
}

function restoreAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.token || !parsed.currentUser) return;

    token = String(parsed.token);
    currentUser = parsed.currentUser;
    roleViewOverride = canUseRoleSwitcher() ? (parsed.roleViewOverride || null) : null;
  } catch {
    localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  }
}

function clearAuthSessionState() {
  token = '';
  currentUser = null;
  roleViewOverride = null;
  orgRoleDisplayLabels = { ...DEFAULT_ROLE_DISPLAY_LABELS };
  authContextLoadedForToken = '';
  persistAuthSession();
}

restoreAuthSession();

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

const DEMO_CLIENT_CARE_INFO = {
  'demo-client-1': {
    displayName: 'Jordan Miles',
    care: [
      {
        title: 'Morning ADL Support',
        content: 'Assist with personal hygiene and grooming between 7:00 AM and 8:00 AM. Use verbal prompts, allow maximum independence, and document completion on the care tracker.',
        icon: '🧼'
      },
      {
        title: 'Transfer Assistance',
        content: 'Provide steady support during transfers from bed to chair using approved stand-pivot technique. Always lock wheels before assisting.',
        icon: '🚶'
      },
      {
        title: 'Toileting Protocol',
        content: 'Accompany and supervise during all toileting. Ensure dignity and privacy. Check for signs of discomfort or health changes.',
        icon: '🚽'
      }
    ],
    nutrition: [
      {
        title: 'Meal Times',
        content: 'Breakfast: 7:30 AM | Lunch: 12:00 PM | Dinner: 5:30 PM | Snacks: 10 AM & 3 PM as needed.',
        icon: '⏰'
      },
      {
        title: 'Diet Type',
        content: 'Regular diet with whole grains, fresh fruits, and vegetables. Adequate hydration: 8 glasses of water daily. Avoid caffeine after 2 PM.',
        icon: '🥗'
      },
      {
        title: 'Dietary Restrictions',
        content: 'ALLERGY ALERT: Peanuts and tree nuts (anaphylaxis risk). NO shellfish, dairy alternatives recommended. Sodium restriction: <2300mg/day.',
        icon: '🚫'
      }
    ],
    medications: [
      {
        title: 'Morning Medications (7:30 AM)',
        content: 'Metformin 500mg x2 tablets (diabetes), Lisinopril 10mg x1 tablet (hypertension). Take with food. Monitor blood pressure daily.',
        icon: '💊'
      },
      {
        title: 'Afternoon Medications (1:00 PM)',
        content: 'Sertraline 50mg x1 tablet (depression). Take with or without food. Report mood changes to supervisor.',
        icon: '💊'
      },
      {
        title: 'Evening Medications (7:30 PM)',
        content: 'Atorvastatin 20mg x1 tablet (cholesterol). Take before bed. No grapefruit juice. Verify pulse before administration.',
        icon: '💊'
      }
    ],
    behavior: [
      {
        title: 'Behavioral Baseline',
        content: 'Jordan typically responds well to structured routines and consistent DSP interactions. Prefers calm environments with minimal noise.',
        icon: '😊'
      },
      {
        title: 'Escalation Triggers',
        content: 'Sudden routine changes, loud noises, and transitions between activities. Allow 10-minute warning before any schedule change.',
        icon: '⚠️'
      },
      {
        title: 'De-escalation Techniques',
        content: 'Use calm voice, offer choices, provide quiet time in preferred space. If distressed, pause activity and reassure. Never force completion. Contact supervisor if escalation continues.',
        icon: '🧘'
      }
    ],
    safety: [
      {
        title: 'Fall Risk Level',
        content: 'HIGH. Ensure non-slip footwear at all times. Use grab bars in bathroom. Avoid clutter in walking paths. Supervise during ambulation.',
        icon: '⚠️'
      },
      {
        title: 'Skin Integrity',
        content: 'Check for pressure areas daily, especially heels and sacrum. Reposition every 2 hours. Report any redness or breakdown immediately.',
        icon: '🩹'
      },
      {
        title: 'Infection Control',
        content: 'Hand hygiene before and after care. Use PPE as indicated. Report fever, cough, or signs of infection within 30 minutes of observation.',
        icon: '✋'
      }
    ]
  },
  'demo-client-2': {
    displayName: 'Avery Brooks',
    care: [
      {
        title: 'Self-Care Activities',
        content: 'Avery is mostly independent with grooming and dressing. Provide oversight only. Encourage participation and offer assistance only when requested.',
        icon: '🧼'
      },
      {
        title: 'Mobility Support',
        content: 'Ambulates with a cane independently. Ensure cane is within reach at all times. Watch for balance issues on stairs.',
        icon: '🚶'
      }
    ],
    nutrition: [
      {
        title: 'Meal Preferences',
        content: 'Prefers smaller, frequent meals. High-protein options preferred. Enjoys home-cooked style foods. Avoid overly processed foods.',
        icon: '🍽️'
      },
      {
        title: 'Dietary Restrictions',
        content: 'Gluten-free diet required (celiac disease). Check all packaged food labels. Offer GF bread, pasta, and cereals only.',
        icon: '🌾'
      }
    ],
    medications: [
      {
        title: 'Morning Medications (8:00 AM)',
        content: 'Levothyroxine 75mcg x1 tablet (thyroid). Take on empty stomach, 30 minutes before breakfast. Do not take with calcium or iron supplements.',
        icon: '💊'
      },
      {
        title: 'Evening Medications (8:00 PM)',
        content: 'Omeprazole 20mg x1 capsule (GERD). Take 30 minutes before meals.',
        icon: '💊'
      }
    ],
    behavior: [
      {
        title: 'Personality',
        content: 'Avery is sociable and enjoys conversations. Prefers a relaxed, friendly approach. Values independence and autonomy in decisions.',
        icon: '😊'
      },
      {
        title: 'Preferences',
        content: 'Enjoys reading and listening to music. Prefers morning activities. Can become withdrawn if left alone for extended periods.',
        icon: '🎵'
      }
    ],
    safety: [
      {
        title: 'General Safety',
        content: 'Low fall risk but monitor on wet surfaces. Ensure adequate lighting. Keep pathways clear.',
        icon: '💡'
      }
    ]
  },
  'demo-client-3': {
    displayName: 'Taylor Reed',
    care: [
      {
        title: 'Personal Care',
        content: 'Requires full assistance with ADLs. Use standard protocols for bathing, dressing, and grooming. Communicate each step clearly.',
        icon: '🧼'
      }
    ],
    nutrition: [
      {
        title: 'Feeding Support',
        content: 'Requires supervision and minimal hand-over-hand cueing during meals. Ensure client drinks adequate fluids. Monitor for choking risks.',
        icon: '🥄'
      },
      {
        title: 'Swallowing Precautions',
        content: 'Soft, moist foods preferred. Thickened liquids required (nectar consistency). Sit upright during meals for 30 minutes after eating.',
        icon: '⚠️'
      }
    ],
    medications: [
      {
        title: 'All Medications (7:00 AM & 7:00 PM)',
        content: 'Donepezil 10mg x1 tablet (dementia). Amlodipine 5mg x1 tablet (hypertension). Assist with self-administration or administer directly as needed.',
        icon: '💊'
      }
    ],
    behavior: [
      {
        title: 'Cognitive Status',
        content: 'Mid-stage dementia. Short-term memory loss expected. Repeat instructions as needed. Use simple, concrete language.',
        icon: '🧠'
      },
      {
        title: 'Emotional Needs',
        content: 'Responds well to reassurance and physical comfort (hand-holding, gentle touch). Avoid arguing about facts or reality.',
        icon: '❤️'
      }
    ],
    safety: [
      {
        title: 'Wandering Risk',
        content: 'MODERATE. Ensure client is supervised in common areas. Door alarms activated. Wears ID bracelet at all times.',
        icon: '🚪'
      }
    ]
  }
};

function getDemoClientCareInfo(clientId, tab) {
  const clientInfo = DEMO_CLIENT_CARE_INFO[clientId];
  if (!clientInfo) return [];
  
  const tabMap = {
    care: 'care',
    nutrition: 'nutrition',
    medications: 'medications',
    behavior: 'behavior',
    safety: 'safety'
  };
  
  const tabKey = tabMap[tab];
  return clientInfo[tabKey] || [];
}

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

const PAGE_ACCESS_RULES = {
  askSection: 'ask:approved_guidance:read',
  careModulesSection: 'tracker:entry:read',
  reportingSection: 'tracker:entry:read',
  uploadSection: 'documents:upload',
  assignmentSection: 'assignments:create',
  createClientSection: ['clients:assigned:read', 'clients:all:read'],
  createUserSection: 'users:invite',
  legalRecordsSection: 'legal_records:export',
  auditSection: 'audit:org:read'
};

function canAccessPage(pageId) {
  if (!pageId) return false;

  if (!currentUser) {
    return pageId === 'loginSection';
  }

  const requiredPermission = PAGE_ACCESS_RULES[pageId];
  if (!requiredPermission) return true;

  if (Array.isArray(requiredPermission)) {
    return requiredPermission.some((permission) => hasPermission(permission));
  }

  return hasPermission(requiredPermission);
}

function updateNavAccess() {
  document.querySelectorAll('.nav-item[data-nav-target]').forEach((item) => {
    const target = item.dataset.navTarget;
    const allowed = canAccessPage(target);
    item.style.display = allowed ? '' : 'none';
  });
}

function updateClientSectionAccess() {
  const section = document.getElementById('createClientSection');
  const form = document.getElementById('clientForm');
  if (!section || !form) return;

  const canCreateClients = hasPermission('clients:create');
  const leftColumn = form.closest('.two-col-left');
  if (leftColumn) {
    leftColumn.style.display = canCreateClients ? '' : 'none';
  }
}

const DEMO_PATIENT_WORKSPACE_ENTRIES = [
  {
    _id: 'demo-workspace-1',
    eventType: 'adl',
    priority: 'normal',
    status: 'completed',
    summary: 'Morning ADL support completed with verbal prompts and transfer assistance.',
    details: 'Client accepted routine, no resistance noted, hygiene checklist complete.',
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  },
  {
    _id: 'demo-workspace-2',
    eventType: 'medication',
    priority: 'high',
    status: 'pending',
    summary: 'Evening medication pass pending nurse verification.',
    details: 'MAR reviewed and medication prepared for handoff.',
    updatedAt: new Date(Date.now() - 55 * 60 * 1000).toISOString()
  },
  {
    _id: 'demo-workspace-3',
    eventType: 'behavior',
    priority: 'urgent',
    status: 'escalated',
    summary: 'Behavior escalation logged after abrupt routine change.',
    details: 'De-escalation protocol initiated and supervisor notified for review.',
    updatedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString()
  },
  {
    _id: 'demo-workspace-4',
    eventType: 'note',
    priority: 'normal',
    status: 'completed',
    summary: 'Nutrition intake recorded: full breakfast and hydration target met.',
    details: 'Meal support completed without issues. No food allergy triggers observed. Hydration chart updated.',
    updatedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString()
  },
  {
    _id: 'demo-workspace-5',
    eventType: 'incident',
    priority: 'high',
    status: 'pending',
    summary: 'Safety follow-up required for hallway near-fall observation.',
    details: 'No injury reported. Environmental sweep and footwear check scheduled.',
    updatedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString()
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

function navigateTo(pageId, options = {}) {
  const shouldShowDeniedToast = options.showDeniedToast !== false;
  const fallbackPage = currentUser ? 'homeSection' : 'loginSection';

  if (!canAccessPage(pageId)) {
    if (shouldShowDeniedToast) {
      showToast('You do not have access to that page.', 'error');
    }
    pageId = fallbackPage;
  }

  document.querySelectorAll('.page').forEach((page) => {
    page.style.display = page.id === pageId ? '' : 'none';
  });
  currentPage = pageId;
  document.querySelectorAll('.nav-item[data-nav-target]').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.navTarget === pageId);
  });
  const main = document.querySelector('.main-content');
  if (main) main.scrollTop = 0;
  handlePageNavigation(pageId);
  return pageId;
}

function handlePageNavigation(pageId) {
  if (!currentUser) return;

  if (pageId === 'askSection') {
    renderAskPromptLibrary();
    return;
  }

  if (pageId === 'homeSection') {
    renderHomeSection().catch(() => {});
    return;
  }

  if (pageId === 'trackerSection') {
    setTrackerStatusFilter(trackerStatusFilter).catch(() => {});
    return;
  }

  if (pageId === 'patientWorkspaceSection') {
    loadPatientWorkspace().catch(() => {});
    return;
  }

  if (pageId === 'careModulesSection') {
    loadTrackerFeed()
      .then(() => renderCareModulesSection())
      .catch(() => renderCareModulesSection());
    return;
  }

  if (pageId === 'reportingSection') {
    loadReportingSection().catch(() => {});
  }
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

const ASK_PROMPT_PHASE_LABELS = {
  pre_shift: 'Pre-Shift',
  documentation: 'Documentation',
  grounded_qa: 'Grounded Q&A',
  escalation: 'Escalation'
};

const DSP_PATIENT_PROMPT_LIBRARY = {
  pre_shift: [
    { category: 'Identity and Baseline', label: 'Patient baseline and communication', question: 'What is this patient baseline behavior, communication style, and preferred support approach for this shift?' },
    { category: 'Identity and Baseline', label: 'Top goals today', question: 'What are this patient top care goals and priority outcomes for today?' },
    { category: 'Safety Screening', label: 'Immediate safety risks', question: 'What immediate safety risks should I watch for right now, including fall, choking, seizure, and elopement concerns?' },
    { category: 'Safety Screening', label: 'Environment safety check', question: 'What environment hazards or equipment checks should be completed before starting care with this patient?' },
    { category: 'Medications', label: 'Meds due this shift', question: 'What medications are due this shift, at what times, and what verification steps are required before and after administration?' },
    { category: 'Medications', label: 'PRN guidance', question: 'What PRN medication triggers and hold parameters apply for this patient today?' },
    { category: 'Diet and Allergies', label: 'Allergies and restrictions', question: 'What allergies, diet restrictions, texture modifications, and hydration instructions apply to this patient?' },
    { category: 'ADL Support', label: 'Personal care assistance level', question: 'What assistance level and protocol should I follow for bathing, toileting, dressing, grooming, and transfers?' },
    { category: 'Behavior and Mental Health', label: 'Behavior triggers and supports', question: 'What known behavior triggers, early warning signs, and de-escalation techniques should I use for this patient?' },
    { category: 'Coordination', label: 'Appointments and handoff tasks', question: 'What appointments, follow-up tasks, or unresolved handoff items do I need to complete for this patient today?' }
  ],
  documentation: [
    { category: 'Charting Quality', label: 'What to document now', question: 'For this patient, what events and observations must be documented in real time during this shift?' },
    { category: 'Charting Quality', label: 'Objective note format', question: 'How should I document this patient interaction in objective, compliance-ready language with timestamps?' },
    { category: 'Medication Documentation', label: 'Med pass documentation', question: 'What details must be captured in documentation for this patient medication pass, including refusals, delays, or variances?' },
    { category: 'ADL Documentation', label: 'ADL documentation checklist', question: 'What ADL outcomes, assistance level, and patient response details should I document for this patient?' },
    { category: 'Incident Documentation', label: 'Incident report threshold', question: 'What incidents for this patient require formal incident reporting versus routine tracker notes?' },
    { category: 'Handoff Documentation', label: 'End-of-shift handoff', question: 'What specific patient updates and unresolved risks must be included in end-of-shift handoff documentation?' }
  ],
  grounded_qa: [
    { category: 'Care Plan Clarification', label: 'Clarify support steps', question: 'Based on this patient ISP, what exact step-by-step support sequence should I follow for this task?' },
    { category: 'Care Plan Clarification', label: 'Allowed vs not allowed actions', question: 'For this patient, which actions are allowed, which are restricted, and when should I stop and escalate?' },
    { category: 'Medication Clarification', label: 'Medication safety confirmation', question: 'Using current records, confirm medication timing, safety checks, and contraindication warnings for this patient.' },
    { category: 'Nutrition Clarification', label: 'Meal support guidance', question: 'What meal setup, feeding assistance, and swallow precautions should I follow for this patient right now?' },
    { category: 'Behavior Clarification', label: 'Behavior response sequence', question: 'What is the documented de-escalation sequence for this patient if distress escalates during care?' },
    { category: 'Communication', label: 'Best communication approach', question: 'What communication techniques are most effective and respectful for this patient during direct support tasks?' }
  ],
  escalation: [
    { category: 'Urgent Escalation', label: 'Escalate now criteria', question: 'What exact signs for this patient require immediate escalation to supervisor or nurse right now?' },
    { category: 'Urgent Escalation', label: 'Immediate actions before call', question: 'What immediate safety actions should be taken for this patient before and during escalation outreach?' },
    { category: 'Medication Escalation', label: 'Med uncertainty escalation', question: 'If I am unsure about medication instructions for this patient, what is the required escalation path and what should be documented?' },
    { category: 'Behavior Escalation', label: 'Crisis behavior escalation', question: 'For this patient, what are the documented crisis escalation steps, including who to notify and in what order?' },
    { category: 'Emergency Access', label: 'Break Glass criteria', question: 'When is break-glass access justified for this patient, and what emergency reason and follow-up notes are required?' },
    { category: 'Escalation Handoff', label: 'Post-escalation summary', question: 'After escalation for this patient, what disposition and follow-up details must be recorded for the next shift?' }
  ]
};

function getPromptLibraryForRole(role) {
  if (role === 'dsp') return DSP_PATIENT_PROMPT_LIBRARY;

  const fallbackQuestions = {
    pre_shift: [
      { category: 'Ops Review', label: 'Shift risk review', question: 'What patient-level risks and priority actions should the care team review at shift start?' }
    ],
    documentation: [
      { category: 'Ops Review', label: 'Documentation quality check', question: 'Which patient entries need documentation quality follow-up for compliance and clarity?' }
    ],
    grounded_qa: [
      { category: 'Ops Review', label: 'Care guidance validation', question: 'Which patient guidance responses need citation verification before action?' }
    ],
    escalation: [
      { category: 'Ops Review', label: 'Open escalations', question: 'What patient escalations are currently open and who owns each next step?' }
    ]
  };

  return fallbackQuestions;
}

function renderAskPromptLibrary() {
  const role = currentUser ? getActiveRole() : 'guest';
  const libraryWrap = document.getElementById('askPromptLibrary');
  const toggleBtn = document.getElementById('askPromptLibraryToggle');
  const roleLabel = document.getElementById('askPromptRoleLabel');
  const groups = document.getElementById('askPromptGroups');
  if (!libraryWrap || !toggleBtn || !roleLabel || !groups) return;

  const library = getPromptLibraryForRole(role);
  const phase = library[selectedAskPromptPhase] ? selectedAskPromptPhase : 'pre_shift';
  const prompts = (library[phase] || []).filter((item) => {
    if (!askPromptSearchTerm) return true;
    const haystack = `${item.category || ''} ${item.label || ''} ${item.question || ''}`.toLowerCase();
    return haystack.includes(askPromptSearchTerm.toLowerCase());
  });

  libraryWrap.classList.toggle('is-collapsed', isAskPromptLibraryCollapsed);
  toggleBtn.textContent = isAskPromptLibraryCollapsed ? 'Expand' : 'Collapse';

  roleLabel.textContent = `Prompt Library: ${getRoleDisplayLabel(role)} | ${ASK_PROMPT_PHASE_LABELS[phase] || 'Pre-Shift'}`;

  document.querySelectorAll('.ask-phase-btn').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.askPhase === phase);
  });

  if (!prompts.length) {
    groups.innerHTML = '<p class="empty-state">No matching prompts. Try a different search or phase.</p>';
    return;
  }

  const grouped = prompts.reduce((acc, item) => {
    const key = item.category || 'General';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const categories = Object.keys(grouped);
  if (!categories.includes(selectedAskPromptGroup)) {
    selectedAskPromptGroup = categories[0] || '';
  }

  groups.innerHTML = Object.entries(grouped)
    .map(([category, items]) => {
      const isOpen = category === selectedAskPromptGroup;
      return `
        <article class="ask-prompt-group">
          <button type="button" class="ask-prompt-group-toggle" data-ask-group="${safeText(category)}" aria-expanded="${isOpen ? 'true' : 'false'}">
            <span>${safeText(category)}</span>
            <span class="ask-prompt-group-toggle-count">${safeText(items.length)} prompts</span>
          </button>
          <div class="ask-prompt-chip-row" ${isOpen ? '' : 'hidden'}>
            ${items.map((item) => `<button type="button" class="ask-prompt-chip" data-question="${safeText(item.question)}">${safeText(item.label)}</button>`).join('')}
          </div>
        </article>
      `;
    })
    .join('');
}

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

function setFormSubmittingState(form, isSubmitting, pendingLabel = 'Saving...') {
  if (!form) return;

  const submitControl = form.querySelector('button[type="submit"], input[type="submit"]');
  if (!submitControl) return;

  if (isSubmitting) {
    submitControl.dataset.originalLabel = submitControl.tagName === 'INPUT'
      ? (submitControl.value || '')
      : (submitControl.textContent || '');

    if (submitControl.tagName === 'INPUT') {
      submitControl.value = pendingLabel;
    } else {
      submitControl.textContent = pendingLabel;
    }
    submitControl.disabled = true;
    form.dataset.submitting = '1';
    return;
  }

  if (submitControl.dataset.originalLabel !== undefined) {
    if (submitControl.tagName === 'INPUT') {
      submitControl.value = submitControl.dataset.originalLabel;
    } else {
      submitControl.textContent = submitControl.dataset.originalLabel;
    }
    delete submitControl.dataset.originalLabel;
  }

  submitControl.disabled = false;
  delete form.dataset.submitting;
}

async function withSubmitLock(form, run, pendingLabel) {
  if (!form || form.dataset.submitting === '1') {
    return;
  }

  setFormSubmittingState(form, true, pendingLabel);
  try {
    await run();
  } finally {
    setFormSubmittingState(form, false);
  }
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
    renderAskPromptLibrary();
    saveCurrentShift(null);
    updateNavAccess();
    persistAuthSession();
    return;
  }

  info.textContent = roleViewOverride
    ? `${currentUser.fullName} | ${getRoleDisplayLabel(currentUser.role)} (viewing as ${getRoleDisplayLabel(activeRole)})`
    : `${currentUser.fullName} | ${getRoleDisplayLabel(currentUser.role)}`;
  if (logoutBtn) logoutBtn.style.display = '';

  if (roleSwitcher) {
    if (canUseRoleSwitcher()) {
      roleSwitcher.style.display = '';
      roleSwitcher.value = activeRole;
      roleSwitcher.title = 'Role view';
      roleSwitcher.setAttribute('aria-label', 'Role view');
    } else {
      roleViewOverride = null;
      roleSwitcher.style.display = 'none';
    }
  }

  applyRoleMode(activeRole);
  syncDemoToggle();
  renderTraining(activeRole, selectedTrainingContext);
  selectedAskPromptPhase = selectedTrainingContext;
  renderAskPromptLibrary();
  loadCurrentShift();
  updateShiftUI();
  renderHomeSection();
  renderRoleLabelSettings();
  updateNavAccess();
  updateClientSectionAccess();
  persistAuthSession();
}

function getRoleDisplayLabel(role) {
  const normalizedRole = String(role || '').trim();
  return orgRoleDisplayLabels?.[normalizedRole] || DEFAULT_ROLE_DISPLAY_LABELS[normalizedRole] || normalizedRole;
}

function getRolePermissions(role) {
  const normalizedRole = String(role || '').trim();
  return ROLE_PERMISSION_FALLBACK[normalizedRole] || [];
}

function hasPermission(permission, options = {}) {
  if (!currentUser) return false;

  const normalizedPermission = String(permission || '').trim();
  if (!normalizedPermission) return false;

  const useActiveRole = options.useActiveRole !== false;
  const activeRole = useActiveRole ? getActiveRole() : currentUser.role;

  if (useActiveRole && activeRole && activeRole !== currentUser.role) {
    return getRolePermissions(activeRole).includes(normalizedPermission);
  }

  const currentPermissions = Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
  if (currentPermissions.length > 0) {
    return currentPermissions.includes(normalizedPermission);
  }

  return getRolePermissions(currentUser.role).includes(normalizedPermission);
}

function canUseRoleSwitcher() {
  // Role switcher is reserved for super admins only.
  return String(currentUser?.role || '').trim() === 'super_admin';
}

function applyAuthUserContext(user) {
  if (!user) return;

  const roleLabelsFromApi = user.roleDisplayLabels && typeof user.roleDisplayLabels === 'object'
    ? user.roleDisplayLabels
    : null;

  orgRoleDisplayLabels = {
    ...DEFAULT_ROLE_DISPLAY_LABELS,
    ...(roleLabelsFromApi || {})
  };

  if (Array.isArray(user.permissions)) {
    currentUser.permissions = [...user.permissions];
  }

  if (token) {
    authContextLoadedForToken = token;
  }
}

async function loadAuthContext() {
  if (!token || !currentUser || authContextLoadedForToken === token) return;

  try {
    const data = await api('/api/auth/permissions');
    orgRoleDisplayLabels = {
      ...DEFAULT_ROLE_DISPLAY_LABELS,
      ...(data.roleDisplayLabels || {})
    };
    currentUser.permissions = Array.isArray(data.permissions) ? data.permissions : [];
    authContextLoadedForToken = token;
    persistAuthSession();
    renderRoleLabelSettings();
    updateSession();
  } catch (error) {
    console.warn('Could not load auth context:', error.message);
  }
}

function renderRoleLabelSettings() {
  const panel = document.getElementById('roleLabelsPanel');
  const form = document.getElementById('roleLabelsForm');
  if (!panel || !form) return;

  if (!hasPermission('role_labels:update', { useActiveRole: false })) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';
  for (const role of Object.keys(DEFAULT_ROLE_DISPLAY_LABELS)) {
    const input = form.querySelector(`input[name="${role}"]`);
    if (!input) continue;
    input.value = getRoleDisplayLabel(role);
  }
}

function canToggleDemoMode() {
  if (!currentUser) return false;
  return canUseRoleSwitcher();
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
    handlePageNavigation(page);
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
  setSelectOptions('reportingClientId', options, 'All Clients');

  const patientSelect = document.getElementById('patientWorkspaceClientId');
  if (isDemo() && patientSelect && !patientSelect.value && options.length) {
    patientSelect.value = options[0].value;
    loadPatientWorkspace().catch(() => {});
  }
}

function getDemoPatientWorkspaceEntries(clientId) {
  return DEMO_PATIENT_WORKSPACE_ENTRIES.map((entry, index) => ({
    ...entry,
    _id: `${entry._id}-${clientId}-${index}`,
    clientId,
    createdAt: entry.updatedAt
  }));
}

async function loadTrackerFeed() {
  try {
    const query = trackerStatusFilter ? `?limit=50&status=${encodeURIComponent(trackerStatusFilter)}` : '?limit=50';
    const data = await api(`/api/tracker${query}`);
    const entries = data.entries || [];
    if (isDemo() && entries.length === 0) {
      renderTrackerFeed(
        trackerStatusFilter ? DEMO_TRACKER_ENTRIES.filter((entry) => entry.status === trackerStatusFilter) : DEMO_TRACKER_ENTRIES
      );
      return;
    }
    renderTrackerFeed(entries);
  } catch (error) {
    if (isDemo()) {
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
    if (isDemo()) {
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

function getClientNameById(clientId) {
  const client = clientsCache.find((item) => item._id === clientId);
  return client?.displayName || 'Unknown Client';
}

function renderCareModulesSection() {
  const grid = document.getElementById('careModulesGrid');
  if (!grid) return;

  const activeClients = clientsCache.filter((client) => (client?.status || 'active') === 'active').length;
  const trackerEntries = currentTrackerFeed || [];
  const pending = trackerEntries.filter((entry) => entry.status === 'pending').length;
  const escalated = trackerEntries.filter((entry) => entry.status === 'escalated').length;
  const incidents = trackerEntries.filter((entry) => entry.eventType === 'incident').length;

  const modules = [
    {
      title: 'Medication Safety',
      description: 'Track med passes, pending verifications, and escalation patterns by client.',
      metricLabel: 'Pending medication workflows',
      metricValue: pending
    },
    {
      title: 'Behavior & Incident',
      description: 'Review behavior events, crisis notes, and immediate incident follow-ups.',
      metricLabel: 'Incident-related events',
      metricValue: incidents
    },
    {
      title: 'Daily Living & ADL',
      description: 'Monitor ADL completion, routine adherence, and support continuity.',
      metricLabel: 'Active clients in care',
      metricValue: activeClients
    },
    {
      title: 'Risk & Escalation',
      description: 'Prioritize high-risk entries with supervisor-ready escalation visibility.',
      metricLabel: 'Escalated items',
      metricValue: escalated
    }
  ];

  grid.innerHTML = modules
    .map((module) => `
      <article class="care-module-card">
        <h3>${safeText(module.title)}</h3>
        <p>${safeText(module.description)}</p>
        <div class="care-module-metric">
          <span class="metric-value">${safeText(module.metricValue)}</span>
          <span class="metric-label">${safeText(module.metricLabel)}</span>
        </div>
      </article>
    `)
    .join('');
}

function buildReportPayload(entries, filters) {
  const filtered = entries.filter((entry) => {
    const matchesClient = !filters.clientId || entry.clientId === filters.clientId;
    const matchesStatus = !filters.status || entry.status === filters.status;

    const createdAt = entry.createdAt || entry.updatedAt || entry.dueAt;
    const stamp = createdAt ? new Date(createdAt).getTime() : NaN;
    const fromStamp = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : null;
    const toStamp = filters.to ? new Date(`${filters.to}T23:59:59`).getTime() : null;
    const matchesFrom = fromStamp ? (!Number.isNaN(stamp) && stamp >= fromStamp) : true;
    const matchesTo = toStamp ? (!Number.isNaN(stamp) && stamp <= toStamp) : true;
    return matchesClient && matchesStatus && matchesFrom && matchesTo;
  });

  const byType = filtered.reduce((acc, entry) => {
    const key = entry.eventType || 'other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const summary = {
    total: filtered.length,
    pending: filtered.filter((entry) => entry.status === 'pending').length,
    completed: filtered.filter((entry) => entry.status === 'completed').length,
    escalated: filtered.filter((entry) => entry.status === 'escalated').length
  };

  const sorted = [...filtered].sort((a, b) => {
    const aStamp = new Date(a.createdAt || a.updatedAt || a.dueAt || 0).getTime();
    const bStamp = new Date(b.createdAt || b.updatedAt || b.dueAt || 0).getTime();
    return bStamp - aStamp;
  });

  return {
    generatedAt: new Date().toISOString(),
    filters,
    summary,
    byType,
    entries: sorted
  };
}

function renderReportPayload(payload) {
  const summaryEl = document.getElementById('reportingSummary');
  const byTypeEl = document.getElementById('reportByType');
  const recentEl = document.getElementById('reportRecent');
  if (!summaryEl || !byTypeEl || !recentEl) return;

  summaryEl.innerHTML = `
    <article class="report-kpi"><span>${safeText(payload.summary.total)}</span><small>Total Entries</small></article>
    <article class="report-kpi"><span>${safeText(payload.summary.pending)}</span><small>Pending</small></article>
    <article class="report-kpi"><span>${safeText(payload.summary.completed)}</span><small>Completed</small></article>
    <article class="report-kpi"><span>${safeText(payload.summary.escalated)}</span><small>Escalated</small></article>
  `;

  const maxTypeValue = Math.max(...Object.values(payload.byType), 1);
  const typeRows = Object.entries(payload.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const width = Math.max(10, Math.round((count / maxTypeValue) * 100));
      return `
        <div class="report-bar-row">
          <span class="report-bar-label">${safeText(type)}</span>
          <div class="report-bar-track"><span class="report-bar-fill" style="width:${safeText(width)}%"></span></div>
          <span class="report-bar-count">${safeText(count)}</span>
        </div>
      `;
    })
    .join('');
  byTypeEl.innerHTML = typeRows || '<p class="empty-state">No matching events for current filters.</p>';

  const recentRows = payload.entries.slice(0, 12).map((entry) => {
    return `
      <div class="report-row">
        <div>
          <strong>${safeText(entry.summary || 'No summary')}</strong>
          <p>${safeText(getClientNameById(entry.clientId))} | ${safeText(entry.eventType || 'other')}</p>
        </div>
        <div class="report-row-meta">
          <span class="status-badge status-${safeText(entry.status || 'pending')}">${safeText(entry.status || 'pending')}</span>
          <time>${safeText(formatDate(entry.createdAt || entry.updatedAt || entry.dueAt))}</time>
        </div>
      </div>
    `;
  }).join('');
  recentEl.innerHTML = recentRows || '<p class="empty-state">No entries available.</p>';
}

async function loadReportingSection(formValues = null) {
  const filters = formValues || {
    clientId: document.getElementById('reportingClientId')?.value || '',
    status: document.getElementById('reportingStatus')?.value || '',
    from: document.getElementById('reportingFrom')?.value || '',
    to: document.getElementById('reportingTo')?.value || ''
  };

  try {
    const params = new URLSearchParams({ limit: '250' });
    if (filters.clientId) params.set('clientId', filters.clientId);
    if (filters.status) params.set('status', filters.status);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);

    const data = await api(`/api/tracker?${params.toString()}`);
    const sourceEntries = data.entries || [];
    const payload = buildReportPayload(sourceEntries, filters);
    currentReportPayload = payload;
    renderReportPayload(payload);
  } catch (error) {
    if (isDemo()) {
      const payload = buildReportPayload(DEMO_TRACKER_ENTRIES, filters);
      currentReportPayload = payload;
      renderReportPayload(payload);
      return;
    }

    currentReportPayload = null;
    const summaryEl = document.getElementById('reportingSummary');
    const byTypeEl = document.getElementById('reportByType');
    const recentEl = document.getElementById('reportRecent');
    if (summaryEl) summaryEl.innerHTML = `<p class="empty-state">${safeText(error.message)}</p>`;
    if (byTypeEl) byTypeEl.innerHTML = '';
    if (recentEl) recentEl.innerHTML = '';
  }
}

function downloadReportFile(content, fileName, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
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
    label: `${user.fullName} (${user.roleDisplayName || getRoleDisplayLabel(user.role)})`
  }));
  setSelectOptions('assignmentUserId', options, 'Select User');
  setSelectOptions('resetPasswordUserId', options, 'Select Team Member');
}

async function refreshClients() {
  if (isDemo()) {
    clientsCache = getDemoClients();
    syncClientPickers();
    renderClientList(clientsCache);
    if (currentPage === 'homeSection') {
      renderHomeSection().catch(() => {});
    }
    return;
  }

  try {
    const data = await api('/api/clients');
    clientsCache = data.clients || [];
    syncClientPickers();
    renderClientList(clientsCache);
    if (currentPage === 'homeSection') {
      renderHomeSection().catch(() => {});
    }
  } catch (error) {
    console.error('Error loading clients:', error);
    // In non-demo mode, never render demo data.
    clientsCache = [];
    syncClientPickers();
    renderClientList(clientsCache);
    if (currentPage === 'homeSection') {
      renderHomeSection().catch(() => {});
    }
  }
}

async function refreshUsers() {
  try {
    const data = await api('/api/assignments/users');
    usersCache = data.users || [];
    if (isDemo() && usersCache.length === 0) {
      usersCache = DEMO_USERS;
    }
    syncUserPicker();
    renderUserList(usersCache);
  } catch (error) {
    usersCache = isDemo() ? DEMO_USERS : [];
    syncUserPicker();
    const list = document.getElementById('usersList');
    if (list && !isDemo()) list.innerHTML = `<p class="empty-state">Could not load team: ${safeText(error.message)}</p>`;
    if (list && isDemo()) renderUserList(usersCache);
  }
}

async function refreshAllPickers() {
  if (!token) return;
  await refreshClients();
  if (hasPermission('users:read')) {
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
      clearAuthSessionState();
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
  const activeClientsCount = clientsCache.filter((client) => (client?.status || 'active') === 'active').length;

  const welcomeTitle = document.getElementById('homeWelcomeTitle');
  const welcomeRole = document.getElementById('homeWelcomeRole');
  if (welcomeTitle) welcomeTitle.textContent = `Welcome back, ${currentUser.fullName}`;

  const roleLabels = {
    dsp: getRoleDisplayLabel('dsp'),
    supervisor: getRoleDisplayLabel('supervisor'),
    org_admin: getRoleDisplayLabel('org_admin'),
    super_admin: getRoleDisplayLabel('super_admin')
  };
  if (welcomeRole) welcomeRole.textContent = roleLabels[role] || role;

  const actionCatalog = [
    { label: 'Ask Assistant', target: 'askSection', permission: 'ask:approved_guidance:read' },
    { label: 'Log Event', target: 'trackerSection', permission: 'tracker:entry:create' },
    { label: 'Review Tracker', target: 'trackerSection', permission: 'tracker:entry:read' },
    { label: 'Care Modules', target: 'careModulesSection', permission: 'tracker:entry:read' },
    { label: 'Reporting', target: 'reportingSection', permission: 'tracker:entry:read' },
    { label: 'Emergency Access', target: 'breakGlassSection' },
    { label: 'My Training', target: 'trainingSection' },
    { label: 'Upload Document', target: 'uploadSection', permission: 'documents:upload' },
    { label: 'Assign DSP', target: 'assignmentSection', permission: 'assignments:create' },
    { label: 'Add Team Member', target: 'createUserSection', permission: 'users:invite' },
    { label: 'Add Client', target: 'createClientSection', permission: 'clients:create' },
    { label: 'Legal Export', target: 'legalRecordsSection', permission: 'legal_records:export' },
    { label: 'Audit Log', target: 'auditSection', permission: 'audit:org:read' }
  ];

  const actions = actionCatalog.filter((action) => {
    if (!action.permission) return true;
    return hasPermission(action.permission);
  });

  const homeActions = document.getElementById('homeActions');
  if (homeActions) {
    const visibleActions = actions.length > 0 ? actions : [{ label: 'My Training', target: 'trainingSection' }];
    homeActions.innerHTML = visibleActions
      .map((a) => `<button type="button" class="quick-action-btn" data-nav-target="${safeText(a.target)}">${safeText(a.label)}</button>`)
      .join('');
  }

  try {
    const summaryData = isDemo() ? DEMO_TRACKER_SUMMARY : await api('/api/tracker/summary');
    const visibleSummary = activeClientsCount === 0 ? { pending: 0, completed: 0, escalated: 0 } : summaryData;
    const homeStats = document.getElementById('homeStats');
    if (homeStats) {
      const clientsTarget = canAccessPage('createClientSection') ? 'createClientSection' : 'trackerSection';
      homeStats.innerHTML = `
        <button type="button" class="stat-chip stat-clickable" data-nav-target="${safeText(clientsTarget)}" aria-label="View clients"><span class="stat-value stat-value-home" style="color:#0f172a;">${activeClientsCount}</span><span class="stat-label">Clients</span></button>
        <button type="button" class="stat-chip stat-warn stat-clickable" data-nav-target="trackerSection" data-tracker-status="pending" aria-label="View pending tracker entries"><span class="stat-value stat-value-home stat-value-warn" style="color:#92400e;">${visibleSummary.pending || 0}</span><span class="stat-label">Pending</span></button>
        <button type="button" class="stat-chip stat-danger stat-clickable" data-nav-target="trackerSection" data-tracker-status="escalated" aria-label="View escalated tracker entries"><span class="stat-value stat-value-home stat-value-danger" style="color:#b91c1c;">${visibleSummary.escalated || 0}</span><span class="stat-label">Escalated</span></button>
        <button type="button" class="stat-chip stat-ok stat-clickable" data-nav-target="trackerSection" data-tracker-status="completed" aria-label="View completed tracker entries"><span class="stat-value stat-value-home stat-value-ok" style="color:#166534;">${visibleSummary.completed || 0}</span><span class="stat-label">Completed</span></button>
      `;
    }

    const homeAlerts = document.getElementById('homeAlerts');
    if (homeAlerts) {
      if (activeClientsCount === 0 && hasPermission('clients:create')) {
        homeAlerts.innerHTML = `<div class="onboard-hint"><strong>Get started:</strong> Add your first client below, then assign a DSP to begin care tracking.<button type="button" class="quick-action-btn" data-scroll-target="createClientSection" style="margin-left:12px;">Add First Client →</button></div>`;
      } else if ((visibleSummary.escalated || 0) > 0) {
        try {
          const feedData = isDemo()
            ? { entries: DEMO_TRACKER_ENTRIES }
            : await api('/api/tracker?limit=20');
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
  const latestQuestion = Array.from(messages.querySelectorAll('.chat-message-user .chat-bubble-text')).pop()?.textContent || '';
  const sourceMessageId = sources.length
    ? `source-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    : '';

  if (sourceMessageId) {
    chatSourceRegistry.set(sourceMessageId, sources);
  }

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

  const immediateGuidance = buildImmediateGuidance({ question: latestQuestion, sources, structured });
  const guidanceHtml = immediateGuidance
    ? `<div class="chat-guidance"><h4>${safeText(immediateGuidance.title)}</h4><p>${safeText(immediateGuidance.body)}</p></div>`
    : '';

  const sourcesHtml = sources.length
    ? `<div class="chat-sources">${sources.map((s, index) => `<button type="button" class="source-tag source-tag-btn" data-source-message-id="${safeText(sourceMessageId)}" data-source-index="${index}">${safeText(formatSourceLabel(s.sourceFileName || s.title || s.docType || 'document'))}</button>`).join('')}</div>`
    : '';

  const bubble = document.createElement('div');
  bubble.className = 'chat-message chat-message-ai';
  bubble.innerHTML = `<div class="chat-bubble"><div class="chat-bubble-text">${safeText(answer).replace(/\n/g, '<br>')}</div>${guidanceHtml}${structuredHtml}${sourcesHtml}</div>`;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

function inferCareTopic(text) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return 'general';
  if (/bath|bathing|shower|toilet|groom|personal care|adl/.test(normalized)) return 'bathing';
  if (/meal|meals|eat|eating|diet|food|feeding|snack|nutrition/.test(normalized)) return 'meal';
  if (/med|medication|mar|med pass/.test(normalized)) return 'medication';
  if (/behavior|distress|escalat|de-escalat|redirect/.test(normalized)) return 'behavior';
  return 'general';
}

function getPrimarySourceForTopic(topic, sources) {
  const sourceList = Array.isArray(sources) ? sources : [];
  if (!sourceList.length) return null;

  if (topic === 'bathing' || topic === 'meal') {
    return sourceList.find((source) => inferSourceDocType(source) === 'isp') || sourceList[0];
  }
  if (topic === 'medication') {
    return sourceList.find((source) => inferSourceDocType(source) === 'mar') || sourceList[0];
  }
  if (topic === 'behavior') {
    return sourceList.find((source) => inferSourceDocType(source) === 'behavior') || sourceList[0];
  }
  return sourceList[0];
}

function buildImmediateGuidance({ question, sources, structured }) {
  const topic = inferCareTopic(question);
  const primarySource = getPrimarySourceForTopic(topic, sources);
  const sectionName = String(primarySource?.sectionHint || '').trim() || 'the cited section';
  const sourceName = primarySource
    ? formatSourceLabel(primarySource.sourceFileName || primarySource.title || primarySource.docType || 'Document')
    : 'the cited document';

  if (topic === 'bathing') {
    return {
      title: 'Start Here For Bathing',
      body: `Open ${sourceName} and go straight to ${sectionName}. That is the first place the DSP should check for bathing supports, cueing, dignity steps, and safety instructions before providing care.`
    };
  }

  if (topic === 'meal') {
    const mealDetails = [];
    if (String(structured?.diet || '').trim()) mealDetails.push('dietary restrictions');
    if (String(structured?.allergies || '').trim()) mealDetails.push('allergies');
    if (String(structured?.protocols || '').trim()) mealDetails.push('assistance protocols');
    const detailText = mealDetails.length ? ` Check ${mealDetails.join(', ')} immediately before serving.` : '';
    return {
      title: 'Start Here For Meals',
      body: `Open ${sourceName} and go straight to ${sectionName}. That is the first place the DSP should check for meal setup, feeding supports, and food safety guidance.${detailText}`
    };
  }

  if (topic === 'medication') {
    return {
      title: 'Start Here For Medication Support',
      body: `Open ${sourceName} and go straight to ${sectionName}. That is the first place the DSP should verify timing, administration status, and any variance notes before proceeding.`
    };
  }

  if (topic === 'behavior') {
    return {
      title: 'Start Here For Behavior Support',
      body: `Open ${sourceName} and go straight to ${sectionName}. That is the first place the DSP should check for de-escalation steps and required responses before continuing the task.`
    };
  }

  return primarySource
    ? {
        title: 'Start With The Primary Source',
        body: `Open ${sourceName} and go straight to ${sectionName}. That is the quickest place for the DSP to confirm the documented care instructions before acting.`
      }
    : null;
}

function formatSourceLabel(rawLabel) {
  let label = String(rawLabel || 'document');

  if (!/Individual Support Plan \(ISP\)/i.test(label)) {
    label = label.replace(/\bISP\b/g, 'Individual Support Plan (ISP)');
  }

  if (!/Medication Administration Record \(MAR\)/i.test(label)) {
    label = label.replace(/\bMAR\b/g, 'Medication Administration Record (MAR)');
  }

  return label;
}

function inferSourceDocType(source) {
  const docType = String(source?.docType || '').toLowerCase();
  const sourceName = String(source?.sourceFileName || source?.title || '').toLowerCase();

  if (docType.includes('isp') || sourceName.includes('isp')) return 'isp';
  if (docType.includes('mar') || sourceName.includes('mar')) return 'mar';
  if (docType.includes('behavior') || sourceName.includes('behavior')) return 'behavior';
  return 'document';
}

function getDemoSourceExcerpt(source) {
  if (String(source?.excerpt || '').trim()) return String(source.excerpt).trim();

  const docType = inferSourceDocType(source);
  if (docType === 'isp') {
    return 'Assist with bathing using step-by-step prompts, ensure privacy and safety checks, and document support level plus response before handoff.';
  }
  if (docType === 'mar') {
    return 'Verify medication timing and MAR entries before and after care tasks, including any deviations or alerts requiring supervisor follow-up.';
  }
  if (docType === 'behavior') {
    return 'Use calm redirection if distress is observed, avoid escalating language, and follow de-escalation sequence documented in the behavior plan.';
  }
  return 'Preview not available for this source yet. Open the Documents section for full records.';
}

async function openSourcePreview(source) {
  const { clientId, clientName } = getSelectedAskClient();
  const sourceName = formatSourceLabel(source?.sourceFileName || source?.title || source?.docType || 'Document');
  const sectionHint = String(source?.sectionHint || '').trim();

  // Build a targeted question so the AI goes straight to that section
  const question = sectionHint
    ? `Based on ${sourceName}, what does the "${sectionHint}" section say for ${clientName}?`
    : `What does ${sourceName} say about care guidance for ${clientName}?`;

  const messages = document.getElementById('chatMessages');
  const textarea = document.querySelector('#askForm textarea');

  // Show the question as a user bubble and a typing indicator
  if (messages) {
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-message chat-message-user';
    userBubble.innerHTML = `<div class="chat-bubble"><div class="chat-bubble-text">${safeText(question)}</div></div>`;
    messages.appendChild(userBubble);

    const typing = document.createElement('div');
    typing.className = 'chat-message chat-message-ai chat-typing';
    typing.innerHTML = '<div class="chat-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
  }

  if (isDemo()) {
    renderAskAnswer(buildDemoAskResponse({ clientId, question }));
    return;
  }

  if (!clientId) {
    renderAskAnswer('Please select a client before opening a source.');
    return;
  }

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

function getDemoAskSources(clientName) {
  return [
    {
      sourceFileName: `${clientName} Individual Support Plan (ISP) (Demo)`,
      docType: 'isp',
      sectionHint: 'Personal care supports',
      excerpt: 'Use clear, one-step prompts for bathing and grooming. Respect preferences, maintain dignity, and document assistance level before shift handoff. This is the primary place the DSP should look for bathing and meal assistance instructions.'
    },
    {
      sourceFileName: `${clientName} Medication Administration Record (MAR) (Demo)`,
      docType: 'mar',
      sectionHint: 'Medication timing and verification',
      excerpt: 'Confirm MAR timing windows and note any variances observed during personal care activities. Escalate missed or uncertain entries immediately.'
    },
    {
      sourceFileName: `${clientName} Behavior Plan (Demo)`,
      docType: 'behavior',
      sectionHint: 'De-escalation supports',
      excerpt: 'If distress rises during ADLs, pause, offer calm reassurance, and follow the documented de-escalation sequence before resuming care tasks.'
    }
  ];
}

function buildDemoAskResponse({ clientId, question, mode = 'general' }) {
  const selectedClient = clientsCache.find((client) => String(client._id) === String(clientId));
  const clientName = selectedClient?.displayName || 'the selected client';
  const prompt = String(question || '').toLowerCase();

  if (mode === 'meal' || /meal|eating|food|nutrition|diet|appetite|swallow|texture/.test(prompt)) {
    return {
      answer: `${clientName} meal support demo summary: confirm texture-safe meal setup, verify allergy flags before serving, and use calm one-step prompts with pacing support. Escalate to supervisor if intake drops or swallow concerns appear.`,
      grounded: true,
      sources: getDemoAskSources(clientName),
      structured: {
        diet: 'Texture-modified diet with hydration prompts every 30 to 45 minutes during active shift windows.',
        allergies: 'Avoid peanut ingredients and citrus concentrates per demo allergy profile.',
        behavior: 'Use calm redirection if routine changes trigger distress. Keep transitions short and predictable.',
        protocols: 'Offer hand-over-hand cueing only when verbal prompts fail. Pause and re-approach after 2 minutes if refusal persists.'
      },
      missingSections: [],
      escalationRequired: false
    };
  }

  if (/bath|shower|hygiene|wash|grooming|soap|towel/.test(prompt)) {
    return {
      answer: `${clientName} bathing support demo summary: gather all supplies before entering the bathroom (washcloth, soap, towel, change of clothes), use warm water and test temperature on your wrist first, verbally prepare each step before touching (e.g., "I'm going to wash your arms now"), allow adequate time without rushing, and offer hand-over-hand support only if requested or needed. Maintain dignity throughout by providing privacy, using appropriate draping, and respecting personal preferences.`,
      grounded: true,
      sources: getDemoAskSources(clientName),
      structured: {
        setup: 'Prepare all supplies: washcloth, mild soap, warm towel, change of clothes, and optional comfort items (bath salts, music). Check bathroom temperature and water pressure.',
        safety: 'Test water temperature on your wrist first (aim for 95–105°F). Ensure non-slip surfaces, grab bars, and secure step stool if needed. Never leave the client unattended in the shower.',
        technique: 'Use gentle, one-step verbal cues. Start with less sensitive areas (arms, legs) before face and genital areas. Minimize water on face unless client prefers a shower over tub bath.',
        comfort: 'Offer hand-over-hand support for scrubbing if requested. Allow the client to do as much as independently possible. Provide a warm robe immediately after and positive encouragement throughout.'
      },
      missingSections: [],
      escalationRequired: false
    };
  }

  if (/morning.*medication|medication schedule|med pass|mar/.test(prompt)) {
    return {
      answer: `Demo medication guidance for ${clientName}: complete morning med-pass window between 8:00 AM and 9:00 AM, verify identity and MAR before administration, and document completion or variance immediately in tracker notes.`,
      grounded: true,
      sources: getDemoAskSources(clientName)
    };
  }

  return {
    answer: `Demo answer for ${clientName}: use current care plan instructions, confirm assignment and safety flags first, perform the task using documented supports, and log outcomes in the tracker before handoff.`,
    grounded: true,
    sources: getDemoAskSources(clientName)
  };
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

  if (isDemo()) {
    renderAskAnswer(buildDemoAskResponse({ clientId, question: userQuestion, mode: 'meal' }));
    return;
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

  const canEdit = hasPermission('clients:update');
  const canArchive = hasPermission('clients:archive');
  const canDelete = hasPermission('clients:delete');

  list.innerHTML = clients.map((c) => `
    <div class="data-item" data-client-open-id="${safeText(c._id)}" role="button" tabindex="0" aria-label="Open ${safeText(c.displayName)} in patient workspace">
      <div class="data-item-stack">
        <span class="data-item-label">${safeText(c.displayName)}</span>
        <span class="data-item-meta">${safeText(c.externalId || '—')}</span>
        <span class="data-item-meta">Status: ${safeText(c.status || 'active')}</span>
      </div>
      <div class="data-item-actions">
        ${canEdit ? `<button type="button" class="btn-secondary btn-sm" data-client-action="edit" data-client-id="${safeText(c._id)}">Edit</button>` : ''}
        ${canArchive && c.status !== 'inactive' ? `<button type="button" class="btn-secondary btn-sm" data-client-action="archive" data-client-id="${safeText(c._id)}">Archive</button>` : ''}
        ${canDelete ? `<button type="button" class="btn-danger btn-sm" data-client-action="delete" data-client-id="${safeText(c._id)}">Delete</button>` : ''}
      </div>
    </div>
  `).join('');
}

async function openClientWorkspace(clientId) {
  const patientClientSelect = document.getElementById('patientWorkspaceClientId');
  if (!patientClientSelect) {
    showToast('Patient workspace is not available right now.', 'error');
    return;
  }

  const hasMatchingOption = Array.from(patientClientSelect.options || []).some((option) => option.value === String(clientId));
  if (!hasMatchingOption) {
    showToast('Could not open this client in patient workspace.', 'error');
    return;
  }

  patientClientSelect.value = String(clientId);
  navigateTo('patientWorkspaceSection');
  await loadPatientWorkspace();
}

async function handleClientListAction(action, clientId) {
  const client = clientsCache.find((item) => String(item._id) === String(clientId));
  if (!client) {
    showToast('Client not found.', 'error');
    return;
  }

  if (action === 'edit') {
    const nextName = window.prompt('Client name', client.displayName || '');
    if (nextName === null) return;
    const trimmedName = String(nextName).trim();
    if (!trimmedName) {
      showToast('Client name is required.', 'error');
      return;
    }

    const nextExternalId = window.prompt('External ID (optional)', client.externalId || '');
    if (nextExternalId === null) return;

    if (isDemo()) {
      clientsCache = clientsCache.map((item) => (
        String(item._id) === String(clientId)
          ? { ...item, displayName: trimmedName, externalId: String(nextExternalId || '').trim() }
          : item
      ));
      saveDemoClients(clientsCache);
      syncClientPickers();
      renderClientList(clientsCache);
      showToast('Demo client updated.', 'success');
      return;
    }

    await api(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: trimmedName,
        externalId: String(nextExternalId || '').trim(),
        notes: client.notes || ''
      })
    });
    await refreshClients();
    showToast('Client updated successfully.', 'success');
    return;
  }

  if (action === 'archive') {
    const confirmed = window.confirm(`Archive ${client.displayName}? This removes active access but keeps records.`);
    if (!confirmed) return;

    if (isDemo()) {
      clientsCache = clientsCache.map((item) => (
        String(item._id) === String(clientId)
          ? { ...item, status: 'inactive' }
          : item
      ));
      saveDemoClients(clientsCache);
      syncClientPickers();
      renderClientList(clientsCache);
      showToast('Demo client archived.', 'success');
      return;
    }

    await api(`/api/clients/${encodeURIComponent(clientId)}/archive`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    });
    await refreshClients();
    showToast('Client archived successfully.', 'success');
    return;
  }

  if (action === 'delete') {
    const typed = window.prompt(`Type DELETE to permanently remove ${client.displayName}.`);
    if (typed !== 'DELETE') {
      showToast('Delete cancelled.', 'info');
      return;
    }

    if (isDemo()) {
      clientsCache = clientsCache.filter((item) => String(item._id) !== String(clientId));
      saveDemoClients(clientsCache);
      syncClientPickers();
      renderClientList(clientsCache);
      showToast('Demo client deleted.', 'success');
      return;
    }

    await api(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE'
    });
    await refreshClients();
    showToast('Client deleted successfully.', 'success');
  }
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
      <span class="data-item-meta data-item-role role-${safeText(u.role)}">${safeText(u.roleDisplayName || getRoleDisplayLabel(u.role))}</span>
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
    if (isDemo()) {
      const selectedClient = clientsCache.find((c) => String(c._id) === String(currentPatientWorkspace.clientId));
      const label = selectedClient ? `${selectedClient.displayName} (${selectedClient.externalId || 'n/a'})` : 'Selected client';
      container.innerHTML = `
        <div class="patient-items">
          <div class="patient-item">
            <p class="patient-item-title">Legal & Compliance Snapshot (Demo)</p>
            <p class="patient-item-meta">Client: ${safeText(label)}</p>
            <p class="patient-item-meta">Retention policy: FL, 7 years | Documents: 6 | Tracker entries: 18 | Audit events: 24</p>
            <p class="patient-item-meta">Status: Export-ready for legal review.</p>
          </div>
        </div>
      `;
      return;
    }

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

  // First, try to show client care information if available
  if (isDemo()) {
    const careInfo = getDemoClientCareInfo(currentPatientWorkspace.clientId, selectedPatientTab);
    if (careInfo && careInfo.length > 0) {
      container.innerHTML = `<div class="patient-items">${careInfo.map((item) => `
        <article class="patient-item">
          <p class="patient-item-title">${item.icon || ''} ${safeText(item.title)}</p>
          <p class="patient-item-meta">${safeText(item.content)}</p>
        </article>
      `).join('')}</div>`;
      return;
    }
  }

  // Fallback to tracker entries filtered by tab
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

  if (isDemo()) {
    currentPatientWorkspace = {
      clientId,
      entries: getDemoPatientWorkspaceEntries(clientId)
    };
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

function ensureDemoPatientWorkspaceLoaded() {
  if (!isDemo()) return;
  const select = document.getElementById('patientWorkspaceClientId');
  if (!select || !select.value) return;
  loadPatientWorkspace().catch(() => {});
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
    applyAuthUserContext(data.user);
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
    applyAuthUserContext(data.user);
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
    roleViewOverride = null;
    applyAuthUserContext(data.user);
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
    // Show success state
    const formContent = document.getElementById('demoFormContent');
    const successState = document.getElementById('demoSuccessState');
    if (formContent) formContent.style.display = 'none';
    if (successState) successState.style.display = 'block';
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
    applyAuthUserContext(data.user);
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

function openGuestDemoFlow() {
  const landing = document.getElementById('landingHero');
  const demo = document.getElementById('demoRequestSection');
  const faqPreview = document.getElementById('faqPreviewSection');
  const login = document.getElementById('loginSection');

  if (landing) landing.style.display = 'block';
  if (faqPreview) faqPreview.style.display = 'block';
  if (login) login.style.display = 'none';
  if (demo) {
    demo.style.display = 'block';
    requestAnimationFrame(() => {
      const top = Math.max(0, demo.offsetTop - 60);
      window.scrollTo(0, top);
    });
  }
}

// Expose function to window for onclick handlers
window.openGuestDemoFlow = openGuestDemoFlow;

function initializeGuestEntryFromUrl() {
  if (currentUser) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('showDemo') !== '1') return;

  openGuestDemoFlow();

  params.delete('showDemo');
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
  window.history.replaceState({}, document.title, nextUrl);
}

document.getElementById('clientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await withSubmitLock(e.target, async () => {
    const payload = Object.fromEntries(new FormData(e.target).entries());

    if (isDemo()) {
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
  }, 'Saving...');
});

document.getElementById('refreshClientsBtn').addEventListener('click', async () => {
  try {
    await refreshClients();
  } catch (err) {
    const list = document.getElementById('clientsList');
    if (list) list.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('clientsList')?.addEventListener('click', async (e) => {
  const actionButton = e.target.closest('[data-client-action]');
  if (actionButton) {
    const action = actionButton.getAttribute('data-client-action');
    const clientId = actionButton.getAttribute('data-client-id');
    if (!action || !clientId) return;

    try {
      await handleClientListAction(action, clientId);
    } catch (err) {
      showToast(err.message, 'error');
    }
    return;
  }

  const clientCard = e.target.closest('[data-client-open-id]');
  if (!clientCard) return;

  const clientId = clientCard.getAttribute('data-client-open-id');
  if (!clientId) return;

  try {
    await openClientWorkspace(clientId);
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('clientsList')?.addEventListener('keydown', async (e) => {
  if (!(e.key === 'Enter' || e.key === ' ')) return;

  const clientCard = e.target.closest('[data-client-open-id]');
  if (!clientCard) return;

  e.preventDefault();
  const clientId = clientCard.getAttribute('data-client-open-id');
  if (!clientId) return;

  try {
    await openClientWorkspace(clientId);
  } catch (err) {
    showToast(err.message, 'error');
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
  selectedAskPromptPhase = selectedTrainingContext;
  renderTraining(getActiveRole(), selectedTrainingContext);
  renderAskPromptLibrary();
});

document.getElementById('askPromptPhaseTabs')?.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-ask-phase]');
  if (!button) return;

  selectedAskPromptPhase = button.dataset.askPhase || 'pre_shift';
  selectedAskPromptGroup = '';
  renderAskPromptLibrary();
});

document.getElementById('askPromptSearch')?.addEventListener('input', (e) => {
  askPromptSearchTerm = String(e.target.value || '').trim();
  selectedAskPromptGroup = '';
  renderAskPromptLibrary();
});

document.getElementById('askPromptLibraryToggle')?.addEventListener('click', () => {
  isAskPromptLibraryCollapsed = !isAskPromptLibraryCollapsed;
  renderAskPromptLibrary();
});

document.getElementById('askPromptGroups')?.addEventListener('click', (e) => {
  const groupButton = e.target.closest('button[data-ask-group]');
  if (groupButton) {
    const nextGroup = groupButton.dataset.askGroup || '';
    selectedAskPromptGroup = selectedAskPromptGroup === nextGroup ? '' : nextGroup;
    renderAskPromptLibrary();
    return;
  }

  const button = e.target.closest('button.ask-prompt-chip[data-question]');
  if (!button) return;

  const textarea = document.querySelector('#askForm textarea');
  if (!textarea) return;
  textarea.value = button.dataset.question || '';
  textarea.focus();
});

document.getElementById('assignmentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await withSubmitLock(e.target, async () => {
    const payload = Object.fromEntries(new FormData(e.target).entries());
    if (isDemo() || String(payload.userId || '').startsWith('demo-') || String(payload.clientId || '').startsWith('demo-')) {
      setOutput('assignmentOutput', '');
      showToast('Assignment saved (demo mode — no real data was changed).', 'success');
      return;
    }
    try {
      await api('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setOutput('assignmentOutput', '');
      showToast('Assignment created successfully.', 'success');
      e.target.reset();
      await refreshClients();
    } catch (err) {
      setOutput('assignmentOutput', err.message);
    }
  }, 'Saving...');
});

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await withSubmitLock(e.target, async () => {
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
  }, 'Uploading...');
});

document.getElementById('askForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await withSubmitLock(e.target, async () => {
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

    if (isDemo()) {
      renderAskAnswer(buildDemoAskResponse({ clientId, question }));
      return;
    }

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
  }, 'Sending...');
});

// Sync askClientId into the form
document.getElementById('askClientId')?.addEventListener('change', () => {
  // No-op: clientId read directly from select on submit
});

// Chat starter buttons
document.getElementById('chatMessages')?.addEventListener('click', (e) => {
  const sourceBtn = e.target.closest('.source-tag-btn');
  if (sourceBtn) {
    const sourceMessageId = sourceBtn.dataset.sourceMessageId;
    const sourceIndex = Number(sourceBtn.dataset.sourceIndex || -1);
    const sourceList = chatSourceRegistry.get(sourceMessageId) || [];
    const source = sourceList[sourceIndex];
    if (source) {
      openSourcePreview(source);
    }
    return;
  }

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

document.getElementById('refreshCareModulesBtn')?.addEventListener('click', async () => {
  try {
    await loadTrackerFeed();
    renderCareModulesSection();
  } catch (err) {
    const grid = document.getElementById('careModulesGrid');
    if (grid) grid.innerHTML = `<p class="empty-state">${safeText(err.message)}</p>`;
  }
});

document.getElementById('reportingForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  await loadReportingSection({
    clientId: String(form.get('clientId') || ''),
    status: String(form.get('status') || ''),
    from: String(form.get('from') || ''),
    to: String(form.get('to') || '')
  });
});

document.getElementById('exportReportCsvBtn')?.addEventListener('click', () => {
  if (!currentReportPayload || !currentReportPayload.entries?.length) {
    showToast('Generate a report before exporting.', 'error');
    return;
  }

  const header = ['client', 'eventType', 'status', 'priority', 'summary', 'createdAt'];
  const rows = currentReportPayload.entries.map((entry) => {
    return [
      getClientNameById(entry.clientId),
      entry.eventType || '',
      entry.status || '',
      entry.priority || '',
      String(entry.summary || '').replaceAll('"', '""'),
      entry.createdAt || entry.updatedAt || entry.dueAt || ''
    ];
  });

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell)}"`).join(','))
    .join('\n');
  const stamp = new Date().toISOString().replaceAll(':', '-');
  downloadReportFile(csv, `synoracare-report-${stamp}.csv`, 'text/csv');
});

document.getElementById('exportReportJsonBtn')?.addEventListener('click', () => {
  if (!currentReportPayload) {
    showToast('Generate a report before exporting.', 'error');
    return;
  }

  const stamp = new Date().toISOString().replaceAll(':', '-');
  downloadReportFile(
    JSON.stringify(currentReportPayload, null, 2),
    `synoracare-report-${stamp}.json`,
    'application/json'
  );
});

document.getElementById('trackerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await withSubmitLock(e.target, async () => {
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
  }, 'Saving...');
});

document.getElementById('trackerStatusForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  if (isDemo() || String(payload.entryId || '').startsWith('demo-')) {
    showToast('Status updated (demo mode — no real data was changed).', 'success');
    return;
  }
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

  const entryId = button.dataset.entryId;
  if (isDemo() || String(entryId || '').startsWith('demo-')) {
    showToast('Status updated (demo mode — no real data was changed).', 'success');
    return;
  }

  try {
    await updateTrackerStatus(entryId, button.dataset.status);
    await loadTrackerFeed();
    await loadTrackerSummary();
  } catch (err) {
    const feed = document.getElementById('trackerFeed');
    if (feed) feed.innerHTML = `<p class="tracker-empty">${safeText(err.message)}</p>`;
  }
});

document.getElementById('breakGlassForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await withSubmitLock(e.target, async () => {
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
  }, 'Submitting...');
});

document.getElementById('legalRecordsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  await withSubmitLock(e.target, async () => {
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
  }, 'Generating...');
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

document.getElementById('patientWorkspaceClientId')?.addEventListener('change', async () => {
  if (!isDemo()) return;
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
  clearAuthSessionState();
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

// Source preview modal close behavior
document.querySelector('#sourcePreviewModal .modal-close')?.addEventListener('click', () => {
  const modal = document.getElementById('sourcePreviewModal');
  if (modal) modal.style.display = 'none';
});

document.getElementById('sourcePreviewModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'sourcePreviewModal') {
    e.currentTarget.style.display = 'none';
  }
});

document.getElementById('demoModeToggle')?.addEventListener('change', (e) => {
  if (!canToggleDemoMode()) {
    syncDemoToggle();
    return;
  }
  setDemoMode(e.target.checked);
  ensureDemoPatientWorkspaceLoaded();
});

document.getElementById('loginDemoModeToggle')?.addEventListener('change', (e) => {
  if (!canToggleDemoMode()) {
    syncDemoToggle();
    return;
  }
  setDemoMode(e.target.checked);
  ensureDemoPatientWorkspaceLoaded();
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
    const didNavigate = navigateTo(navBtn.dataset.navTarget);
    if (didNavigate && window.innerWidth <= 900) document.body.classList.remove('sidebar-open');
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
let voiceListening = false;
let voiceHadError = false;
let voiceBaseText = '';
let voiceFinalTranscript = '';
let voicePermissionStatus = null;
let voicePermissionState = 'unknown';

function getVoiceErrorMessage(errorCode) {
  const messages = {
    'not-allowed': 'Microphone access was blocked. Allow microphone access and try again.',
    'service-not-allowed': 'Speech recognition service is unavailable in this browser.',
    'no-speech': 'No speech detected. Please speak clearly and try again.',
    'audio-capture': 'No microphone was detected. Check your audio input settings.',
    'network': 'Speech service network issue. Check your connection and try again.',
    'aborted': 'Voice capture was stopped.'
  };
  return messages[errorCode] || `Voice input error: ${errorCode}`;
}

function getVoiceElements() {
  return {
    statusWrap: document.getElementById('voiceStatus'),
    statusText: document.getElementById('voiceStatusText'),
    voiceBtn: document.getElementById('voiceToTextBtn'),
    capabilityHint: document.getElementById('voiceCapabilityHint')
  };
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function setVoiceCapabilityHint(text, variant = 'caution') {
  const { capabilityHint } = getVoiceElements();
  if (!capabilityHint) return;

  capabilityHint.textContent = text;
  capabilityHint.classList.remove('is-ready', 'is-caution', 'is-error');
  capabilityHint.classList.add(
    variant === 'ready' ? 'is-ready' : variant === 'error' ? 'is-error' : 'is-caution'
  );
}

async function resolveVoicePermissionState() {
  const supportsPermissionsApi = Boolean(navigator.permissions && navigator.permissions.query);
  if (!supportsPermissionsApi) {
    voicePermissionStatus = null;
    voicePermissionState = 'unknown';
    return voicePermissionState;
  }

  try {
    if (!voicePermissionStatus) {
      voicePermissionStatus = await navigator.permissions.query({ name: 'microphone' });
      voicePermissionStatus.addEventListener('change', () => {
        voicePermissionState = voicePermissionStatus?.state || 'unknown';
        updateVoiceCapabilityHint();
      });
    }
    voicePermissionState = voicePermissionStatus?.state || 'unknown';
    return voicePermissionState;
  } catch (err) {
    voicePermissionStatus = null;
    voicePermissionState = 'unknown';
    return voicePermissionState;
  }
}

async function updateVoiceCapabilityHint() {
  const { voiceBtn } = getVoiceElements();
  if (!voiceBtn) {
    return { ready: false, message: 'Voice button not available.' };
  }

  const SpeechRecognition = getSpeechRecognitionCtor();
  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceBtn.title = 'Voice input is not supported in this browser.';
    setVoiceCapabilityHint('Voice unavailable in this browser. Use Chrome on desktop or Android.', 'error');
    return { ready: false, message: 'Voice input is not supported in this browser.' };
  }

  if (!window.isSecureContext) {
    voiceBtn.disabled = true;
    voiceBtn.title = 'Voice input requires HTTPS.';
    setVoiceCapabilityHint('Voice requires HTTPS. Open the secure app URL to use the mic.', 'error');
    return { ready: false, message: 'Voice input requires HTTPS.' };
  }

  const permissionState = await resolveVoicePermissionState();
  if (permissionState === 'denied') {
    voiceBtn.disabled = false;
    voiceBtn.title = 'Microphone blocked. Enable permission, then tap again to retry.';
    setVoiceCapabilityHint('Microphone access is blocked. Enable mic permission in browser settings, then tap the mic again to retry.', 'error');
    return { ready: false, message: 'Microphone permission is blocked.' };
  }

  voiceBtn.disabled = false;
  voiceBtn.title = 'Speak summary';

  if (permissionState === 'granted') {
    setVoiceCapabilityHint('Mic ready. Tap the mic and speak your tracker summary.', 'ready');
    return { ready: true, message: 'Microphone ready.' };
  }

  setVoiceCapabilityHint('Mic available. Tap the mic and allow permission when prompted.', 'caution');
  return { ready: true, message: 'Microphone permission will be requested when recording starts.' };
}

function setVoiceStatus(text, options = {}) {
  const { isError = false, visible = true } = options;
  const { statusWrap, statusText, voiceBtn } = getVoiceElements();
  if (!statusWrap || !statusText || !voiceBtn) return;

  statusText.textContent = text;
  statusWrap.style.display = visible ? 'flex' : 'none';
  statusWrap.classList.toggle('is-error', isError);
  voiceBtn.classList.toggle('is-listening', voiceListening);
  voiceBtn.setAttribute('aria-pressed', voiceListening ? 'true' : 'false');
}

function getVoiceTargetField() {
  return document.querySelector('#trackerForm input[name="summary"]')
    || document.querySelector('#trackerForm textarea[name="details"]');
}

function normalizeVoiceText(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function applyVoiceTranscript(transcript) {
  const target = getVoiceTargetField();
  if (!target) return;

  const combined = [voiceBaseText, transcript].filter(Boolean).join(' ').trim();
  target.value = normalizeVoiceText(combined);
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function initVoiceToText() {
  const SpeechRecognition = getSpeechRecognitionCtor();
  if (!SpeechRecognition) {
    showToast('Voice input is not supported in this browser. Try Chrome on desktop or Android.', 'info');
    return false;
  }

  voiceRecognition = new SpeechRecognition();
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = true;
  voiceRecognition.maxAlternatives = 1;
  voiceRecognition.lang = 'en-US';

  voiceRecognition.onstart = function() {
    voiceListening = true;
    voiceHadError = false;
    voiceFinalTranscript = '';
    const target = getVoiceTargetField();
    voiceBaseText = target ? String(target.value || '').trim() : '';
    setVoiceStatus('Listening... Tap the mic again to stop.');
  };

  voiceRecognition.onresult = function(e) {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const piece = String(e.results[i][0]?.transcript || '').trim();
      if (!piece) continue;
      if (e.results[i].isFinal) {
        voiceFinalTranscript = `${voiceFinalTranscript} ${piece}`.trim();
      } else {
        interim = `${interim} ${piece}`.trim();
      }
    }

    const liveTranscript = `${voiceFinalTranscript} ${interim}`.trim();
    applyVoiceTranscript(liveTranscript);
    if (liveTranscript) {
      setVoiceStatus('Transcribing...');
    }
  };

  voiceRecognition.onerror = function(e) {
    voiceHadError = true;
    voiceListening = false;
    const message = getVoiceErrorMessage(e.error);
    setVoiceStatus(message, { isError: true, visible: true });
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      voicePermissionState = 'denied';
      updateVoiceCapabilityHint();
    }
    if (e.error !== 'aborted') {
      showToast(message, 'error');
    }
  };

  voiceRecognition.onend = function() {
    voiceListening = false;
    const hasTranscript = Boolean(voiceFinalTranscript.trim());

    if (voiceHadError) {
      setTimeout(() => setVoiceStatus('', { visible: false }), 2200);
      return;
    }

    if (hasTranscript) {
      setVoiceStatus('Voice captured.', { visible: true });
      setTimeout(() => setVoiceStatus('', { visible: false }), 1200);
      return;
    }

    setVoiceStatus('No speech captured. Try again and speak clearly.', { isError: true, visible: true });
    setTimeout(() => setVoiceStatus('', { visible: false }), 2200);
  };

  return true;
}

document.getElementById('voiceToTextBtn')?.addEventListener('click', async (e) => {
  e.preventDefault();

  const voicePreflight = await updateVoiceCapabilityHint();
  if (!voicePreflight.ready) {
    showToast(voicePreflight.message, 'error');
    return;
  }

  if (!voiceRecognition && !initVoiceToText()) {
    return;
  }

  if (!voiceRecognition) {
    return;
  }

  if (voiceListening) {
    voiceRecognition.stop();
    return;
  }

  try {
    voiceRecognition.start();
  } catch (err) {
    const message = err?.name === 'InvalidStateError'
      ? 'Voice capture is already active. Tap the mic again to stop.'
      : 'Unable to start voice capture. Please try again.';
    showToast(message, 'error');
    setVoiceStatus(message, { isError: true, visible: true });
  }
});

updateVoiceCapabilityHint();

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
    // Only render demo data in demo mode; non-demo mode shows empty state
    if (isDemo()) {
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
    } else {
      if (container) container.innerHTML = '<p style="color: var(--muted); font-size: 12px; padding: 8px;">Unable to load shift data</p>';
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
    // Only render demo data in demo mode; non-demo mode shows empty state
    if (isDemo()) {
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
    } else {
      // Non-demo mode: show empty state on error
      document.getElementById('activeShiftCount').textContent = '0';
      document.getElementById('endedShiftCount').textContent = '0';
      document.getElementById('totalEntriesCount').textContent = '0';
      document.getElementById('escalationCount').textContent = '0';
      const container = document.getElementById('activeShiftsContainer');
      if (container) container.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--muted);">Unable to load shift data</p>';
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
  const navigatedPage = originalNavigateTo.call(this, pageId);
  if (!navigatedPage || navigatedPage !== pageId) return;

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
  if (!currentUser || !canUseRoleSwitcher()) {
    showToast('Only super admins can switch roles.', 'error');
    return;
  }

  const newRole = e.target.value;
  if (!newRole) return;

  roleViewOverride = newRole === 'super_admin' ? null : newRole;
  updateSession();
  await refreshAllPickers();
  showToast(`Viewing as ${getRoleDisplayLabel(getActiveRole())}`, 'success');
});

document.getElementById('roleLabelsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = Object.fromEntries(new FormData(e.target).entries());
  const payload = {
    roleDisplayLabels: {
      dsp: String(formData.dsp || '').trim(),
      supervisor: String(formData.supervisor || '').trim(),
      org_admin: String(formData.org_admin || '').trim(),
      super_admin: String(formData.super_admin || '').trim()
    }
  };

  const output = document.getElementById('roleLabelsOutput');

  try {
    const data = await api('/api/auth/role-labels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    orgRoleDisplayLabels = {
      ...DEFAULT_ROLE_DISPLAY_LABELS,
      ...(data.roleDisplayLabels || {})
    };

    renderRoleLabelSettings();
    updateSession();
    syncUserPicker();
    renderUserList(usersCache);

    if (output) output.textContent = 'Role labels updated successfully.';
    showToast('Role labels updated.', 'success');
  } catch (err) {
    if (output) output.textContent = `Failed to update labels: ${err.message}`;
    showToast(err.message, 'error');
  }
});

updateSession();
initializeInviteAndResetFromUrl();
initializeGuestEntryFromUrl();
fetchAndShowVersion();
ensureDemoPatientWorkspaceLoaded();
if (currentUser && token) {
  applyAuthUserContext(currentUser);
  loadAuthContext();
}

if (currentUser && token) {
  refreshAllPickers().catch(() => {
    clearAuthSessionState();
    updateSession();
  });
}
