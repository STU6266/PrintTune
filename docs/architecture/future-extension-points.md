# Future extension points

The Alpha deliberately limits functionality. The following are planned extension points for future
versions.

- `ResearchProvider`: opt-in external research and evidence providers (see
  docs/architecture/research-extension.md).
- Additional `AIProvider` connectors: cloud or self-hosted LLMs beyond local Ollama.
- Optional read-only printer connectors for convenience (must preserve read-only constraints).
- KnowledgePackage distribution mechanisms and signing/trust systems.
- Pluggable analysis modules for advanced diagnostics (must follow data-only KnowledgePackage
  constraints).
