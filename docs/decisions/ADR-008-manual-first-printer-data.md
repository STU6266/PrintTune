# ADR 008 — Manual-first printer data

Status: Accepted

Context

- Many users cannot, or choose not to, connect printers directly to the app.

Decision

- Design the Alpha to work without direct printer connections. Accept user-provided configuration,
  profile metadata, G-code metadata, and manual inputs as primary sources.

Positive consequences

- Broader support for users who prefer manual workflows and those with closed printers.

Negative consequences

- Some integrations and automation conveniences are delayed to future releases.

Future considerations

- Provide optional, clearly labelled read-only connectors for users who want tighter integrations.
