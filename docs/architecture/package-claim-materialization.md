# Knowledge Package fact materialization

## Purpose and placement

Knowledge Package fact materialization is the pure boundary that turns one validated,
Core-compatible printer-series package into immutable baseline `FieldClaim`s for one exact
`PrinterState`. It belongs in `@printtune/knowledge-engine`: package-engine owns format validation,
Core owns field and Claim semantics, and application/storage code later owns trust acquisition and
atomic persistence.

The materializer does not parse packages, select current records, read repositories, create a
PrinterState, assign trust, or persist Claims. It returns `readonly FieldClaim[]`; a result wrapper
or PackageApplication model adds nothing required by the first pure implementation.

## Minimum inputs

The proposed operation receives:

- one exact `PrinterKnowledgeIdentity`;
- one validated `PrinterSeriesKnowledgePackageV1`;
- one exact existing `PrinterState` supplied by the caller;
- one externally established `PackageKnowledgeTrust`;
- one materialization `createdAt`; and
- a narrow Claim-ID factory invoked once per effective fact in deterministic order.

`PackageKnowledgeTrust` is the closed union `"developer_verified" | "customer_verified"`. These are
the existing trust outcomes approved for package evidence. `user_confirmed`, `user_entered`,
`imported_observation`, and `ai_generated_unverified` describe other evidence boundaries and cannot
masquerade as package trust.

Effective facts are not supplied separately. The materializer derives them internally from the
package and known identity's optional `modelDefinitionId`, using the existing compatibility and
effective-fact operations. A separate fact array would be redundant and could disagree. The ID seam
produces a fresh local Claim ID on every call:

```ts
type PackageClaimIdFactory = () => string;
```

The application layer owns UUID and clock access; tests inject deterministic values. The complete
package/identity/state/trust context and all facts are validated before the factory is invoked.
Every returned Claim ID must be valid and unique. `factId` remains provenance identity and is never
reused or deterministically transformed into a local Claim ID. Deterministic tests use a closure
that returns `claim-1`, `claim-2`, and so on in effective-fact call order. Array positions are never
identities.

One explicit UTC `createdAt` applies to the complete batch. This represents one evidence-application
event and avoids artificial recency between its facts. Claim IDs do not establish recency, and
package content supplies neither local IDs nor timestamps.

## Exact applicability and alignment

Only `PrinterKnowledgeIdentity.kind === "known"` can produce package Claims. An `unclassified`
identity rejects with `identity_not_known`; package availability never overrides the user's explicit
classification.

Before creating any Claim, require exact equality between:

1. identity `definitionRef.packageId` and package `packageId`;
2. identity `definitionRef.packageVersion` and package `packageVersion`;
3. identity `definitionRef.seriesDefinitionId` and package `payload.series.seriesDefinitionId`; and
4. identity `printerId` and target `printerState.printerId`.

There is no `latest`, version substitution, display-name/publisher matching, alias inference, or
current-state selection. Display snapshots are historical labels, not lookup identity. The caller
supplies the exact state; the materializer never infers one by timestamp or ID.

For a series-only identity, absent `modelDefinitionId` produces series-only facts. For an
exact-model identity, the existing effective-fact operation must find that exact ID. An absent model
rejects the whole operation; it never falls back, fuzzy matches, or chooses the first model.

## Validation and trust boundary

A valid/Core-compatible package means its structure and technical field semantics are interpretable.
It does not mean the package is locally trusted. Trust is assigned outside the manifest by a future
installation/distribution boundary and passed as the closed `PackageKnowledgeTrust` value.

The materializer never infers trust from publisher metadata, package namespace, names, contents, or
technical validity. During the interim Alpha seam, orchestration and synthetic tests may inject an
approved typed value. This is dependency injection, not package self-trust. Production flows must
eventually obtain it from a local trusted installation/source boundary; UI and packages must never
freely select trust. Installation and trust persistence remain future work.

Core compatibility is checked again at the public materialization boundary for runtime safety. It
validates the complete package, including unselected models, before IDs are requested or output is
created. Packages cannot contribute ResolutionPolicies, confidence, safety flags, or authority.

## Exact Claim mapping

Each selected effective fact produces exactly one Claim:

