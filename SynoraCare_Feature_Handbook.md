# SynoraCare Feature Handbook

This handbook explains what each major feature, section, and button in the SynoraCare web app does. It is intended for onboarding, internal training, and quick-reference support.

## How to Read This Guide

- Guest mode refers to the public-facing experience before sign-in.
- Authenticated mode refers to the application after a user signs in.
- Some navigation items are role-based and only appear for supervisors or admins.
- Demo Mode shows sample data and lets teams explore the product without changing live records.

## Global Header And Navigation

### Sidebar Toggle

- Sidebar Toggle: Opens or closes the sidebar on smaller screens.

### Topbar Items

- SynoraCare AI logo: Returns the user to the main app context visually and anchors the header.
- Version badge: Displays the current app version when backend status data is available.
- Session info: Shows whether the user is signed in and, when authenticated, reflects the current user context.
- Demo toggle: Turns Demo Mode on or off when the current session is allowed to use sample data.
- Sign Out: Clears the active session, resets in-memory data, and returns the app to guest mode.

### Sidebar Navigation Buttons

- Dashboard: Opens the home dashboard with welcome text, role-specific shortcuts, summary cards, and alerts.
- Ask AI: Opens the grounded Q and A workspace for asking questions about a selected client.
- Tracker: Opens the patient tracker feed, summary, and event logging forms.
- Patient: Opens the patient workspace where records are grouped into domain tabs.
- Documents: Opens the document upload workflow for care files such as ISP, MAR, and behavior plans.
- Assign: Opens the assignment form used to link staff members to clients.
- Team: Opens the team invitation and team list section.
- Clients: Opens the client creation and client list section.
- Break Glass: Opens the emergency access workflow for temporary elevated access.
- Audit: Opens the audit log review section.
- Legal: Opens the legal records export section.
- Training: Opens the micro-training section with role-aware guidance.

## Guest Mode Features

### Landing Hero

- Book Demo: Opens the demo request form and scrolls the user directly to it.
- Request Pilot: Opens the same request form and positions the user at that section.
- See How It Works: Opens the request form as an entry point for product follow-up.
- Faster Decisions badge: Communicates the product value around speed of decision-making.
- Less Paperwork badge: Communicates the product value around reducing manual overhead.
- More Confidence badge: Communicates the product value around safer, more consistent care execution.

### Demo Request Form

- Organization Name: Captures the requesting organization.
- Your Name: Captures the requestor's name.
- Email: Captures the contact email for follow-up.
- Phone: Captures an optional phone number.
- What are you interested in?: Tags the request as a demo, pilot, or walkthrough inquiry.
- Tell us a bit about your team: Captures optional context about team size, care setting, or needs.
- Send Request: Submits the request to the backend contact workflow.
- Close: Hides the demo request form.

### Organization Setup

- Organization Name: Sets the organization display name.
- organization-slug: Sets the URL-friendly or internal slug used for org setup.
- State Code: Stores a two-letter state reference for retention and compliance logic.
- Admin Full Name: Sets the first administrator's name.
- Admin email: Sets the first administrator's email.
- Password: Sets the first administrator's password.
- Create Organization: Boots the first organization and admin account, then signs the user in.

### Login Card

- Email Address: Captures the sign-in email.
- Password: Captures the sign-in password.
- Toggle password visibility: Switches the password input between masked and visible states.
- Login: Authenticates the user and loads the authenticated app state.
- Forgot Password?: Opens or closes the password reset panel and prefills the email when possible.
- Admin Recovery: Opens or closes the admin recovery panel for recovery-key-based reset.
- Request a demo link: Switches from the login card to the demo request flow.
- Demo View (Sample Data): Enables Demo Mode from the login screen so the product can be previewed with sample data.

### Password And Account Recovery Panels

- Reset Password panel: Issues a short-lived reset token and completes a password reset flow.
- Email address in Reset Password: Specifies the account to reset.
- New password in Reset Password: Sets the replacement password.
- Reset Password button: Completes the forgot-password reset flow.
- Complete Your Invitation panel: Lets invited users activate their account using the invite token in the URL.
- Full name in invitation panel: Records the invited staff member's name.
- Email in invitation panel: Shows the invited account email as read-only.
- Password in invitation panel: Sets the invited user's password.
- Accept terms checkbox: Confirms organization security and compliance terms.
- Activate Account: Finishes account activation and signs the invited user in.
- Admin Account Recovery panel: Lets an administrator recover access using a recovery key.
- Admin email: Identifies the admin account.
- New password in admin recovery: Sets the replacement admin password.
- Recovery key: Authenticates the recovery attempt.
- Reset And Sign In: Completes account recovery and signs the user in immediately.

