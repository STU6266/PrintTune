# Canonical field definitions and registry

## Decision

PrintTune uses a declarative `FieldDefinition` to give each understood canonical `fieldPath` one
stable technical meaning. A definition states which target owns the field, its scalar
representation, its canonical unit semantics, and the deterministic ResolutionPolicy to apply.

FieldClaim remains historical evidence and may preserve unknown paths. FieldDefinition describes how
Core understands a path; it contains no printer-specific value, evidence, executable validator, or
UI text. AI does not create or alter definitions.

## Minimal Alpha contract

The smallest useful contract is:

```ts
type FieldTargetType = FieldClaimTarget["type"];
type FieldValueType = FieldClaimValue["type"];

interface FieldDefinition {
  readonly fieldPath: string;
  readonly targetType: FieldTargetType;
  readonly valueType: FieldValueType;
  readonly unit?: CanonicalUnit;
  readonly resolutionPolicy: ResolutionPolicy;
}
```

`fieldPath` is the stable identity. A separate ID would duplicate it and introduce an unnecessary
mapping. Definitions and their nested policy values are validated, defensively copied, and deeply
frozen when the contract is implemented.

No display label, description, default value, current value, provenance, confidence, package ID, or
arbitrary metadata belongs in the initial contract.

## Target compatibility

Each Alpha definition declares exactly one of the existing target types:

- `printer_state`
- `component_installation`

A readonly list is unnecessary. Exact ownership keeps queries and referential meaning unambiguous.
If a related concept genuinely applies at both scopes, it receives two distinct canonical paths
whose names express their different meanings. This avoids resolving PrinterState and
ComponentInstallation claims as if they shared one context.

For example, `printer.nozzle.diameter` describes the recorded printer configuration and targets a
PrinterState. `component.probe.offset.x` describes one installed probe in one state and targets a
ComponentInstallation. No generic graph target is introduced.

## Value and unit semantics

`valueType` reuses the existing FieldClaim discriminators exactly: `string`, `number`, or `boolean`.
A registry-aware resolution request validates every relevant claim against the definition before it
calls the existing resolver.

- A claim with a different scalar discriminator is invalid for that definition and blocks semantic
  resolution. It is retained as historical evidence.
- A numeric definition declares its canonical unit when the field has one. Alpha fields with ratios
  use the existing `ratio` unit. A genuinely unitless numeric field may omit `unit`, but this must
  be an explicit semantic decision rather than an absent guess.
- A numeric claim must have exactly the definition's unit semantics: the same unit, or no unit only
  when the definition is explicitly unitless.
- String and boolean definitions have no unit. A unit on such a claim is invalid evidence.

The registry performs no parsing, coercion, tolerance, or unit conversion. Imported values must be
converted to the canonical representation before a valid claim is created.

Representation mismatch against a known definition should produce `blocked` with
`invalid_claim_evidence`, rather than a normal value conflict. A conflict means comparable claims
disagree; a definition mismatch means evidence does not conform to the field semantics.

## Resolution policy assignment

Every definition selects exactly one existing closed ResolutionPolicy:

- `exact_match`
- `installed_hardware_confirmation`
- `safety_upper_bound`
- `safety_lower_bound`

The registry chooses policy; the generic resolver executes the supplied policy. The resolver must
not infer policy from path spelling.

Policy assignment requires an explicit semantic decision. For example, nozzle diameter describes
currently installed hardware, so direct confirmation may override a catalog default. `firmware.type`
has no comparable override or bound meaning and uses `exact_match`.

`printer.extruder.type` is assigned `installed_hardware_confirmation` in the proposed initial set
because it describes the currently installed extruder classification. If product requirements later
mean catalog identity rather than installed configuration, that must become a distinct field path;
the meaning of this path must not be silently changed.

## Safety semantics and ownership

The policy kind is the single source of truth for Alpha safety-bound semantics:

- `safety_upper_bound` identifies a safety-sensitive upper limit.
- `safety_lower_bound` identifies a safety-sensitive lower limit.

A separate `safetySensitive` boolean would permit contradictory states such as a safety flag paired
with `exact_match`, so it is not included. UI and diagnostics can determine whether a definition is
safety-bound by inspecting its closed policy kind. If non-bound safety categories later require
identification, they need an explicit reviewed model rather than a generic boolean.

