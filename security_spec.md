# Security Specification: Moshi Urban Hostel PMS

## 1. Zero-Trust Data Invariants
1. **No Public Guest Data**: Unauthenticated users are strictly barred from reading, listing, or modifying any reservations, guests, or financial payments.
2. **Deterministic Document IDs**: All document IDs (`reservationId`, `guestId`, `paymentId`, `userId`, `logId`) must strictly conform to `^[a-zA-Z0-9_\-]+$` and length <= 128 characters (`isValidId()`).
3. **Immutable Identity & Timestamps**: Client requests cannot forge user roles or bypass role tiers. `createdAt` is immutable upon update.
4. **Anti-Update-Gap Validation**: Every write operation (`create` and `update`) executes entity-specific validation helpers (`isValidReservation`, `isValidGuest`, `isValidPayment`, `isValidUserRole`, `isValidUserProfile`).
5. **No Self-Assigned Role Escalation**: Authenticated users writing to `/users/{userId}` cannot assign or escalate their own role to `admin` or `manager`.
6. **Immediate Revocation via Suspension**: If a staff or manager account has `status == 'suspended'` in `/user_roles/{email}`, all operational access is synchronously blocked.
7. **Strict Financial Accounting**: Payments require a positive amount, supported currency (`USD`, `TZS`, `EUR`, `GBP`), designated transaction type, and authenticated employee recording.
8. **Audit Trail Completeness**: Audit logs can only be created by signed-in staff, recording traceable mutations.

## 2. The "Dirty Dozen" Rejection Payloads
1. **Unauthenticated Public Read**: Anonymous or unauthenticated request querying `/reservations` -> `PERMISSION_DENIED`.
2. **Missing Required Fields**: Reservation creation missing `guestName`, `room`, `bedCode`, `checkIn`, `checkOut`, or `status` -> `PERMISSION_DENIED`.
3. **Invalid Date Inversion**: Check-in date on or after check-out date (`checkIn >= checkOut`) -> `PERMISSION_DENIED`.
4. **Denial-of-Wallet String Injection**: `guestName` > 150 characters or `notes` > 1000 characters -> `PERMISSION_DENIED`.
5. **Document ID Poisoning**: Reservation ID with path traversal or illegal symbols (`../../bad_id`) -> `PERMISSION_DENIED`.
6. **Privilege Escalation in User Profile**: Regular staff user attempting to write `{ role: 'admin' }` to their own `/users/{uid}` -> `PERMISSION_DENIED`.
7. **Unauthorized Role Modification**: Non-admin attempting to create or modify records in `/user_roles/{email}` -> `PERMISSION_DENIED`.
8. **Suspended User Write**: Account with `status: 'suspended'` attempting to create or update reservations -> `PERMISSION_DENIED`.
9. **Negative Financial Value**: Payment document with `amount: -100` -> `PERMISSION_DENIED`.
10. **Shadow Key Injection**: Payload containing unauthorized arbitrary keys beyond schema definition -> `PERMISSION_DENIED`.
11. **Cross-User Profile Hijack**: Authenticated user trying to write to `/users/{anotherUid}` without admin rights -> `PERMISSION_DENIED`.
12. **Public Guest PII Access**: Unauthenticated access to `/guests/{guestId}` attempting to harvest phone numbers and emails -> `PERMISSION_DENIED`.
