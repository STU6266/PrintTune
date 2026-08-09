# Knowledge packages

KnowledgePackages are PrintTune's mechanism for versioned printer-specific and domain knowledge.
They are immutable, source-bearing declarative data and never executable application code. Core owns
canonical field meanings, resolution policies, and safety semantics; packages can contribute
evidence but cannot redefine those rules.

The exact initial package envelope, printer-series payload, trust boundary, validation stages, and
physical `.ptpack` format are defined in [`knowledge-package-v1.md`](knowledge-package-v1.md).

Package references always use stable machine identifiers and an exact version. A physical Printer's
optional series/model selection and local display snapshot follow
[`printer-knowledge-identity.md`](printer-knowledge-identity.md). Component catalog identity and
historical installation snapshots follow
[`component-identity-model.md`](component-identity-model.md). Package facts later become immutable,
provenance-bearing FieldClaims rather than mutable properties on either identity model. Their pure
conversion boundary and externally established trust requirement are defined in
[`package-claim-materialization.md`](package-claim-materialization.md).

The durable Alpha boundary for exact accepted content, local installation source, and trust is
designed in [`installed-knowledge-packages.md`](installed-knowledge-packages.md).

Distribution, installation storage, signature verification, dependencies, rules, assets, package
derived claims, and real manufacturer content remain separate future work.
