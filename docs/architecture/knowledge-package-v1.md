# Declarative Knowledge Package v1

## Status and scope

This document defines the implemented first PrintTune Knowledge Package format. Phase 4 provides its
TypeScript contracts, Draft 2020-12 JSON Schema, Ajv structural validation, semantic validation,
Core compatibility checks, deterministic printer-series interpretation, trusted local installation,
and Claim materialization. Only synthetic content is present; real package content remains deferred.

Knowledge Packages are:

- declarative data;
- versioned and immutable once identified by `packageId` plus `packageVersion`;
- validated completely before use;
- source- and provenance-bearing;
- independent of AI; and
- incapable of executing arbitrary code.

A package must never contain executable JavaScript, TypeScript, Python, shell commands, SQL,
callbacks, dynamic expressions, arbitrary scripts, or another executable payload. Future rules may
use only a separately approved declarative rule language interpreted by the rule engine. Data that
resembles code is not made safe merely by placing it in JSON.

## Common package envelope

The v1 logical envelope is a closed object with this shape:

```ts
interface KnowledgePackageV1<TType extends KnowledgePackageType, TPayload> {
  readonly formatVersion: 1;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly packageType: TType;
  readonly displayName: string;
  readonly description?: string;
  readonly publisher: {
    readonly publisherId: string;
    readonly publisherDisplayName: string;
  };
  readonly coreCompatibility: {
    readonly minimumVersion: string;
    readonly maximumVersionExclusive?: string;
  };
  readonly payload: TPayload;
}
```

All identifiers are non-empty trimmed machine strings. `packageId` is globally namespaced and
stable; a name such as `org.example.synthetic-printer-series` illustrates the shape without
assigning a real package. `packageVersion` is an exact, opaque content-version identifier. The tuple
`(packageId, packageVersion)` identifies one immutable byte-equivalent logical package and must
never later denote different content. `displayName`, `description`, and publisher display text are
presentation metadata, never identity.

`publisherId` is a stable manifest assertion about who published the content and
`publisherDisplayName` is its label. Neither string proves authorship or trust. Cryptographic or
distribution evidence is evaluated outside the manifest.

`coreCompatibility.minimumVersion` and optional `maximumVersionExclusive` are versions of the
PrintTune Core contract understood by the package. Unlike opaque `packageVersion`, these fields use
valid Semantic Versioning 2.0.0 strings because a validator must compare them with the running Core.
The minimum is inclusive and the optional maximum is exclusive; prerelease comparison follows
Semantic Versioning. The interval must be non-empty. This ordered compatibility interval does not
make package-content versions semantically ordered by association.

The shipped Knowledge Package/Core semantic contract version is currently `1.0.0`. It covers the
canonical FieldDefinitions, targets, value types, canonical units, and interpretation semantics
required by Knowledge Package v1. It is independent of the application release, package content
version, `formatVersion`, database schema, UI features, and AI capabilities. A future incompatible
change to these Core semantics may advance this contract version.

Runtime compatibility validation accepts a package exactly when the current contract version is at
least its inclusive minimum and, when present, below its exclusive maximum. Trusted installation and
package materialization both enforce this check.

Unknown envelope fields are rejected in v1. This makes misspellings visible and prevents ignored
content from appearing effective.

## Format version and content version

`formatVersion` and `packageVersion` answer different questions:

- `formatVersion: 1` selects PrintTune's package structure and validation rules.
- `packageVersion` identifies a publisher's exact knowledge-content revision.

A future PrintTune build must reject a format version it does not support before interpreting its
payload. It must not guess that a newer format is backward compatible. Supporting another format
adds an explicit parser/validator path; it does not mutate the meaning of format v1.

Floating or latest-version resolution is forbidden. `packageVersion` is always an exact opaque
string, and no token has reserved resolution meaning. A literal value such as `latest` identifies
only the exact tuple `(packageId, "latest")`; it never aliases a newer, semantically greatest, or
otherwise selected version. Compatibility ranges belong only in `coreCompatibility`, not in identity
or Claim provenance.

## Package types

The initial architecture reserves this closed set:

```ts
type KnowledgePackageType = "printer_series" | "component_catalog" | "firmware" | "slicer";
```

Each type has a distinct schema selected by `packageType`; a generic untyped payload is invalid.
Only `printer_series` is implemented. The other three names reserve clear architectural roles but
are rejected until their payload schemas are implemented.

Test procedures and calibration workflows are not silently placed in these types. If future
TestWorkflow content needs distribution, it receives a separately reviewed package type and
lifecycle.

## Printer-series package

### One series per package

