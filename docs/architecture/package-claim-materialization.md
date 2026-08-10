# Knowledge Package fact materialization

## Purpose and placement

Knowledge Package fact materialization is the pure boundary that turns one validated,
Core-compatible printer-series package into immutable baseline `FieldClaim`s for one exact
`PrinterState`. It belongs in `@printtune/knowledge-engine`: package-engine owns format validation,
Core owns field and Claim semantics, while Main/storage own trusted package acquisition and atomic
persistence.

The materializer does not parse packages, select current records, read repositories, create a
PrinterState, assign trust, or persist Claims. It returns `readonly FieldClaim[]`; a result wrapper
or PackageApplication model adds nothing required by the first pure implementation.

## Minimum inputs

The implemented operation receives:

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

There is no latest-version resolution, version substitution, display-name/publisher matching, alias
inference, or current-state selection. A literal package version `latest` is just that exact opaque
key. Display snapshots are historical labels, not lookup identity. The caller supplies the exact
state; the materializer never infers one by timestamp or ID.

For a series-only identity, absent `modelDefinitionId` produces series-only facts. For an
exact-model identity, the existing effective-fact operation must find that exact ID. An absent model
rejects the whole operation; it never falls back, fuzzy matches, or chooses the first model.

## Validation and trust boundary

A valid/Core-compatible package means its structure and technical field semantics are interpretable.
It does not mean the package is locally trusted. The implemented trusted installation/source
boundary assigns trust outside the manifest and passes the closed `PackageKnowledgeTrust` value.

The materializer never infers trust from publisher metadata, package namespace, names, contents, or
technical validity. Orchestration and synthetic tests may inject an approved typed value. This is
dependency injection, not package self-trust. The production Main flow obtains it from
`InstalledKnowledgePackageSource`; UI and packages never freely select trust.

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

The implementation calls Core `createFieldClaim()` rather than duplicating validation/freezing. The
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

Pure materialization performs no writes and remains stateless: independent calls can still produce
fresh Claim batches. The authoritative `PrinterKnowledgeApplicationService` Main path now persists
the PackageApplication, complete Claim batch, and exact membership through one atomic
`PackageApplicationLifecyclePersistence.applyOnce()` operation.

The pure function cannot know whether invocation is a retry or a deliberate new historical event. It
therefore returns a fresh batch for each direct call. Main does not infer idempotency from equal
values or matching provenance; it uses the durable PackageApplication semantic key and atomic
apply-once boundary defined in [`package-application.md`](package-application.md).

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

## Implementation status

The pure materializer, atomic `createBatch()` storage boundary, and Main-process orchestration are
implemented. The application seam obtains the current identity from explicit selection persistence,
looks up only its exact package ID and version through a narrow trusted `KnowledgePackageSource`,
parses and materializes it, and persists the result with one `createBatch()` call. The application
operation accepts neither package text nor trust. Explicit reapplication creates another immutable
batch; idempotency remains deferred. No filesystem/network source or runtime IPC wiring is implied.
`InstalledKnowledgePackageSource` is the durable exact source and verifies the stored digest on
every successful lookup. [`installed-knowledge-packages.md`](installed-knowledge-packages.md)
defines that boundary.

PackageApplication/idempotency, UI-triggered application, automatic reapplication, trust-management
workflows, real printer data, filesystem loading, IPC, AI, network, printer connectivity, and
TestWorkflow assets remain outside this design.