Core owns all safety-sensitive canonical field semantics. KnowledgePackages may contribute sourced
Claim values, but they may not change a Core field's type, unit, target, or policy; weaken an upper
or lower bound; or replace a safety policy with `exact_match`. AI has no authority to assign or
alter field semantics. Unknown safety meaning is blocked, never guessed.

## Registry ownership

### Core registry

The initial registry is a static, readonly Core-owned collection. It contains common paths whose
meaning must stay stable across packages and application runs. Definitions are reviewed application
code/data, but the registry itself exposes data only; it does not embed printer-specific knowledge
or recommended values.

Core ownership guarantees that package installation order cannot redefine a common field or weaken
safety behavior. Updating a Core definition is an architecture-compatible application change and
must preserve the historical meaning of its path. A semantic change requires a new path.

### Package extension fields

Future KnowledgePackages may declaratively propose fields only under an extension namespace such as
`extension.klipper.square-corner-velocity`. A package definition may use the same minimal shape:
path, target type, scalar type, unit, and named policy. It contains no callback, script, expression,
or executable validator.

Before composition, future package loading must validate that:

- the path is canonical and belongs to an extension namespace authorized for that package;
- it does not collide with a Core path or another installed definition;
- target, value type, unit, and policy are closed supported values;
- it cannot override or weaken Core-owned safety semantics.

Package-provided registration is deferred until KnowledgePackage loading and version ownership are
implemented. Alpha's first registry should contain Core definitions only. A package cannot establish
new authoritative safety semantics merely by labeling an extension as a safety bound; such fields
remain blocked until the safety meaning is reviewed and made Core-authoritative.

## Unknown field paths

A syntactically valid unknown path is not rejected at FieldClaim creation. Claims may originate from
a future importer, an unavailable extension package, or a typo, and preserving that evidence is more
honest than discarding it.

Registry-aware technical resolution does not fall back to generic `exact_match`, because agreement
does not prove that PrintTune understands the target, type, unit, or safety meaning. It returns a
blocked unknown-field outcome and retains the Claims unchanged.

The current closed ResolvedField reason set has no precise unknown-definition code. Before registry
orchestration is implemented, the contract should add the explicit reason code
`unknown_field_definition`; reusing `invalid_claim_evidence` would incorrectly describe valid claims
whose semantics are unavailable. This is a concrete follow-up requirement, not an implemented
contract change in this design task.

When the missing package definition later becomes available, on-demand resolution can run again. The
original claims remain auditable throughout.

## Read-only lookup API

The minimal future Core API is a read-only lookup:

```ts
interface FieldDefinitionRegistry {
  find(fieldPath: string): FieldDefinition | undefined;
}
```

The initial Core implementation may instead expose a pure `getFieldDefinition(fieldPath)` function
over one frozen map. Neither form needs mutation methods, dependency injection, persistence, or a
generic schema engine. Enumeration can be added only when a concrete consumer needs it.

## Resolver orchestration

Registry-aware resolution belongs in a thin application/Core orchestration service around the
existing pure resolver:

```text
FieldClaimRepository
    -> list exact target + fieldPath claims
    -> FieldDefinition registry lookup
    -> validate target, scalar type, and unit against the definition
    -> resolveFieldClaims({ target, fieldPath, claims, policy: definition.resolutionPolicy })
    -> ResolvedField
```

Responsibilities remain separate:

- **Registry:** owns canonical field semantics and returns immutable definitions.
- **Orchestration layer:** obtains claims, handles unknown definitions, validates claims against the
  definition, and supplies the explicit policy.
- **Claim resolver:** remains repository-free and field-agnostic; it handles trust groups,
  agreement, conflicts, policy mechanics, and deterministic supporting-ID order.

The registry must not fetch claims, and the resolver must not import the registry or infer semantics
from a path. This keeps the resolver pure and permits direct deterministic tests.

## Initial Alpha Core fields

The first registry should prove scalar, unit, target, installed-hardware, exact-match, and safety
behavior without attempting to catalog every printer setting.

