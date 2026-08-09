# Installed Knowledge Packages

## Purpose and boundary

The installed Knowledge Package store is the local, durable availability and trust boundary for
accepted `.ptpack` content. It supports later browsing and exact lookup for new Claim
materialization. It is not the historical evidence store.

Immutable `FieldClaim`s retain their value, unit, exact package/fact provenance, and trust at the
time they were created. Claim resolution must never read this store. Removing or losing an installed
package therefore does not remove or invalidate Claims, PrinterKnowledgeIdentity history, or
PrinterState history. A known current identity may remain pinned to an unavailable package: old
Claims still resolve, while applying that package to another state fails as package unavailable.

Installed immutable content also remains stored if a later shipped Knowledge Package/Core contract
version falls outside the package's declared compatibility interval. Exact lookup and parsing may
still succeed, but compatibility validation rejects new application or materialization. The stored
package, its trust, and historical Claims are not rewritten or removed.

The Alpha store accepts only inert, validated printer-series v1 JSON. It does not execute package
content or grant filesystem, network, shell, AI, printer, firmware, slicer, or G-code capabilities.

## Exact identity and immutable content

The store key is the exact tuple:

```text
packageId + packageVersion
```

`packageVersion` is opaque. Lookup never uses `latest`, ranges, display labels, installation order,
or semantic-version comparison. Multiple versions such as `P/1.0` and `P/1.1` coexist as separate
records. There is no global current-package pointer; a Printer's exact
`PrinterKnowledgeIdentity.definitionRef` selects the applicable version.

One key promises one immutable sequence of accepted UTF-8 bytes. Alpha records a lowercase SHA-256
digest of the exact original UTF-8 `.ptpack` text. SHA-256 is sufficient for local collision and
corruption detection at this boundary. It is not a signature, proof of authorship, publisher
identity, or source of trust.

An incoming package with an existing key and either different exact raw text or a different digest
fails explicitly with an error such as `immutable_package_collision`. Equality is never inferred
from the caller-supplied digest alone. The record is not overwritten, merged, or selected by file
timestamp. Different content requires a different `packageVersion`.

## Raw content storage

Alpha should store the exact accepted `.ptpack` text directly in SQLite rather than retaining only
an import path. Version 1 is one UTF-8 JSON document and has no assets, so this choice:

- survives deletion or movement of the original import file;
- keeps content and accepted local metadata in one transaction;
- avoids stale paths and application-data filesystem coordination; and
- gives `KnowledgePackageSource` one deterministic local read.

Installation must not parse and reserialize, normalize whitespace, reorder properties, or otherwise
canonicalize the accepted JSON. The stored text must reproduce the exact input whose UTF-8 bytes
were hashed. Parsed manifest data is used for validation and identity extraction, not as a rewritten
storage representation. A future asset-bearing container requires a separately designed storage
boundary.

## Minimal accepted record

The recommended creation-only Alpha record contains:

| Field                | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `packageId`          | Exact manifest-derived package identity                                   |
| `packageVersion`     | Exact opaque manifest-derived content version                             |
| `formatVersion`      | Records the accepted format and supports a closed schema check            |
| `packageType`        | Records the accepted payload type without duplicating its full manifest   |
| `rawText`            | Exact accepted UTF-8 JSON text                                            |
| `contentSha256`      | Lowercase 64-hex digest of the exact UTF-8 bytes                          |
| `installationSource` | Trusted local account of how the package entered the accepted store       |
| `trust`              | Approved trust assigned to Claims on future materialization               |
| `installedAt`        | Caller-supplied strict ISO-8601 UTC time of the original accepted install |

Display name, description, publisher fields, series/model definitions, and facts remain in the
validated raw manifest and are not duplicated into relational columns. `formatVersion` and
`packageType` are the only deliberate manifest denormalization: they make the accepted-format/type
boundary explicit and cheaply inspectable. Package ID and version must exactly match the parsed raw
content.

