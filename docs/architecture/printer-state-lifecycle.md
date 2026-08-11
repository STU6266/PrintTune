# PrinterState lifecycle and transitions

## Decision and scope

`Printer` represents one physical machine throughout its lifetime. Renaming it, replacing hardware,
or changing firmware does not create another Printer. `PrinterState` represents one immutable
technical snapshot of that Printer. Once recorded, a state is never edited to describe a later
configuration; a meaningful technical change creates another state.

The lineage and persistent working-selection foundation is implemented by migration 009 and the
storage boundaries described below. The desktop flow still deliberately reads the earliest state and
labels it **Initialer Druckerzustand**. That is a temporary single-state UI boundary, not an
inference that the earliest state is current. No transition service or multi-state UI exists yet.

The lifecycle is append-only snapshot history, not generic event sourcing. A state stores the
resulting snapshot identity and lineage; it does not attempt to record every action performed on a
Printer.

## Working-state selection

Every Printer has one explicit persistent working-state selection:

```text
Printer
  -> printer_state_selections
       (printer_id, selected_printer_state_id)
```

A separate one-row-per-Printer `printer_state_selections` relation is preferred over a mutable
column on `printers`. It matches the existing PrinterKnowledgeIdentity selection architecture, keeps
immutable state records separate from mutable selection, and permits composite ownership constraints
proving that the selected state belongs to the same Printer.

Currentness must never be inferred from `createdAt`, ID ordering, insertion order, or list position.
The application must fail explicitly if a selection points to a missing or foreign state. The normal
application lifecycle must create an initial state and select it atomically. Existing Alpha data
will acquire a selection pointing to its existing initial state.

“Working state” means the state used as the default target for new state-sensitive operations. It is
not a mutable flag on `PrinterState`. Merely viewing history never changes this selection.

## State shape and lineage

The implemented immutable state contract is:

```ts
interface PrinterState {
  readonly id: string;
  readonly printerId: string;
  readonly parentPrinterStateId?: string;
  readonly createdAt: string;
}
```

The initial state has no parent. Every later state records the exact state from which its transition
was prepared. Parentage is not inferred from time. Storage must verify that parent and child belong
to the same Printer and that a state cannot parent itself or form a cycle.

Alpha presents a linear working history: a new state derives from the currently selected working
state and becomes selected in the same transaction. Public lifecycle operations prohibit creating
two successors from one working state and reject a stale expected-parent selection. The underlying
lineage shape could represent a branch in the future, but Alpha exposes no branching workflow and
must not silently create one.

Do not add `updatedAt`, an active flag, version number, archive status, or mutable technical label.
An optional user-facing change summary is useful presentation metadata, but it is not required for
the technical lifecycle. If introduced, it should be an independently editable annotation so
correcting wording does not mutate the immutable technical snapshot.

## Creating a state

The future deliberate operation is conceptually:

```text
createPrinterStateFromCurrent(expectedCurrentStateId, transitionPlan, commandId)
```

It creates a new state only when the physical or persistent technical configuration meaningfully
changed, for example a different nozzle, hotend, extruder, probe, firmware family, firmware motion
limit, or probe configuration. Printer/Workspace renames, viewing data, opening the application,
running a recommendation, retrying an operation, and confirming evidence about an unchanged
configuration do not create a state.

For Alpha, creation requires explicit user confirmation. An importer may detect and explain a
difference, but it must not create a state merely because a file differs. The user decides whether
the file describes the working state, a newly changed configuration, or neither.

The transition plan identifies:

- the exact expected working state;
- component instances retained, removed, added, or replaced;
- proposed new evidence and deterministic carry-forward decisions; and
- values that require user reconfirmation or remain missing.

The plan is validated in Core/application logic. AI must not decide its contents or approve it.

## Claims and controlled carry-forward

FieldClaims remain attached to exactly one PrinterState or ComponentInstallation. Resolution for a
state must not walk ancestor states implicitly. Such a walk would make the meaning of an exact
target depend on mutable policy and could carry invalid hardware or safety facts without an
auditable decision. Existing Claims are never retargeted, edited, or deleted during a transition.

