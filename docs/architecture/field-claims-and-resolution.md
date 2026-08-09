# Field claims and resolution

## Decision

PrintTune stores technical facts as immutable `FieldClaim` records. A claim says that one identified
source asserted one typed value for one canonical field on one specific target. Claims are evidence;
they are not automatically the value that PrintTune should use.

Alpha derives a `ResolvedField` for the same target and field path on demand. Resolution retains the
supporting claim IDs and an explicit status instead of overwriting conflicting or older claims. This
separation lets PrintTune preserve provenance, uncertainty, and history while still providing a
usable value when the evidence permits one.

This document defines the implemented FieldClaim and ResolvedField shapes, immutable Claim
persistence, and deterministic Alpha resolution semantics. Package loading, a broader safety engine,
and persisted resolution history remain deferred.

## FieldClaim

The smallest useful Alpha contract is:

```ts
type FieldClaimTarget =
  | { readonly type: "printer_state"; readonly printerStateId: string }
  | {
      readonly type: "component_installation";
      readonly componentInstallationId: string;
    };

type FieldClaimValue =
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "boolean"; readonly value: boolean };

interface FieldClaim {
  readonly id: string;
  readonly target: FieldClaimTarget;
  readonly fieldPath: string;
  readonly value: FieldClaimValue;
  readonly unit?: CanonicalUnit;
  readonly provenance: ClaimProvenance;
  readonly trust: ClaimTrust;
  readonly confidence?: number;
  readonly createdAt: string;
}
```

`createdAt` is the time the claim was recorded, expressed as a strict ISO-8601 UTC timestamp. It is
not necessarily the time the source observation occurred. Observation-time metadata can be added
when a concrete import or measurement use case requires it.

IDs, target identifiers, paths, provenance, units, and timestamps require explicit validation.
Numeric values must be finite. Confidence, when present, is in the inclusive range zero through one.

## Target and context

Alpha needs two explicit target types:

- `printer_state` covers facts about the recorded printer configuration, firmware observations, and
  slicer values considered in that state.
- `component_installation` covers facts about one installed component in one immutable state, such
  as a probe offset or nozzle diameter.

This discriminated union makes ownership unambiguous without introducing a generic `targetType` and
`targetId` graph. A ComponentInstallation already identifies its PrinterState, so a component claim
must not duplicate `printerStateId`. Consumers can obtain the state context through the installation
relationship.

Examples:

| Field path                       | Target                                            |
| -------------------------------- | ------------------------------------------------- |
| `printer.nozzle.diameter`        | PrinterState when no nozzle installation is known |
| `printer.hotend.max-temperature` | PrinterState                                      |
| `component.probe.offset.x`       | Probe ComponentInstallation                       |
| `firmware.motion.max-velocity`   | PrinterState                                      |
| `slicer.retraction.distance`     | PrinterState                                      |

The first example is deliberately permitted at PrinterState scope for incomplete or imported data.
When an exact component installation is known, component-specific facts should target it. Resolution
must not silently merge claims from different targets merely because their paths appear related.

Slicer profiles and material profiles do not need claim targets in the initial model because those
entities do not yet exist. If they later become independent historical entities, the target union
can gain named variants. That is an additive extension, not a reason to create a generic graph now.

## Canonical field paths

`fieldPath` is a stable, machine-readable dotted identifier, not a display label. Alpha paths follow
these rules:

- use lowercase ASCII segments separated by single dots;
- each segment begins with a letter and contains lowercase letters, digits, or internal hyphens;
- use a stable domain prefix such as `printer`, `component`, `firmware`, or `slicer`;
- describe the fact, not its source, display unit, or current value;
- never include record IDs, array positions, translated text, or package versions in a path;
- changing the meaning of a path requires a new path rather than silently reinterpreting old claims.

Common fields use fixed paths defined by PrintTune, for example `printer.nozzle.diameter`,
`printer.extruder.type`, `printer.hotend.max-temperature`, `firmware.type`, and
`slicer.retraction.distance`.

