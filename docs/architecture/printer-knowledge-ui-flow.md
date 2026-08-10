# Printer knowledge classification and application UI flow

## Scope and decision

The first Alpha UI extends the existing Printer detail on `PrintersPage`; it does not create a
separate package-management area. A new section titled **Druckermodell und Wissen** appears before
the existing **Technische Angaben** section. Classification complements manual technical input and
never replaces it.

The flow keeps two user actions separate:

1. explicitly confirm a product classification; and
2. explicitly apply knowledge for one named PrinterState.

Selecting or confirming a series/model never creates package FieldClaims. Applying knowledge never
changes firmware, slicer profiles, printer files, G-code, or the physical Printer. It adds immutable
evidence only inside PrintTune.

Phase 5 should implement classification UI before exposing application. A normal user-facing
**Druckerwissen anwenden** action requires a durable `PackageApplication`/idempotency boundary
first. Without it, every retry or repeated click creates another valid evidence batch, and the UI
cannot truthfully distinguish success, retry after an uncertain failure, and intentional
reapplication.

## Printer-page presentation

The section shows the current classification, exact package availability, and actions for the opened
Printer. It uses German presentation text and does not expose domain type names, package provenance
IDs, trust enums, or resolution-policy names.

The four current-classification states are:

| Domain state            | Primary UI text                        |
| ----------------------- | -------------------------------------- |
| No selection record     | **Noch kein Druckermodell ausgewählt** |
| Explicitly unclassified | **Unbekannt / Eigenbau**               |
| Known series only       | Manufacturer, then series              |
| Known exact model       | Manufacturer, then `Series – Model`    |

No selection and explicit unclassified remain distinct. Opening a Printer must not create an
unclassified record to fill the empty state.

For a known identity, the current immutable display snapshot remains visible even when its package
is unavailable. Availability is shown separately as **Wissen verfügbar** or **Wissen nicht
verfügbar**. An unavailable package does not remove the classification, manual data, old Claims, or
resolved historical information.

The primary action is **Druckermodell auswählen** when no selection exists and **Druckermodell
ändern** otherwise. Classification history remains accessible through the domain/service boundary,
but the first UI does not render a full audit timeline. A small history disclosure can follow only
when there is a demonstrated user need; current classification is the first task.

## Selection and confirmation

Selection opens a compact modal or inline stepper rather than permanently editable identity fields.
It lists locally available approved printer-series definitions and one explicit **Unbekannt /
Eigenbau** option. A user may browse without any write.

The final step displays, for example:

```text
Ausgewählt
Synthetic Manufacturer
Synthetic Series – Model X

[Druckermodell bestätigen]
```

Only the confirmation invokes Main. While confirmation is pending, selection controls and the
confirmation button are disabled to prevent double-submit. Success closes the flow and reloads the
authoritative current-classification projection. Failure leaves the selection visible for retry but
does not optimistically change the displayed current classification.

For a known selection, Main must:

1. authorize the Printer against the active Workspace;
2. resolve the exact installed package and verify its digest;
3. parse and validate the package, including Core compatibility;
4. find the exact series and optional model;
5. derive display snapshots from that validated definition, ignoring renderer-supplied labels;
6. generate the identity ID and `selectedAt`; and
7. atomically append and select the immutable identity through the existing lifecycle boundary.

For **Unbekannt / Eigenbau**, Main authorizes the Printer, generates the ID/time, and atomically
creates/selects the unclassified variant. The renderer supplies no invented manufacturer, series,
model, or package metadata.

`PrinterKnowledgeClassificationService` implements this 5.2b write boundary in Main. It accepts a
closed, runtime-validated exact reference, authorizes through the existing identity application
service, and re-reads the digest-valid package before every known confirmation. Series/model
references and Core compatibility are validated again, and immutable display snapshots come only
from that trusted package content. The existing identity application service remains the sole owner
of generated identity IDs, authoritative timestamps, and atomic create-and-select persistence.

Confirming the exact currently selected reference returns `already_selected` without adding history,
but only after the package has been revalidated. Confirming an already selected unclassified state
also returns `already_selected` and performs no package lookup. Every actual correction appends a
new immutable identity and atomically selects it; older identities remain history. Classification
does not apply package knowledge, create FieldClaims, or change any PrinterState.

