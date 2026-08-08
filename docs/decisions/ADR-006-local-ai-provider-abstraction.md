# ADR 006 — Local AI provider abstraction

Status: Accepted

Context

- The Alpha requires a local AI experience without mandatory cloud dependencies.

Decision

- Implement an `AIProvider` abstraction. The Alpha reference implementation may use a local Ollama
  provider behind this abstraction.

Positive consequences

- Local-first privacy-preserving AI usage option.

Negative consequences

- Local models may have resource and capability limitations.

Future considerations

- Add additional providers behind the same abstraction for cloud or paid options.
