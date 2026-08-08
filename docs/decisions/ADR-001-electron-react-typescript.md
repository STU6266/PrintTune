# ADR 001 — Electron + React + TypeScript

Status: Accepted

Context

- The UI requires a native-like desktop experience for interacting with local printers and files.

Decision

- Use Electron + React + TypeScript for the UI layer. Keep Core domain code framework-independent.

Positive consequences

- Fast desktop iteration and broad desktop platform support.
- Familiar web stack for UI engineers.

Negative consequences

- Electron adds distribution and packaging complexity.

Future considerations

- Re-evaluate desktop frameworks if packaging and performance tradeoffs change.
