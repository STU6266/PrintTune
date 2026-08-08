# Architecture overview

High-level components

- Core domain library (framework-independent TypeScript): data models, business rules, validation,
  diagnostic engine.
- Storage / Repository layer: abstracted behind interfaces (SQLite + Drizzle ORM in Alpha).
- KnowledgePackage store: versioned, declarative data packages used by Core.
- UI: Electron + React (strict separation from Core). UI code must not call Node APIs directly.
- Electron preload API: narrow, validated surface for privileged operations.
- AIProvider abstraction: local AI provider implementation (Ollama) in Alpha.
- ResearchProvider abstraction: extension point for future research backends (disabled in Alpha).

Key constraints

- Core must not depend on Electron/React or concrete storage implementations.
- KnowledgePackages are data-only and never execute code.
- Read-only product behavior — Core never performs operations that change printers or external
  systems.
