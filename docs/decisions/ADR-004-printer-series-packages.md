# ADR 004 — Printer series packages

Status: Accepted

Context

- Many printers share marketing names but differ technically.

Decision

- Group printer knowledge by technical series using the `printer-series.<vendor>.<series>` naming
  scheme. Allow multiple models and revisions in one series package; split when technically
  necessary.

Positive consequences

- Easier organization and reuse of knowledge across similar models.

Negative consequences

- Some ambiguity when marketing names span unrelated hardware; requires careful package boundaries.

Future considerations

- Provide tooling to help package authors decide when to split packages.
