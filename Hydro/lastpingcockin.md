# Home Geofence Clock-In & Departure Ping Tracking (`lastpingcockin.md`)

## 1. Overview & Objective

In remote and field operations, field staff often open the mobile app and punch **Clock In** while still inside their house (e.g., at 08:00 AM). However, they frequently spend additional time preparing for the day and do not physically depart their residence until later (e.g., 09:15 AM or 10:10 AM).

Under the standard model, the employee was credited with work/travel hours while still lounging at home. 

This enhancement introduces **Home Geofence Departure Ping Tracking**:
1. **Home Clock-In Identification:** When an employee clocks in from within their assigned **House Geofence** (`category: 'HOUSE'`), the session is flagged as `isHomeClockIn = true`.
2. **Departure Tracking:** As background GPS pings arrive while the employee is at home, the system keeps updating the last ping timestamp inside the geofence.
3. **Official Clock-In Lock (Last Home Ping):** The **last GPS ping recorded inside the home geofence before exiting** is designated as the **effective official clock-in time** (the actual start of the workday/travel).
4. **Dual Timestamp Display Across Dashboard:** Both times are preserved and surfaced across all dashboard screens:
   - **App Clock-In Time:** The original time the employee pressed "Clock In" in the mobile app (e.g., `08:00 AM`).
   - **Departure Time (Effective In):** The timestamp of the final ping before leaving the house boundary (e.g., `10:10 AM`).
5. **Accurate Working Hours:** Duration, overtime, shift engines, and regularization automatically compute working hours from the effective departure time.

---

## 2. Database Schema Changes (`Attendances` table)

The following columns were added to the `Attendances` table via PostgreSQL migration and registered in `backend/src/shared/models/Attendance.js`:

| Column Name | Type | Default | Description |
|---|---|---|---|
| `isHomeClockIn` | `BOOLEAN` | `FALSE` | Indicates whether the clock-in punch occurred within the employee's `HOUSE` geofence. |
| `appCheckIn` | `VARCHAR(255)` | `NULL` | Stores the original mobile app button punch time (e.g., `'08:00:00 AM'`). |
| `homeDepartureTime` | `VARCHAR(255)` | `NULL` | Stores the timestamp of the last ping recorded inside the home geofence before exit (e.g., `'10:10:21 AM'`). |
| `hasExitedHome` | `BOOLEAN` | `FALSE` | `false` while employee remains at home; flips to `true` when the employee departs the home geofence boundary. |
| `homeGeofenceId` | `INTEGER` | `NULL` | Foreign key referencing the matched `location_geofence_settings` record. |

---

## 3. Production Field Workers Audit (2026-11-23)

All existing field workers who punched from home today have been audited, retroactively synchronized, and verified against telemetry:

| Field Worker | Emp Code | House Geofence | App Punch (Mobile) | Last Home Ping (Departure) | First Outside Ping | Status & Duty Start |
|---|---|---|---|---|---|---|
| **Balkar Singh** | `HMPL71` | ID 166 (Amritsar) | `08:00:00 AM` | `10:10:21 AM` | `10:25:00 AM` (11 km away) | **Departed** (Official In: 10:10 AM) |
| **Roop Singh** | `HMPL40` | ID 164 (Amritsar) | `09:29:58 AM` | `09:44:59 AM` | `10:00:00 AM` (2.9 km away) | **Departed** (Official In: 09:44 AM) |
| **Dharm Veer Yadav** | `HMPL067` | ID 169 (Siwan) | `09:24:00 AM` | `10:09:01 AM` | `10:24:01 AM` (2.4 km away) | **Departed** (Official In: 10:09 AM) |
| **Mandeep Singh** | `HMPL39` | ID 165 (Majitha) | `08:05:38 AM` | `09:05:41 AM` | `09:35:49 AM` (2.7 km away) | **Departed** (Official In: 09:05 AM) |
| **Kamal Raj** | `HMPL105` | ID 167 (Amritsar) | *No punch today* | - | - | Ready (Dynamic detection active) |
| **Chamel Singh** | `HMPL75` | ID 168 (Nahan) | *No punch today* | - | - | Ready (Dynamic detection active) |