Extensions use `extension.<namespace>.<field>`, such as `extension.klipper.some-field`. Future
package validation must prevent an extension from claiming a Core namespace. The implemented Alpha
registry recognizes the fixed Core definitions; package-provided extension registration remains
deferred.

## Values and units

Alpha claim values are a discriminated union of string, finite number, and boolean. A discriminator
prevents SQLite or JSON representation details from changing the intended type. Arbitrary JSON,
arrays, objects, and display-formatted values are not accepted initially.

Units are separate from numeric values. For example, a nozzle claim stores numeric `0.4` with unit
`mm`, not string `"0.4 mm"`. The unit is absent for strings, booleans, counts, and genuinely
unitless numbers. Validation rejects a unit on a non-numeric value and rejects a unit incompatible
with a known field.

The initial closed `CanonicalUnit` set contains only units needed by implemented fields, drawn from
the architecture's canonical system, for example `mm`, `mm/s`, `mm/s2`, `degC`, `mm3/s`, and
`ratio`. Machine codes use ASCII (`degC`, `mm/s2`) while the UI may render `°C`, `mm/s²`, and
`mm³/s`. Values are converted to canonical units before a claim is recorded; the original source
text or source unit belongs in an import snapshot when preservation is required.

Structured values should be added later as explicit domain value variants, not through an arbitrary
JSON escape hatch.

## Provenance

Provenance answers where a claim came from. Trust answers how the application should characterize
that evidence. They are separate because two sources of the same type can have different
verification quality.

The minimal provenance shape is:

```ts
type ClaimSourceType =
  | "user_confirmed"
  | "user_entered"
  | "imported_file"
  | "slicer_profile"
  | "firmware_read"
  | "knowledge_package"
  | "component_definition"
  | "test_result"
  | "ai_unverified";

type ClaimSourceReference =
  | { readonly type: "import_snapshot"; readonly id: string }
  | { readonly type: "slicer_profile_snapshot"; readonly id: string }
  | { readonly type: "firmware_snapshot"; readonly id: string }
  | {
      readonly type: "knowledge_package";
      readonly packageId: string;
      readonly packageVersion: string;
    }
  | {
      readonly type: "component_definition";
      readonly packageId: string;
      readonly packageVersion: string;
      readonly definitionId: string;
    }
  | { readonly type: "test_run"; readonly id: string };

interface ClaimProvenance {
  readonly sourceType: ClaimSourceType;
  readonly sourceRef?: ClaimSourceReference;
}
```

Source references identify immutable local snapshots or exact package versions, rather than live
paths, URLs, or mutable package aliases. The validator defines which reference type is permitted or
required for each source type. User-originated claims need no user ID in the single-user Alpha.
AI-originated claims remain explicitly unverified and do not require an external provider identity
in the initial model. No AI or network source is implemented by this design.

Customer-specific and official/base packages use the same package reference. Verification belongs to
trust, not to a privileged package-source variant. An exact component definition uses the same
package ID, package version, and definition ID tuple as `ComponentDefinitionReference`.

### Knowledge-package fact provenance evolution

The implemented `knowledge_package` reference currently contains exactly `type`, `packageId`, and
`packageVersion`. It records the immutable package version, but not the individual assertion inside
that package. This differs from `component_definition`: that separate source identifies a component
definition with `packageId`, `packageVersion`, and `definitionId`. A component definition identity
must not be reused as baseline-fact provenance.

Knowledge Package v1 gives every fact a stable package-local `factId`, and model selection preserves
the exact winning fact. The backward-compatible target contract is therefore:

```ts
{
  readonly type: "knowledge_package";
  readonly packageId: string;
  readonly packageVersion: string;
  readonly factId?: string;
}
```

The two representable states have explicit meanings:

- With no `factId`, the historical Claim is known to originate from the exact package version, but
  the exact source fact was not recorded.
- With `factId`, the Claim originates from that exact fact inside that exact package version. Its
  complete fact identity is `(packageId, packageVersion, factId)`.

Absence of `factId` is honest historical incompleteness, not corruption. Existing Claims must load,
retain their values and package references, and participate in resolution unchanged. Migration must
not fabricate a fact ID from an array index, `fieldPath`, `"legacy"`, `"unknown"`, or another
sentinel.

Three shapes were considered:

1. Making `factId` required on every package reference would make the strongest contract, but an
   existing persisted Claim has no truthful value with which to satisfy it. Migration would either
   reject valid history or manufacture precision.
2. Adding optional `factId` preserves the existing package-level state and permits exact provenance
   for new facts. A stricter package-to-Claim boundary can still require it for all new Package v1
   Claims.
3. Adding a second fact-level package source variant makes the distinction explicit in the
   discriminator, but duplicates package semantics and complicates resolution lineage, repository
   mapping, and future callers without adding information beyond presence of `factId`.

Option 2 is the smallest honest, migration-safe model. Generic Core `createFieldClaim()` should
accept and validate both forms. That keeps historical reconstruction on the normal validated path
and avoids a privileged unsafe legacy constructor. The future Package-v1-to-Claim service is the
stronger creation boundary: it must require the package's exact `packageId`, exact `packageVersion`,
and the effective winning fact's exact `factId`, and must never create incomplete package
provenance. Low-level historical compatibility does not weaken that application invariant.

### Migration and repository requirements

Migration 006 should add one nullable `TEXT` column, `source_fact_id`, to `field_claims`. Migration
004's existing provenance CHECK already requires both package columns for `knowledge_package`,
forbids them for unrelated sources, and distinguishes `source_definition_id`. It does not enumerate
all allowed columns as a closed row shape, so no existing CHECK must be rewritten. Migration 006 can
use `ALTER TABLE ... ADD COLUMN` with a column CHECK that permits only either:

- `NULL`; or
- a non-empty trimmed value when `source_type = 'knowledge_package'`.

This additionally forces `source_fact_id` to `NULL` for `user_confirmed`, `user_entered`,
`imported_file`, `slicer_profile`, `firmware_read`, `component_definition`, `test_result`, and
`ai_unverified`. The existing table CHECK continues to require package ID and version together for
package provenance. The normal migration runner supplies the transaction, version ordering,
rollback, and schema-version update. Existing rows acquire `NULL`, preserving their exact prior
meaning; a table rebuild is unnecessary.

After migration, repository reconstruction must map package ID/version plus `NULL` fact ID to valid
historical package-level provenance, and a populated fact ID to exact fact-level provenance. A
partial package ID/version remains a data-integrity error. A malformed fact ID or any fact ID on an
incompatible source type is also a data-integrity error; the repository must neither discard nor
invent it.

`factId` is audit provenance only. It does not change value agreement, source lineage, trust
grouping, confidence, recency, ResolutionPolicy, or safety calculations. Two separately auditable
Claims from different fact IDs may still agree technically when their typed values and units agree.
Adding a fact ID never promotes package trust.

Package updates append evidence rather than rewriting it. A Claim from package 1.0 fact A and a
Claim from package 1.1 fact B retain their respective complete identities, even when `factId` is the
same string across versions. If a selected model fact B overrides series fact A, the generated Claim
must reference B; it must not reference A, synthesize an identity, or substitute
`modelDefinitionId`. PrinterKnowledgeIdentity separately records series/model selection. Package
removal does not invalidate historical Claims: their value, unit, package identity, and recorded
fact identity remain sufficient for normal historical resolution without the package being present.

Implementation should remain green in two commits:

1. **4.5b:** extend the FieldClaim contract and Core validation to accept optional, validated
   `factId`, retaining package-level historical construction.