`installedAt` is local metadata, not package-authored data. An idempotent reinstall preserves the
original value. Alpha has no installation-event audit table.

## Installation source and trust

Installation source answers how content entered the accepted store. Trust answers how Claims made
from that content may be characterized. Both are local metadata established by trusted application
code; neither comes from publisher strings, namespaces, display labels, or another manifest field.

Alpha permits only this closed mapping:

| Installation source              | Package Claim trust  | Meaning                                                                           |
| -------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `bundled_official`               | `developer_verified` | Candidate delivered through the trusted PrintTune application distribution        |
| `customer_verified_installation` | `customer_verified`  | A privileged customer/business process has already established local verification |

Storing both values keeps source context and Claim trust explicit, while a database constraint and
row validator enforce the mapping. Callers cannot pair them arbitrarily. In particular, ordinary
file selection does not establish `customer_verified`, and customer content cannot become
`developer_verified`.

Arbitrary manual or community `.ptpack` files may be parsed and inspected by a future workflow, but
Alpha must not admit them into this trusted source. The current trust vocabulary has no honest
unverified/community package outcome. Such content requires a separately designed quarantine and
promotion model before it can generate Claims; it must not be mislabeled as developer- or
customer-verified. This document does not create that store.

## Acceptance pipeline and atomicity

For the currently supported `printer_series` v1 type, trusted installation follows this order:

```text
candidate UTF-8 text and resource boundary
→ parse, structural, and package-semantic validation
→ complete Core FieldDefinition compatibility validation
→ privileged local installation-source decision and its fixed trust mapping
→ SHA-256 over the exact original UTF-8 bytes
→ atomic accepted-record insertion
```

Technical validity and local trust are independent requirements. A valid/Core-compatible package
without an approved source decision is not available through the trusted source. Unsupported,
invalid, incompatible, or untrusted candidates leave no accepted row or partial metadata. A failed
insert leaves all previously installed versions unchanged.

Installation outcomes are deterministic:

- same key, exact raw text, digest, format/type, source, and trust: idempotent success/no-op;
  preserve the original `installedAt`;
- same key with different raw text, digest, format, or type: fail with
  `immutable_package_collision`, including when raw text differs but the supplied digest matches;
- same key and digest but different source or trust: fail with an explicit local-metadata conflict;
  reinstall is not a hidden trust-change or escalation operation.

Accepted Alpha metadata is creation-only. A future explicit trust-management operation may
re-evaluate local source/trust state, but it needs its own authorization and audit design. Such a
change never rewrites existing Claims: they retain the trust assigned at creation. Only later Claim
applications may use newly established current trust.

The implemented Main-layer installer parses the candidate, validates complete Core compatibility,
maps the privileged installation source to its fixed trust, hashes the exact raw UTF-8 text with
Node SHA-256, and calls repository acceptance once. Installation only makes content available; it
does not select an identity, create Claims, or otherwise apply the package.

## Durable source adapter and defensive reads

A future `InstalledKnowledgePackageSource` implements the existing narrow exact-lookup contract:

```text
getExactPackage({ packageId, packageVersion })
→ { text: exactStoredRawText, trust: approvedLocalTrust } | undefined
```

It is read-only. It neither chooses another version nor mutates trust, queries a network, or infers
trust from content. On each exact lookup it should recompute SHA-256 from the stored raw text and
compare it with `contentSha256`. Package application is infrequent enough that this is the smallest
meaningful corruption check without an additional verification lifecycle. A mismatch fails with an
explicit data-integrity error rather than returning unavailable or repaired content.

The adapter returns stored text, not an already parsed package. The existing application path parses
and structurally/semantically validates that text again, and the materializer repeats Core
compatibility checks. This defense detects corrupted or incompatible stored content while keeping
package-engine contracts out of generic storage row reconstruction.

