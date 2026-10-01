# Matching E2E fixture coverage

`tests/matchingE2E.test.js` exercises the matching seam without credentials or network access:

- a seeded rider, approved online driver, and searching trip appear in the driver desk;
- `acceptTrip` persists the winner and writes one accepted event;
- the accepted row drives the rider live view to En route with assigned-driver coordinates;
- simultaneous accepts produce exactly one winner; and
- offline and unapproved drivers are rejected.

Run it with:

```sh
node --test tests/matchingE2E.test.js
```

The application-level approval and online checks are covered here. The live database defense-in-depth gap remains until the `driver_approval_accept_gate` migration associated with #118 is safely renamed, reviewed, and applied. This test change does not modify or apply that migration.
