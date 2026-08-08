# Diagnostics

Diagnostics are deterministic, evidence-driven routines that help users identify and resolve
printing issues without performing automatic changes.

Process

1. Evidence collection: Core collects structured `Evidence` from user-provided inputs, imported
   metadata, and test run results.
2. Rule evaluation: Deterministic rules from KnowledgePackages and Core run against the Evidence to
   produce `DiagnosticResult`s.
3. Recommendations: Core emits `Recommendation`s with provenance, required confidence, and manual
   steps for the user.

Recording

- All `DiagnosticResult`s and `Recommendation`s are stored with references to the `PrinterState`,
  `KnowledgePackage` versions, and `FieldClaim`s used.

User interaction

- The AI assistant presents results in German, explains the evidence and gives actionable, manual
  steps. The system never performs the steps automatically.