## Authenticated Dashboard

### Dashboard Elements

- Welcome message: Personalizes the dashboard using the signed-in user's name.
- Role tag: Shows the active role, such as DSP, Supervisor, or Organization Admin.
- Clients stat card: Shows the current number of clients and opens the Clients section when selected.
- Pending stat card: Shows pending tracker entries and opens Tracker filtered to pending items.
- Escalated stat card: Shows escalated tracker entries and opens Tracker filtered to escalated items.
- Completed stat card: Shows completed tracker entries and opens Tracker filtered to completed items.

### Role-Based Quick Actions

- Ask Grounded Q and A: Takes a DSP directly to the Ask AI page.
- Log Event: Takes a DSP directly to Tracker.
- Emergency Access: Takes a DSP directly to Break Glass.
- My Training: Takes a DSP directly to Training.
- Review Tracker: Takes a supervisor directly to Tracker.
- Upload Document: Takes a supervisor directly to Documents.
- Assign DSP: Takes a supervisor or admin directly to Assign.
- Audit Log: Takes a supervisor or admin directly to Audit.
- Add Team Member: Takes an admin directly to Team.
- Add Client: Takes an admin directly to Clients.
- Legal Export: Takes an admin directly to Legal.

### Dashboard Alerts

- Get started hint: Appears for admins when no clients exist and includes an Add First Client shortcut.
- Add First Client: Scrolls the user to the client creation section.
- Escalated item alerts: Show the most urgent escalated tracker items requiring attention.

## Ask AI

- Select Client: Chooses which client's documents and records will ground the answer.
- Refresh clients: Reloads the client list used in the selector.
- Morning meds schedule: Inserts a starter question about medication timing into the Ask AI text box.
- Bathing assistance: Inserts a starter question about personal care support.
- Escalation steps: Inserts a starter question about escalation protocol.
- Dietary needs: Inserts a starter question about diet restrictions or preferences.
- Ask question text area: Lets the user type a freeform grounded question.
- Send: Submits the question to the backend ask workflow.
- AI answer bubble: Displays the returned answer.
- Source tags: Show which documents or sources informed the answer.

## Training

- Pre-Shift: Shows checklist and reminders for the start of a shift.
- Documentation: Shows guidance focused on accurate and compliant recordkeeping.
- Grounded Q and A: Shows guidance for using the Ask AI workflow responsibly.
- Escalation: Shows guidance for urgent or higher-risk scenarios.
- Checklist panel: Displays action steps for the selected training context.
- Policy reminders panel: Displays policy-level reminders for the selected context.
- In-the-moment guidance panel: Displays practical tips relevant to the selected context.

## Team Members

- Full Name: Captures the invited staff member's name.
- Email: Captures the invited staff member's email.
- Role selector: Assigns the invited user a role such as Org Admin, Supervisor, or DSP.
- Create Invite: Creates an invitation link for the new user.
- Invite output: Displays the generated invite link for sharing.
- Team list: Displays current team members, their role, status, and email.

## Clients

- Refresh: Reloads the client list from the current data source.
- Client Name: Sets the client's display name.
- External ID: Stores an optional external or legacy identifier.
- Add Client: Creates a client record.
- Client List: Displays all current clients.

### Demo Mode Behavior In Clients

- Add Client in Demo Mode: Creates a local sample client instead of calling the live API.
- Refresh in Demo Mode: Reloads the locally stored demo clients.

## Assign DSP

- Refresh Users: Reloads the staff selector.
- Refresh Clients: Reloads the client selector.
- Select User: Chooses the staff member being assigned.
- Select Client: Chooses the client receiving the assignment.
- Expiration date and time: Optionally limits how long the assignment remains active.
- Create Assignment: Saves the user-to-client assignment.
- Assignment output: Displays the API response or any error details.

## Upload Care Document

- Refresh Clients: Reloads the client selector for uploads.
- Sample TXT: Downloads or generates a sample text document for testing uploads.
- Sample PDF: Downloads or generates a sample PDF document for testing uploads.
- Select Client: Chooses the client the document belongs to.
- Document type: Classifies the file as ISP, MAR, Behavior Plan, Care Plan, or Other.
- Document Title: Names the uploaded document.
- Effective Date: Stores an optional effective date.
- Document file picker: Selects the file to upload.
- Upload Document: Sends the document to the backend upload endpoint.
- Upload output: Displays the upload result or any error details.