```ts
{
  id: claimIdFactory(),
  target: { type: "printer_state", printerStateId: printerState.id },
  fieldPath: effectiveFact.fieldPath,
  value: effectiveFact.value,
  ...(effectiveFact.unit === undefined ? {} : { unit: effectiveFact.unit }),
  provenance: {
    sourceType: "knowledge_package",
    sourceRef: {
      type: "knowledge_package",
      packageId: package.packageId,
      packageVersion: package.packageVersion,
      factId: effectiveFact.factId,
    },
  },
  trust: packageKnowledgeTrust,
  createdAt,
}
```

Implementation should call Core `createFieldClaim()` rather than duplicate validation/freezing. The
low-level contract still accepts historical package provenance without `factId`; this boundary never
produces it. It preserves the winning fact's exact ID, scalar discriminator/value, unit, and field
path without conversion, rounding, normalization, or AI transformation.

Series/model IDs do not belong in Claim provenance; PrinterKnowledgeIdentity records that selection.
Printer-series v1 always targets the supplied `printer_state` and cannot generate component Claims.

## Failure behavior

The materializer fails the complete operation deterministically and returns no partial array. The
minimal failure codes are:

- `identity_not_known`;
- `package_identity_mismatch`;
- `series_definition_mismatch`;
- `model_definition_not_found`;
- `printer_state_ownership_mismatch`;
- `invalid_package_trust`;
- `incompatible_package`; and
- `invalid_materialization_context` for an invalid timestamp, invalid generated Claim ID, or
  duplicate generated IDs.

Errors carry only stable technical context such as expected/received machine IDs and preserve
deterministic compatibility issues where applicable. They do not expose arbitrary exceptions or
introduce localization.

## Persistence, reapplication, and history

Pure materialization performs no writes. Future persistence must insert the complete batch in one
transaction after successful materialization; if any Claim fails, none may remain stored. The
storage boundary provides this through atomic `FieldClaimRepository.createBatch()` semantics.

The pure function cannot know whether invocation is a retry or a deliberate new historical event. It
therefore returns a fresh batch for each explicit call. Alpha must not infer idempotency from equal
values or matching provenance. Before user-facing or automatically retryable reapplication, a future
PackageApplication/audit record should provide an idempotency key and lifecycle. This is deferred
instead of approximated with Claim-value heuristics.

Versions never float. Claims for identity `P/1.0` can come only from package `P/1.0`. Installing
`P/1.1` cannot contribute to that identity or rewrite its Claims; applying 1.1 requires an explicit
new PrinterKnowledgeIdentity selection/correction pinned to 1.1 and a new materialization event.

A physical configuration change creates a new PrinterState outside this boundary. The same known
Printer identity may be materialized for the new exact state because product classification is
lifetime metadata while Claims are state-scoped. Old-state Claims remain untouched. Package
baselines remain evidence rather than proof that modified hardware is stock; direct installed or
user-confirmed evidence can win through existing Core policies. The materializer does not increase
package authority or special-case resolution.

## Required pipeline

```text
.ptpack text
→ parse plus structural and package-semantic validation
→ complete Core FieldDefinition compatibility validation
→ establish local package trust outside the manifest
→ choose or confirm an exact PrinterKnowledgeIdentity
→ supply one exact existing PrinterState
→ derive effective facts and materialize immutable FieldClaims
→ atomically persist the complete Claim batch
→ resolve through the existing FieldResolutionService
```

Trust assignment and Claim persistence never occur before validation.

## Recommended implementation sequence

### 4.6b — pure materialization

Implement exact identity/package/series/model/state checks, externally supplied approved trust,
internally derived facts, mandatory fact provenance, deterministic ID/time seams, immutable Claims,
typed failures, and no persistence.

### 4.6c — atomic application orchestration

Add a storage transaction that materializes and persists the complete batch, then prove with
synthetic data that existing resolution reads the stored Claims. Package installation/trust storage
is not part of that step.

Only afterwards should PrintTune design installed-package storage, durable trust assignment, and
user-facing application. Real printer data, executable package content, filesystem loading, IPC, UI,
AI, network, printer connectivity, and TestWorkflow assets remain outside this design.