2. **4.5c:** add migration 006 and update repository writes, reconstruction, integrity checks, and
   tests for both historical and exact forms.

The temporary state after 4.5b remains coherent because no package-to-Claim generator exists and
persisted data still uses the older valid subset. Package-to-Claim generation must wait until 4.5c
is complete.

The subsequent pure conversion boundary, including exact identity/state alignment and external
package trust, is defined in [`package-claim-materialization.md`](package-claim-materialization.md).

## Trust and confidence

The initial trust vocabulary is:

```ts
type ClaimTrust =
  | "developer_verified"
  | "customer_verified"
  | "user_confirmed"
  | "user_entered"
  | "imported_observation"
  | "ai_generated_unverified";
```

The three concepts have distinct meanings:

- **Provenance** identifies the kind and exact reference of the source.
- **Trust** is a categorical statement about how that source or assertion was verified. It is not a
  universal numeric rank.
- **Confidence** is an optional source-supplied or process-derived estimate from zero to one. Its
  absence means unknown, not zero and not certainty.

Resolution must consider field semantics, target, recency, provenance, and safety context rather
than sorting claims by a single trust score. For example, a current firmware observation and a
developer-verified product limit answer different questions even if both concern temperature.
Confidence must never promote unverified evidence into a verified trust category.

## ResolvedField and deterministic resolution

Saving a new claim never replaces a prior claim for the same target and path. A `ResolvedField` is
PrintTune's current derived interpretation of those claims. It is neither historical evidence nor a
mutation of any claim.

### Minimal Alpha contract

Alpha uses a discriminated union so a non-resolved result cannot accidentally carry a usable value:

```ts
type ResolvedFieldStatus = "resolved" | "conflict" | "missing" | "blocked";

type ResolvedFieldReasonCode =
  | "single_claim"
  | "claims_agree"
  | "stronger_evidence"
  | "newer_same_source"
  | "field_policy_selected"
  | "safety_conservative_bound"
  | "safety_policy_blocked"
  | "no_usable_claims"
  | "insufficient_confirmation"
  | "unresolved_conflict"
  | "incompatible_claim_representations"
  | "invalid_claim_evidence"
  | "unknown_field_definition";

interface ResolvedFieldBase {
  readonly target: FieldClaimTarget;
  readonly fieldPath: string;
  readonly supportingClaimIds: readonly string[];
  readonly reasonCode: ResolutionReasonCode;
}

type ResolvedField =
  | (ResolvedFieldBase & {
      readonly status: "resolved";
      readonly value: FieldClaimValue;
      readonly unit?: CanonicalUnit;
    })
  | (ResolvedFieldBase & {
      readonly status: "conflict" | "missing" | "blocked";
    });
```

The statuses mean:

- `resolved`: deterministic rules produced one usable typed value and unit.
- `missing`: no valid, usable claim exists for the exact target and field path.
- `conflict`: valid usable claims disagree, and neither generic mechanics nor the field policy may
  choose safely.
- `blocked`: evidence exists, but an integrity, representation, confirmation, or safety condition
  prohibits use of a value.

`target` and `fieldPath` identify the interpretation; a separate ID is unnecessary. `resolvedAt` is
also omitted in Alpha. Resolution is calculated on demand, and adding a clock value would not help
reproduce the result. If results are cached later, cache metadata can record computation time and
resolver version without changing the semantic value.

`reasonCode` is closed and machine-readable, not localized prose. The UI or AI may translate it and
the supporting evidence into a German explanation, but that explanation is not the source of truth.

### Claim eligibility

Resolution operates on claims for one exact target and one exact canonical field path:

1. Every claim must pass the existing FieldClaim validation and storage-integrity boundary.
2. Its target must exactly equal the requested discriminated target, including the ID.
3. Its `fieldPath` must exactly equal the requested path. Related-looking paths are not aliases.
4. Alpha has no superseded, inactive, revoked, or validity-period mechanism. The resolver must not
   invent one or silently discard old claims as if one existed.