A new state starts with only what PrintTune can honestly establish for that configuration. To avoid
requiring complete re-entry, the transition operation may create new immutable carried-forward
Claims, but only from a deterministic, reviewed transition plan. These are new assertions about the
new exact target—not aliases to old Claims—and need explicit provenance linking each new Claim to:

- the prior Claim ID; and
- the durable state-creation command/transition origin.

The implemented `state_transition` provenance records `sourceClaimId` and `transitionCommandId`.
State-level parent metadata alone cannot tell which Claim was deliberately retained, and making the
resolver consult ancestry would hide that decision. Carry-forward provenance must not increase trust
or confidence. Package-derived Claims are not carried this way; package knowledge has its existing
explicit per-state application flow.

The implemented transition policy vocabulary is deliberately small:

- `safe_to_carry`: unchanged state-level evidence may be carried deterministically;
- `component_dependent`: never auto-carry; a future transition plan must explicitly confirm that the
  relevant installation/configuration remains applicable;
- `configuration_dependent`: never auto-carry; a future transition plan must explicitly confirm the
  relevant machine or firmware configuration remains applicable; and
- `require_reconfirmation`: never create a carried Claim, even from a generic applicability
  confirmation; establish a new independent Claim for the new state.

These are transition semantics, separate from `ResolutionPolicy`. Every Core-owned `FieldDefinition`
has a required `transitionPolicy`; there is no implicit default. Dependencies on roles/change
categories need declarative, deterministic Core rules. Knowledge Packages may contribute facts but
must not weaken Core safety behavior, and the renderer must not encode inheritance rules.

The transition UI should summarize changed, carried, missing, and reconfirmation-required values. It
need not demand confirmation for every low-risk carried field, but safety-critical values always
require deterministic proof of unchanged applicability or explicit reconfirmation. Otherwise the new
state reports the field as missing or blocked. Fewer resolved fields in a new state is valid and
safer than copying uncertain completeness. The UI can state: **Für diesen neuen Druckerzustand
fehlen noch einige technische Angaben.**

If new and carried Claims conflict, the existing `FieldResolutionService` resolves or blocks them
under the normal field policy. The transition operation never chooses a winner.

### Manual Claims

Confirmed manual Claims may be carried only through the transition plan and the field's transition
policy. For example, a nozzle-only change may permit an unchanged firmware-family assertion to be
carried, while the nozzle value is replaced and relevant retraction information is not assumed.
Unconfirmed/user-entered evidence should normally require reconfirmation rather than being promoted.
The original Claim remains attached to the parent state.

Core's pure carry assessment also excludes all `knowledge_package` Claims, weak `user_entered` and
`ai_generated_unverified` evidence, and component-targeted Claims that lack an exact old-to-new
installation mapping. Eligible carried Claims preserve value, unit, trust, and confidence exactly,
use the transition timestamp and a fresh injected Claim ID, target the exact new PrinterState, and
reference the immediately preceding source Claim. Resolution does not traverse this provenance or
PrinterState ancestry.

SQLite does not yet persist `state_transition` provenance. Migration 010 must add a closed storage
representation for the source Claim and transition command before the atomic transition lifecycle
can store carried Claims. The current `field_claims.source_type` CHECK excludes this discriminator,
so SQLite cannot safely extend it with `ALTER TABLE` alone: Migration 010 must transactionally
rebuild `field_claims` (preserving all existing rows/indexes) or introduce an equally explicit
normalized representation. The preferred rebuilt shape adds nullable `source_claim_id` and
`transition_command_id` columns guarded by provenance CHECKs. `source_claim_id` should reference the
globally unique `field_claims(id)` with restrictive/no-action deletion; no composite key is needed.
The command ID should reference durable transition-command bookkeeping. Once that lifecycle exists,
repeating one `transitionCommandId` must return the same completed transition result.

### Package Claims and PackageApplication

`PackageApplication` already includes `printerStateId` in its semantic key. An application for State
A is not applied to State B. A new state has no inherited PackageApplication and receives no
automatic copy of package Claims. If classification is known and the exact package remains usable,
the UI may explicitly offer **Druckerwissen für diesen Zustand anwenden**. Retry and audit semantics
remain those defined in [`package-application.md`](package-application.md).

