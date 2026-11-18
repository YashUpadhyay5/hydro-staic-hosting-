Implement the "Day Activities" feature in this mobile app (the Hydro HRMS employee app).

## What the feature does
Employees log what they are doing during the day. Each activity has a title and an end time the employee picks. When that time passes, the HRMS server sends an alarm push. The phone must ring and ask how much extra time is needed and why. The employee answers with extra minutes and a reason, or finishes the activity, giving a reason if it ran late. The server side is already built; this task is the app side only. Do not change the server.

## Before you write code
1. Find out the app's stack and structure: framework, navigation, state management, how screens are laid out and styled.
2. Find and reuse what already exists. Don't add parallel versions:
   - the HTTP/API client and how it sets the base URL and the `Authorization: Bearer <token>` header;
   - where the login token and the logged-in user (`user.id`) are stored;
   - the Firebase (FCM) setup, including the call to `POST /api/employees/fcm-token` that registers the device token;
   - the existing handler for the clock-out alarm push. Search for `alarm_loud`, `"ALARM"` and `clock_out`. It already makes the phone ring for `data.type === "ALARM"`. The new alarm must ring the same way.
   - existing date/time pickers, buttons, cards and dialogs, so the new screens match the app.
3. Give me a short plan (files to add and change) before making large changes. Keep changes minimal and consistent with the code style; don't refactor unrelated code.

## Server contract (already implemented)
All calls go to the server the app already uses, under `/api`, with the app's usual `Authorization: Bearer <token>` and `Content-Type: application/json` headers. The server takes the employee from the token. Times are epoch milliseconds (numbers); requests may also send ISO 8601 strings with an offset. Show times in IST (Asia/Kolkata). Every error is a 4xx with `{ "error": "<message for the user>", "code": "<CODE>" }`. Show `error` as-is and branch on `code`.

| Call | Body | Success |
|---|---|---|
| `POST /api/activities` | `{ title, plannedEndAt? \| plannedMinutes?, notes?, latitude?, longitude?, startedAt? }` | `201 { activity }` |
| `GET /api/activities/current` | none | `200 { activity }` or `{ activity: null }` |
| `POST /api/activities/:id/extend` | `{ extraMinutes, reason }` | `200 { activity }` |
| `POST /api/activities/:id/finish` | `{ reason?, notes?, latitude?, longitude? }` | `200 { activity }` |
| `POST /api/activities/:id/cancel` | `{ reason? }` | `200 { activity }` |
| `GET /api/activities?date=YYYY-MM-DD` | none (date defaults to today, IST) | `200 { employee, date, activities: [...] }`, oldest first |

What the Start screen offers depends on the employee's work place, so build it from `GET /api/activities/work-list` (call it when the screen opens; never hard-code the items):
- `mode: "LIST"` (Andhra Pradesh, UP / Punjab): show `items` as a list to pick from, with no free text. Send the chosen `key` as `workKey`. If the item has `minutes`, show "Time: N min", hide the time pickers and send no time (the server fixes it and ignores any you send). If `minutes` is null, show the time picker as usual.
- `mode: "FREE"` (Himachal Pradesh and any other work place): two fields, the work (text, becomes `title`) and the time (end time or duration).
- `400 WORK_REQUIRED`: the choice was missing or not in the list. Reload the list and let the employee choose again.