## Patient Tracker

### Header Controls

- Refresh Feed: Reloads tracker entries in the event feed.
- Summary: Reloads tracker summary statistics.

### Summary Cards

- Total: Shows total tracker entries returned in the summary.
- Pending: Shows how many entries remain pending.
- Completed: Shows how many entries are completed.
- Escalated: Shows how many entries are escalated.
- Overdue: Shows how many entries are overdue.

### Log Event Form

- Select Client: Chooses the client tied to the tracker event.
- Event Type: Classifies the entry as Medication, ADL, Behavior, Incident, Note, or Handoff.
- Priority: Sets urgency from Low through Urgent.
- Status: Sets the current state as Pending, Completed, or Escalated.
- Summary: Captures the short headline for the event.
- Optional details: Captures longer notes and context.
- Photo: Attaches an optional image from a device or file picker.
- Photo caption: Adds an optional caption to the attached image.
- Due date and time: Sets a target time for follow-up.
- Log Entry: Creates the tracker record, then refreshes the feed and summary.

### Update Status Form

- Entry ID: Specifies which tracker item should be updated.
- Status selector: Chooses the new status value.
- Update: Applies the status change and refreshes the tracker feed and summary.

### Event Feed Actions

- Event Feed: Lists recent tracker entries.
- View photo button: Appears on entries that include a photo and opens the associated image.
- Inline status buttons: Appear on tracker entries and let users quickly change status to the offered value.

## Patient Workspace

- Select Client: Chooses which patient's records to review.
- Load Patient: Loads tracker-derived patient records into the workspace.
- Care tab: Shows ADL, handoff, note, and other general care records.
- Nutrition tab: Shows entries related to food, diet, fluids, or hydration.
- Medications tab: Shows medication-related entries.
- Behavior tab: Shows behavior and incident entries.
- Safety tab: Shows escalated, urgent, or high-priority entries.
- Legal tab: Explains that legal review is handled through the Legal Records Export section.
- Patient record cards: Show summary, type, status, priority, and update time for each matching entry.

## Emergency Break-Glass

- Select Client: Chooses which client needs emergency access.
- Duration (minutes): Sets how long the temporary emergency access should last.
- Emergency reason: Captures the mandatory justification for the break-glass event.
- Grant Temporary Access: Sends the emergency access request to the backend.
- Break-glass output: Displays the result of the access grant request.

## Audit Log

- Load Audit Log: Retrieves recent security and access-related audit events.
- Audit event type: Shows the type of event that was recorded.
- Audit event time: Shows when the event occurred.
- Audit event user: Shows the user associated with the event.

## Legal Records Export

- Select Client: Chooses which client record set to export.
- State code: Sets or overrides the state used for retention policy logic.
- Override years: Optionally overrides the calculated retention period.
- Include audit events: Includes or excludes audit data from the export package.
- Generate Legal Export: Builds a legal export package and preview summary.
- Download Export JSON: Downloads the generated export package as JSON after an export is available.
- Legal summary list: Shows retention policy details, cutoff date, counts, and target client.

## Demo Mode

- Demo Mode toggle: Enables sample-data exploration without depending on live records.
- Login-screen Demo Mode toggle: Enables the same sample-data mode before sign-in.
- Demo clients: Can be created locally so the app remains functional during a demo.
- Demo experience: Helps teams explore navigation, dashboards, Ask AI, training, and client workflows safely.

## Role Visibility Notes

- DSP users focus on care execution tools such as Ask AI, Tracker, Training, Patient Workspace, and Break Glass.
- Supervisor users gain access to document upload, staff assignment, and audit review.
- Org Admin and Super Admin users gain access to team management, client management, assignments, legal export, and audit workflows.

## Operational Notes

- Most refresh buttons reload cached selectors or lists after data changes.
- Most form submission buttons either show toast feedback or render the API response in an output area.
- Sign Out clears session state, client cache, user cache, legal export state, patient workspace state, and visible data panels.
- Escape closes the mobile sidebar when it is open.

## Recommended Use For New Teams

1. Use Demo Mode to explore the interface safely.
2. Create your organization only once during first-time setup.
3. Invite team members before assigning them to clients.
4. Add clients before uploading documents or creating assignments.
5. Use Tracker for day-to-day operational logging.
6. Use Ask AI only after selecting the correct client.
7. Use Break Glass only for real emergencies.
8. Use Legal Export when records need retention-aware packaging for review.