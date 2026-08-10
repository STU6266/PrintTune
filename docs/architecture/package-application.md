# Durable Knowledge Package application

## Decision

`PackageApplication` is an immutable durable record meaning:

> PrintTune successfully materialized the effective facts from one exact Knowledge Package
> classification onto one exact PrinterState under one specific Knowledge Package/Core contract
> version.

Alpha persists only successful completed applications. Pending, failed, cancelled, retry-count, and
workflow status records are not part of this model. An operation is either absent or successfully
applied. Classification never applies knowledge automatically.

PackageApplication is operation history. `FieldClaim` remains immutable evidence history, and
`FieldResolutionService` continues to resolve Claims without consulting PackageApplication.

## Minimal immutable record

```ts
interface PackageApplication {
  readonly id: string;
  readonly printerId: string;
  readonly printerStateId: string;
  readonly printerKnowledgeIdentityId: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly seriesDefinitionId: string;
  readonly modelDefinitionId?: string;
  readonly coreContractVersion: string;
  readonly packageTrust: PackageKnowledgeTrust;
  readonly appliedAt: string;
}
```

Main generates the opaque local `id` and one authoritative strict-UTC `appliedAt`. That same
timestamp is every generated Claim's `createdAt`, making one coherent event. The application ID is
not derived from package identity, facts, Claims, or the semantic key.

Future domain validation requires non-empty trimmed IDs, an exact opaque `packageVersion`, a valid
optional model ID, strict UTC `appliedAt`, valid `PackageKnowledgeTrust`, and a valid SemVer
`coreContractVersion`. A historical constructor must not require the stored contract version to
equal the running version. New application orchestration uses the current
`KNOWLEDGE_PACKAGE_CORE_CONTRACT_VERSION` (`1.0.0` at this decision).

Do not add `updatedAt`, status, active/current flags, retry metadata, user/AI metadata, or
delete/undo operations.

## Semantic idempotency key

The semantic key consists of explicit columns:

```text
printerStateId
+ packageId
+ packageVersion
+ seriesDefinitionId
+ optional modelDefinitionId
+ coreContractVersion
```

It excludes random application ID and `printerKnowledgeIdentityId`. Identity ID records the
historical origin of the first successful application; the exact package/series/model reference
determines the materialized baseline. With classification history `A → B → C`, where A and C have
the same exact reference, applying C to the same state and contract returns `already_applied` if A
was applied. The original application and identity reference remain unchanged.

`printerId` is stored for ownership/audit clarity but is not part of uniqueness because PrinterState
IDs are globally unique. Persistence still verifies that the state and origin identity belong to the
stored Printer.

The following deliberately produce distinct applications:

- another PrinterState;
- series-only versus exact model;
- another model;
- another exact package version; or
- another Core contract version, if the package is available/compatible and the user explicitly
  confirms application.

Core contract version is interpretation semantics, not app, npm, or schema version. A change never
causes automatic reapplication. Package `formatVersion` is not stored: immutable exact package
identity plus Core contract version already identifies content and interpretation, so it adds no
semantic or necessary audit dimension.

## Trust snapshot

Store `packageTrust` exactly as supplied by the trusted local source to materialization. Historical
reads use this snapshot, never current installed-package trust. Claims independently retain the same
trust. Later trust changes must rewrite neither record.

Alpha installed-package trust is immutable, so trust is not part of the key. Future explicit
re-evaluation/rematerialization at different trust requires an explicit semantics extension; Alpha
does not speculate with a generation counter.

## Exact application-to-Claim traceability

Use a dedicated `package_application_claims` relation. Do not add an optional application field to
every Claim or infer membership from timestamp, value, provenance, or `factId`. A composite primary
key `(application_id, claim_id)` prevents duplicate links; unique `claim_id` ensures a created Claim
belongs to at most one PackageApplication.

