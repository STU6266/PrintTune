# Printer knowledge identity

## Decision

PrintTune separates the lifetime identity of a physical `Printer` from technical facts about an
immutable `PrinterState`:

- A user-confirmed printer-series/model selection is lifetime metadata for `Printer`.
- Technical facts contributed by the selected KnowledgePackage are immutable, package-provenanced
  `FieldClaim`s targeting the relevant `PrinterState`.
- `PrinterState` does not store a model reference. Replacing hardware does not change which physical
  product the Printer originally is, and correcting a mistaken model selection is not a hardware
  change.

This combination keeps an Ender 3 Pro identifiable after modifications without pretending that its
current state is still stock. A known model is optional: custom and unsupported printers continue to
work with manual claims.

## Package definitions: series with optional model variants

Alpha needs both series and exact-model meanings, but not two independent catalog systems. A
printer-series package should contain a series definition and may contain model variants within it:

```ts
interface PrinterSeriesDefinition {
  readonly id: string;
  readonly manufacturerDisplayName: string;
  readonly displayName: string;
  readonly models: readonly PrinterModelVariantDefinition[];
}

interface PrinterModelVariantDefinition {
  readonly id: string;
  readonly displayName: string;
}
```

The series groups technically related products in accordance with ADR-004. A model variant names a
more exact product within that series. A selection may stop at series level when the exact variant
is unknown or irrelevant. Model IDs are only meaningful within their series and package version;
Alpha does not need a separate globally addressable `PrinterModelDefinition` catalog.

The exact implemented v1 contracts use `seriesDefinitionId`, `seriesDisplayName`,
`modelDefinitionId`, and `modelDisplayName`. The abbreviated shape above illustrates their
relationship. Technical properties do not belong directly on either identity definition; declarative
package facts become sourced Claims.

## Exact external reference

A known selection uses an immutable exact reference:

```ts
interface PrinterKnowledgeDefinitionReference {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly seriesDefinitionId: string;
  readonly modelDefinitionId?: string;
}
```

The complete tuple identifies the knowledge consulted. `modelDefinitionId` is absent for a
series-only selection. Versions never float: even the literal opaque version `latest` denotes only
that exact string and cannot select another installed package version.

## Local selection history and display snapshot

The smallest local record that preserves correction history and remains readable without its package
is a discriminated, immutable selection record:

```ts
interface PrinterKnowledgeIdentityBase {
  readonly id: string;
  readonly printerId: string;
  readonly selectedAt: string;
}

type PrinterKnowledgeIdentity =
  | (PrinterKnowledgeIdentityBase & {
      readonly kind: "known";
      readonly definitionRef: PrinterKnowledgeDefinitionReference;
      readonly manufacturerDisplayName: string;
      readonly seriesDisplayName: string;
      readonly modelDisplayName?: string;
    })
  | (PrinterKnowledgeIdentityBase & {
      readonly kind: "unclassified";
    });
```

The known variant snapshots only the identity labels required for display. It does not copy
technical facts, localized help, rules, sources, images, or the package payload. The package remains
the source for those. The unclassified variant explicitly represents “unknown / custom” and is
needed to supersede an earlier mistaken known selection without deleting history. The Printer's
existing user-chosen name remains its local display name; no second custom-model label is needed in
Alpha.

The dedicated `printer_knowledge_identity_selections` relation stores the optional current identity
for each Printer. A correction atomically appends a new record and changes that selection. It is
current metadata, not technical evidence. Historical records are never edited, and current selection
is not inferred from timestamps or record IDs.

## Why model identity is not a FieldClaim

The selected external identity is not modeled as a `printer.model` FieldClaim. A scalar model name
cannot carry the structured series/model reference, exact package version, local display snapshot,
explicit unclassified choice, and current-selection history without creating parallel competing
truths.

The explicit identity record answers “which external product definition did the user select?”
FieldClaims answer “what sourced technical fact applies to this exact state or installation?” A
package-derived claim records its own exact package provenance. No duplicate model-name claim is
created merely to mirror the identity record.

## Manual selection and future suggestions

Alpha is manual-first. The intended future user-facing selection flow is:

1. Choose a manufacturer from installed package definitions.
2. Choose a technically related series and, optionally, an exact model variant.
3. Confirm the selection, or choose `Unbekannt / Eigenbau`.

Only explicit user confirmation changes `currentKnowledgeIdentityId`. A future import, detector, or
AI may return candidates with evidence or confidence, but a candidate is not an identity selection
and must not generate trusted package claims until the user confirms it. Suggestion persistence and
automatic detection semantics remain deferred.

## Modified printers and immutable states

