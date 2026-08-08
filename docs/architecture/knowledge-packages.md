# Knowledge packages

KnowledgePackages are the primary mechanism to capture printer-specific and domain knowledge.

Characteristics

- Declarative data packages (JSON/YAML/archives) containing facts, mappings, detection rules,
  validation rules, safety rules, questions, instructions, diagnostics, recommendations, workflows,
  sources, images, and static test models.
- Must not contain executable application code.
- Versioned and referenced by `PrinterState` and `TestRun` records for traceability.

Organization

- Namespaced by logical group, e.g. `printer-series.creality.ender-3-classic`.
- A series package may contain multiple models and revisions; split a package when technically
  needed.

Localization

- KnowledgePackages may include localized text; UI-facing localization is used at runtime.

Validation and signing

- Packages should include metadata (version, checksum, source). The Core validates package schemas
  before use.