Existing pre-model package Claims remain valid and unlinked. Migration fabricates no applications
and infers none from Claims. A later explicit Apply may therefore create one new linked baseline
batch even when similar legacy Claims exist. Once recorded, retries are safe. Claim-value scanning
would incorrectly conflate evidence history with operation history.

## Atomic lifecycle persistence

Introduce purpose-built `PackageApplicationLifecyclePersistence`:

```ts
applyOnce(
  application: PackageApplication,
  claims: readonly FieldClaim[]
): Promise<"applied" | "already_applied">;
```

It owns one transaction. One PackageApplication, every generated Claim, and every
application-to-Claim link commit together or none do. No committed application may have a
partial/missing batch, and no new Claim from this operation may exist without its application.
Independent `FieldClaimRepository.createBatch()` is insufficient for the user-facing lifecycle,
while remaining a valid low-level Claim primitive.

The in-memory implementation stages and validates all records and links before mutating collections.
Shared lifecycle contract tests cover it and SQLite.

SQLite follows existing explicit transaction patterns:

```text
BEGIN IMMEDIATE
lookup semantic key
if present: COMMIT; return already_applied
insert application
insert all Claims
insert all links
COMMIT; return applied
```

Any error rolls back all writes. Do not use `INSERT OR REPLACE`, mutating UPSERT, or Claim-value
deduplication.

An application precheck may avoid package loading and Claim-ID generation, but it is only an
optimization. Storage uniqueness remains authoritative when concurrent callers both pass the
precheck. The second equivalent transaction returns `already_applied`, not a raw constraint error,
and persists none of its generated Claims. Unused in-memory IDs from a losing concurrent operation
are acceptable.

If commit succeeds but the renderer loses its response or the app exits, a retry after restart finds
the same semantic record, returns `already_applied`, and creates no Claims. If the first transaction
never committed, retry applies normally. No renderer idempotency token is needed.

Already-applied status remains knowable if the exact package later disappears. Package availability
is needed for new materialization, not historical success.

## Migration 008 direction

Create a STRICT `package_applications` table with:

- `id` TEXT PRIMARY KEY
- `printer_id` TEXT NOT NULL
- `printer_state_id` TEXT NOT NULL
- `printer_knowledge_identity_id` TEXT NOT NULL
- `package_id` TEXT NOT NULL
- `package_version` TEXT NOT NULL
- `series_definition_id` TEXT NOT NULL
- `model_definition_id` TEXT NULL
- `core_contract_version` TEXT NOT NULL
- `package_trust` TEXT NOT NULL
- `applied_at` TEXT NOT NULL

Use explicit Printer, PrinterState, and PrinterKnowledgeIdentity foreign keys, including composite
ownership references where needed so state and identity belong to `printer_id`. Supporting unique
indexes on existing `(id, printer_id)` parents may be required. Do not reference installed packages:
uninstall/unavailability cannot erase application history.

Printer/State deletion follows existing ownership cascades and may remove their application history
together with state-scoped evidence. The append-only origin identity uses `NO ACTION`/`RESTRICT`.
There is no standalone application delete API.

Because SQLite permits multiple `NULL`s in ordinary composite uniqueness, use two partial indexes:

```text
UNIQUE (
  printer_state_id, package_id, package_version,
  series_definition_id, core_contract_version
) WHERE model_definition_id IS NULL

UNIQUE (
  printer_state_id, package_id, package_version,
  series_definition_id, model_definition_id, core_contract_version
) WHERE model_definition_id IS NOT NULL
```

Do not use an empty-string sentinel.

Create STRICT `package_application_claims` with `application_id`, `claim_id`, composite primary key,
and unique Claim ID. Application deletion may cascade junction rows only. Claim deletion should be
restricted so a successful application cannot lose membership independently; normal Printer/State
ownership deletion removes application/link/evidence coherently. No junction delete API exists.
Existing Claims are preserved and not backfilled.

## Main service evolution

Evolve the existing user-facing `PrinterKnowledgeApplicationService`; do not add a public bypass:

1. authorize active Workspace, Printer, and exact renderer-supplied PrinterState;
2. load the explicit current identity once;
3. reject no selection and unclassified;
4. derive the semantic key from that identity, state, and current Core contract;
5. optionally precheck durable application status;
6. load/validate the exact installed package and trust;
7. generate application ID, one timestamp, and fresh Claim IDs;
8. materialize using the identity captured at step 2; and
9. delegate atomic `applyOnce` persistence.

If classification changes concurrently, the operation does not switch midway. Its record retains the
identity captured at start. A later distinct reference is another key; returning to an equivalent
already-applied reference returns `already_applied`.

Replace the current direct `FieldClaimRepository.createBatch()` orchestration for this public Main
operation. The pure `materializePrinterSeriesPackageClaims()` remains unchanged and can produce
fresh arrays on each call; apply-once is orchestration/persistence semantics.

## Future renderer and UI boundary

The renderer eventually sends only:

```ts
{
  printerId: string;
  printerStateId: string;
}
```

Main derives identity, package reference, trust, Core contract, application/Claim IDs, and
timestamp. The safe result is `applied | already_applied`; the renderer reloads authoritative status
and receives no internal IDs.

For the displayed state/current identity, future status distinguishes:

- no selection or unclassified: cannot apply;
- known but package unavailable/unusable: cannot newly apply;
- known, compatible, not applied: eligible for explicit Apply; and
- semantic key already applied: **Druckerwissen angewendet**, without an enabled normal Apply
  button.

Future supporting copy:

> Bekannte technische Basisdaten werden als unveränderliche PrintTune-Nachweise für diesen
> Druckerzustand hinzugefügt. Am Drucker, an Firmware und Slicer-Dateien wird nichts geändert.

The action does not change firmware, slicer, settings, G-code, or hardware and never controls the
Printer. Application remains explicit.

## Resolution boundary and tests

`FieldResolutionService` remains unaware of PackageApplication. It resolves Claims by existing
trust, policy, agreement, recency, conflict, and safety rules. PackageApplication only decides
whether a new batch should be generated; it does not rank evidence or suppress legacy Claims.

Implementation tests must cover:

- first apply: one application, exact Claim batch, exact links;
- exact retry, restart retry, and simulated lost response: `already_applied`, no new Claims;
- concurrent equivalent calls: exactly one application/batch;
- distinct state, model, package version, Core contract, and series-only/model keys;
- `A → B → A`: final equivalent A is already applied;
- removed package: applied status and historical resolution remain;
- legacy unlinked Claims: no backfill, one first new apply-once batch;
- ownership mismatch rejection;
- failure after partial inserts: no application, Claims, or links;
- shared in-memory/SQLite lifecycle behavior; and
- reconstruction of historical older-contract applications.

Task 4.6 deliberately permitted repeated application. That test changes when this lifecycle becomes
authoritative: pure materialization still produces fresh Claim arrays, but user-facing orchestration
returns `already_applied` and persists no second batch for the same key. This is an intentional
Phase 5 behavior change, not Claim deduplication.

## Recommended implementation sequence

### 5.2e1 — PackageApplication domain and storage

Implemented: contract/Core validation, Migration 008, read APIs, the ordered junction relation, and
atomic in-memory and SQLite lifecycle persistence. Main orchestration and UI remain deferred.

### 5.2e2 — Idempotent Main application service

Implemented: `PrinterKnowledgeApplicationService` derives the current semantic key after
Workspace/Printer/State authorization, performs the durable precheck, and delegates new batches to
authoritative `applyOnce`. Its Main-only API returns `applied | already_applied` and exposes a
package-independent read-only application-status projection. IPC and UI remain deferred.

### 5.2e3 — Validated IPC/preload and Apply UI

Implemented: two fixed validated application channels expose status and explicit Apply through the
narrow preload API. The renderer sends only Printer/PrinterState IDs, reloads durable status, and
never applies knowledge automatically.
