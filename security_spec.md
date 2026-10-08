# Security Specification: Moshi Urban Hostel

## 1. Data Invariants
- A reservation document ID must be valid alphanumeric identifier matching `^[a-zA-Z0-9_-]+$`.
- Hostel room availability and reservations are publicly readable (`get`, `list`) so guests and hostel visitors can view live availability.
- Required fields for a reservation include `id`, `guestName`, `room`, `bedCode`, `checkIn`, `checkOut`, and `status`.
- String fields are bounded in length (e.g. `guestName` <= 150 chars, `notes` <= 1000 chars) to prevent Denial of Wallet.
- Single-document target operations (`get`, `create`, `update`, `delete`) enforce ID format and boundary checking (`isValidId`).
- User profile documents in `/users/{userId}` can only be written by the authenticated user whose `uid` matches the document ID or an admin.
- Sensitive role escalation is prevented: users cannot assign themselves `admin` role arbitrarily.

## 2. The Dirty Dozen Payloads (Rejection Targets)
1. Missing `guestName` on reservation creation.
2. Missing `checkIn` or `checkOut` on reservation creation.
3. Over-length `guestName` (>150 characters).
4. Unbounded string injection attack on `notes` (>1000 characters).
5. Document ID poisoning with special characters or path traversal.
6. Writing to `/users/{otherUserId}` by a non-matching authenticated user.
7. Privilege escalation: regular user setting `role: 'admin'`.
8. Malformed status value not in allowed status enum.
9. Extra shadow fields injection not defined in reservation schema.
10. Attempting to write reservation with negative total amount.
11. Unauthenticated write or update to user profiles.
12. Attempting to delete user profile documents.
