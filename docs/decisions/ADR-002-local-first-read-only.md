# ADR 002 — Local-first, read-only product behavior

Status: Accepted

Context

- Users interact with printers and provide potentially sensitive device data. Safety requires
  conservative behavior.

Decision

- The product will be local-first and enforce read-only interactions with printers and imported
  files. All changes must be manual and user-driven.

Positive consequences

- Reduces risk of accidental or malicious device modification.
- Preserves user control and auditability.

Negative consequences

- Some automation convenience is not available in Alpha.

Future considerations

- Consider optional, clearly labelled integrations for advanced users that are gated and explicitly
  consented to.