## Renderer-safe catalog

Catalog choices come only from locally installed, digest-valid, structurally valid, Core-compatible
`printer_series` packages. React must not contain manufacturer or model data. The catalog
application service lists installed records, reads each exact package through the durable source,
parses it, validates full compatibility, and returns a frozen display projection in deterministic
package/series/model order.

A minimal renderer-safe item is:

```ts
interface PrinterKnowledgeCatalogItem {
  readonly selection: {
    readonly packageId: string;
    readonly packageVersion: string;
    readonly seriesDefinitionId: string;
  };
  readonly manufacturerDisplayName: string;
  readonly seriesDisplayName: string;
  readonly models: readonly {
    readonly selection: {
      readonly packageId: string;
      readonly packageVersion: string;
      readonly seriesDefinitionId: string;
      readonly modelDefinitionId: string;
    };
    readonly modelDisplayName: string;
  }[];
}
```

Exact reference fields are safe selection identifiers, not authority. They need not be rendered.
Using them is smaller and restart-safe compared with a session token map. Main revalidates the
reference at confirmation time and never trusts the accompanying display projection. The renderer
does not receive raw package JSON, installed-package rows, publisher/trust controls, installation
source, `factId`s, or technical facts merely to render the catalog.

`PrinterKnowledgeUiService` implements this read-only projection in Main. It returns a non-sensitive
count of installed entries omitted because they are unavailable, corrupt, invalid, or
Core-incompatible; unexpected repository failures remain service errors rather than being hidden.

Corrupt, structurally invalid, unsupported, or Core-incompatible installed content is excluded from
choices and recorded as a technical Main error. It is not downgraded to an untrusted selectable
item. Empty catalog text is **Noch keine auswählbaren Druckermodelle verfügbar.**

## Current status projection and exact availability

One Main query should return the authorized Printer's current classification and availability:

```ts
type PrinterKnowledgeStatus = {
  readonly printerState: {
    readonly id: string;
    readonly label: "Initialer Druckerzustand";
  };
} & (
  | { readonly kind: "no_selection" }
  | { readonly kind: "unclassified" }
  | {
      readonly kind: "known";
      readonly manufacturerDisplayName: string;
      readonly seriesDisplayName: string;
      readonly modelDisplayName?: string;
      readonly packageAvailability: "available" | "unavailable" | "unusable";
    }
);
```

Availability is determined only from the current identity's exact `packageId` and `packageVersion`.
There is no latest-version resolution, version substitution, or fuzzy matching. The identity
snapshot is the display fallback when its exact package cannot be read. A missing package disables
knowledge application but does not disable classification changes or manual technical entry.

## Exact PrinterState

The existing Printer detail and `PrinterTechnicalDataService` explicitly load and use the Printer's
initial state. The first Alpha knowledge UI should keep that narrow boundary:

- label it **Initialer Druckerzustand** with its existing timestamp;
- retain the exact `initialState.id` in the loaded detail projection; and
- apply knowledge only to that displayed state ID.

This is an intentional initial-state flow, not a rule that the earliest, newest, first, or
highest-ID state is globally current. Main must re-fetch the supplied state and verify Printer
ownership. A future PrinterState history/viewer can supply another exact viewed state without
changing the application contract. No current-PrinterState pointer or inferred state is introduced
here.

## Knowledge application and idempotency decision

Option C is required for the normal Alpha UI: do not expose an enabled application action until a
durable `PackageApplication`/idempotency lifecycle exists.

[`package-application.md`](package-application.md) defines the approved successful-operation record,
semantic idempotency key, atomic application/Claim/link lifecycle, and future renderer boundary. It
does not make application automatic or enable the action in the current UI.

- Option A makes repeated evidence creation look like an ordinary harmless action.
- Option B prevents duplicates only in one renderer session and fails after restart or an uncertain
  IPC response.
- Option C preserves the existing immutable-Claim semantics without pretending that retries are
  idempotent.

The classification slice may show **Wissensanwendung folgt** rather than a disabled control that
looks actionable. After the durable boundary exists, the section shows **Druckerwissen anwenden**
only for a known current classification with an available exact package and one displayed exact
state.

