# Desktop app (Windows / Linux / macOS)

The CMA System also runs as a native desktop application. It packages the exact
same Next.js app with an **embedded PostgreSQL database**, so a parish can run
it on a single office computer with no server, no Docker and no database
administrator.

## How it works

```
┌─────────────────────────────────────────────────┐
│ Electron main process (electron/main.cjs)        │
│  ├─ desktop/bootstrap.cjs                        │
│  │   ├─ PGlite  (embedded PostgreSQL, .pgdata)   │
│  │   ├─ desktop/migrate.cjs   (db/migrations/*)  │
│  │   └─ desktop/first-run.cjs (Super Admin)      │
│  └─ spawns .next/standalone/server.js            │
│       (Next.js production server, 127.0.0.1)     │
└─────────────────────────────────────────────────┘
        ▲ native BrowserWindow loads http://127.0.0.1:<port>
```

The application code never knows it is on a desktop: it always talks to
PostgreSQL through `DATABASE_URL` and the standard `pg` driver, which is the
same code path used on Railway. The desktop layer only swaps *what provides*
PostgreSQL — the bundled PGlite server instead of a hosted instance.

PGlite is real PostgreSQL 18 compiled to WebAssembly, exposed over the standard
wire protocol via `@electric-sql/pglite-socket`, so migrations, extensions
syntax and the `pg` driver behave exactly as in production.

### Packaging: what has to be unpacked from app.asar

The main process (and everything it loads — `desktop/*.cjs`, `db/migrations`,
PGlite) runs from inside the `app.asar` archive, which Electron's patched `fs`
reads natively. The spawned Next.js server is different: it runs as a plain
Node.js child process (`ELECTRON_RUN_AS_NODE=1`), and plain Node **cannot read
inside an asar archive**. Everything that child touches therefore has to exist
as real files under `resources/app.asar.unpacked/`, which is what `asarUnpack`
in `electron-builder.yml` does:

| Unpacked entry        | Why the child needs it                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.next/standalone/**` | The server itself (`server.js`, the compiled routes, `required-server-files.json`).                                                          |
| `node_modules/**`     | The server's runtime dependencies. **This one is easy to miss** — see below.                                                                 |

Why `node_modules/**` is not optional: electron-builder ships production
`node_modules` (package.json `dependencies`) at the **top level** of the app and
silently drops *nested* `node_modules` directories — including
`.next/standalone/node_modules`, the traced copy Next produces precisely so the
standalone server is self-contained (`app-builder-lib`'s `AppFileWalker` skips
every `*/node_modules` unless `includeSubNodeModules` is enabled, which it is
not by default). So the unpacked standalone tree ships *without* any
dependencies, and `server.js` can only resolve them by walking up to
`app.asar.unpacked/node_modules`. That covers `next` itself plus the
`serverExternalPackages` (`pg`, `pdfkit`, `exceljs`, `bcryptjs`, `qrcode`).

`desktop/bootstrap.cjs` translates the in-archive path to its unpacked twin at
runtime. `npm run desktop:smoke` guards both entries in CI, and its second boot
reproduces the packaged layout exactly — standalone **without** nested
`node_modules`, dependencies only in the unpacked top-level tree. Without the
`node_modules` entry the installed app dies at startup and never reaches the
login screen; that is the v1.0.1 bug:

```
Error: Cannot find module 'next'
Require stack:
- C:\Users\…\CMA System\resources\app.asar.unpacked\.next\standalone\server.js
code: 'MODULE_NOT_FOUND'
```

### Packaging: keeping the repository out of the standalone output

Next's file tracer (`@vercel/nft`) statically analyses every `require`/`fs`
path it can see. A traced path built from `process.cwd()` cannot be resolved
statically, so the tracer falls back to copying **the whole working
directory** into `.next/standalone` — which put `.git`, the local
`.pgdata-test` database (971 files, ~39 MB) and the sources into every
installer. `src/lib/files.ts` therefore uses `path.resolve(UPLOAD_DIR)` rather
than `path.resolve(process.cwd(), UPLOAD_DIR)` (identical at runtime — see the
comment there). The smoke test fails if `.git`, `.pgdata-test` or `src` reappear
inside `.next/standalone`.

## Prerequisites

- Node.js 20+ (Node 22 recommended)
- A machine with ~2 GB free disk space

## Building installers

```bash
npm install
npm run dist:win      # NSIS installer -> release/CMA System-Setup-<ver>.exe
npm run dist          # installer for the current OS
npm run dist:dir      # unpacked build (fastest local smoke test)
```

`dist:*` runs, in order: `next build` (standalone output) → copy static assets →
render the app icon → `electron-builder`. On Windows you get a per-user NSIS
installer with a desktop shortcut and Start Menu entry.

Packaging changes (`electron-builder.yml`, `desktop/`, `scripts/prepare-standalone.mjs`)
only take effect when the installers are rebuilt, and an already-installed app
does not update itself — reinstall the new build to pick them up.

## Verifying the desktop startup path

```bash
npm ci && npm run build && npm run desktop:smoke
```

The smoke test boots the exact production stack (embedded PostgreSQL,
migrations, first-run admin, spawned Next.js server) and verifies the login
screen renders — once from the source tree and once against a simulated
installed app (`app.asar` + `app.asar.unpacked`), reproducing the packaged
layout where a plain Node child cannot read inside the archive. The simulation
is faithful in the way that matters: the unpacked standalone tree has **no**
nested `node_modules`, and the dependencies exist only in the unpacked
top-level `node_modules`, so a missing `asarUnpack: node_modules/**` fails here
instead of in the field. CI runs it on every platform before the installers are
built and attached to a release.

## Development

Use the normal web workflow plus an Electron shell pointed at it:

```bash
npm run dev:all                                       # PGlite + migrations + Next on :3000
CMA_DEV_URL=http://localhost:3000 npm run desktop:dev  # Electron window -> dev server
```

With `CMA_DEV_URL` set, the main process skips the embedded stack entirely and
just opens the URL, so hot reload works as usual.

## First launch

1. The main process boots PGlite and applies `db/migrations/*.sql`.
2. If the database has no users, a `super_admin` account (`ADMIN` /
   `admin@cma.local`) is created with a generated password and
   `must_change_password = TRUE`.
3. The credentials are written to `first-run-credentials.txt` in the data
   directory and the Next server is started; the splash window shows progress.

Sign in with the generated credentials, then choose a new password. Delete the
credentials file once signed in.

## Where data lives

| Platform | Data directory                                        |
| -------- | ----------------------------------------------------- |
| Windows  | `%APPDATA%\CMA System`                                |
| macOS    | `~/Library/Application Support/CMA System`            |
| Linux    | `~/.config/CMA System`                                |

Inside it:

- `pglite/` — the PostgreSQL data directory (back this up)
- `config.json` — per-installation `AUTH_SECRET` and `ENCRYPTION_KEY`
- `first-run-credentials.txt` — created on first launch only
- `desktop.log` — startup log of the most recent sessions (rotated to
  `desktop.log.old` past 2 MB); the failure dialog points here

`AUTH_SECRET` signs sessions and `ENCRYPTION_KEY` derives the key for encrypted
member identifiers; both are generated once and must be preserved (losing them
makes encrypted columns unreadable). For portable / shared deployments, point
`CMA_DATA_DIR` at a folder on a mapped drive or USB stick:

```bash
CMA_DATA_DIR="E:\CMA-Data" "CMA System.exe"
```

## Backups

Stop the app and copy the `pglite/` directory, or use the in-app **Reports →
Backups** flow. Keep `config.json` together with the data directory.

## CI releases

`.github/workflows/desktop-installer.yml` builds Windows, Linux and macOS
installers on every `v*` tag (or manual dispatch) and attaches them to the
GitHub release:

```bash
git tag v1.1.0
git push origin v1.1.0
```

## Troubleshooting

- **"Standalone server not found"** — run `npm run build` before `dist:*`.
- **Startup failed / server stopped unexpectedly** — the dialog shows the cause
  and the path to `desktop.log` in the data directory; send that file when
  reporting the problem. It contains the full startup trace, including the
  spawned web server's output.
- **"...packed inside app.asar..."** — the installers were built without the
  `asarUnpack: .next/standalone/**` entry in `electron-builder.yml`; rebuild
  after restoring it (CI's `npm run desktop:smoke` step catches this).
- **`Error: Cannot find module 'next'` / `MODULE_NOT_FOUND` in `desktop.log`** —
  the web server started but could not load its dependencies: `asarUnpack` is
  missing `node_modules/**`, so the unpacked standalone tree has no
  `node_modules` next to it (the v1.0.1 bug). Restore the entry, rebuild the
  installers and **reinstall** — an already-installed app does not fix itself.
- **Installer is unexpectedly huge** — the file tracer pulled the repository
  into `.next/standalone` (`.git`, `.pgdata-test`, `src`). Check
  `du -sh .next/standalone` and avoid `process.cwd()` in traced server code;
  the smoke test's "no stray repository files" check catches this.
- **Blank window** — also check `stderr` when running `npm run desktop:dev`.
- **Port conflicts** — all ports (database and web) are ephemeral and bound to
  `127.0.0.1`, so conflicts are avoided automatically.
- **Slow first launch** — the one-time schema migration (large SQL files) runs
  behind the splash screen; subsequent launches are seconds.
