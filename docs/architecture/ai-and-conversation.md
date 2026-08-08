# AI and conversation

Role of the AI

- The AI is a natural-language explanation and guidance layer. It consumes structured artifacts
  (`Evidence`, `DiagnosticResult`, `Recommendation`) prepared by Core and returns German-language
  responses to the end user by default.

Constraints

- The AI must not be treated as the ultimate authority on safety or limits. The UI and Core must
  present provenance and evidence with every technical recommendation.
- The AI must not have direct access to the filesystem, database, shell, network, or printer APIs.

Provider abstraction

- Use an `AIProvider` abstraction to encapsulate local or remote LLM backends (Alpha implements a
  local provider such as Ollama behind this abstraction).

Conversation behavior

- Keep conversation context local to the workspace; persist only what is necessary for the user
  experience and privacy.
- When insufficient evidence exists, the assistant must ask for targeted information or say that a
  reliable recommendation cannot be produced.
