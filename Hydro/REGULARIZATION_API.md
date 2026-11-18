# Attendance regularization: phone app API

An employee who worked a past day but forgot to clock in asks to be marked present. They send the date, a comment and supporting documents (photos or PDFs). Admins see the request on the HRMS dashboard under **Regularization**. **Approve** marks the employee present on that day. **Reject** leaves the day as it is and tells the employee why.

## Flow

```
Employee: pick a past day, write a comment, attach documents  ──►  POST /api/regularizations
Admin (dashboard): opens the card, reads the comment, looks at the documents
      ├─ Approve ──► attendance row created for that day (the employee is present) ──► push "Attendance regularized"
      └─ Reject (reason) ──────────────────────────────────────────────────────────► push "Regularization rejected"
Employee: can withdraw a request that is still pending  ──►  POST /api/regularizations/:id/cancel
```

## Basics

- **Base URL and auth:** the same server and `Authorization: Bearer <token>` header the app already uses. The server works out the employee from the token. An employee only sees and changes their own requests.
- **Errors:** every error returns `{ "error": "<message to show the user>", "code": "<CODE>" }` with a 4xx status. Show `error` as it comes; branch on `code`.
- **Dates:** `YYYY-MM-DD`, India time. Times in the request body: `09:30` or `9:30 AM`.

## The request object

```json
{
  "id": "6d3f0f5e-2a4c-4f0e-9a43-3f6f8f7c1b11",
  "employeeId": "EMP0021",
  "empCode": "HMPL113",
  "employeeName": "Aman Vishwakarma",
  "date": "2026-11-02",
  "comment": "Phone battery died at the site",
  "requestedCheckIn": "09:30:00 AM",
  "requestedCheckOut": "06:15:00 PM",
  "documents": [
    { "url": "storage/regularization/regularization-1793700000000-123456789.pdf", "name": "gate-pass.pdf", "mimeType": "application/pdf", "size": 48213 }
  ],
  "status": "PENDING",
  "decidedBy": null,
  "decidedAt": null,
  "decisionNote": null,
  "attendanceId": null,
  "createdAt": "2026-11-03T05:30:00.000Z",
  "updatedAt": "2026-11-03T05:30:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `status` | `PENDING`, `APPROVED`, `REJECTED` or `CANCELLED` (the employee withdrew it). |
| `requestedCheckIn` / `requestedCheckOut` | The times the employee said they worked. `null` means "my normal shift". |
| `documents[].url` | Path on the server. Open it as `<server>/<url>`, for example `http://<server>:8000/storage/regularization/...`. |
| `decisionNote` | The admin's reason when rejected (show it to the employee), or their note when approved. |
| `decidedAt` | When it was decided, in epoch milliseconds. |

## Endpoints

### Send a request
`POST /api/regularizations`, `Content-Type: multipart/form-data`

| Field | Required | Notes |
|---|---|---|
| `date` | yes | A past day, at most 31 days back. Not today (clock in for today). |
| `comment` | yes | 3 to 1000 characters. Why the employee could not clock in. |
| `checkIn`, `checkOut` | no | The times they worked. If left out, the employee's shift hours are used on approval. `checkOut` must be after `checkIn`. |
| `documents` | no | Up to 5 files in the field `documents` (repeat the field). Images or PDF, up to 10 MB each. |

Reply: `201 { "request": { ... } }`.

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_DATE`, `DATE_NOT_PAST`, `DATE_TOO_OLD` | The date is not a valid past day within 31 days. |
| 400 | `COMMENT_REQUIRED`, `INVALID_TIME`, `TOO_MANY_DOCUMENTS`, `INVALID_DOCUMENT` | Bad input, or a file that is not an image or PDF. |
| 409 | `ATTENDANCE_EXISTS` | The employee already has attendance on that day. No request is needed. |
| 409 | `ALREADY_REQUESTED` | A request for that day is still pending. The reply also carries `request`. |
| 409 | `ON_LEAVE` | The employee is on approved leave that day. |

A rejected or withdrawn request can be sent again for the same day.

### My requests
`GET /api/regularizations?status=ALL` returns `{ "requests": [ ... ], "pendingCount": 1 }`, oldest day first.

- `status`: `PENDING` (default), `APPROVED`, `REJECTED`, `CANCELLED` or `ALL`.
- Optional `from` and `to` (`YYYY-MM-DD`) limit the days.
- An employee always gets their own requests, whatever `employeeId` they send.

### One request
`GET /api/regularizations/:id` returns `{ "request": { ... } }`. `404 NOT_FOUND`, or `403 FORBIDDEN` for someone else's.

### Withdraw a pending request
`POST /api/regularizations/:id/cancel` returns `200 { "request": { ... } }` with status `CANCELLED`. `409 NOT_PENDING` if it was already decided.

## Admin endpoints (the dashboard uses these)

Roles: `ADMIN`, `SUPER_ADMIN`, `HR`, `HR_ADMIN`, `MANAGER`. Anyone else gets `403 FORBIDDEN`.

### List pending requests
`GET /api/regularizations` (default `status=PENDING`) returns every employee's requests. Add `employeeId` to filter to one employee.

### Approve
`POST /api/regularizations/:id/approve` with an optional `{ "note": "..." }`. Reply: `200 { "request": { ... } }` with `status: "APPROVED"` and `attendanceId`.

This creates one attendance row for the employee on that day:
- `checkIn` and `checkOut` are the times the employee gave, or their shift start and end.
- `workingHours` is worked out from them.
- `checkInMethod` and `clockOutMethod` are `REGULARIZED`.

The employee then counts as present in the attendance list and the dashboard totals. A Sunday or holiday goes through the normal Sunday/holiday shift verification like any other worked day.

| Status | `code` | When |
|---|---|---|
| 409 | `NOT_PENDING` | Already approved, rejected or withdrawn. |
| 409 | `ATTENDANCE_EXISTS` | The employee got attendance on that day after the request was sent. Reject it instead. |

### Reject
`POST /api/regularizations/:id/reject` with `{ "note": "No proof of work that day" }`. The `note` is required (3 to 500 characters, `400 NOTE_REQUIRED`) and is sent to the employee. Reply: `200 { "request": { ... } }` with `status: "REJECTED"`.

## Push to the phone

Both decisions send a normal (non-alarm) FCM push to the employee's registered devices:

```
notification: { title: "Attendance regularized", body: "You are marked present for 2 Nov 2026." }
data: { type: "REGULARIZATION", status: "APPROVED", requestId: "<id>", date: "2026-11-02" }
```

A rejection has `status: "REJECTED"`, the title "Regularization rejected" and the reason in the body. `data` values are strings. Route on `data.type === "REGULARIZATION"` and refresh `GET /api/regularizations?status=ALL`. The push is best effort, so the app should also refresh the list when it opens.

## Screens to add in the app

1. **Regularize attendance:**
   - a date picker limited to the last 31 days, before today;
   - a comment box;
   - optional check-in and check-out times;
   - attach up to 5 photos or PDFs (camera, gallery or files);
   - Send.
2. **My requests:** the list from `GET /api/regularizations?status=ALL`, with a status badge, the date, and the admin's `decisionNote` when rejected. A pending request has a Withdraw button.
3. Offer the screen from the attendance history, on a day that has no attendance, so the date is already filled in.

## Testing

Send a request for yesterday with one photo. It should appear on the HRMS dashboard under **Regularization**. Approve it there and check that the day shows as present in Attendance and that the phone gets the push.
