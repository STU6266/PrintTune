# ADR 003 — Declarative knowledge packages

Status: Accepted

Context

- Printer-specific knowledge must be extensible and auditable.

Decision

- Capture printer and domain knowledge in versioned, declarative KnowledgePackages that never
  contain executable application code.

Positive consequences

- Easier auditing, versioning, and distribution of knowledge.
- Safer security posture (no executing package code).

Negative consequences

- Some dynamic behaviors must be implemented in Core rather than in packages.

Future considerations

- Define a package distribution and signing/trust model.