5. Weak claims remain eligible evidence but are not authoritative by themselves.

A malformed claim must not be skipped while resolution continues with a plausible subset. The result
is `blocked` with `invalid_claim_evidence`, or the repository fails with its explicit data-integrity
error before resolution. This prevents corrupt evidence from being hidden by a seemingly valid
result.

### Trust groups, provenance, and confidence

Alpha uses explicit categories, not a universal score:

- **Strong verified evidence:** `developer_verified`, `customer_verified`, `user_confirmed`.
- **Observed evidence:** `imported_observation`.
- **Weak or unverified evidence:** `user_entered`, `ai_generated_unverified`.

These groups describe eligibility for generic decisions, not a total ordering within a group.
`developer_verified` does not universally beat `user_confirmed`; a verified catalog default and a
direct observation of installed hardware have different semantics.

Provenance identifies the source and exact lineage. Trust describes verification. Confidence is an
optional estimate. Confidence does not change a trust group, break a conflict, or establish a value
when confirmation is required. Alpha defines no confidence threshold.

Weak claims cannot override strong or observed disagreement. If weak evidence is the only evidence,
the result is `blocked` with `insufficient_confirmation`. If a strong or observed claim resolves and
weak claims agree exactly, those agreeing weak claims may support it. Disagreeing weak claims remain
auditable but do not force a conflict against otherwise usable stronger evidence; the result uses
`stronger_evidence`.

### Agreement, disagreement, and recency

Claims agree only when their value discriminator, scalar value, and canonical unit are exactly
equal. One usable claim resolves with `single_claim`; multiple agreeing claims resolve with
`claims_agree`. Differing provenance, trust, confidence, or creation time does not prevent exact
agreement, and every materially agreeing claim ID is retained. Strings use exact code-point
equality, booleans must match, and numbers use exact canonical stored values; Alpha adds no numeric
tolerance.

The generic resolver applies these deterministic rules in order:

1. Validate the complete input set and exact context.
2. With no claims, return `missing` / `no_usable_claims`.
3. With only weak claims, return `blocked` / `insufficient_confirmation`.
4. Reject incompatible value types or unit representations as `blocked` /
   `incompatible_claim_representations`.
5. If all usable strong and observed claims agree, return their value and include agreeing weak
   claims as support.
6. Disregard conflicting weak claims when stronger usable evidence exists and return
   `stronger_evidence`.
7. Recency may select a newer claim only when disagreeing claims have the same exact trust, source
   type, source lineage, and target, the field policy permits replacement semantics, and the latest
   actual timestamp has one agreed value. Claim ID orders evidence but is never temporal evidence.
   Use `newer_same_source`.
8. Apply an explicit field-specific policy if one exists.
9. Otherwise return `conflict` / `unresolved_conflict` with every materially conflicting claim ID.

“Same source lineage” is narrow. User confirmations in the single-user Alpha share one lineage.
Package claims share a lineage only when package ID matches; versions may advance. Imported, slicer,
firmware, component-definition, and test sources use their structured references to determine
lineage. Different sources sharing a trust category are not one lineage. Equal timestamps with
different values cannot be ordered and remain a conflict.

This gives the required recency behavior:

- Old `user_confirmed` 0.4 and newer `user_confirmed` 0.6 resolve to 0.6 with `newer_same_source`
  when the field permits replacement semantics.
- New `user_entered` 0.6 cannot replace old `user_confirmed` 0.4; the result is 0.4 with
  `stronger_evidence`.
- Package default 0.4 and direct confirmation of installed 0.6 require a field policy, which may
  choose 0.6 with `field_policy_selected`.
- Equally trusted current claims from different lineages, or equally timed claims in one lineage,
  remain `conflict` / `unresolved_conflict`.

No claim is deleted or marked obsolete by these choices.

### Type and unit compatibility

