# SynoraCare Demo Mode Setup Guide

## Overview

SynoraCare supports two distinct data modes for testing and customer demonstrations:

1. **Non-Demo Mode** (Production/Testing): Clean database state. Users must explicitly add clients, homes, staff, and data.
2. **Demo Mode** (Customer Pitches): Pre-loaded with realistic sample data for customer demonstrations.

---

## Demo Mode Architecture

### Demo Data (Client-Side Only)

- **Location**: `/frontend/app.js` lines 195-700
- **Data Models**:
  - 3 Sample Clients: Jordan Miles, Avery Brooks, Taylor Reed
  - 3 Sample Homes: Sunrise Home, Peaceful Haven, Community Living
  - 5 Sample Users: DSPs, Supervisors, and Org Admins
  - 10+ Sample Tracker Entries: Medications, behaviors, ADLs, incidents with varying statuses
  - Detailed Care Plans: Medical info, dietary needs, transfer assistance requirements

### Demo Toggle Mechanism

- **UI Location**: Top-right corner (checkbox labeled "Demo")
- **Availability**: Super Admin users only
- **Persistence**: Stored in browser `localStorage` as `synoracare_demo_mode`
- **URL Override**: Can enable via `?demo=1` URL parameter

### Demo Mode Behavior

When demo mode is **ON**:
- All API calls are intercepted at the frontend
- Sample data is returned instead of making backend requests
- `refreshClients()`, `refreshUsers()`, `loadTrackerSummary()`, etc. serve demo data
- No database writes occur; all changes are ephemeral (lost on refresh)
- localStorage key: `synoracare_demo_clients` (optional client modifications)

When demo mode is **OFF**:
- All API calls go to the real backend
- Database reflects actual data (starts empty unless explicitly added)
- Behavior matches production environment

---

## Using Demo Mode

### For Internal Testing

1. **Log in as a Super Admin** (e.g., `terrasample@yahoo.com`)
2. **Toggle the Demo checkbox** in the top-right corner
3. **Interact with realistic sample data** to test workflows
4. **Toggle off** to return to empty production state

### For Customer Pitches

#### Option 1: Manual Toggle (Recommended)
1. Create a super_admin test account (e.g., `demo@company.com / DemoPassword123`)
2. Log in as that user
3. **Toggle demo mode ON** when presenting to customers
4. Show realistic workflows with sample clients, tracking entries, reports, etc.
5. Toggle OFF before returning to the system

#### Option 2: Auto-Demo Account (Future)
If you want a dedicated demo account that auto-loads with demo mode enabled:

```javascript
// Modify frontend/app.js login handler:
const AUTO_DEMO_EMAILS = new Set(['demo@company.com']);

if (AUTO_DEMO_EMAILS.has(String(payload.email).toLowerCase())) {
  setDemoMode(true);  // Auto-enable demo mode for this account
}
```

---

## Demo Data Quality

The demo data is curated for customer pitches and includes:

### Clients
- Realistic names and IDs
- Clear status indicators (active)
- Multiple locations for organizational complexity
- External ID references (SC-1001, SC-1002, etc.)

### Homes/Locations
- Realistic addresses and phone numbers
- Capacity constraints (4 clients max per home)
- Professional names (Sunrise Home, Peaceful Haven, Community Living)
- Active status for consistent state

### Users
- Diverse roles (DSP, Supervisor, Org Admin)
- Different responsibility levels
- Realistic email addresses (.synoracare.demo domain)
- Multiple entries to show team structures

### Tracker Entries
- Medical issues (medication reminders, vital signs)
- Behavioral incidents (escalations, notes)
- ADL tracking (activities of daily living)
- Incident reports with timestamps
- Mixed statuses (pending, escalated, completed)

### Care Plans
- Medication regimens with interaction notes
- Dietary requirements (allergies, preferences)
- Transfer/mobility assistance needs
- Mental health considerations
- Communication preferences

---

## Database State Management

### Non-Demo (Production)

**Initial State**: Empty organization with no clients or data
**Setup**: 
1. Create organization during bootstrap
2. Create super_admin user
3. Manually add clients, homes, staff as needed

**Data Persistence**: All changes persisted to MongoDB

### Demo (Testing)

**Initial State**: Predetermined sample data (client-side only)
**Setup**: 
1. Log in as super_admin
2. Toggle demo mode ON
3. Sample data immediately available for testing

**Data Persistence**: Changes stored in browser localStorage only (not saved to backend)

---

## Important Notes

### Security
- Demo mode toggle is restricted to `super_admin` users only
- Cannot be enabled by regular DSP, Supervisor, or Org Admin roles
- Demo data never touches the production database (client-side only)

### Performance
- Demo data is hardcoded and loads instantly (no API calls)
- Suitable for live customer demonstrations without backend latency
- Ideal for showcasing UI responsiveness and features

### Customization
To customize demo data for your needs:
1. Edit `/frontend/app.js` lines 195-700
2. Modify `DEMO_CLIENTS`, `DEMO_HOMES`, `DEMO_USERS`, tracker entries
3. Ensure realistic, professional sample data
4. Test thoroughly before customer demonstrations

---

## Troubleshooting

### Demo data not showing?
- Verify you're logged in as `super_admin`
- Check that demo toggle checkbox is actually checked
- Clear browser cache and localStorage: `localStorage.removeItem('synoracare_demo_mode')`
- Refresh the page

### Non-demo mode showing old data?
- Verify demo toggle is unchecked
- Check browser console for errors
- Ensure backend is running (`npm run start` from `/backend`)
- Verify MongoDB connection

### Demo mode persisting after logout?
- Demo state is stored in browser localStorage
- It will persist across sessions for the same user
- Clear localStorage if you want to reset: `localStorage.removeItem('synoracare_demo_mode')`

---

## Future Enhancements

- [ ] Add seed script to populate backend demo organizations
- [ ] Create dedicated demo accounts in database
- [ ] Add demo data export/import functionality
- [ ] Extend demo data with more realistic industry examples
- [ ] Add "Reset Demo Data" button for consistent demonstrations