## Components across states

Every new state is self-contained. Each unchanged installed physical component receives a new
`ComponentInstallation` snapshot with a new installation ID and the same `componentInstanceId`. The
definition reference, role, kind, and display-name snapshot are copied only through the explicit
transition plan. State B never directly reuses State A's installation row; otherwise inspecting B
would depend on another state's snapshot and state-local component Claims would have an ambiguous
owner.

Component behavior is:

- **unchanged:** new installation ID, same `componentInstanceId`;
- **moved role:** new installation ID, same instance ID, new role;
- **removed:** absent from the new state; historical installations remain untouched;
- **new or replacement:** new installation ID and new `componentInstanceId`;
- **reinstalled known physical item:** reusing its former `componentInstanceId` is conceptually
  correct only when the user explicitly identifies it as that same item.

Alpha need not build an inventory or reinstallation picker. Without reliable identity, reinstalling
a component creates a new instance ID rather than guessing. Two identical products share a
`ComponentDefinition` but retain different physical instance IDs.

Component-targeted Claims follow the same controlled carry-forward rule and target the new
installation record. Component continuity alone does not make every old Claim valid.

## Lifetime Printer knowledge identity

`PrinterKnowledgeIdentity` remains lifetime metadata for `Printer`, not state metadata. Creating a
state does not change or append classification. An Ender 3 V2 with a replaced hotend remains
classified as that product until the user explicitly corrects its identity. Baseline knowledge must
still be applied separately to each exact state, where stronger state/component evidence can show
modification or conflict.

## Firmware, slicer, and configuration boundary

Persistent firmware and machine configuration are part of PrinterState when they materially affect
the technical behavior of the machine. Changing Marlin to Klipper, changing firmware motion limits,
or changing probe configuration can justify a new state. Merely importing or viewing a diagnostic
log does not.

Slicer settings have a different lifecycle. Layer height, retraction, speeds, material choices, and
other print parameters can change per profile or job without changing the physical Printer. Treating
each such change as a PrinterState would cause state explosion. PrintTune should therefore introduce
a separate immutable `PrintConfiguration` (with a versioned `SlicerProfile` snapshot or source
reference where needed) before broad slicer/import work.

`PrintConfiguration` should reference the exact PrinterState for which it was prepared, while
recommendations and jobs reference both. The existing slicer Claims on PrinterState remain valid
historical Alpha data and must not be rewritten. New import architecture should stop expanding this
temporary placement and define migration/compatibility behavior before using slicer fields broadly.

Firmware configuration stays with PrinterState because it describes persistent machine behavior.
Print-job/slicer configuration belongs to PrintConfiguration because it is selected frequently and
may vary between otherwise identical uses of one state.

## Current Core field review

| Current field                      | Long-term domain                                                                           | Transition implication                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `printer.nozzle.diameter`          | PrinterState technical fact; component-specific when an exact nozzle installation exists   | Component-dependent; changed/reconfirmed on nozzle replacement                        |
| `printer.extruder.type`            | PrinterState technical fact; component-specific when an exact extruder installation exists | Component-dependent                                                                   |
| `printer.hotend.max-temperature`   | PrinterState safety fact; preferably tied to an exact hotend installation when modeled     | Safety-critical component-dependent; prove unchanged or reconfirm/block               |
| `printer.bed.max-temperature`      | PrinterState safety fact                                                                   | Safety-critical component/configuration-dependent; prove unchanged or reconfirm/block |
| `firmware.type`                    | PrinterState technical fact                                                                | Configuration-dependent; may carry only when firmware is unchanged                    |
| `firmware.motion.max-velocity`     | PrinterState technical fact                                                                | Configuration-dependent and safety-relevant; prove unchanged or reconfirm/block       |
| `firmware.motion.max-acceleration` | PrinterState technical fact                                                                | Configuration-dependent and safety-relevant; prove unchanged or reconfirm/block       |
| `slicer.retraction.distance`       | Future PrintConfiguration/SlicerProfile fact                                               | Do not carry as PrinterState evidence in the future model                             |
| `slicer.retraction.speed`          | Future PrintConfiguration/SlicerProfile fact                                               | Do not carry as PrinterState evidence in the future model                             |
| `slicer.layer-height`              | Future PrintConfiguration/SlicerProfile fact                                               | Do not create a PrinterState when it changes                                          |
| `component.probe.offset.x`         | ComponentInstallation fact                                                                 | Component/configuration-dependent; target the new installation snapshot               |