Claims for one canonical field must have the same value discriminator and unit semantics:

- number `mm` and number `mm` are compatible;
- number `mm` and number `degC` are incompatible;
- number and string are incompatible even if the string looks numeric;
- a unit and no unit are incompatible when either claim assigns a unit to that field.

Alpha performs no parsing, coercion, tolerance, or unit conversion. Incompatible representations
produce `blocked` / `incompatible_claim_representations` with all involved claim IDs. This is
`blocked`, rather than `conflict`, because the values cannot safely be compared as assertions of the
same canonical field.

### Supporting claims

`supportingClaimIds` is deduplicated and ordered by `createdAt`, then claim ID:

- For `resolved`, it includes claims materially supporting the chosen value, including all agreeing
  confirmations at the latest timestamp and all reliable bounds considered by a safety policy. Stale
  confirmations that disagree with a selected strictly newer value are not presented as support for
  that value.
- For `conflict`, it includes every claim materially involved in the unresolved disagreement. An
  equal-latest-time confirmation conflict includes all conflicting Claims at that latest time; stale
  earlier confirmations do not become current conflict support.
- For `blocked`, it includes every claim causing the integrity, compatibility, confirmation, or
  safety block.
- For `missing`, it is empty.

Claims for another target or field path are outside the request and are not supporting claims.

### Resolution policy boundary

Canonical field semantics and policy lookup are defined in
[`field-definition-registry.md`](field-definition-registry.md). The registry remains outside the
generic resolver.

The implemented Alpha resolution architecture has three layers:

```text
FieldClaims
    -> generic Claim Resolver
    -> named field-specific ResolutionPolicy when required
    -> ResolvedField
```

The generic resolver owns validation, exact-context filtering, agreement, trust grouping, weak-only
blocking, representation compatibility, deterministic ordering, and fallback conflict reporting.

A field policy owns semantics that cannot be inferred from a scalar value. The implemented closed
Alpha policy vocabulary is:

- `exact_match`: disagreement remains a conflict;
- `installed_hardware_confirmation`: direct current user confirmation of installed hardware may
  override a generic catalog/package default;
- `safety_upper_bound`: choose the lowest reliable upper bound;
- `safety_lower_bound`: choose the highest reliable lower bound.

This is a closed named policy kind, not an arbitrary callback. The Core-owned registry and policy
contract are implemented, and Core-owned safety assignments cannot be weakened by a
KnowledgePackage. Future packages may contain declarative policy data only; they never execute code.

A normal policy selection uses `field_policy_selected`; a conservative safety bound uses
`safety_conservative_bound`. If a safety policy lacks enough reliable, compatible evidence or cannot
establish its conservative direction, it returns `blocked` / `safety_policy_blocked` rather than
guessing. A more specific integrity, representation, or confirmation reason takes precedence when
that condition caused the block.

### Safety-sensitive fields

Safety meaning is explicit. The generic resolver never infers from a number whether lower or higher
is safer. The vetted Core FieldDefinition registry assigns each known path its named policy.

For a safety upper bound, reliable compatible claims of 300 `degC` and 260 `degC` resolve to 260
`degC` with `safety_conservative_bound`. Both claim IDs remain supporting evidence. Recency cannot
select 300. A lower-bound policy uses the opposite direction. Non-bound safety conflicts remain
blocked or conflicting according to their explicit policy; they are never optimized by a generic
minimum/maximum rule.

### Recalculation and persistence

Alpha calculates ResolvedField on demand. It adds no ResolvedField table or repository. Resolution
reruns after a relevant claim is created, an applicable policy or package version changes, or the
application resolver version changes.

The same claims and policy inputs produce the same semantic result. An in-memory cache may be used,
but it is disposable and must be invalidated for those events. Persisted derived results, if later
justified, need resolver and policy-version metadata and remain rebuildable; they never become
evidence equivalent to Claims.

### AI boundary

