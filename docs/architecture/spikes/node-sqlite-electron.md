# `node:sqlite` compatibility with Electron 43

Status: compatibility spike completed on 2026-08-08. This is not a production persistence design or
implementation.

## Environment tested

| Component                       | Version                        |
| ------------------------------- | ------------------------------ |
| Host operating system           | Linux 7.0.0-28-generic, x86-64 |
| Repository Node requirement     | 24.18.0 or newer, below 25     |
| Installed system Node           | 24.14.1                        |
| pnpm                            | 11.15.1                        |
| Electron                        | 43.3.0                         |
| Node bundled with Electron      | 24.18.1                        |
| SQLite reported inside Electron | 3.53.1                         |

The installed system Node is older than the repository's minimum and emitted the expected engine
warning. The system-runtime tests passed on 24.14.1, but they do not replace CI verification on the
required Node 24.18.0 toolchain. Electron was tested separately because it uses its own bundled Node
runtime.

## Compatibility fixture

The isolated fixture uses `DatabaseSync` from `node:sqlite`. It is not connected to
`WorkspaceRepository`, normal application startup, preload, IPC, or renderer code. It creates only
in-memory databases, except for one automated test that creates and removes a database beneath the
operating system's temporary directory.

The fixture passed all of the following checks:

- opened and closed an in-memory database;
- created a `STRICT` table and observed strict type rejection;
- inserted, selected, updated, and deleted data with prepared statements and bound values;
- committed a successful transaction;
- rolled back a transaction after a uniqueness violation and confirmed its write was absent;
- confirmed `PRAGMA foreign_keys` was enabled and rejected an invalid foreign key;
- constructed the database with extension loading disabled and confirmed it could not subsequently
  be enabled;
- constructed the database with defensive mode enabled, confirmed `enableDefensive()` was available,
  and enabled it explicitly; and
- closed and reopened a temporary file-backed database and read the persisted value before cleanup.

No extension was loaded or attempted. The extension check only attempts to change the permission and
expects that change to be rejected.

## Electron runtime results

### Forge development mode

`pnpm --filter @printtune/desktop smoke:node-sqlite:dev` built the Forge/Vite development bundles,
launched Electron's real main process, ran the compatibility fixture, and exited successfully. It
reported Node 24.18.1 and SQLite 3.53.1. Every fixture capability reported success.

### Packaged application

After `electron-forge package`, the Linux x64 executable was launched with the isolated smoke
argument. It ran the same main-process fixture and exited successfully, again reporting Node
24.18.1, SQLite 3.53.1, and success for every capability.

The test host sets `ELECTRON_RUN_AS_NODE=1` for its automation environment, so that variable was
unset when directly launching the packaged graphical executable. It was not changed in application
code or repository configuration.

## Security and limitations

- SQLite remains main-process-only. No database API, object, path, SQL, or IPC channel is exposed to
  the renderer.
- Existing `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true` renderer settings
  are unchanged.
- Dynamic values in the fixture use bound prepared-statement parameters. SQL is fixed in code.
- `DatabaseSync` is synchronous, so production use must avoid long operations that could block the
  Electron main process.
- Node currently documents `node:sqlite` as release-candidate stability, and the installed system
  Node emits an experimental-feature warning when the tests import it.
- The defensive-mode API has no getter. This spike verifies that the constructor option and explicit
  enabling call are accepted by both tested runtimes; it cannot independently query the mode after
  enabling it.
- The spike proves runtime compatibility only. It does not address production schema design,
  migrations, backup, concurrency, corruption recovery, or repository lifecycle management.

See the official [`node:sqlite` API documentation](https://nodejs.org/api/sqlite.html) for the
current stability and API details.

## Recommendation

`node:sqlite` is suitable as the SQLite runtime for PrintTune Alpha on Electron 43.3.0 based on the
tested capabilities. The Electron-bundled runtime meets the repository's Node minimum, needs no
native add-on, and passed development and packaged main-process checks. A production repository
should still be introduced separately behind the boundary described by ADR-005, with focused schema,
migration, lifecycle, and failure-handling tests.
