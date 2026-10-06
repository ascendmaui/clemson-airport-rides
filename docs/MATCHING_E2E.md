# Matching E2E fixture coverage

`tests/matchingE2E.test.js` exercises the matching seam without credentials or network access:

- a seeded rider, approved online driver, and searching trip appear in the driver desk;
- `acceptTrip` persists the winner and writes one accepted event;
- the accepted row drives the rider live view to En route with assigned-driver coordinates;
- simultaneous accepts produce exactly one winner; and
- offline and unapproved drivers are rejected.

Additionally, the specific scenario of rider cancel while searching (R001) is covered by a dedicated CI test.

The following scenarios are also covered by dedicated tests:

- R001: rider cancel removes a searching offer and rejects a stale driver accept
- R002: rider cancels accepted trip; driver accept is rolled back and trip is canceled
- R003: driver can decline a searching trip, allowing another driver to accept (now passes)
- R004: driver who declined a canceled trip can be offered a new trip
- R005: driver desk correctly handles trips of different tiers (standard vs tesla)
- R006: driver desk correctly handles scheduled trips (now passing)
- R007: driver desk correctly handles trip lifecycle from acceptance to completion
- R008: 
  * driver desk shows multiple concurrent searching trips as separate offers
  * driver can accept either of multiple concurrent searching trips
  * driver desk does not show completed trips as offers

Run the dedicated tests with:

```sh
node --test tests/matchingE2E_R001.test.js
node --test tests/matchingE2E_R002.test.js
node --test tests/matchingE2E_R003.test.js
node --test tests/matchingE2E_R004.test.js
node --test tests/matchingE2E_R005.test.js
node --test tests/matchingE2E_R006.test.js
node --test tests/matchingE2E_R007.test.js
node --test tests/matchingE2E_R008.test.js
```

The application-level approval and online checks are covered here. The live database defense-in-depth gap remains until the `driver_approval_accept_gate` migration associated with #118 is safely renamed, reviewed, and applied. This test change does not modify or apply that migration.

## Driver Approval Gate

The migration `supabase/migrations/20260925120000_driver_approval_accept_gate.sql` adds a database-level guard that prevents trip acceptance by drivers whose applications are not approved. The fixture in `tests/fixtures/matchingE2E.js` does not implement this guard, so the E2E tests do not cover it. However, the gate is designed to be compatible with the existing matching logic and should be verified separately.

### Testing the Gate

To test the gate locally, one would need to deploy the migration to a development Supabase instance and write integration tests that attempt to accept trips with unapproved drivers. Such tests are not currently in the repository but could be added in the future.

### Migration Status

As of the latest commit, the migration is not applied to the production Supabase project. It requires approval before deployment.