AI may explain a resolved value, describe a conflict or block, and ask for missing confirmation. AI
may not choose a winning claim outside deterministic resolver rules, turn `conflict` or `blocked`
into `resolved`, override a safety policy, change trust, or invent a missing technical value.

### Worked Alpha examples

| Scenario                                                                                          | Alpha outcome                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package says nozzle is 0.4 `mm`; user confirms installed nozzle is 0.6 `mm`                       | With `installed_hardware_confirmation`, `resolved` at 0.6 `mm`, `field_policy_selected`; the direct confirmation supports the selected value while the conflicting package Claim remains historical evidence.            |
| Package says nozzle is 0.4 `mm`; user says “I think 0.6 mm”                                       | `resolved` at 0.4 `mm` with `stronger_evidence` when the package claim is verified; the uncertain claim remains evidence. With no reliable package evidence, weak-only input is `blocked` / `insufficient_confirmation`. |
| Imported configuration says 0.6 `mm`; user confirms 0.6 `mm`                                      | `resolved` at 0.6 `mm`, `claims_agree`; both IDs support the result despite differing provenance and trust.                                                                                                              |
| Reliable component source says maximum 300 `degC`; reliable printer/hotend source says 260 `degC` | Under `safety_upper_bound`, `resolved` at 260 `degC`, `safety_conservative_bound`; both IDs are retained.                                                                                                                |
| Two equally strong current sources from different lineages disagree                               | `conflict` / `unresolved_conflict`; neither silently wins.                                                                                                                                                               |

## Historical and audit behavior

FieldClaims are append-only historical evidence. Package updates, changed imports, user corrections,
new measurements, or better identification create new claims. Hardware changes normally create a new
PrinterState and new ComponentInstallation records, and claims attach to that new context. Old
claims remain attached to the state or installation for which they were recorded.

Claims must not be silently edited to match a newer package, current hardware, or a later user
answer. If administrative invalidation is eventually required, it should be modeled as explicit
audit metadata or a superseding record, not mutation of the original evidence. Exact provenance
references and supporting claim IDs make past interpretations reproducible even when packages are
later upgraded or unavailable.

## Unknown and uncertain information

Uncertain user input is evidence, but it is not confirmation. “I think I have a 0.6 mm nozzle”
creates a claim with provenance `user_entered`, trust `user_entered`, and an optional confidence
only if the application captures a meaningful estimate. It must not be rewritten as
`user_confirmed`, and resolution may remain `blocked` or `conflict` for decisions requiring
confirmation.

An explicit confirmation creates a separate claim with provenance `user_confirmed` and trust
`user_confirmed`. It does not mutate the uncertain claim. Unknown information is represented by the
absence of a claim and an eventual `missing` ResolvedField, not by empty strings, sentinel numeric
values, or fabricated low-confidence facts.

## Fields intentionally deferred

Do not add these to the initial FieldClaim or ResolvedField contracts:

- arbitrary JSON values, arrays, general objects, or display-formatted value strings;
- generic entity targets, slicer/material targets before those entities exist, or embedded target
  objects;
- source URLs, live filesystem paths, raw imported content, user IDs, provider IDs, or arbitrary
  provenance metadata maps;
- observation time, validity intervals, expiry, supersedes/revokes links, soft deletion, or mutable
  status flags;
- universal priority scores, derived trust scores, confidence explanations, or per-claim resolution
  weights;
- localized reason text, notes, tags, comments, or UI presentation metadata;
- `resolvedAt`, resolution algorithm versions, persisted resolution history, manual override
  objects, or cache invalidation metadata;
- safety classifications, safe-bound direction, safety-engine decisions, or automatic actions;
- package loading data, TestRun payloads, evidence blobs, recommendations, or diagnostic results.

These additions require concrete lifecycle, validation, or safety requirements. The minimal model is
sufficient to record typed sourced facts, distinguish uncertainty, preserve conflicts, and later
derive a traceable value.
