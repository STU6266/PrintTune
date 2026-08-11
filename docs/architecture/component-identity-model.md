# Component identity model

## Decision

PrintTune should represent component identity with two separate concepts:

- `ComponentDefinition` describes what a component or product is. It is declarative knowledge that
  may come from an official, base, or customer-specific KnowledgePackage.
- `ComponentInstallation` records one physical component as installed in one immutable
  `PrinterState`.

A definition is reusable knowledge, not evidence that a particular product is installed. An
installation is part of recorded printer history and must remain understandable without its source
package. Neither display names nor definition IDs identify a physical instance.

## Component definitions

A `ComponentDefinition` is a catalog entry. The smallest useful Alpha contract is:

```ts
interface ComponentDefinition {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
}
```

`id` is stable within its package and must not be reassigned to a different product. `kind` is a
small machine-readable classification such as `hotend`, `extruder`, `fan`, or `motor`. `displayName`
is the package-provided human-readable identity.

Package identity and version belong to the reference provenance, rather than being repeated inside
every definition:

```ts
interface ComponentDefinitionReference {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly definitionId: string;
}
```

The tuple of package ID, package version, and definition ID identifies the exact knowledge used.
Official, base, and customer-specific packages use the same reference mechanism; no package class
receives privileged identity semantics.

## Component installations

The smallest useful Alpha installation contract is:

```ts
interface ComponentInstallation {
  readonly id: string;
  readonly printerStateId: string;
  readonly componentInstanceId: string;
  readonly role: string;
  readonly kind: string;
  readonly displayName: string;
  readonly definitionRef?: ComponentDefinitionReference;
}
```

The fields have deliberately separate meanings:

- `id` uniquely identifies this installation snapshot record.
- `printerStateId` owns the record and ties it to one immutable configuration snapshot.
- `componentInstanceId` is a PrintTune-local identity for the physical instance across successive
  PrinterStates. It is not a serial number or verified manufacturer identity.
- `role` identifies where or how the instance is used in this state.
- `kind` and `displayName` are identity snapshots retained with history.
- `definitionRef` is present only when an exact package definition was selected.

The snapshotted `kind` and `displayName` keep historical states readable if a package is upgraded,
removed, or unavailable. They must not be silently rewritten when package content changes. A later
explicit reconciliation could create a new PrinterState or update package-resolution metadata, but
must not alter an existing state.

## Unknown and custom components

An installation does not require a definition reference. For “generic 5015 blower,” PrintTune
creates a local `componentInstanceId`, records an appropriate kind such as `fan`, a user-entered
display name, and a role. `definitionRef` remains absent.

This records exactly what the user supplied without inventing a manufacturer, model, package ID, or
verified match. If a definition is identified later, that new understanding belongs to a later
PrinterState and retains its provenance.

## Roles and multiple components

Every installation has a required machine-readable `role`. Roles are normalized, non-empty dotted
identifiers, for example:

- `toolhead.hotend`
- `toolhead.extruder`
- `cooling.part.1`
- `cooling.part.2`
- `motion.z.motor.left`
- `motion.z.motor.right`

Within one PrinterState, a role identifies at most one installed component. Multiple components of
the same `kind` are allowed and distinguished by role and `componentInstanceId`. Code must not
derive uniqueness from `kind` or `displayName`.

Alpha should validate only the identifier shape and uniqueness within a state. It should not define
an exhaustive role enum. KnowledgePackages may recommend conventional roles, while customer and
future printer layouts may introduce additional namespaced roles.

## Immutable history

Component installations are snapshot records owned by PrinterState. Configuration changes create a
new PrinterState and a new set of installation records:

- Replacing a nozzle creates a new state. The replacement gets a new `componentInstanceId`; the old
  state continues to reference the previous instance.
- Upgrading an extruder follows the same replacement behavior.
- Removing a component means its installation is absent from the new state.
- A physical component that remains installed receives a new installation record in the new state,
  retaining the same `componentInstanceId` and normally the same role.
- Moving the same physical component retains `componentInstanceId` but records its new role.

No existing ComponentInstallation is updated or deleted to describe a configuration change. The
stable instance ID expresses continuity; installation record IDs express immutable observations in
particular states. The future atomic snapshot/carry-forward lifecycle is defined in
[`printer-state-lifecycle.md`](printer-state-lifecycle.md).

## Technical facts and claims

ComponentInstallation must not become a bag of technical properties.

- `ComponentDefinition` contains stable catalog identity and classification. Package-supplied
  technical assertions are represented as sourced claims rather than unqualified contract fields.
- `ComponentInstallation` contains only state membership, physical-instance continuity, role, and
  the minimum identity snapshot.
- `FieldClaim` represents sourced assertions or observations, scoped to the relevant PrinterState or
  ComponentInstallation.
- `ResolvedField` represents the value selected from claims by explicit resolution rules.

Examples:

| Fact                       | Representation                                                                    |
| -------------------------- | --------------------------------------------------------------------------------- |
| Nozzle diameter            | Installation-scoped FieldClaim; resolved for that PrinterState                    |
| Hotend maximum temperature | Definition/package-sourced FieldClaim, not copied blindly onto every installation |
| Extruder type              | Definition classification or sourced FieldClaim when more specific than `kind`    |
| Motor current              | PrinterState/installation-scoped FieldClaim                                       |
| Probe offset               | PrinterState/installation-scoped FieldClaim                                       |

This distinction preserves provenance and permits conflicting or uncertain facts without treating
them as verified identity.

## Fields deferred beyond the Alpha identity model

Do not add these fields to the initial contracts:

- manufacturer, model, SKU, serial number, barcode, or purchase information
- firmware, driver, bus, address, pin, IP address, or other connection details
- nozzle diameter, temperature limits, motor current, offsets, dimensions, or calibration values
- confidence, verification status, evidence, source URLs, or arbitrary metadata maps
- installation/removal timestamps or mutable status flags
- `previousInstallationId`, replacement chains, or lifecycle event objects
- parent/child component trees, compatibility lists, aliases, tags, notes, or localized text maps
- package checksums or complete embedded definition payloads

These fields require concrete use cases and provenance rules. Package checksums may later strengthen
artifact verification, but package ID, exact version, definition ID, and the local identity snapshot
are sufficient for the next implementation tasks.

## Consequences

This model supports known and unknown components, repeated component kinds, customer packages, and
immutable history without tying stored printer records to package availability. It adds only the
physical-instance continuity needed to distinguish “same component in a later state” from “new
replacement component.” Package loading remains deferred. Component facts use FieldClaims and
deterministic resolution; local persistence is limited to ComponentInstallation snapshots as
described below.

## Alpha persistence boundary

The application SQLite database persists ComponentInstallation snapshots, but not
ComponentDefinition catalog records. Definitions remain external, versioned KnowledgePackage data;
installations retain their optional exact reference and identity snapshot.

SQLite enforces one role per PrinterState with a unique `(printer_state_id, role)` index. Its
leftmost column also supports listing a state's installations, so no redundant single-column state
index is needed. A separate non-unique `component_instance_id` index supports historical lookup of
the same physical component across PrinterStates.
