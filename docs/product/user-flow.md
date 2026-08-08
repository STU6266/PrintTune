# User flows

This file describes common user journeys for the PrintTune Alpha.

1. Onboard a printer (manual-first)

- User creates a new Printer record and fills fields or imports configuration / slicer profile
  metadata.
- PrintTune stores `FieldClaim`s and builds a `ResolvedField` where possible; the UI highlights
  missing or conflicting claims.

2. Knowledge-driven diagnostics

- User asks the assistant (in German) about a print issue.
- Core collects Evidence (logs, metadata, user-provided observations), runs deterministic validation
  rules, and returns `DiagnosticResult` and Recommendations.
- Assistant explains findings and provides step-by-step manual instructions.

3. Calibration and Test Runs

- User runs a local test print and imports `TestRun` results (or provides observations).
- System stores `TestRun` tied to the `PrinterState` and relevant `KnowledgePackage` versions.

4. Managing knowledge packages

- User installs or updates KnowledgePackages (declarative data). Packages are versioned and
  referenced by `PrinterState` records.

5. Conversational assistance

- The chat remembers relevant progress within the local workspace and can follow up on workflows
  without performing system changes.
