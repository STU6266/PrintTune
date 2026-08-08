# ADR 005 — SQLite repository abstraction

Status: Accepted

Context

- Alpha needs a simple, reliable local datastore for structured records and full-text search.

Decision

- Use SQLite (FTS5) as the reference storage in Alpha, with a repository abstraction layer (e.g.,
  Drizzle ORM) so Core is storage-agnostic.
- The Alpha implementation uses the built-in `node:sqlite` driver in the local Electron main-process
  backend. It does not use `better-sqlite3` or Drizzle at this stage. This decision is based on the
  Electron 43 compatibility results recorded in
  [`node-sqlite-electron.md`](../architecture/spikes/node-sqlite-electron.md).

Positive consequences

- Robust local storage and search; easy to operate offline.

Negative consequences

- Migration paths must be designed for future stores; additional abstraction required.

Future considerations

- Keep repository interfaces small and well-documented to enable other storage backends later.
