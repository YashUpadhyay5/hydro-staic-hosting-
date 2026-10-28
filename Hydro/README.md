# Hydro HRMS Application

A modern Web-based HRMS Admin Dashboard & Location Tracking Management System.

---

## 🚀 Quick Start Guide

### 1. Requirements & Prerequisites
- **Node.js**: v18.x or higher (Node v22 supported)
- **NPM**: v9.x or higher

### 2. Environment Setup & Configuration
- **Backend Configuration (`backend/.env`)**:
  ```env
  STORAGE_PATH=../storage
  PORT=8000
  JWT_SECRET=super_secret_hrms_token_key_2026
  ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://45.122.121.237:5173
  ```

### 3. Running the Application
The project consists of two services that must be run simultaneously:

#### Step A: Start Backend Express Server
```bash
cd backend
npm start
```
*Running on `http://localhost:8000` (API base: `http://localhost:8000/api`)*

#### Step B: Start Frontend Vite Server
```bash
cd frontend
npm run dev
```
*Running on `http://localhost:5173`*

---

## 🔐 Default Admin Login Credentials

- **Email**: `admin@hrms.com`
- **Password**: `password123`

---

## 📁 Repository Directory Structure

```
Hydro/
├── backend/                  # Express Node.js REST API Server
│   ├── src/
│   │   ├── app.js            # Express app configuration & middleware registration
│   │   ├── server.js         # HTTP server entrypoint (PORT 8000)
│   │   ├── modules/
│   │   │   ├── auth/         # Login & JWT token authentication routes
│   │   │   ├── hrms/         # Employee, Attendance, Footprint, Leave, Expense, Geofence modules
│   │   │   └── payroll/      # Salary structure & payroll processing routes
│   │   └── shared/models/    # Sequelize ORM Models (Employee, Footprint, Geofence, etc.)
├── frontend/                 # React 19 + Vite Frontend SPA
│   ├── index.html            # Main HTML document with Leaflet JS/CSS imports
│   └── src/
│       ├── Routes.jsx        # Top-level React Router protection & module loader
│       └── modules/hrms/
│           ├── HrmsModule.jsx# Main HRMS module shell, layout, and view switcher
│           ├── components/
│           │   ├── Sidebar.jsx # Navigation sidebar menu items
│           │   └── views/    # Page views (Dashboard, Employees, Geofence, SiteInfo, etc.)
│           └── services/api.js# Frontend API Service client (connects to http://<hostname>:8000/api)
└── storage/                  # SQLite DB (`database.sqlite`) & persistent media uploads
```

---

## 🛠️ Instructions for AI Agents: How to Add New Sidebar Views & Routes

When an AI agent or developer needs to add a new page/route (such as a custom sidebar analytics module):

### Step 1: Create the View Component
Create a new React component under `frontend/src/modules/hrms/components/views/<NewView>.jsx`.

*Example (`frontend/src/modules/hrms/components/views/MyCustomView.jsx`):*
```jsx
import React from 'react';

export default function MyCustomView() {
    return (
        <div id="my-custom-view" className="view active">
            <div className="glass" style={{ padding: '20px' }}>
                <h3>My Custom Module</h3>
            </div>
        </div>
    );
}
```

### Step 2: Add Entry to Sidebar Navigation (`Sidebar.jsx`)
In `frontend/src/modules/hrms/components/Sidebar.jsx`, locate the `navItems` array and add your item with a unique `id`, human-readable `label`, and FontAwesome `icon`:

```jsx
const navItems = [
    // ...
    { id: 'geofence-view', label: 'Geofence', icon: 'fa-draw-polygon' },
    { id: 'site-info-view', label: 'Site Info', icon: 'fa-map-location-dot' }, // Example custom view
    // ...
];
```

### Step 3: Register Route & Component in `HrmsModule.jsx`
Open `frontend/src/modules/hrms/HrmsModule.jsx` and make the following updates:

1. **Import Component**:
   ```jsx
   import MyCustomView from './components/views/MyCustomView';
   ```

2. **Update `getInitialView`**:
   ```jsx
   const getInitialView = () => {
       const path = window.location.pathname;
       if (path === '/hrms/my-custom' || path === '/my-custom') return 'my-custom-view';
       // ...
   };
   ```

3. **Update `getPathForView`**:
   ```jsx
   const getPathForView = (view) => {
       if (view === 'my-custom-view') return '/hrms/my-custom';
       // ...
   };
   ```

4. **Update `getViewTitle`**:
   ```jsx
   const titleMap = {
       'my-custom-view': 'My Custom Module Title',
       // ...
   };
   ```

5. **Render View Component**:
   ```jsx
   <div className="content-wrapper">
       {currentView === 'my-custom-view' && <MyCustomView />}
   </div>
   ```

---

## 📌 Reference Implementation: Site Info & GPS Geofence Analytics

### Feature Requirements Overview
- **Location in Sidebar**: Positioned directly beneath **Geofence** (`site-info-view`).
- **Functionality**:
  1. Select an Employee and Date.
  2. Load footprint history via `api.getFootprintHistory(employeeId, date)`.
  3. **Strict GPS Filter**: Only process records where `trackingMethod === 'GPS'` (ignoring Cellular/Network logs).
  4. Calculate distance to office geofences (`api.getGeofences()`) using the Haversine formula.
  5. Compute aggregate **Inside Geofence Time** vs **Outside Geofence Time**.
  6. Calculate per-geofence **Arrival Time** (first GPS ping inside), **Leaving Time** (last GPS ping inside), and **Spending Time** (total duration).
  7. Render side-by-side view with summary cards, visited geofence cards on the left, and interactive Leaflet map on the right.

### Core Files Modified/Created:
- **[NEW] Component**: `frontend/src/modules/hrms/components/views/SiteInfoView.jsx`
- **Sidebar**: `frontend/src/modules/hrms/components/Sidebar.jsx`
- **Module Shell**: `frontend/src/modules/hrms/HrmsModule.jsx`

---

## 🧪 Verification & Build Commands

- **Build Verification**:
  ```bash
  cd frontend
  npm run build
  ```
- **Backend API Smoke Test (PowerShell)**:
  ```powershell
  Invoke-RestMethod -Uri http://localhost:8000/api/auth/status
  ```
