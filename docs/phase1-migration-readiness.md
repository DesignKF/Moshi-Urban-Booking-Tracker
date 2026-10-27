# Phase 1 — Read-only booking migration readiness

**Status:** Preparation only. Do not merge or change production until reviewed.

## What this branch does

Adds an **offline** audit utility and unit tests. It does not contact Firebase, Google Sheets, or any server; it never writes or deletes a booking. The existing app, synchronization logic, Firebase configuration, and production rules are unchanged.

## Operator checklist (before any export)

1. Confirm the Google Sheet tab containing the original, editable booking records. Avoid report tabs containing calculated summaries.
2. Confirm which Firebase project **and named Firestore database** the deployed app actually uses. The repository config has a custom `firestoreDatabaseId`; do not silently assume the default database.
3. Restrict copies of guest information to designated authorized personnel. Work on an encrypted device or protected storage; never attach raw guest exports to GitHub issues or commits.
4. Obtain an owner-approved, time-stamped backup of the **full original workbook** and a separate, documented Firestore backup. A CSV export alone is not a full workbook backup because it omits formulas and other tabs.
5. Record the export date/time, workbook and tab names, source record counts, operator, and any manual data modifications made while the audit is running.
6. Do not freeze or switch production during Phase 1.

## Offline comparison (after backups)

The tool accepts:
- A **CSV export of a booking input tab** with a detectable Booking ID and Guest Name header.
- A **JSON array** of reservations copied from an authorized Firestore export, or `{"documents":[{"data":{...}}]}` with plain field values. It does **not** support raw Firestore REST typed-value JSON or Firestore backup files. Convert using a separate reviewed procedure in a secure environment. Never read production Firestore directly from this audit script.

Run locally:

```bash
node --test tests/migrationAudit.test.mjs
node scripts/migration-audit.mjs --sheet /private/booking-overview.csv --firestore /private/reservations.json > /private/reconciliation-report.json
```

The tool **only reads** input files and writes its JSON report to standard output. Shell redirection to a local report is optional and controlled by the operator. Do not store exports or reports in the Git repository. The report contains booking IDs and field names, but not names, phone numbers, or full record contents; still treat IDs as sensitive.

It reports duplicate booking IDs, records missing on either side, and differences for fields present with nonempty values on both sides. Numeric amount formatting such as `1,000` and `1000` is normalized. Currency values are **not** converted. Records with empty/missing fields, invalid date formats, aliases the parser does not recognize, changes in spreadsheet rows during export, and semantic room/bed conflicts still require manual investigation. Never automatically "repair" or overwrite source data based only on this output. Duplicate IDs must be resolved before importing.

## Exit conditions for Phase 1

- Owner-controlled workbook and Firestore backups exist and can be restored.
- The exact live Firebase project/database and authoritative spreadsheet tab are identified.
- Export mapping has been checked on **sanitized** examples, with every important booking field mapped.
- Source counts, missing IDs, duplicate IDs, nonmatching bookings, and payment/currency differences are reviewed by an authorized person.
- Discrepancies are documented; zero differences should never be assumed without exporting and reviewing both actual sources.
- A cutover and rollback procedure is agreed **before** production changes.

**Explicitly out of scope:** live access, production configuration or Firestore rules changes, new database deployment, migrations, bookings edits/deletes, staff login changes, removing Google Sheets, changing application UX, automatic backups, and production cutover.