Rules the server enforces. Validate the same way in the UI so most errors never happen:
- `title` (FREE only): 1–120 characters.
- Planned end: send exactly one of `plannedEndAt` (a time after the start, at most 16 h later) or `plannedMinutes` (whole number, 1–960).
- `startedAt`: only for a start that was queued while offline. It must be within the last 12 h and not in the future.
- One activity at a time. Starting another returns `409 ACTIVITY_IN_PROGRESS`, and the reply also carries `current` (the running activity).
- `extend`: `extraMinutes` is a whole number from 5 to 480, and `reason` is 3–500 characters. Before the deadline the minutes are added to the deadline; after it they count from now.
- `finish`: more than 1 minute after `deadlineAt`, a `reason` (3–500 characters) is required, otherwise `400 REASON_REQUIRED`.
- Error codes: `WORK_REQUIRED`, `TITLE_REQUIRED`, `PLANNED_END_REQUIRED`, `INVALID_PLANNED_END`, `INVALID_START`, `ACTIVITY_IN_PROGRESS` (409), `INVALID_EXTRA_MINUTES`, `REASON_REQUIRED`, `TOO_LONG`, `NOT_IN_PROGRESS` (409), `INVALID_DATE`, `FORBIDDEN` (403), `NOT_FOUND` (404), `EMPLOYEE_NOT_FOUND` (404), `SERVER_ERROR` (500).

Activity object fields the app uses:
- `id`, `title`, `siteName` (verified physical site/cluster name, e.g. "Amritsar, Punjab"), `notes`, `date` (YYYY-MM-DD), `startedAt`, `plannedEndAt` (the original plan; never changes), `deadlineAt` (current deadline; use this for the countdown), `endedAt`.
- `status`: `IN_PROGRESS` | `COMPLETED` | `CANCELLED`.
- `state`, for display: `IN_PROGRESS` | `OVERDUE` | `COMPLETED` | `COMPLETED_LATE` (finished after the original `plannedEndAt`, by any amount, even if extra time covered it; show `overPlanMinutes`) | `CANCELLED` | `UNFINISHED` (left open on an earlier day).
- `plannedMinutes`, `takenMinutes`, `overMinutes` (past `deadlineAt`), `extraMinutesAsked`.
- `extensions`: `[{ at, extraMinutes, reason, previousDeadlineAt, newDeadlineAt }]`.
- `finishReason`, `remindersSent`.

The time-is-up push (FCM), sent to every registered device token of the employee:
```
notification: { title: "⏰ Time is up: <title>", body: "Your planned time for \"<title>\" ended at 12:00 PM. How much extra time do you need, and why?" }
data: { type: "ALARM", sound: "alarm_loud", action: "activity_extend", activityId: "<id>", activityTitle: "<title>", deadlineAt: "<ms as string>" }
android: { priority: "high", notification: { channelId: "default", sound: "default" } }
```

The smart site departure dispatch push (FCM), sent when activity is completed and worker is inside site geofence:
```
notification: { title: "✅ Work Completed at <siteName>", body: "Your work \"<title>\" at <siteName> is complete. You can now leave this site and move to your next site." }
data: { type: "ACTIVITY_SITE_COMPLETED_DISPATCH", action: "MOVE_TO_NEXT_SITE", activityId: "<id>", activityTitle: "<title>", siteName: "<siteName>" }
```
- If the employee has already physically departed outside the geofence boundary, this notification is automatically suppressed.
- Tapping this push or finishing the activity brings the employee back to the Start Activity screen to pick the next activity at the next site.
- **Data values are strings.** Route on `data.action === "activity_extend"`.
- **Ringing pace:** the first ring comes within a minute after `deadlineAt`. If unanswered, it repeats every 5 minutes, at most 12 times per deadline.
- **When it stops:** after extend, finish or cancel, or once the employee clocks out.
- **Only today:** only activities started today are rung.

