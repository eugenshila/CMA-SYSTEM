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
- **Blank window / startup failed** — the error is shown in a dialog; also check
  `stderr` when running `npm run desktop:dev`.
- **Port conflicts** — all ports (database and web) are ephemeral and bound to
  `127.0.0.1`, so conflicts are avoided automatically.
- **Slow first launch** — the one-time schema migration (large SQL files) runs
  behind the splash screen; subsequent launches are seconds.
