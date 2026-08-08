# PrintTune

PrintTune is a local-first advisory platform for FDM 3D printers. It collects structured printer
information, hardware configuration, slicer and filament data, calibration results, knowledge
packages, deterministic rules, diagnostics, and exposes a conversational AI assistant (German by
default) to guide users.

Alpha scope and constraints

- The Alpha is read-only with respect to printers, firmware, slicer profiles, and imported source
  files.
- Automatic internet research is disabled in Alpha; the product supports an extension point for
  future ResearchProviders.
- The AI assistant communicates with end users in German by default; source code, identifiers,
  schemas, tests, and developer docs use English.

Where to find documentation

- Agents rules: [AGENTS.md](AGENTS.md)
- Product: [docs/product/alpha-scope.md](docs/product/alpha-scope.md),
  [docs/product/user-flow.md](docs/product/user-flow.md)
- Architecture: [docs/architecture/overview.md](docs/architecture/overview.md)
- Safety: [docs/architecture/safety-boundaries.md](docs/architecture/safety-boundaries.md)
- Knowledge packages:
  [docs/architecture/knowledge-packages.md](docs/architecture/knowledge-packages.md)
- ADRs: [docs/decisions](docs/decisions)

Technology direction (Alpha)

- Electron + React + TypeScript (UI)
- Vite for local dev
- SQLite + Drizzle ORM for storage
- JSON Schema + Ajv and Zod for validation
- Ollama via AIProvider abstraction (local AI)
- SQLite FTS5 for local knowledge search
- pnpm workspaces, Vitest, React Testing Library, Playwright for tests

Important development rules

- Core domain libraries must be framework-independent TypeScript (no direct Electron/Node APIs).
- UI code must not access Node.js APIs directly; Electron preload APIs must be narrow and validated.
- Knowledge packages are declarative data and must not execute code.

Contributing

- Read [AGENTS.md](AGENTS.md) before making changes.
- Keep user-facing text in German; keep code and schemas in English.
- Open issues or PRs in this repository; include tests for implemented behavior.
