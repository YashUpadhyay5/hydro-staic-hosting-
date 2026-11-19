# 📍 Geotagged Photo Clustering & Geofence Site Architecture (`cluster.md`)

## 1. Overview & Core Philosophy

In **Hydro HRMS**, photo clustering is **100% dynamic and site-based**. Instead of creating arbitrary distance clusters named from Google reverse-geocoded road addresses, photos are grouped directly under the **official Office Geofence Sites** configured in the **Office Geofence Configuration** interface (`/geofence`).

```
┌────────────────────────────────┐       GPS Coords
│ Employee Captures Photo        │ ─────────────────────┐
│ (Mobile App / Web Attendance)  │                      │
└────────────────────────────────┘                      ▼
                                            ┌───────────────────────┐
                                            │ Haversine Calculation │
                                            │ vs 158 Office Sites   │
                                            └───────────────────────┘
                                                        │
                      ┌─────────────────────────────────┴─────────────────────────────────┐
                      ▼                                                                   ▼
       Inside Boundary (Radius + 30m)                                      Outside All Boundaries
                      │                                                                   │
       ┌─────────────────────────────┐                                     ┌─────────────────────────────┐
       │ site_id = GeofenceSite.id   │                                     │ site_id = NULL              │
       │ e.g. "Noida Office", "Kulla"│                                     │ Appears in:                 │
       │ Appears under named Site    │                                     │ "⚠️ Unassigned / Out of bounds"│
       └─────────────────────────────┘                                     └─────────────────────────────┘
```

---

## 2. Dynamic Lifecycle & Retroactive Synchronization

When the admin manages geofences in **Office Geofence Configuration**, past and future photos are **automatically and retroactively kept in sync**:

### A. When a New Site is Added (`POST /api/geofence`)
1. The new site boundary (latitude, longitude, radius) is saved in `location_geofence_settings`.
2. `GeofenceMediaSyncService.onGeofenceAddedOrUpdated()` is automatically triggered in the background.
3. **Retroactive Effect:** Any photo taken on **any past date** (yesterday, last month, or last year) that falls within this new boundary is instantly assigned `site_id = newSite.id`.
4. Photos immediately appear under the newly created site in the **Photos & Media** gallery.

### B. When Sites are Bulk-Imported from Excel (`POST /api/geofence/bulk`)
1. All sites are parsed and inserted into `location_geofence_settings`.
2. `GeofenceMediaSyncService.reclassifyAllMedia()` scans the full photo database in a single fast pass.
3. Historical photos are grouped across all new sites.

### C. When a Site Boundary (Coords or Radius) is Edited (`PUT /api/geofence/:id`)
1. If radius is expanded (e.g. 200m → 400m), past photos that were previously outside are dynamically pulled into the site.
2. If radius is shrunk, photos that fell outside are either reassigned to an overlapping neighbor site or moved to `⚠️ Unassigned / Out of bounds`.

### D. When a Site is Renamed (`PUT /api/geofence/:id`)
1. Renaming is **instantaneous across all past days** with zero database re-writes needed for photos.
2. Because `geotagged_media` links to `location_geofence_settings` by foreign key `site_id`, all views dynamically display the updated site name immediately.

### E. When a Site is Deleted (`DELETE /api/geofence/:id`)
1. The geofence record is removed.
2. `GeofenceMediaSyncService.onGeofenceDeleted()` automatically intercepts all historical photos attached to that site.
3. If another active site covers those coordinates, the photo is transferred to that site.
4. Otherwise, `site_id` is cleanly reset to `NULL` so the photo moves to `⚠️ Unassigned / Out of bounds`.
5. **No photos are ever lost or deleted.**

---

## 3. Database Schema & Models

### Model 1: `Geofence` (`location_geofence_settings`)
Represents the official office/site boundaries.
- `id` (INTEGER, Primary Key, Auto-increment)
- `name` (STRING) — e.g. "Mehlanwala", "Noida Office", "Kulla"
- `latitude` (DOUBLE PRECISION)
- `longitude` (DOUBLE PRECISION)
- `radius` (DOUBLE PRECISION, meters) — e.g. 200.0, 300.0

### Model 2: `Media` (`geotagged_media`)
Represents geotagged photos and attachments uploaded by employees.
- `id` (UUID, Primary Key)
- `user_id` (STRING)
- `user_name` (STRING)
- `file_path` (STRING)
- `latitude` (DOUBLE PRECISION)
- `longitude` (DOUBLE PRECISION)
- `timestamp` (BIGINT)
- `date` (STRING)
- `site_id` (BIGINT, Foreign Key to `location_geofence_settings.id`) — **The active link for site clustering**
- `cluster_id` (BIGINT, Legacy / Null)

### Model Associations
```javascript
// backend/src/shared/models/Media.js
const Geofence = require('./Geofence');
Media.belongsTo(Geofence, { foreignKey: 'siteId', as: 'geofence' });
Geofence.hasMany(Media, { foreignKey: 'siteId', as: 'media' });
```

---

## 4. API Endpoints

### 1. Retrieve All Sites & Associated Photos
- **Endpoint:** `GET /api/clusters`
- **Controller:** `backend/src/modules/hrms/organization/routes/cluster.js`
- **Output:** Returns all 158 Office Geofences, sorted alphabetically by name. Each site includes:
  ```json
  [
    {
      "id": 105,
      "name": "Noida Office",
      "centerLatitude": 28.6692,
      "centerLongitude": 77.4538,
      "radius": 200,
      "media": [
        {
          "id": "uuid-1",
          "userName": "Shikha Raghav",
          "filePath": "images/photo-1.jpg",
          "timestamp": 1795000000000
        }
      ]
    }
  ]
  ```

### 2. Filter Photos by Site
- **Endpoint:** `GET /api/media?cluster_id=<siteId>`
- **Controller:** `backend/src/modules/hrms/attendance/routes/media.js`
- **Usage:**
  - `GET /api/media` — All photos.
  - `GET /api/media?cluster_id=unassigned` — All out-of-bounds / unassigned photos (`site_id IS NULL`).
  - `GET /api/media?cluster_id=105` — Only photos captured at Site 105 (*Noida Office*).

### 3. Geofence Lifecycle Management
- `POST /api/geofence` — Add a new office site (triggers retroactive sync).
- `POST /api/geofence/bulk` — Bulk upload sites via Excel (triggers batch sync).
- `PUT /api/geofence/:id` — Update site name or boundary (triggers boundary re-check).
- `DELETE /api/geofence/:id` — Delete site (cleans up and moves photos to unassigned).

---

## 5. Frontend Integration (`MediaView.jsx`)

1. **Photos Gallery Tab:**
   - Dropdown displays **"All Sites"**, **"⚠️ Unassigned / Out of bounds"**, and each named site with its photo count (e.g. `Noida Office (5 photos)`).
   - Each photo card features a badge in the top-left corner displaying its matched geofence site name.
2. **Site Clustering Tab:**
   - Full interactive Leaflet map previewing all 158 sites with live geofence circle overlays and clickable pins.
   - Smooth flying swoop animation (`flyTo`) when clicking any site card in the list.
   - Displays real-time photo thumbnails attached to each geofence site.

---

## 6. Real-Time Socket Notifications

The background service emits real-time events via Socket.IO:
- Event: `media:clusters_updated`
- Payload: `{ updatedCount: number, geofenceId?: number, timestamp: number }`
- Client components automatically refresh photo lists without requiring a hard browser refresh.
