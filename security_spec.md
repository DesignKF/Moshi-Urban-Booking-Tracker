# Security Specification: Moshi Urban Hostel

## 1. Data Invariants
- A reservation document ID must be valid alphanumeric identifier matching `^[a-zA-Z0-9_-]+$`.
- Only authenticated hostel staff or admins can read or write reservations.
- Required fields for a reservation include `id`, `guestName`, `room`, `bedCode`, `checkIn`, `checkOut`, and `status`.
- String fields are bounded in length (e.g. `guestName` <= 150 chars, `notes` <= 1000 chars) to prevent Denial of Wallet.
- User profile documents in `/users/{userId}` can only be written by the authenticated user whose `uid` matches the document ID or an admin.
- Sensitive role escalation is prevented: users cannot assign themselves `admin` role arbitrarily.

## 2. The Dirty Dozen Payloads (Rejection Targets)
1. Missing `guestName` on reservation creation.
2. Missing `checkIn` or `checkOut` on reservation creation.
3. Over-length `guestName` (>150 characters).
4. Unbounded string injection attack on `notes` (>1000 characters).
5. Document ID poisoning with special characters or path traversal.
6. Unauthenticated reservation creation.
7. Unauthenticated reservation read / listing.
8. Writing to `/users/{otherUserId}` by a non-matching authenticated user.
9. Privilege escalation: regular user setting `role: 'admin'`.
10. Malformed status value not in allowed status enum.
11. Extra shadow fields injection not defined in reservation schema.
12. Attempting to write reservation with negative total amount.
