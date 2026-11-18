# Day Activities: phone app API

Employees log what they are doing during the day from the phone. For each activity they set a title and a planned end time.

When the planned time runs out, the server **rings the phone** with an alarm push. The push asks how much extra time the employee needs and why. The answer moves the deadline, and the server watches the new deadline the same way.

Admins see the whole day on **Attendance → employee → Tracking**, in the *Day Activities* panel.

## Flow

```
Start activity ──► (planned end passes) ──► phone rings ──► employee asks for extra time + reason
      │                                         │  (rings again every 5 min, max 12, if ignored)
      │                                         ▼
      └──────────────► Finish  (a reason is required if finished after the deadline)
                       Cancel  (started by mistake)
```

## Basics

- **Base URL:** the same server the app already uses, for example `http://<server>:8000/api`. The paths `/api/v1/...` work too.
- **Auth:** the same `Authorization: Bearer <token>` header the app already sends after login. The server works out the employee from the token. An employee can only see and change their own activities.
- **Times:** epoch milliseconds, as in footprints. Requests may also use an ISO string such as `"2026-11-03T12:30:00+05:30"`. Show times in IST.
- **One at a time:** an employee can have only one activity in progress.
- **Errors:** every error returns `{ "error": "<message to show the user>", "code": "<CODE>" }` with a 4xx status.

## The activity object

Every endpoint returns activities in this shape:

```json
{
  "id": "8f47a537-98e9-4998-be51-1b73f46c4f26",
  "employeeId": "EMP0021",
  "date": "2026-11-03",
  "title": "Site visit at Noida",
  "notes": null,
  "startedAt": 1793688000000,
  "plannedEndAt": 1793695200000,
  "deadlineAt": 1793697000000,
  "endedAt": null,
  "status": "IN_PROGRESS",
  "state": "OVERDUE",
  "plannedMinutes": 120,
  "takenMinutes": 145,
  "overMinutes": 10,
  "overPlanMinutes": 40,
  "extraMinutesAsked": 30,
  "extensions": [
    { "at": 1793695500000, "extraMinutes": 30, "reason": "Client asked for a second panel",
      "previousDeadlineAt": 1793695200000, "newDeadlineAt": 1793697000000 }
  ],
  "finishReason": null,
  "remindersSent": 2,
  "startLatitude": 28.5099, "startLongitude": 77.3807,
  "endLatitude": null, "endLongitude": null,
  "siteName": "Amritsar, Punjab"
}
```

| Field | Meaning |
|---|---|
| `siteName` | Verified physical Site / Cluster name (e.g. `Amritsar, Punjab` or `Lwss Renuka Badon`). Automatically resolved from GPS coordinates against official sites/clusters or optionally supplied by client. |
| `plannedEndAt` | The end time the employee chose when starting. It never changes. |
| `deadlineAt` | The current deadline: `plannedEndAt` plus any extra time asked for. **Use this for the countdown.** |
| `status` | Stored status: `IN_PROGRESS`, `COMPLETED` or `CANCELLED`. |
| `state` | What to display: `IN_PROGRESS`, `OVERDUE` (past `deadlineAt`), `COMPLETED`, `COMPLETED_LATE` (finished after the original `plannedEndAt`, by any amount, even when extra time covered it; show `overPlanMinutes`), `CANCELLED`, or `UNFINISHED` (left open on an earlier day). |
| `overMinutes` | Minutes past `deadlineAt`, up to now or up to the finish. |
| `overPlanMinutes` | Minutes past the original `plannedEndAt`. |
| `remindersSent` | How many times the phone was rung for this activity. |

## Endpoints

### What the employee can log: the work list
`GET /api/activities/work-list` returns the choices for the employee's work place (the same work place that sets their holiday calendar):

```json
{ "region": "AP", "label": "Andhra Pradesh", "mode": "LIST", "workPlace": "Andhra Pradesh",
  "items": [ { "key": "service_t0_t1", "title": "Service work (T0, T1)", "minutes": 30 } ] }
```