## What to build
1. **Start activity screen:**
   - `LIST` work place: the work list from `GET /api/activities/work-list` (fixed-time items show their time and need no picker); `FREE` work place: title (free text, with chips of recently used titles stored on the device);
   - end time picker, plus quick durations (30 min, 1 h, 2 h, custom), except for fixed-time items;
   - optional notes;
   - Start button. On press it gets the current GPS fix (if location permission is already granted; don't block on it) and calls `POST /api/activities`.
2. **Current activity card on the home screen:**
   - title and a live countdown to `deadlineAt`; once past it, red "Over by X min";
   - buttons: Extra time, Finish, Cancel (with a confirm).
3. **Extra time screen:**
   - shows the title and how long it has been over;
   - extra minutes (15 / 30 / 60 / custom, 5–480) and a required reason (3–500 characters);
   - also a "Finish now" button that uses the same reason box.
4. **Finish flow:** if `state` is `OVERDUE` (or now > `deadlineAt` + 1 min), ask for the reason before calling finish. If the server still returns `REASON_REQUIRED`, show the reason box and retry.
5. **My day screen:** the list from `GET /api/activities` (today by default, with a date picker). Each row shows the state badge, planned vs actual time, extensions with reasons, and the finish reason.
6. **Restore state:** call `GET /api/activities/current` at launch, on login, and whenever the app returns to the foreground. Render the card from it. Don't trust a locally cached copy over the server.
7. **Alarm handling for `action: "activity_extend"`:**
   - **Foreground:** ring using the same mechanism as the existing clock-out alarm, and open the Extra time screen for `activityId`.
   - **Background or killed:** the system shows the notification on Android channel `default`. Make sure the phone actually rings, as the clock-out alarm does today, for example with a high-importance channel with an alarm sound, or by playing the alarm from the app's background message handler. If the app needs a dedicated channel id instead of `default`, say so in your summary; the server team will change it.
   - **Tap, including a cold start:** open the Extra time screen for `activityId`. If that activity has already ended (fetch `GET /current` or the day list), show its final state instead.
   - **Stop the alarm sound** when the employee opens the Extra time screen or sends extend/finish/cancel.
8. **Push registration:** confirm the app calls `POST /api/employees/fcm-token` with `{ token }` after login and on every FCM token refresh. Add the refresh case if it's missing.
9. **Offline start:** if `POST /api/activities` fails for lack of network, keep it in a local queue with the real start time. Send it later with `startedAt`, if still within 12 hours.
10. **Activity notifications in Mobile Inbox:** activity lifecycle events (`ACTIVITY_STARTED`, `ACTIVITY_EXTENDED`, `ACTIVITY_COMPLETED`, `ACTIVITY_COMPLETED_LATE`, `ACTIVITY_CANCELLED`) are persisted to the server's notification store. They appear in `GET /api/notifications/my-notifications` (and `GET /api/notifications/inbox`) tagged with `category: "DAY_ACTIVITY"`. Show them in the notifications screen alongside other alerts.

## Error handling
- **`409 ACTIVITY_IN_PROGRESS`:** offer "Finish" or "Cancel" for `current.title`, then let the user start the new one.
- **`409 NOT_IN_PROGRESS`, `404 NOT_FOUND` or `403 FORBIDDEN`:** refresh from `GET /api/activities/current` and close the screen.
- **`400` codes:** show `error` next to the field concerned and keep the user's input.
- **Network failure or `500`:** keep the input, show a retry, never lose the reason the user typed.
- **`401`:** use the app's existing "log in again" flow.

## Done when
- [ ] An activity can be started (by end time or by duration), shown with a countdown, extended, finished and cancelled against the real server.
- [ ] Starting a 1-minute activity makes the phone ring within about 2 minutes in foreground, background and killed states. Tapping opens the Extra time screen.
- [ ] Sending extra time stops the ringing until the new deadline.
- [ ] A late finish asks for a reason first. An on-time finish doesn't.
- [ ] A second start while one is running is handled with the finish/cancel prompt.
- [ ] Reopening the app restores the current activity from the server.
- [ ] The My day list matches what the HRMS web page shows under Attendance → employee → Tracking → Day Activities.
- [ ] Activity lifecycle updates appear in the mobile app's notification center / inbox (`category: "DAY_ACTIVITY"`).
- [ ] No changes to unrelated features; existing alarms (clock-out) still work.

Note: until the server update is deployed, these endpoints return 404 on the real server. Build against this contract, with a temporary mock if needed, and test end to end once it's live. The full spec is DAY_ACTIVITIES_API.md in the HRMS server repo.

When finished, give me:
- the files changed;
- how to test it;
- any question for the server team (for example the Android channel id).
