# Temporary Firestore database — private reservation JSON export

**No production activity is performed by this script.** The script is not a backup importer. A qualified, authorized cloud administrator must first restore the existing Firestore backup into a **separate isolated project**, with the target database empty and confirmed to be non-production.

## Safeguards
- Rejects the production project ID from the app's checked-in configuration.
- Rejects the known named production database ID.
- Requires a clearly named temporary project `moshi-urban-migration*` or `moshi-urban-audit*`.
- Requires explicit project, database and output path.
- Queries only `reservations`, never writes Firestore documents.
- Will not overwrite an existing JSON file.
- Retains full document fields and fails on mismatched document/reservation IDs.

**Security note:** Project-name checks are a secondary safety mechanism, not proof of isolation. Before execution, check project ownership, the Google Cloud console destination, and the identity being used. The operator must grant the identity only the minimal **read-only** access to the temporary database; never use the application's production credentials. Never upload a private key or guest exports to GitHub.

## In a private operator environment

Install Node.js and `firebase-admin` separately from the PMS application, using an isolated directory (not inside the public GitHub project). Use Application Default Credentials for the **temporary** project.

From that private environment with repository scripts available, run:

```bash
node scripts/export-test-firestore-reservations.mjs --project moshi-urban-migration-test --database '(default)' --output /private/firestore-reservations.json
```

Replace values with the **verified actual isolated target**. The example database `(default)` applies only if that database really holds the restored copy. If setup, access permissions, or identity are unclear, **do not execute**. The database snapshot is current as of the read of the isolated restored copy.

Then use `scripts/migration-audit.mjs` with the protected Bookings-tab CSV and the resulting private JSON. The script generates a JSON report without modifying either input.

## Limitations and next checks

This script has not been run against any Google Cloud environment or real guest data. It assumes the isolated database has already been restored and requires a compatible `firebase-admin` version. Test it against fictional records before working with sensitive data. Confirm export count against the temporary Firestore collection count and the original backup metadata. Delete temporary guest copies following the approved retention plan only after verification; **never delete the original backup**.

The offline audit identifies likely differences but does not prove all booking records are correct, and it does not migrate anything. Dates, deposits, refunds, bookings without IDs, and missing columns require review. Keep `main` and production untouched until all checks pass.
