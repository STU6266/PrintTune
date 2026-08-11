# Data model principles

Core domain model terminology (use consistently)

- `Printer`: a logical representation of a physical printer.
- Printer-series/model knowledge is an optional, versioned lifetime-identity selection whose
  technical facts remain state-scoped claims; see
  [`printer-knowledge-identity.md`](printer-knowledge-identity.md).
- `PrinterState`: an immutable snapshot of a printer at a point in time. Hardware changes create new
  `PrinterState`s. The explicit future working-state selection, lineage, and conservative transition
  semantics are defined in [`printer-state-lifecycle.md`](printer-state-lifecycle.md).
- `ComponentInstallation`: an installed component (mainboard, hotend, probe) with metadata and
  provenance. Its identity model is defined in
  [`component-identity-model.md`](component-identity-model.md).
- `FieldClaim`: a single observed or imported claim about a printer field (value + source +
  timestamp). Targeting, provenance, trust, and value semantics are defined in
  [`field-claims-and-resolution.md`](field-claims-and-resolution.md).
- `ResolvedField`: the resolved value for a field derived from one or more `FieldClaim`s and
  resolution rules.
- `KnowledgePackage`: a declarative package of facts, rules, and help content.
- `Evidence`: structured inputs used by diagnostics (logs, metadata, user answers, test
  measurements).
- `Recommendation`: a suggested manual action or mitigation with provenance.
- `Workflow`: a guided multi-step procedure for users to follow.
- `TestRun`: a recorded test or calibration run, tied to a `PrinterState` and KnowledgePackage
  versions.
- `DiagnosticResult`: deterministic or probabilistic findings produced by Core.

Principles

- Preserve history: never overwrite prior `PrinterState`s; append new states for hardware changes.
- Create every persisted `Printer` atomically with exactly one initial `PrinterState`; normal
  application creation must not persist a Printer by itself.
- Alpha now persists an explicit working `PrinterState` selection and optional immutable parent
  lineage. Current desktop flows intentionally continue using the initial state until the authorized
  state-management/UI phases are implemented; transition planning remains deferred. See
  [`printer-state-lifecycle.md`](printer-state-lifecycle.md).
- Claim-first: store raw `FieldClaim`s; compute `ResolvedField`s deterministically and
  conservatively.
- Traceability: all `Recommendation`s and `DiagnosticResult`s reference the evidence and package
  versions used.