Before confirmation, explain:

> PrintTune übernimmt bekannte technische Basisdaten aus dem ausgewählten Wissenspaket für den
> angezeigten Druckerzustand. Eigene bestätigte Hardware-Angaben bleiben erhalten und können
> Paketwerte überstimmen. Am Drucker, an Firmware oder Slicer-Dateien wird nichts geändert.

The durable operation must own one application ID/idempotency key, the exact identity/package/state
context, completion status, and the single atomic Claim batch. Its detailed contract needs a focused
design task; it must not deduplicate by equal values, provenance, or `factId`. Only after a
confirmed successful application should the UI reload knowledge status and technical fields.

## Technical Details integration

After application, `PrinterTechnicalDataSection` continues to read the same exact state's fields
through `FieldResolutionService`. There is no package-only resolver or second source of technical
truth. Existing manual input remains available before and after classification/application.

The UI preserves all resolver outcomes:

- `resolved`: show the deterministic value;
- `missing`: **Noch keine Angabe**;
- `conflict`: **Widersprüchliche Angaben** with a short prompt to review evidence;
- `blocked`: retain the existing reason-specific safe explanation.

Package values never silently overwrite user evidence. Installed-hardware/user-confirmed policies,
agreement, conflict, and safety-conservative outcomes remain Core decisions; neither renderer nor AI
chooses a winner. Classification and application do not fabricate values for missing fields.

The smallest useful provenance addition is an optional renderer-safe source label derived by Main
from the resolved field's supporting Claims:

- **Eigene bestätigte Angabe**;
- **Manuelle Angabe**;
- **PrintTune-Wissenspaket**; or
- **Mehrere übereinstimmende Quellen**.

Conflict remains a status rather than pretending one source won. The projection exposes no Claim
IDs, `factId`, trust enum, or package internals. This source label can be added with the application
UI; it is not required for classification selection.

## Trusted installation and synthetic development data

There is no package-installation UI in this slice. Renderer code cannot choose
`customer_verified_installation`, trust, digest, or installation metadata. Trusted installation
remains a privileged Main/development boundary. Filesystem import, file pickers, community trust,
signatures, updates, network repositories, and trust mutation remain deferred.

For development, prefer an explicit developer-only fixture setup that installs one obviously
synthetic package into isolated app data. This avoids production startup side effects and prevents a
synthetic artifact from resembling shipped official manufacturer knowledge. Component/application
tests use test-only repositories; a documented development command or fixture launcher can prepare
manual smoke data. Do not hard-code the fixture in React or seed it during normal startup.

## Future narrow API and IPC surface

Task 5.2c implements the classification portion of this boundary with four fixed IPC channels and a
narrow preload API for catalog, status, known confirmation, and unclassified confirmation. Every
handler validates the trusted renderer sender, Main remains the authoritative runtime-validation and
authorization boundary, and transport failures are reduced to renderer-safe error codes. Raw
package, repository, parser, digest, trust, and Electron objects are not exposed.

The Printer detail now renders **Druckermodell und Wissen** before **Technische Angaben**. It loads
the renderer-safe catalog and current status, shows exact availability without replacing immutable
snapshot labels, and uses an explicit local pending-selection/confirmation step. Visually colliding
exact package versions remain separate and show their opaque version labels; neither version is
described as newer or preferred. Classification success reloads the authoritative Main status. It
does not apply package knowledge, create Claims, or alter technical data, and no package-application
IPC or button exists.

The inline selector uses disclosure semantics. Changing the opened Printer resets its pending
selection and transient messages, and renderer request generations prevent late status, catalog, or
save responses from an earlier Printer interaction from altering the newly opened Printer UI.
Visually colliding exact choices are progressively disambiguated by opaque version and, only when
that still collides, the already renderer-safe package ID. Duplicate model display names use their
definition ID only as a final local fallback.

The renderer eventually needs only these conceptual operations:

```ts
listPrinterKnowledgeCatalog(): Promise<readonly PrinterKnowledgeCatalogItem[]>;
getPrinterKnowledgeStatus(printerId: string): Promise<PrinterKnowledgeStatus>;
confirmPrinterKnowledgeSelection(input: {
  printerId: string;
  selection: KnownCatalogSelection | { kind: "unclassified" };
}): Promise<PrinterKnowledgeStatus>;

// Added only after durable PackageApplication/idempotency exists.
applyCurrentPrinterKnowledge(input: {
  printerId: string;
  printerStateId: string;
}): Promise<KnowledgeApplicationResult>;
```

These become fixed channels with shared request/response validators, trusted-renderer checks, and a
narrow preload facade. Static selection browsing needs no writes. Main authorizes the active
Workspace and Printer for every operation, validates IDs and exact state ownership, and re-resolves
all package definitions. The renderer never supplies trust, raw JSON, `installedAt`, Claim IDs,
identity IDs, `selectedAt`, or authoritative display names. Raw IPC and repositories remain hidden.

The API belongs in ordinary Main application services, not React or Core. A future trusted Chat
orchestrator can call the same services after explicit user confirmation; it receives no AI-only
bypass and cannot infer, select, or apply a model autonomously.

## Errors, loading, and action state

Main maps typed internal failures to a closed renderer-safe outcome. Suggested user text is:

| Outcome                            | User-facing text                                                        |
| ---------------------------------- | ----------------------------------------------------------------------- |
| No active Workspace                | **Wähle zuerst einen Workspace aus.**                                   |
| Printer absent/not authorized      | **Der Drucker ist nicht mehr verfügbar.**                               |
| Exact package unavailable          | **Das zugehörige Wissenspaket ist derzeit nicht verfügbar.**            |
| Selection stale/definition missing | **Die Auswahl ist nicht mehr verfügbar. Bitte wähle erneut.**           |
| Package invalid/Core-incompatible  | **Das Wissenspaket ist mit dieser PrintTune-Version nicht kompatibel.** |
| Current identity unclassified      | **Für „Unbekannt / Eigenbau“ kann kein Paketwissen angewendet werden.** |
| Application persistence failed     | **Das Druckerwissen konnte nicht sicher gespeichert werden.**           |

SQLite, Ajv, SemVer, crypto details, stack traces, IDs, and package internals remain in Main logs
and typed causes, not renderer messages.

Catalog/status loading shows **Druckermodell wird geladen …**. Confirmation shows **Wird bestätigt
…**, and application later shows **Druckerwissen wird angewendet …**. Pending actions disable their
own controls. The UI does not optimistically change classification or technical values. Success is
announced with a short status message and followed by an authoritative reload; failure preserves the
last confirmed state.

## Recommended implementation split

### 5.2a — catalog and status service (implemented)

- derive deterministic renderer-safe choices from locally installed validated packages;
- project current identity and exact package availability;
- enforce active-Workspace/Printer authorization;
- add application-service tests only; no IPC or UI.

### 5.2b — safe classification write service

- accept only an exact approved reference or unclassified selection;
- re-read, digest-check, parse, and revalidate known definitions in Main;
- derive snapshots/ID/time in Main and use atomic create-and-select;
- test stale, unavailable, incompatible, cross-Workspace, and model-pairing failures.

### 5.2c — classification IPC/preload and Printer-page UI

- add fixed validated channels and narrow preload methods;
- render the four classification states, availability, catalog, confirmation, and pending errors;
- retain manual technical entry and the explicit initial-state presentation;
- do not expose knowledge application yet.

### 5.2d — PackageApplication/idempotency design

- define durable application identity, retry, completion, and exact context semantics;
- decide the smallest migration/repository boundary without deduplicating Claims heuristically;
- preserve one atomic Claim batch and historical independence.

### 5.2e — durable application implementation and explicit UI action

- PackageApplication storage and authoritative Main apply-once/status orchestration are implemented;
- expose the existing durable status and apply operation through validated transport in 5.2e3;
- connect the exact displayed state to the existing knowledge application and resolution flow;
- refresh technical details and add the minimal renderer-safe source label;
- test retries/restarts, unavailable packages, conflicts, double-submit, and persistence failure.

Real packages, normal startup seeding, filesystem import, signatures, community/quarantine trust,
trust mutation, uninstall, updates, network sources, automatic application, user-facing
state-history navigation, Chat/AI integration, printer connectivity/control, and TestWorkflow assets
remain deferred.
