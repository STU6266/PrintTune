# ADR 007 — No automatic internet research in Alpha

Status: Accepted

Context

- Automatic web research can introduce privacy, cost, and reliability concerns.

Decision

- Disable automatic internet research in Alpha. Provide a `ResearchProvider` abstraction for future
  opt-in providers.

Positive consequences

- Predictable offline behavior and reduced privacy surface.

Negative consequences

- Search-driven recommendations may be less comprehensive in Alpha.

Future considerations

- Define opt-in research providers that surface provenance and cost to users.