A `printer_series` v1 package contains exactly one technically related series. This keeps the
package boundary, identity reference, updates, and review unit aligned. ADR-004 still permits
multiple marketed models or revisions inside that technical series. A technically different series
uses another package.

There is no demonstrated Alpha benefit to multiple series in one artifact. The `seriesDefinitionId`
remains explicit because it gives persisted references a stable definition identity and leaves room
for a later format without changing `PrinterKnowledgeDefinitionReference`.

The exact logical payload is:

```ts
type PrinterSeriesKnowledgePackageV1 = KnowledgePackageV1<
  "printer_series",
  {
    readonly series: PrinterSeriesDefinitionV1;
  }
>;

interface PrinterSeriesDefinitionV1 {
  readonly seriesDefinitionId: string;
  readonly manufacturerDisplayName: string;
  readonly seriesDisplayName: string;
  readonly facts: readonly PackageFieldFactV1[];
  readonly models: readonly PrinterModelVariantDefinitionV1[];
}

interface PrinterModelVariantDefinitionV1 {
  readonly modelDefinitionId: string;
  readonly modelDisplayName: string;
  readonly facts: readonly PackageFieldFactV1[];
}
```

`models` is present and may be empty. IDs are stable, non-empty, trimmed identifiers unique within
their containing series. A model ID is meaningful only inside the exact package version and series.
The tuple already implemented by `PrinterKnowledgeDefinitionReference` is therefore unambiguous:

```text
packageId + packageVersion + seriesDefinitionId [+ modelDefinitionId]
```

The series contains only identity labels, model variants, and baseline facts required by the first
vertical slice. Marketing copy, images, URLs, prices, availability, tags, localized text maps, match
aliases, revision trees, and compatibility matrices are deferred. Technical aliases may be added
later when an actual matching flow defines normalization and ambiguity behavior; manual Alpha
selection does not require them.

### Series and model facts

Series facts establish shared package baseline evidence. A model variant contains only differences
or more-specific baseline facts; it does not duplicate the complete series.

For a series-only identity, its effective fact set is the series facts. For an exact-model identity,
the deterministic effective set is:

1. start with all series facts;
2. replace a series fact when the model has the same exact `fieldPath`;
3. add model facts whose `fieldPath` is absent from the series.

The series facts contain at most one entry for each canonical field path, and each individual
model's facts contain at most one entry for each canonical field path. A duplicate path within
either scope makes the package invalid. The same path at series level and model level is valid and
expresses an intentional override; the same path in different models is also valid because only the
selected model participates.

The implemented preprocessing produces one effective package Claim per field, not two conflicting
Claims for an overridden value. It retains the exact fact object that won. If a series fact with
`factId: A` is overridden by a selected-model fact with `factId: B`, the effective value and source
fact are B. It must not generate a synthetic third fact identity. The immutable package preserves
both original facts.

This is a small override rule, not a general inheritance engine. Models cannot remove a series fact
in v1; absence means no override.

## Declarative baseline facts

The exact fact shape reuses the implemented scalar and unit vocabulary:

```ts
interface PackageFieldFactV1 {
  readonly factId: string;
  readonly fieldPath: string;
  readonly value:
    | { readonly type: "string"; readonly value: string }
    | { readonly type: "number"; readonly value: number }
    | { readonly type: "boolean"; readonly value: boolean };
  readonly unit?: "mm" | "mm/s" | "mm/s2" | "degC" | "mm3/s" | "ratio";
}
```

`factId` is a stable package-local machine identifier assigned by the package author. It must be a
non-empty trimmed string, must not depend on array position, and must not be generated or rewritten
during loading. Every `factId` is unique across the complete `.ptpack`, including the series facts
and every model variant's facts.

`fieldPath` cannot serve as fact identity because the same canonical field may legitimately have a
series fact and different overrides in multiple models. Despite its global uniqueness, `factId` does
not affect override precedence: the selected model's matching `fieldPath` still overrides the series
fact.

Facts contain no local `printerId`, `printerStateId`, or `componentInstallationId`. A printer-series
fact describes baseline applicability. When explicitly applied later, application code targets the
generated immutable Claim at a concrete PrinterState and assigns exact package provenance and
locally determined trust.

Packages cannot provide `ClaimTrust`, confidence promotion, provenance objects, FieldDefinitions,
ResolutionPolicies, safety direction, or arbitrary validators. Core owns those semantics. A package
fact can influence evidence but cannot decide how competing evidence resolves.

### Exact fact provenance

The implemented `knowledge_package` source reference retains the exact source `factId` in addition
to `packageId` and `packageVersion`:

```text
packageId + packageVersion + factId
```