| fieldPath                          | target                   | type     | unit    | policy                            | technical meaning                                   |
| ---------------------------------- | ------------------------ | -------- | ------- | --------------------------------- | --------------------------------------------------- |
| `printer.nozzle.diameter`          | `printer_state`          | `number` | `mm`    | `installed_hardware_confirmation` | Diameter of the nozzle installed for this state     |
| `printer.extruder.type`            | `printer_state`          | `string` | —       | `installed_hardware_confirmation` | Classification of the installed extrusion mechanism |
| `printer.hotend.max-temperature`   | `printer_state`          | `number` | `degC`  | `safety_upper_bound`              | Maximum permitted hotend temperature                |
| `printer.bed.max-temperature`      | `printer_state`          | `number` | `degC`  | `safety_upper_bound`              | Maximum permitted heated-bed temperature            |
| `firmware.type`                    | `printer_state`          | `string` | —       | `exact_match`                     | Firmware family observed for this state             |
| `firmware.motion.max-velocity`     | `printer_state`          | `number` | `mm/s`  | `exact_match`                     | Configured firmware velocity ceiling                |
| `firmware.motion.max-acceleration` | `printer_state`          | `number` | `mm/s2` | `exact_match`                     | Configured firmware acceleration ceiling            |
| `slicer.retraction.distance`       | `printer_state`          | `number` | `mm`    | `exact_match`                     | Retraction distance associated with this state      |
| `slicer.retraction.speed`          | `printer_state`          | `number` | `mm/s`  | `exact_match`                     | Retraction speed associated with this state         |
| `slicer.layer-height`              | `printer_state`          | `number` | `mm`    | `exact_match`                     | Layer height associated with this state             |
| `component.probe.offset.x`         | `component_installation` | `number` | `mm`    | `exact_match`                     | X offset recorded for one installed probe           |

The table defines representation and resolution semantics only. It supplies no recommended values,
manufacturer defaults, compatibility claims, or printer-specific knowledge.

## Identity, material, and tests

### Manufacturer and model information

Printer manufacturer/model matching is identity and knowledge-package selection, not automatically a
bag of technical FieldClaims. Stable physical-printer identity belongs on Printer only when a future
identity contract explicitly requires it. Product catalog identity belongs in ComponentDefinition
and its exact package reference. An installed hotend model is represented by a ComponentInstallation
definition reference and identity snapshot, not by an unqualified `printer.hotend.model` claim.

A sourced assertion may still become a FieldClaim when identity is uncertain or conflicting, but a
dedicated identity/matching design must define that path and its target first. The initial registry
does not add manufacturer or model fields.

### Filament and material context

Material temperatures, material-specific flow, and filament properties do not belong to PrinterState
merely because a slicer uses them. They require a future material/filament-profile target and
lifecycle. The initial registry deliberately excludes nozzle temperature for a material, bed
temperature for a material, flow ratio, filament diameter, and similar profile values.

### Test and calibration results

A TestRun is the immutable historical experiment: procedure, inputs, measurements, result, and
provenance. A FieldClaim is one technical assertion inferred or confirmed from that evidence. For
example, a retraction TestRun may later create a sourced claim that
`slicer.retraction.distance = 0.8 mm`; the claim references the TestRun provenance, while the
TestRun retains the experiment detail. The field registry defines only the resulting claim's
semantics and does not replace TestRun.

## Fields intentionally deferred

The initial FieldDefinition and registry do not include:

- separate definition IDs, aliases, display labels, descriptions, translations, or UI groups;
- defaults, recommended values, ranges, tolerances, precision, formatting, or conversion rules;
- arbitrary validators, callbacks, scripts, expressions, or executable package content;
- multiple target types per definition, generic graph targets, or embedded target entities;
- provenance, confidence, trust, package versions, source URLs, or current resolved values;
- mutable registration APIs, persistence, database schema, registry synchronization, or dependency
  injection infrastructure;
- material/filament targets, TestRun contracts, identity matching, or manufacturer/model fields;
- package extension registration and authoritative extension safety declarations;
- a complete catalog of firmware, slicer, hardware, or calibration fields.

These additions require concrete consumers and lifecycle rules. The minimal model is sufficient to
validate known representations, select an explicit deterministic policy, protect Core safety
semantics, and block unknown fields without discarding evidence.