This classification is implemented as required transition-policy metadata in the Core registry;
existing Claim targets and resolution policies remain unchanged.

## Imports and exact targeting

Every future import must name an exact authorized Printer and exact PrinterState. The renderer may
send those IDs as selection context, but Main re-fetches both, verifies active-Workspace ownership,
and verifies the state belongs to the Printer. Neither layer chooses “latest” by timestamp.

If imported content conflicts with the working state—for example it names a 0.4 mm nozzle while the
working state records 0.6 mm—the importer presents a discrepancy. Explicit user choices may later
attach evidence to the current state, prepare a new state transition, or cancel/retain only import
metadata. Import does not overwrite a state or create one automatically.

## Recommendations, diagnostics, and AI

A recommendation records the exact PrinterState, relevant PrintConfiguration, material/filament
context when introduced, and package/Core/rule versions used. A diagnostic similarly targets the
exact state and retains its evidence. Selecting a new working state never retargets or reinterprets
old recommendations or diagnoses.

Future AI receives an exact state selected and authorized by Main/Core. It never infers currentness
from chronology, carries safety evidence, or creates/selects a state by itself. A state change
proposed through conversation must pass through the same explicit reviewed application workflow as
the normal UI.

## History and user experience

The future Printer detail separates viewing from working selection:

```text
Druckerzustand
Aktuell verwendet: Zustand 3

[Historie ansehen] [Neuen Zustand erstellen]

Historie
- Zustand 3 — 10.08.2026 — Neue 0,6-mm-Düse
- Zustand 2 — 02.08.2026
- Initialer Druckerzustand — 20.07.2026
```

Opening a history entry means **Historischen Zustand ansehen** and does not change the working
state. Alpha does not offer an action that makes an old historical record current. If such an action
is ever needed, it requires a distinct confirmation and an explicit branching policy. In normal
Alpha use, returning the machine to an old configuration creates a new state instead: State 1 (0.4
mm), State 2 (0.6 mm), then State 3 (0.4 mm again). State 3 may use State 1 as a
comparison/template, but it derives from the current State 2 and records a new point in time and new
evidence.

Display ordinals such as **Zustand 2** are derived from deterministic history order for presentation
and are never stored as identity. The immutable ID remains authoritative. The initial-state label is
retained for the root. Timestamps and an optional short annotation help users distinguish states
without exposing IDs.

Alpha provides no state deletion once created. Evidence, component snapshots, applications,
recommendations, and diagnoses may depend on it. A future cleanup operation for a genuinely empty,
never-used mistaken state requires a separate integrity design; cascading history deletion is not
part of this lifecycle.

## Atomicity and retry safety

State creation is one future transaction containing:

1. the new PrinterState with its parent;
2. carried ComponentInstallation snapshots;
3. deterministic carried Claims and their lineage, if any; and
4. the working-state selection change from the expected parent to the new state.

Any failure rolls back all four. Repository calls composed outside this lifecycle are not
sufficient. The transaction rechecks that the expected parent is still selected, preventing
concurrent stale transitions.

An uncertain IPC response must not create two states on retry. Unlike PackageApplication, state
creation has no natural semantic key: two intentional transitions can contain equal data. The future
command therefore needs a caller-held opaque one-time `commandId` recorded durably by the atomic
lifecycle. Retrying the same command returns the already-created state; a different explicit
transition uses another command ID. Main still derives authoritative IDs/timestamps and validates
the complete plan. The renderer token grants no authority.

A separate public `PrinterStateTransition` domain entity is not needed for Alpha.
`parentPrinterStateId` already records lineage, carried Claims record evidence lineage, and the
lifecycle's private durable command record supplies retry identity. Add a first-class transition
entity only if later audit requirements need structured transition reasons beyond those facts; do
not duplicate lineage now.