| `mode` | Who | The start screen shows |
|---|---|---|
| `LIST` | Andhra Pradesh, UP / Punjab | A list to pick from. Nothing is typed. |
| `FREE` | Himachal Pradesh, and any other work place | Two fields: the work (text) and the time. |

- **`minutes` set:** the time is fixed by the server. Show it, do not ask for a time, and do not send one (it is ignored).
- **`minutes` null:** the employee picks the time (end time or minutes), as usual.
- Call it when the Start screen opens. Do not hard-code the lists; they can change on the server.

| Region | Items (minutes) |
|---|---|
| AP | New installation (T0, T1) 60 · New installation (T2) 60 · Service work (T0, T1) 30 · Service work (T2) 60 |
| UP / Punjab | Backwash 60 · Leakage · Paint works · Welding work · Assembly work · Material purchase · IoT work · Repair of chamber and platform · Sample collect · Excavation work (all the others: employee picks the time) |
| HP / other | Free text + time |

### Start an activity
`POST /api/activities`

```json
{ "workKey": "leakage", "plannedMinutes": 90, "notes": "optional", "latitude": 28.5099, "longitude": 77.3807 }
```

- **`LIST` work places:** send `workKey` (an item's `key`) instead of `title`. The server sets the title. A missing or unknown `workKey` gets `400 WORK_REQUIRED`, and the reply carries `workList`.
- **`FREE` work places:** send `title` as before, for example `{ "title": "Site visit at Noida", "plannedEndAt": 1793695200000 }`.

- **Planned end:** send either `plannedEndAt` (a time) or `plannedMinutes` (for example `90`), not both. Not needed when the chosen item has fixed `minutes`.
- **Title (`FREE` only):** required, up to 120 characters.
- **Limits:** the planned end must be after the start and at most 16 hours later.
- **Location:** `latitude` / `longitude` are optional. Send the current fix if you have one.
- **Offline phones:** optional `startedAt` gives the real start time if the request is sent late. It must be within the last 12 hours.

Reply: `201 { "activity": { ... } }`.

| Status | `code` | When |
|---|---|---|
| 400 | `WORK_REQUIRED`, `TITLE_REQUIRED`, `PLANNED_END_REQUIRED`, `INVALID_PLANNED_END`, `INVALID_START` | Bad input |
| 409 | `ACTIVITY_IN_PROGRESS` | Another activity is still running. The reply also contains `current` (that activity), so the app can offer to finish it. |

### The activity in progress
`GET /api/activities/current` returns `{ "activity": { ... } }`, or `{ "activity": null }` if nothing is running.

Call it when the app opens, to restore the current-activity card and countdown.

### Ask for extra time
`POST /api/activities/:id/extend`

```json
{ "extraMinutes": 30, "reason": "Client asked for a second panel" }
```

- **`extraMinutes`:** a whole number from 5 to 480.
- **`reason`:** required, 3 to 500 characters.
- **Before the deadline:** the extra time is added to the current deadline.
- **After the deadline** (answering the alarm): the extra time counts from now.
- **Ringing:** stops and restarts at the new deadline.

Reply: `200 { "activity": { ... } }`.

Errors: `400 INVALID_EXTRA_MINUTES` / `REASON_REQUIRED` / `TOO_LONG` (the activity would exceed 16 hours), and `409 NOT_IN_PROGRESS`.

### Finish
`POST /api/activities/:id/finish`

```json
{ "reason": "Site gate was locked", "notes": "optional", "latitude": 28.51, "longitude": 77.38 }
```

- **`reason`:** only needed when finishing more than 1 minute after `deadlineAt`. Without it the server replies `400 REASON_REQUIRED`. Show the reason box and send again.
- **Simplest approach:** whenever `state === 'OVERDUE'`, ask for the reason before calling finish.

Reply: `200 { "activity": { ... } }`. The error `409 NOT_IN_PROGRESS` means it was already finished or cancelled.

### Cancel
`POST /api/activities/:id/cancel` with optional `{ "reason": "Started by mistake" }`. Reply: `200 { "activity": { ... } }`.

### A day's list
`GET /api/activities?date=YYYY-MM-DD` returns `{ "employee": { "id", "empCode", "name" }, "date", "activities": [ ... ] }`, oldest first.

- **Default date:** today (IST).
- **Use:** the phone can show "My activities today" from this.
- **Admin pages:** they also pass `employeeId`. For employees it is ignored, and they always get their own day.

## The "time is up" push: the phone must ring

When `deadlineAt` passes, the server sends an FCM message to every phone registered for the employee. It uses the same high-priority push as the clock-out alarm:

```json
notification: { "title": "⏰ Time is up: Site visit at Noida",
                "body":  "Your planned time for \"Site visit at Noida\" ended at 12:30 PM. How much extra time do you need, and why?" }
data: {
  "type": "ALARM",
  "sound": "alarm_loud",
  "action": "activity_extend",
  "activityId": "8f47a537-98e9-4998-be51-1b73f46c4f26",
  "activityTitle": "Site visit at Noida",
  "deadlineAt": "1793697000000"
}
```

All `data` values are strings, as FCM requires.

**What the app must do:**
1. **Ring:** play the loud alarm, as for the existing clock-out `type: 'ALARM'` push, even when the app is in the background or the screen is locked.
2. **Open the Extra time screen:** when the employee taps the notification, open it for `activityId`, with the title, how long it has been over, extra minutes (quick picks such as 15 / 30 / 60, plus a custom value), and a required reason. Also offer **Finish now**, which uses the same reason box.
3. **Send the answer:** `extend` or `finish`. The server then stops ringing.

**Ringing rules (server side):**
- The first ring comes when the deadline passes. If unanswered, it rings again every **5 minutes**, up to **12 times** per deadline.
- It stops when the employee asks for extra time, finishes, cancels, or **clocks out**.
- After extra time is given, ringing starts again only when the new deadline passes.
- Only activities started today are rung.

## Screens to add in the app

1. **Start activity:** built from `GET /api/activities/work-list`:
   - `LIST`: the work list; an item with fixed minutes shows its time and asks for none;
   - `FREE`: activity name (free text, optionally with a recent-titles list);
   - end time picker or duration (not for fixed-time items);
   - optional notes;
   - Start button, sending the current GPS fix.
2. **Current activity card** (home screen):
   - title and a countdown to `deadlineAt`;
   - red "over by X min" once past it;
   - buttons: Extra time, Finish, Cancel.
3. **Extra time / reason screen:** opened from the push or from the card.
4. **My day:** the list from `GET /api/activities`.

## Testing

Start an activity with `"plannedMinutes": 1`. Within about two minutes the phone should ring (the server checks every minute). Answer with `extend` and check that ringing stops until the new deadline.

## Notifications & Real-Time Alerts

Whenever any employee starts, extends, finishes, or cancels an activity (or when an activity exceeds its deadline), the server automatically triggers notifications across **all channels** for both management and the employee.

### 1. Notification Event Matrix

| Event | Code | Recipient | Title | Body Example |
|---|---|---|---|---|
| **Start** | `ACTIVITY_STARTED` | Admins & Employee | `📋 Day Activity Started: Aman Test` | `Aman Test (HMPL113) started "Site visit at Noida" at Amritsar, Punjab. Planned: 2h 00m (Due at 12:30 PM).` |
| **Extend** | `ACTIVITY_EXTENDED` | Admins & Employee | `⏳ Activity Extended: Aman Test` | `Aman Test requested +30 min for "Site visit at Noida" at Amritsar, Punjab. Reason: "Client asked for a second panel". New deadline: 01:00 PM.` |
| **Overdue** | `ACTIVITY_OVERDUE` | Admins (Employee receives ALARM ring) | `⚠️ Activity Overdue: Aman Test` | `Aman Test's activity "Site visit at Noida" at Amritsar, Punjab has exceeded its deadline (12:30 PM). Phone alarm triggered.` |
| **Complete (On Time)** | `ACTIVITY_COMPLETED` | Admins & Employee | `✅ Activity Completed: Aman Test` | `Aman Test completed "Site visit at Noida" at Amritsar, Punjab on time (Duration: 1h 45m).` |
| **Complete (Late)** | `ACTIVITY_COMPLETED_LATE` | Admins & Employee | `⚠️ Activity Completed Late: Aman Test` | `Aman Test completed "Site visit at Noida" at Amritsar, Punjab 25m late. Reason: "Traffic jam on Expressway". Total: 2h 25m.` |
| **Cancel** | `ACTIVITY_CANCELLED` | Admins & Employee | `❌ Activity Cancelled: Aman Test` | `Aman Test cancelled "Site visit at Noida" at Amritsar, Punjab. Reason: "Client meeting postponed".` |
| **Smart Dispatch (Next Site)** | `ACTIVITY_SITE_COMPLETED_DISPATCH` | Employee Only | `✅ Work Completed at <Site Name>` | `Your work "<Title>" at <Site Name> is complete. You can now leave this site and move to your next site.` |

### Smart Geofence Departure Rule upon Work Completion:
1. When an employee completes their activity at a site, the server checks their current finish GPS coordinates against the physical site/cluster geofence boundary (radius + 50m drift tolerance).
2. **If the worker is still inside the site geofence:** The server sends the dispatch push notification instructing them: *"Your work [Title] at [Site Name] is complete. You can now leave this site and move to your next site."*
3. **If the worker has already left the geofence:** The push notification is automatically suppressed, as the worker is already on the road/traveling to their next destination.
4. When the worker arrives at their next site, they select or enter their next activity, and the exact same cycle automatically repeats!

### 2. Multi-Channel Delivery Channels

1. **In-App Notification Center (`notifications` & `notification_logs` tables):**
   - **For Staff/Admins:** Stored under `target: 'STAFF'` / `targetId: 'ADMIN'`, visible in the HRMS Web Portal Notification Center and audit logs.
   - **For the Employee:** Stored under `target: 'EMPLOYEE'` / `targetId: employee.id`. Accessible via `GET /api/notifications/my-notifications` or `GET /api/notifications/inbox` on mobile.
2. **Mobile Push (FCM):**
   - High-priority push sent to all active devices registered for staff/admins (`ADMIN`, `SUPER_ADMIN`, `HR`, `HR_ADMIN`, `MANAGER`, `TRACKING_MANAGER`).
   - Confirmation push sent to the employee's registered phones.
3. **Real-Time WebSockets (`socketGateway`):**
   - Broadcasts `day_activity_event` globally for live toast alerts.
   - Broadcasts `DAY_ACTIVITY_UPDATE` with the full updated activity object so `DayActivitiesPanel` on the live tracking page refreshes instantaneously without manual polling.
   - Emits `day_activity_event` to the user's private socket room (`user:<employeeId>`).

### 3. Notification Payload Shape

```json
{
  "type": "ACTIVITY_STARTED",
  "category": "DAY_ACTIVITY",
  "activityId": "8f47a537-98e9-4998-be51-1b73f46c4f26",
  "employeeId": "EMP0021",
  "employeeName": "Aman Test",
  "empCode": "HMPL113",
  "activityTitle": "Site visit at Noida",
  "status": "IN_PROGRESS",
  "startedAt": 1793688000000,
  "plannedEndAt": 1793695200000,
  "deadlineAt": 1793695200000,
  "endedAt": null,
  "timestamp": 1793688005000
}
```