The backward-compatible evolution is defined in
[`field-claims-and-resolution.md`](field-claims-and-resolution.md#knowledge-package-fact-provenance-evolution):
historical package-level references remain valid with an absent `factId`, while every newly
generated Package v1 Claim carries the winning fact's exact `factId`. Core validation, migration
006, repository reconstruction, and the Package v1 materializer implement this distinction.

Facts do not duplicate `seriesDefinitionId` or `modelDefinitionId`. The globally unique `factId`
identifies the source inside one immutable package version, while PrinterKnowledgeIdentity
separately records which series and optional model the user selected. These identifiers answer
different questions: fact provenance identifies the supplied assertion; PrinterKnowledgeIdentity
identifies the selected product definition.

### Core registry compatibility

Every v1 printer-series fact must name an existing Core FieldDefinition whose target is
`printer_state`. At validation time:

- `value.type` must exactly equal the definition's `valueType`;
- the fact's unit must exactly equal the definition's canonical unit semantics;
- string and boolean facts must have no unit;
- numeric values must be finite; and
- no parsing, scalar coercion, tolerance, or unit conversion is performed.

For example, a numeric Core field supplied as the string `"0.4"` is invalid package content. It is
not installed as weak evidence and does not become a later resolution conflict.

V1 accepts only fields in the Core-owned registry. Package-defined extension fields are deferred to
a later schema or reviewed extension-registry feature. An unknown path rejects the package; it is
never silently assigned `exact_match`. This package-ingestion rule is intentionally stricter than
FieldClaim creation, which can preserve unknown historical evidence from other sources.

## Component knowledge and dependencies

Individual component product knowledge belongs in `ComponentDefinition`, identified by the exact
`packageId`, `packageVersion`, and `definitionId` reference described in
[`component-identity-model.md`](component-identity-model.md). A printer-series package must not
duplicate component specifications into its series or model facts.

Stock-component references and cross-package dependency resolution are deferred from the first v1
slice. Consequently the initial `PrinterSeriesDefinitionV1` has no stock-components field and the
common envelope has no dependencies section. This avoids unresolved or floating references and an
npm-like resolver. A later format revision may add an exact component reference plus explicit
dependency validation when stock-component materialization has a concrete consumer.

## Trust boundary

Package content identity and local trust are separate:

- The manifest asserts package and publisher identity.
- Local installation metadata records how the artifact arrived and what trust PrintTune assigns.
- A package cannot self-declare itself `developer_verified` or `customer_verified`.
- Trust cannot alter a Core FieldDefinition, ResolutionPolicy, or safety rule.

The two currently approved package-derived Claim trust outcomes are `developer_verified` and
`customer_verified`. A valid package receives one only through trusted local context, such as
bundled application distribution or an approved customer-managed channel. A merely manual or future
community import is not promoted into either category. Until a reviewed unverified-package trust
vocabulary and behavior exist, such an artifact may be structurally valid but must remain
quarantined and must not generate package-derived Claims.

Installation source belongs in local installation metadata, never in the manifest. Alpha implements
the exact mappings `bundled_official` to `developer_verified` and `customer_verified_installation`
to `customer_verified`. Manual/community import remains deferred until it has explicit trust
behavior. The package cannot truthfully assert how it was installed.

Publisher strings are descriptive metadata, not cryptographic identity. Alpha does not require a new
signature protocol: bundled official packages can inherit trust from the trusted application
distribution, and customer packages require a locally approved channel. The architecture reserves
signature verification for later external/community distribution, after signing identities,
revocation, rotation, and failure handling are designed together.

## Physical `.ptpack` format

V1 `.ptpack` is one UTF-8 JSON document using the envelope above. The `.ptpack` extension identifies
its purpose; it does not make the document an executable or opaque binary format.

Plain JSON is chosen because the first slice needs no assets, keeps parsing and deterministic
validation small, and avoids archive path traversal, decompression bombs, duplicate-entry ambiguity,
and file-count policy. Comments, YAML, embedded files, external file references, and non-finite JSON
numbers are not allowed.

A later format version may define a ZIP container with a manifest at a fixed path and strict path,
entry-count, expanded-size, compression-ratio, duplicate-name, and executable-file rules. That
future format must be explicitly versioned and validated at the archive boundary; v1 readers must
not guess based on file contents.

`.ptbundle` is reserved as a future distribution container for multiple independent `.ptpack`
artifacts. A bundle does not create a shared package identity, merge manifests, weaken individual
validation, or affect single-package v1. Bundle parsing and atomic multi-package installation are
not defined here.

## Validation and acceptance pipeline

The implemented trusted installation path uses distinct stages:

```text
file boundary and resource limits
→ UTF-8 / JSON parsing
→ structural schema validation
→ semantic package validation
→ Core FieldDefinition compatibility validation
→ local source and trust decision
→ atomic acceptance into the installed knowledge store
```

The responsibilities are deliberately separate:

- **Boundary validation** rejects an unsupported physical format, excessive resources, invalid
  encoding, and malformed JSON before domain interpretation.
- **Structural validation** checks the closed envelope and type-specific payload, required fields,
  scalar types, and unsupported `formatVersion` or `packageType`.
- **Semantic validation** checks trimmed identifiers, uniqueness, the exact series/model reference
  graph, package-wide `factId` uniqueness, duplicate field paths within each definition, model
  pairing, and immutable `(packageId, packageVersion)` identity.
- **Core compatibility validation** checks that the current semantic contract version
  `KNOWLEDGE_PACKAGE_CORE_CONTRACT_VERSION = 1.0.0` lies in the declared interval, then resolves
  every fact against the Core registry and checks target, scalar type, and canonical unit exactly.
- **Trust validation** evaluates external distribution/installation evidence and assigns local
  status. Manifest publisher text cannot satisfy this stage.

Validation is all-or-nothing. An invalid, unsupported, incompatible, or untrusted package must not
partially install, generate Claims, mutate Printer or PrinterState data, or affect existing
installed packages. It returns explicit stage-specific validation problems. Repository acceptance
provides immutable collision and metadata-conflict behavior.

## Updates, removal, and history

`packageId + packageVersion` denotes immutable knowledge. Installing a newer exact version adds
another artifact; it does not edit the old artifact or rewrite package-derived Claims. Reapplying a
new version is an explicit future operation that creates new immutable evidence with the new exact
provenance. Printer history is never automatically recalculated.

Removing an installed package does not delete historical Claims, ComponentInstallation snapshots, or
PrinterKnowledgeIdentity records. Those retain exact package references and local identity or
provenance snapshots. Live browsing and package-only detail may become unavailable, but PrintTune
must not substitute another version or invent missing content.

A historical package-derived Claim retains its typed value and canonical unit, so understanding the
asserted value never requires the package to remain installed. Its exact
`packageId + packageVersion + factId` provenance continues to identify the original package fact and
can be resolved again if that immutable package version later becomes available.

## Rules and security boundary

The first implementation has definitions and baseline facts only. Detection, validation, diagnostic,
recommendation, question, safety-supporting, and workflow rules are deferred. When a declarative
rule language is approved, evaluation belongs in the separate rule engine; package data never
supplies a callback or executable evaluator.

Package data may later influence evidence, diagnostics, and recommendations through validated
application boundaries. It may not directly:

- execute code or dynamic expressions;
- call filesystem, network, shell, SQLite, operating-system, or AI APIs;
- send G-code or control a printer;
- mutate printer firmware, slicer profiles, imports, or user files;
- change Core FieldDefinitions, target or unit semantics, ResolutionPolicies, or safety direction;
- weaken safety behavior or promote its own trust; or
- generate local IDs or choose local Claim targets without application authorization.

`factId` is inert provenance data. It has no effect on trust, confidence, resolution precedence, or
safety policy, and must never be interpreted as code, an expression, a path, a URL, a callback
identifier, or a general database key outside exact package provenance.

## Implemented v1 scope

The implemented schema, validators, and interpretation provide:

1. the closed common v1 envelope;
2. `packageType: "printer_series"`;
3. exactly one series with identity labels;
4. a present, possibly empty model-variant array;
5. series and model baseline facts with stable, package-wide-unique `factId` values using the
   existing scalar and canonical-unit vocabulary;
6. duplicate `factId` rejection across the complete package;
7. unique series/model IDs and duplicate field-path rejection within the series and each individual
   model;
8. deterministic series-plus-model override preprocessing that retains the winning source fact;
9. acceptance of known Core `printer_state` fields only; and
10. explicit structural, semantic, Core-compatibility, and trust-stage errors; and
11. exact winning-fact materialization with atomic FieldClaim batch persistence.

The implementation does not include component references, dependencies, aliases, localized maps,
rules, archives, assets, signatures, extension fields, or real printer data.

## Deferred items

The following remain deliberately outside v1's first implementation:

- payload schemas for `component_catalog`, `firmware`, and `slicer`;
- package-defined extension fields and extension registry composition;
- component references and dependency resolution;
- publisher signing, certificate/key lifecycle, revocation, and community trust;
- ZIP archives, images, documentation assets, localization, and bundles;
- declarative rule schemas and rule-engine integration;
- PackageApplication/idempotency, automatic reapplication, and trust-management workflows;
- TestWorkflow assets, package distribution, updates, and removal implementation;
- real manufacturer, model, firmware, slicer, component, or technical values;
- UI, AI integration, network access, and printer connectivity.
