# Agents Guidelines

These are concise instructions that all future coding agents and contributors must follow when
modifying the PrintTune repository or implementing features.

1. Printer, firmware, slicer, and imported files are read-only from PrintTune's perspective. Never
   modify user-supplied printer files or device firmware.
2. Never add printer-control functions (no functions that start, stop, pause, resume, or otherwise
   control a printer or send G-code).
3. Never add unrestricted network or filesystem access to the AI or any component that the AI can
   call.
4. Printer-specific knowledge belongs in KnowledgePackages, not in Core application logic.
5. Knowledge packages must not contain or execute code — they are declarative data only.
6. Core domain code must not depend on Electron, React, or concrete storage implementations; it must
   remain framework-independent TypeScript.
7. Internet research is disabled in the Alpha release — do not add automatic web research or
   external search functionality in Alpha.
8. Any future research capability must be routed through a `ResearchProvider` abstraction (see
   docs/architecture/research-extension.md).
9. When implementing tasks, make the smallest change required to satisfy the task; avoid broad
   refactors.
10. Do not refactor or rewrite unrelated code when performing focused tasks.
11. Add tests when behavior is implemented; include tests for data model, domain logic, and
    integrations where appropriate.
12. After each coding task, report: changed files, added/updated tests, and any remaining risks or
    ambiguities.

Agents must always verify that no application implementation code is added when the task is to
create documentation only.
