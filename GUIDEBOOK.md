# SynoraCare Guidebook

## 1) Purpose
SynoraCare is a care-operations platform for healthcare and disability support teams.
It combines:
- operational workflows (clients, staffing, assignments)
- clinical operations logging (tracker)
- document-grounded AI support (Ask AI)
- governance and compliance tools (audit log, legal export, break-glass)

## 2) Core Roles
- Super Admin: organization setup, global oversight, user/client governance, legal/audit controls
- Org Admin: day-to-day admin control, staffing and care operations
- Supervisor: care coordination, assignments, operational monitoring
- DSP: assigned-client execution, tracker updates, safe escalation

## 3) Main Product Areas
- Dashboard: top-level status and quick actions
- Ask AI: grounded care Q&A using uploaded documents
- Tracker: event logging (medication, ADL, behavior, incident, handoff)
- Patient Workspace: patient-specific tabbed workspace
- Documents: care-document upload and classification
- Assign: user-client assignment workflows
- Team: user invite and role management
- Clients: client profile and lifecycle management
- Break Glass: emergency temporary access (fully audited)
- Audit: security and operational event review
- Legal: legal record export with retention policy context
- Training: role-based micro-training guidance

## 4) Recommended First-Time Operational Flow
1. Bootstrap organization and super admin
2. Add team members (Org Admin, Supervisor, DSP)
3. Add clients
4. Create assignments (who supports whom)
5. Upload core docs (ISP, MAR, care plans)
6. Use Ask AI for grounded guidance
7. Run daily operations in Tracker + Patient Workspace
8. Monitor Audit and use Legal export when needed

## 5) Dashboard: Should Cards Be Clickable?
Yes. The four stat cards should be clickable and should act as primary navigation filters.
Cards:
- Clients
- Pending
- Escalated
- Completed

If cards are not clickable, users lose the fastest path from summary -> action.

## 6) Dashboard Flow Specification

### A) Clients card
Intent: move from high-level count to client management.
On click:
1. Navigate to Clients page
2. Preserve context with optional URL/query state: metric=clients
3. Pre-focus client list and show sort by recent activity (if available)

Expected user outcome:
- quickly identify client roster
- add/edit/search clients

### B) Pending card
Intent: triage outstanding operational work.
On click:
1. Navigate to Tracker page
2. Auto-apply status filter: pending
3. Sort by priority desc, dueAt asc
4. Highlight overdue items first

Expected user outcome:
- quickly resolve unfinished tasks

### C) Escalated card
Intent: immediate risk/safety response.
On click:
1. Navigate to Tracker page
2. Auto-apply status filter: escalated
3. Sort by newest first (or highest severity first)
4. Show escalation reason and latest owner/update clearly

Expected user outcome:
- rapid visibility into high-risk/open escalations
- faster handoff and closure

### D) Completed card
Intent: review completed operational activity.
On click:
1. Navigate to Tracker page
2. Auto-apply status filter: completed
3. Default to recent 7 or 30 days (configurable)
4. Keep export/share actions visible for reporting

Expected user outcome:
- confirm throughput and closure quality

## 7) Interaction Rules for All Dashboard Cards
- Entire card should be clickable (not just number text)
- Hover/active state should clearly indicate interactivity
- Keyboard accessible: tab focus + Enter/Space activation
- Include aria-label, for example: "View pending tracker entries"
- Mobile: card tap target should be at least 44px height
- Empty state handling:
  - if value is 0, still navigate and show an empty-state message with next action

## 8) Suggested Empty-State Messages
- Clients = 0: "No clients yet. Add your first client to begin care workflows."
- Pending = 0: "No pending tracker items. Great job staying current."
- Escalated = 0: "No active escalations. Continue routine monitoring."
- Completed = 0: "No completed items in the selected period yet."

## 9) What Success Looks Like on the Dashboard Page
- User understands system status in under 5 seconds
- Each summary card leads directly to actionable work
- No dead-end metrics
- Flow is summary -> filtered queue -> action -> updated dashboard count

## 10) QA Checklist for Dashboard Flow
- Clicking Clients opens Clients section and shows list
- Clicking Pending opens Tracker filtered to pending
- Clicking Escalated opens Tracker filtered to escalated
- Clicking Completed opens Tracker filtered to completed
- Browser refresh preserves filter state when possible
- Back button returns to dashboard without losing context unexpectedly
- All interactions work on desktop and mobile
- Keyboard-only navigation works for cards

## 11) Product Decision
Decision: make Clients, Pending, Escalated, and Completed cards clickable.
Reason: these are operational counters, and operators need direct drill-down from signal to action.