The implemented `InstalledKnowledgePackageSource` recomputes SHA-256 on every exact repository hit,
rejects identity or digest inconsistencies as integrity failures, and returns the stored trust
unchanged. Missing exact versions remain distinct and return `undefined`.

Repository reconstruction validates local metadata without silently repairing it. It rejects empty
or non-normalized package identity values, unsupported format/type/source/trust values,
non-lowercase or non-64-hex SHA-256 values, empty raw text, invalid strict-UTC `installedAt`, and an
impossible source/trust pair. Exact manifest-to-column agreement and package parsing belong to the
trusted installation path and defensive source/application read, not to every generic row mapping.

## Persistence direction

The next schema should add one STRICT table structurally equivalent to:

```text
installed_knowledge_packages
  package_id TEXT
  package_version TEXT
  format_version INTEGER
  package_type TEXT
  raw_text TEXT
  content_sha256 TEXT
  installation_source TEXT
  trust TEXT
  installed_at TEXT

PRIMARY KEY (package_id, package_version)
```

All fields are non-null. CHECK constraints should close Alpha to format `1`, type `printer_series`,
the two source and trust values, their permitted pairings, non-empty normalized identity/text
values, and lowercase 64-hex digest representation where SQLite can express these deterministically.
Strict timestamp and complete row validation remain repository responsibilities, consistent with
existing storage boundaries.

The initial repository needs only exact `find(packageId, packageVersion)`, deterministic `list()`,
and creation with immutable collision semantics. Listing orders lexically by `packageId`, then the
opaque `packageVersion`; lexical order is deterministic, not a version-precedence claim. No generic
repository, search, publisher filtering, update discovery, latest-version lookup, update method, or
uninstall method is needed.

## Removal, versions, and historical behavior

A future uninstall removes only accepted local content and its availability/trust metadata. It does
not cascade to or rewrite FieldClaims, PrinterKnowledgeIdentity records or current selection,
PrinterStates, or resolved historical evidence. A current identity can consequently reference an
unavailable package, and a later application reports package unavailable.

Installing `P/1.1` never replaces `P/1.0`; both remain available by exact key. It does not update a
PrinterKnowledgeIdentity, generate Claims, or recalculate history. Applying 1.1 requires an explicit
identity selection/correction pinned to 1.1 followed by explicit materialization.

Bundled official candidates use the same validation, digest, collision, persistence, and exact
source lookup as customer-verified packages. They differ only in the privileged source decision and
fixed trust mapping. There is no separate official resolution path or startup seeding in this
design. `customer_verified_installation` means verification already occurred through a future
privileged business process; filename, file selection, publisher metadata, or a company-looking
namespace cannot establish it.

## Future renderer boundary

A renderer may later request that Main begin an import/install workflow, but renderer data is never
authoritative for `PackageKnowledgeTrust`, installation source, digest, package ID/version
overrides, or developer/customer verification. Main derives identity from validated content,
computes the digest, and obtains source/trust from the privileged pathway. Any future IPC must be
narrow and runtime-validated; no IPC is introduced here.

## Recommended implementation split

### 4.7b — installed-package storage foundation

- add only the required local record contracts and source/trust metadata;
- add migration 007 and a focused repository;
- store exact raw text and SHA-256;
- implement exact lookup/list and immutable collision semantics; and
- test malformed-row detection, deterministic listing, idempotency, collisions, and close/reopen.

This task should not implement candidate validation or an application installer.

### 4.7c — trusted installation and source adapter

- implement the staged candidate validation and Core compatibility checks;
- compute the exact UTF-8 digest and derive trust from a privileged closed source context;
- atomically accept the package through the storage boundary;
- implement `InstalledKnowledgePackageSource`; and
- prove synthetic install → apply → restart → historical resolution.

Startup seeding, filesystem import UI, quarantine, signing, updates, uninstall, trust mutation, IPC,
and real package content remain later work.