---

## 4. Frontend UI Display (Where to See Both Times)

### 4.1. Table View (Check In Column)
In **HRMS -> Attendance** table:
- **Primary Time:** Shows the **Departure Time** (e.g., `10:10 AM`) in bold.
- **Status Badge:**
  - `Departed` (Blue badge): Employee has left the home geofence. Tooltip: *Official Clock-In (Last ping inside home before departure)*.
  - `At Home` (Yellow badge): Employee is still inside the home geofence. Tooltip: *Clocked in at home (Not yet departed)*.
- **App Punch Badge:** Directly below the departure time:
  - `📱 App: 08:00 AM` (Purple pill with mobile icon)
- **Punch Method Badge:**
  - `📱 App` or `💻 Web` or `🔄 Auto-Recovered` (Clean FontAwesome icon, zero corrupted characters).

### 4.2. Punch History Modal (Session Popup)
When clicking on the **Punch Count** button (e.g., `1 time`):
Inside **SESSION #1 -> CHECK IN**:
1. **System Departure (Official In):**
   - Header: `🏠 System Departure (Official In):` + `Departed Home` badge.
   - Large bold timestamp: `10:10 AM`
   - Subtext: `* Official duty start (working hours calculated from this departure time)`
2. **Field Worker Mobile App Punch:**
   - Shaded purple block: `📱 Field Worker App Punch:`
   - Time: `08:00 AM`
   - Subtext: `Actual button press time recorded from mobile app`
3. **Location Address:**
   - Red pin icon + complete reverse geocoded street address.

---

## 5. Architectural Components & Services

### 5.1. `HomeGeofenceDepartureService` (`backend/src/shared/services/HomeGeofenceDepartureService.js`)
Dedicated service managing all home geofence calculations:
- `resolveHomeGeofence(userAliases)`: Dynamically resolves an employee's assigned `HOUSE` geofence by ID, empCode, or name.
- `isInsideHome(lat, lon, homeGf, bufferMeters = 25)`: Calculates Haversine distance with a 25m buffer for indoor GPS drift.
- `evaluateClockIn(lat, lon, userAliases)`: Evaluates initial punch coordinates to identify home punches.
- `evaluateFootprintPing(ping, userAliases, activeAttendance, io)`:
  - While inside (`distance <= radius + 25m`): Updates `homeDepartureTime` and `checkIn` to latest ping.
  - Upon exit (`distance > radius + 25m`): Locks `hasExitedHome = true`, freezes `homeDepartureTime` as the final inside ping, locks `checkIn = homeDepartureTime`, and broadcasts `ATTENDANCE_PUNCH` (`HOME_DEPARTURE`) & `ATTENDANCE_UPDATE` via Socket.IO.

---

## 6. Dynamic Support for Any Field Worker in the Future

The system is **100% dynamic** with zero hardcoded worker lists:

### How to Add Home Location for Any Worker:
1. Go to **HRMS -> Geofences** (`/hrms/geofences`).
2. Click on the **"HOUSES"** tab.
3. In the **"Link to Employee"** dropdown, select the field worker.
4. Click on the map to set their house location.
5. Set the radius (Standard default: `30` meters).
6. Click **"Add House Geofence"**.

### Dynamic Resolution Pipeline:
- **Instant Activation:** The record is stored with `category: 'HOUSE'` and `employee_id: '<empCode>'`.
- **Multi-Alias Resolution:** Matches by:
  1. Case-insensitive Employee Code (`HMPL...` or `hmpl...`)
  2. Numerical / UUID database Employee ID
  3. Employee Full Name fallback in Geofence title
- The next time that worker clocks in from home, their session automatically detects their house, captures their app punch, tracks their home stay, and locks their official start time to the last departure ping without touching any configuration or server settings.