## Implemented storage and migration 009

Migration 009 uses a separate STRICT `printer_state_lineage` relation rather than rebuilding
`printer_states`. FieldClaims, ComponentInstallations, and PackageApplications already reference the
existing state table, so leaving that table intact is the safer additive migration. A lineage row
stores the owning Printer plus exact child and parent IDs. Composite foreign keys prove both States
belong to that Printer, the child ID is the primary key, and a CHECK rejects self-parenting. Absence
of a row means an initial State. The schema intentionally permits multiple children per parent so it
does not permanently prohibit future branching.

The repository validates the parent before insertion and persists a child plus its lineage row under
one savepoint. Missing and cross-Printer parents fail explicitly without leaving a partial State.
Because a new child ID cannot already have descendants, this creation-only path prevents the cycles
it can construct. General graph repair or reparenting does not exist; deeper transition-plan
validation remains part of 6.2b.

The STRICT `printer_state_selections` relation has one row per Printer and a composite foreign key
proving the selected State belongs to it. The narrow persistence API only gets or sets an exact
selection; it has no clear/latest/previous operation. Repository history remains ordered by
`createdAt`, then ID, solely for presentation.

Migration from v8 requires exactly one existing State for every Printer. It backfills that exact ID
without modifying the State or any historical row. Zero or multiple States raise an explicit
`AmbiguousLegacyPrinterStateError`; migration rolls back and does not guess. Fresh Printer creation
atomically persists the Printer, parentless initial State, and working selection. Both SQLite and
in-memory persistence expose equivalent selection and lineage behavior.

## Backward compatibility

The future migration must:

- add optional parent lineage without rewriting existing states;
- create one selection for every existing Printer, pointing to its deterministic existing initial
  state;
- preserve every state ID and timestamp;
- leave all FieldClaims, ComponentInstallations, PrinterKnowledgeIdentities, and PackageApplications
  attached to their current exact records; and
- reject or surface anomalous legacy Printers with zero or multiple plausible root states rather
  than guessing from a “latest” heuristic.

For valid current Alpha data, the only state is the unambiguous root and becomes selected. No Claim
or PackageApplication is moved, cloned, rewritten, or reapplied during migration.

## Recommended implementation sequence

Before broad slicer-file imports, resolve the `PrintConfiguration`/`SlicerProfile` contract and the
future ownership of the three current `slicer.*` fields. PrinterState lifecycle can otherwise
proceed in these focused slices:

### 6.2a — lineage and working-state selection (implemented)

- immutable PrinterState has optional parent lineage;
- migration 009 adds ownership-constrained lineage and selection relations and backfills valid
  single-state Printers;
- repositories, selection persistence, database factories, and atomic initial creation are covered
  for SQLite and in-memory behavior;
- the earliest-state UI behavior remains until the application boundary changes.

### 6.2b — deterministic transition planning and atomic creation

- define transition policies and a pure transition plan;
- snapshot retained components with stable instance IDs;
- add carried-Claim lineage provenance and conservative safety handling;
- implement one atomic, command-idempotent creation lifecycle; no IPC or UI.

### 6.2c — authorized Main and transport boundary

- get the working state, list history, prepare/confirm a transition, and inspect an exact state;
- reauthorize Workspace/Printer/state ownership and expected selection;
- add fixed validated IPC/preload operations without repositories or raw state mutation in the
  renderer.

### 6.2d — Printer detail history and transition UI

- show working state separately from the viewed state;
- add explicit history viewing and confirmed new-state creation;
- bind technical details and knowledge application to the exact viewed/working state as labeled;
- preserve request-generation guards and German safety/missing-data explanations.

### Separate prerequisite — PrintConfiguration boundary

Define the immutable PrintConfiguration/SlicerProfile lifecycle and migration strategy before slicer
imports or recommendations depend on the current `slicer.*` PrinterState targets.

## Deferred boundaries

This decision adds no migration, repository, Core implementation, IPC, preload API, React UI,
importer, diagnostic/recommendation implementation, AI/chat behavior, network capability, printer
connectivity/control, real Knowledge Package, or TestWorkflow asset.
