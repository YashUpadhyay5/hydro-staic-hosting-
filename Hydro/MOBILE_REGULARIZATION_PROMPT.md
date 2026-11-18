Implement "Attendance regularization" in this mobile app (the Hydro HRMS employee app).

## What the feature does
An employee who worked a past day but forgot to clock in asks to be marked present. They pick the day, write a comment and attach supporting documents (photos or PDFs). An admin reviews it on the HRMS dashboard and approves or rejects it. Approving marks the employee present on that day. The server side is already built; this task is the app side only. Do not change the server.

## Before you write code
1. Find out the app's stack and structure: framework, navigation, state management, how screens are laid out and styled.
2. Find and reuse what already exists. Don't add parallel versions:
   - the HTTP/API client and how it sets the base URL and the `Authorization: Bearer <token>` header;
   - where the login token and the logged-in user are stored;
   - the Firebase (FCM) setup and the foreground and background push handlers;
   - the attendance history screen (the new screen is reached from it);
   - existing date pickers, image/file pickers (camera, gallery, documents), buttons, cards, badges and dialogs, so the new screens match the app.
3. Give me a short plan (files to add and change) before making large changes. Keep changes minimal and consistent with the code style; don't refactor unrelated code.

## Server contract (already implemented)
All calls go to the server the app already uses, under `/api`, with the app's usual `Authorization: Bearer <token>` header. The server takes the employee from the token. Dates are `YYYY-MM-DD` (India time). Every error is a 4xx with `{ "error": "<message for the user>", "code": "<CODE>" }`. Show `error` as-is and branch on `code`.

| Call | Body | Success |
|---|---|---|
| `POST /api/regularizations` | `multipart/form-data`: `date`, `comment`, `checkIn?`, `checkOut?`, `documents` (repeat the field, up to 5 files) | `201 { request }` |
| `GET /api/regularizations?status=ALL` | none. `status` is `PENDING` (default), `APPROVED`, `REJECTED`, `CANCELLED` or `ALL`. Optional `from` / `to` (`YYYY-MM-DD`). | `200 { requests: [...], pendingCount }`, oldest day first |
| `GET /api/regularizations/:id` | none | `200 { request }` |
| `POST /api/regularizations/:id/cancel` | none | `200 { request }` |

Do not send `Content-Type` yourself on the multipart call; let the HTTP client set it with the boundary.

Rules the server enforces. Validate the same way in the UI so most errors never happen:
- `date`: a past day (not today, not the future), at most 31 days back.
- `comment`: required, 3 to 1000 characters.
- `checkIn` / `checkOut`: optional, such as `09:30` or `9:30 AM`. If both are sent, `checkOut` must be after `checkIn`. If left out, the employee's normal shift hours are used when it is approved.
- `documents`: optional, at most 5 files, images or PDF only, up to 10 MB each.
- One pending request per day. A rejected or withdrawn request can be sent again for the same day.
- Error codes: `INVALID_DATE`, `DATE_NOT_PAST`, `DATE_TOO_OLD`, `COMMENT_REQUIRED`, `INVALID_TIME`, `TOO_MANY_DOCUMENTS`, `INVALID_DOCUMENT`, `ATTENDANCE_EXISTS` (409, the day already has attendance), `ALREADY_REQUESTED` (409, the reply also carries `request`), `ON_LEAVE` (409, approved leave that day), `NOT_PENDING` (409), `FORBIDDEN` (403), `NOT_FOUND` (404), `EMPLOYEE_NOT_FOUND` (404), `SERVER_ERROR` (500).

Request fields the app uses:
- `id`, `date`, `comment`, `requestedCheckIn`, `requestedCheckOut` (like `"09:30:00 AM"`, or null).
- `status`: `PENDING` | `APPROVED` | `REJECTED` | `CANCELLED` (the employee withdrew it).
- `decisionNote`: the admin's reason when rejected. Show it to the employee.
- `decidedAt`: epoch milliseconds, or null.
- `documents`: `[{ url, name, mimeType, size }]`. `url` is a path on the server such as `storage/regularization/regularization-123.pdf`. Open it as `<server base without /api>/<url>`.
- `createdAt`: ISO time the request was sent.

The decision push (FCM), sent to the employee's registered devices. It is a normal notification, not an alarm:
```
notification: { title: "Attendance regularized", body: "You are marked present for 2 Nov 2026." }
data: { type: "REGULARIZATION", status: "APPROVED", requestId: "<id>", date: "2026-11-02" }
```
A rejection has `status: "REJECTED"`, the title "Regularization rejected", and the reason in the body. `data` values are strings. Route on `data.type === "REGULARIZATION"`.

## What to build
1. **Regularize attendance screen:**
   - a date picker limited to the last 31 days, before today;
   - a multi-line comment box (3 to 1000 characters, with a counter);
   - optional "I worked from" and "until" time pickers;
   - an attachments area: add up to 5 photos or PDFs from the camera, gallery or files, with a thumbnail or file name and a remove button for each;
   - a Send button that is disabled until the date and comment are valid. While sending, show progress and block double taps.
2. **My requests screen:**
   - the list from `GET /api/regularizations?status=ALL`, newest day first (the server returns oldest first, so reverse it);
   - each row shows the date, a status badge (Pending, Approved, Rejected, Withdrawn), and the time it was sent;
   - tapping a row shows the comment, the documents, and for a rejected request the admin's `decisionNote`;
   - a pending request has a Withdraw button (with a confirm) that calls `cancel`.
3. **Entry points:** add a "Regularize attendance" action to the attendance history, on a day that has no attendance, with the date already filled in. Add a "My requests" link next to it.
4. **Push handling:** when a push with `data.type === "REGULARIZATION"` arrives in the foreground, show a short in-app message and refresh My requests. When the employee taps it from the background or a cold start, open My requests. Use the app's existing push setup; do not add a second one.
5. **Refresh:** reload the list when My requests opens and when the app returns to the foreground. The push is best effort, so never rely on it alone.

## Error handling
- **`ATTENDANCE_EXISTS`:** tell the employee the day already has attendance and close the screen. No request is needed.
- **`ALREADY_REQUESTED`:** show that a request for that day is already pending and open it from `request`.
- **`ON_LEAVE`:** show the message as it comes.
- **Other `400` codes:** show `error` next to the field concerned and keep the user's input and attachments.
- **`INVALID_DOCUMENT` / `TOO_MANY_DOCUMENTS`:** show the message and let them remove files; keep everything else.
- **Network failure or `500`:** keep the comment and attachments, show a retry, never lose what the employee typed.
- **`NOT_PENDING` on withdraw:** refresh the list; the admin already decided it.
- **`401`:** use the app's existing "log in again" flow.

## Done when
- [ ] A request can be sent for yesterday with a comment and one photo, against the real server, and it shows as Pending in My requests.
- [ ] It appears on the HRMS dashboard under Regularization with the comment and the photo.
- [ ] After the admin approves it, the employee gets the push, the request shows Approved, and the day shows as present in the attendance history.
- [ ] After the admin rejects it, the reason is shown to the employee, and a new request can be sent for that day.
- [ ] A pending request can be withdrawn.
- [ ] Today, a future day, a day older than 31 days, a day with attendance, and a second request for the same day are all handled with the server's message and no lost input.
- [ ] No changes to unrelated features; existing pushes and alarms still work.

Note: until the server update is deployed, these endpoints return 404 on the real server. Build against this contract, with a temporary mock if needed, and test end to end once it's live. The full spec is REGULARIZATION_API.md in the HRMS server repo.

When finished, give me:
- the files changed;
- how to test it;
- any question for the server team.
