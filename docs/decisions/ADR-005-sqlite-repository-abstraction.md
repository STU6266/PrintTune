# ADR 005 — SQLite repository abstraction

Status: Accepted

Context

- Alpha needs a simple, reliable local datastore for structured records and full-text search.

Decision

- Use SQLite (FTS5) as the reference storage in Alpha, with a repository abstraction layer (e.g.,
  Drizzle ORM) so Core is storage-agnostic.

Positive consequences

- Robust local storage and search; easy to operate offline.

Negative consequences

- Migration paths must be designed for future stores; additional abstraction required.

Future considerations

- Keep repository interfaces small and well-documented to enable other storage backends later.