A selected model supplies baseline knowledge, not a claim that the current machine is stock. When
the implemented package Claim generator targets a specific PrinterState and records the exact
package version as provenance. Direct evidence about installed hardware continues through
ComponentInstallation and FieldClaim:

```text
selected model baseline: nozzle diameter = 0.4 mm
user-confirmed installed hardware: nozzle diameter = 0.6 mm
installed_hardware_confirmation result: 0.6 mm
```

Replacing a hotend, toolhead, motherboard, or motion system creates a new PrinterState under the
existing rules, but does not by itself change the Printer's product identity. As modifications grow,
baseline claims may become less representative; they remain auditable weak/baseline evidence and
must not override stronger state-specific or installation-specific evidence.

Changing a mistaken model label does the opposite: it appends a new identity selection but does not
create a PrinterState, because no physical configuration change occurred. Existing package-derived
claims are not rewritten or deleted. Applying the corrected selection to a state later creates new
claims with new provenance, allowing existing resolution rules to expose agreement, replacement, or
conflict.

## Package upgrades and unavailable packages

Installing package version 1.1 does not mutate a selection or claim that references version 1.0. The
user may explicitly reconcile the current identity to 1.1 by creating another selection record. Any
facts materialized from 1.1 become new FieldClaims; 1.0 claims remain historical evidence.

If a referenced package/version is removed or unavailable:

- the local manufacturer, series, and optional model labels still make the Printer understandable;
- the exact reference remains visible and auditable;
- already persisted package-derived Claims retain their exact provenance and can still participate
  in deterministic resolution;
- PrintTune must not silently substitute another installed version;
- package-only detail that was never materialized locally is reported unavailable, not invented.

This snapshot is intentionally smaller than the ComponentInstallation snapshot because it describes
a catalog selection for a lifetime identity rather than installed hardware in every state.

## Knowledge-to-Claim flow

The implemented Main-process knowledge-application flow is:

```text
user confirms Printer series/model
→ application stores exact identity selection and local labels
→ installed declarative package definition is resolved by exact version
→ applicable baseline facts are converted to immutable FieldClaims for a PrinterState
→ each Claim retains exact package provenance/version
→ FieldResolutionService combines package evidence with manual and installed-hardware evidence
```

Package upgrades never regenerate or overwrite old Claims implicitly. A package supplies evidence,
not resolution behavior. In particular, a package may assert `printer.hotend.max-temperature`, but
the Core-owned FieldDefinition and its `safety_upper_bound` policy remain authoritative. Package
content cannot replace, relax, or execute safety semantics.

## Boundary to ComponentDefinition

Printer series/model knowledge describes the baseline product as sold or documented.
`ComponentDefinition` describes an individual component product, and `ComponentInstallation` records
what is actually installed in one PrinterState. A model definition may declaratively refer to a
stock component definition, but that reference does not prove the component remains installed.

Current hardware is represented by ComponentInstallation snapshots and associated FieldClaims. The
printer identity record must not duplicate component references, role assignments, nozzle sizes,
firmware, or other current configuration data.

## Implemented persistence

Migration 005 provides one dedicated append-only `printer_knowledge_identities` table and one
optional current-record relation for each Printer. This is smaller and clearer than generic
metadata, putting package columns directly on every PrinterState, or deriving current identity from
history. Persistence must enforce that the selected record belongs to the same Printer, and changing
the pointer plus appending a correction must be atomic.

SQLite represents that optional domain pointer through a dedicated
`printer_knowledge_identity_selections` relation rather than a literal column on `printers`. Its
composite foreign key includes both Printer and identity IDs, so the database itself rejects an
identity owned by another Printer while still permitting no selection or one selection per Printer.

Creating an immutable identity and selecting it as current is implemented as one atomic lifecycle
operation. Application correction flows use that boundary instead of composing repository creation
and selection as two independent writes.

No package definitions need to be copied into the application database. Definitions remain in the
versioned package store; only the exact reference, minimal labels, selection kind, and selection
time are local.

## Implementation status and deferred work

Phase 4 implements the TypeScript contract/Core validation, migration 005, SQLite and in-memory
repositories, atomic create-and-select lifecycle, current-selection reads, exact package references,
and package-to-FieldClaim application. The following remain deferred:

- user-facing selection UI and related IPC;
- package distribution, updates, signing, startup catalogs, and real content;
- manufacturer catalogs or real printer/model datasets;
- PackageApplication/idempotency and reconciliation workflows;
- automatic detection, import matching, suggestion persistence, or AI matching;
- package applicability scoring for heavily modified machines;
- current PrinterState selection or additional PrinterState workflows;
- component editing, diagnostics, recommendations, connectivity, or network access.
