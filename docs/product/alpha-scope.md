# Alpha scope

This document defines the PrintTune Alpha scope and explicitly out-of-scope items.

In-scope (Alpha)

- Local-first advisory UI for FDM 3D printers.
- Import and analyze: configuration files, slicer profiles, G-code/3MF metadata, archives, and
  copied terminal output.
- Declarative KnowledgePackages for printer series, common hardware, materials, diagnostics, and
  workflows.
- Conversational assistant (German default) that explains evidence, recommendations, and
  step-by-step manual instructions.
- Local AI via the AIProvider abstraction (no cloud dependency required in Alpha).

Out-of-scope (Alpha)

- Any automatic modification of printers, firmware, slicer profiles, or imported files.
- Sending G-code to printers or initiating print control actions.
- Automatic internet research or web scraping (disabled — see
  docs/architecture/research-extension.md).
- Executable code embedded in knowledge packages.

Future extension points

- Research providers (optional, pluggable in future releases).
- Optional read-only printer integrations (connectors) as convenience features.
