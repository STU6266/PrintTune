# Safety boundaries

This document lists hard safety constraints and non-negotiable rules for the PrintTune architecture.

Read-only product behavior (non-negotiable)

- PrintTune must never directly modify: printer settings, firmware, slicer profiles, imported source
  files.
- PrintTune must never send G-code or initiate print control actions, or restart firmware or
  services.

AI boundaries

- The AI is an explanation and conversation layer only.
- The AI must not have unrestricted access to the filesystem, database, printer APIs, shell, or
  network services.
- The Core prepares structured `Evidence`, `Recommendations`, and `DiagnosticResult`s; the AI
  consumes these artifacts for natural-language explanation.
- When evidence is insufficient, the AI must state that reliable recommendations cannot be made.

Claims and safety

- Store individual `FieldClaim`s and derive `ResolvedField` values conservatively.
- Conflicts involving safety-sensitive fields must be handled conservatively: prefer safer defaults
  and present the conflict to the user.

Operational rules

- Any action that would change state on hardware or system must be presented as manual steps for the
  user to perform.
