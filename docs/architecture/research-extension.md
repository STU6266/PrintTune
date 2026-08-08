# ResearchProvider extension

Alpha state

- Automatic internet research is disabled in the Alpha.

Design for future research providers

- Provide a `ResearchProvider` abstraction that can be implemented to supply evidence or external
  sources to Core.
- Provider implementations may include: free web research, self-hosted search, paid search APIs,
  paid AI research APIs, or cloud AI connectors.
- Research providers must be opt-in and pay-aware: they may incur usage costs and require
  configuration.

Security and provenance

- Any external evidence must be stored with provenance and clearly labelled as externally sourced.
- ResearchProvider implementations must not be used by default in Alpha; they are strictly a future
  extension point.
