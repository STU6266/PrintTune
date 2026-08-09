# Field claims and resolution

## Decision

PrintTune stores technical facts as immutable `FieldClaim` records. A claim says that one identified
source asserted one typed value for one canonical field on one specific target. Claims are evidence;
they are not automatically the value that PrintTune should use.

A later resolution step derives a `ResolvedField` for the same target and field path. Resolution
retains the supporting claim IDs and an explicit status instead of overwriting conflicting or older
claims. This separation lets PrintTune preserve provenance, uncertainty, and history while still
providing a usable value when the evidence permits one.

This document defines the data shape and semantics only. It does not define resolution algorithms,
safety rules, persistence, or package loading.

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
| `printer.hotend.max_temperature` | Relevant ComponentInstallation when identified    |
| `component.probe.offset.x`       | Probe ComponentInstallation                       |
| `firmware.max_velocity`          | PrinterState                                      |
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
- each segment begins with a letter and contains only letters, digits, or underscores;
- use a stable domain prefix such as `printer`, `component`, `firmware`, or `slicer`;
- describe the fact, not its source, display unit, or current value;
- never include record IDs, array positions, translated text, or package versions in a path;
- changing the meaning of a path requires a new path rather than silently reinterpreting old claims.

Common fields use fixed paths defined by PrintTune, for example `printer.nozzle.diameter`,
`printer.extruder.type`, `printer.hotend.max_temperature`, `firmware.type`, and
`slicer.retraction.distance`.

Extensions use `extension.<namespace>.<field>`, such as `extension.klipper.some_field`. Package
validation must prevent an extension from claiming a core namespace. Alpha does not need a schema
registry; the first implementation can validate path syntax and recognize only the fields its
consumers understand.

## Values and units

Alpha claim values are a discriminated union of string, finite number, and boolean. A discriminator
prevents SQLite or JSON representation details from changing the intended type. Arbitrary JSON,
arrays, objects, and display-formatted values are not accepted initially.

Units are separate from numeric values. For example, a nozzle claim stores numeric `0.4` with unit
`mm`, not string `"0.4 mm"`. The unit is absent for strings, booleans, counts, and genuinely
unitless numbers. Validation rejects a unit on a non-numeric value and rejects a unit incompatible
with a known field.

The initial closed `CanonicalUnit` set should contain only units needed by implemented fields, drawn
from the architecture's canonical system, for example `mm`, `mm/s`, `mm/s2`, `degC`, `mm3/s`, and
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

## Conflicts and resolution

Saving a new claim never replaces a prior claim for the same target and path. If a package claims a
nozzle diameter of 0.4 mm and the user later confirms a 0.6 mm replacement, both records remain. The
hardware change should normally also create a new PrinterState and corresponding installation
context. When claims genuinely conflict within the same context, resolution records the conflict
rather than deleting either source.

The minimal eventual resolved-value model is:

```ts
type ResolutionStatus = "resolved" | "conflict" | "missing" | "blocked";

interface ResolvedField {
  readonly target: FieldClaimTarget;
  readonly fieldPath: string;
  readonly status: ResolutionStatus;
  readonly value?: FieldClaimValue;
  readonly unit?: CanonicalUnit;
  readonly supportingClaimIds: readonly string[];
  readonly reason: string;
  readonly resolvedAt: string;
}
```

The first implementation should enforce status-specific invariants: `resolved` has exactly one
usable value; `conflict`, `missing`, and `blocked` do not present a normal usable value. Unit rules
match FieldClaim. `supportingClaimIds` contains every claim that materially supports the result or
conflict and is empty only when evidence is missing. `reason` is a stable machine-readable reason
code, not localized prose. `resolvedAt` records when this interpretation was computed.

There is no independent `id` in the minimal model because target plus field path identifies the
current derived interpretation. Persisted resolution history, algorithm/package version, expiry, and
manual overrides are deferred until their lifecycle is defined. A ResolvedField is derived data;
FieldClaims remain the auditable source of truth.

Resolution rules themselves are deliberately not specified here. They must be deterministic,
field-aware, and capable of reporting missing, conflicting, or blocked results.

## Safety conflicts

Normal resolution may prefer evidence that is more specific, current, or appropriately verified.
Safety-related fields have a stricter rule: when reliable sources disagree, PrintTune must not
select the less conservative value merely because it appears newer or has a nominally higher trust
category.

For example, reliable maximum-hotend-temperature claims of 300 °C and 260 °C must not casually
produce a usable 300 °C limit. A later safety engine must use the safest reliable bound or block the
operation when field semantics do not define a safe bound. The conflict and all supporting claim IDs
remain visible. This document does not implement or enumerate safety fields or rules.

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
- resolution algorithm versions, persisted resolution history, manual override objects, or cache
  invalidation metadata;
- safety classifications, safe-bound direction, safety-engine decisions, or automatic actions;
- package loading data, TestRun payloads, evidence blobs, recommendations, or diagnostic results.

These additions require concrete lifecycle, validation, or safety requirements. The minimal model is
sufficient to record typed sourced facts, distinguish uncertainty, preserve conflicts, and later
derive a traceable value.
