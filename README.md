<p align="center">
  <img src="public/brand/logo.svg" alt="Catholic Men Association — Men of Faith · Men of Service" width="420" />
</p>

# CMA Management System

Member management, welfare, contributions, SDP/Sacco savings, shares and loans platform for the
**Catholic Men Association (CMA)** — country → archdiocese/diocese → deanery → parish →
church/outstation → Small Christian Community (SCC) → member.

Member data is processed in line with the **Kenya Data Protection Act, 2019**: sensitive
identifiers are stored encrypted, and every financial transaction is permanently audited.

## Feature set

- **Membership registry** — full member profiles, documents, next of kin, parish structure
- **Welfare & cases** — sick welfare, funerals, weddings and unlimited special projects
- **Contributions** — monthly billing, penalties, arrears and reconciliation
- **SDP / Sacco** — savings deposits, share capital, certificates, dividends, statements
- **Loans** — configurable products, guarantor approval, amortisation schedules, penalties
- **Payments** — M-Pesa (Daraja), bank, cash and manual entry with official receipts
- **Meetings & communication** — attendance, handwritten-minutes OCR drafts, Word-compatible / PDF minutes, secure WhatsApp sharing, meeting reminders and bulk SMS
- **Reports & exports** — report hub with PDF / Excel output and branded letterheads
- **Administration** — role-based access control, audit trail, system settings

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · PostgreSQL (via `pg`) ·
PDFKit · ExcelJS · M-Pesa Daraja sandbox/production support

## Local development

One command starts the bundled PGlite PostgreSQL server, runs migrations (with a demo seed on
first boot) and launches the dev server:

```bash
npm install
npm run dev:all        # → http://localhost:3000
```

Or run the pieces separately:

```bash
npm run db:local       # PGlite PostgreSQL on 0.0.0.0:5432 (data in ./.pgdata)
npm run db:migrate     # apply db/migrations
npm run db:seed        # reference + demo data (skip with SEED_DEMO_DATA=false)
npm run dev            # Next.js dev server
```

Other scripts: `npm run typecheck`, `npm run lint`, `npm run build`, `npm start`.

## Configuration

Copy `.env.example` → `.env.local`. The essentials:

| Variable            | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`      | PostgreSQL connection string (Railway in production)           |
| `AUTH_SECRET`       | Session-signing secret — set a long random value in production |
| `ENCRYPTION_KEY`    | 64-hex-character key for encrypted identifiers                 |
| `APP_NAME`          | Product name shown in titles/emails (default below)            |
| `APP_URL`           | Public base URL (M-Pesa callbacks, links in notifications)     |
| `PGPOOL_MAX`        | Pool size — `1` against the local PGlite server, `8–10` on Railway |

Organisation identity (name, parish structure, currency, **logo** and stamp) is managed at
**Settings → Organisation** and printed on receipts, statements and reports. When the uploaded
logo cannot be loaded the UI degrades gracefully to the bundled CMA crest and then to a
monogram badge — no broken-image icons anywhere.

### Meeting minutes, SMS and WhatsApp

A Secretary can open a meeting and use **Upload & read** to attach a handwritten scan. OCR is
optional: configure either Google Cloud Vision or a parish-hosted generic OCR endpoint under
**Settings → Minutes OCR**. The extracted text is always a draft; it must be reviewed before it
can be published. The resulting minutes can be downloaded as PDF or an editable Microsoft Word (.docx) file.
Publishing produces an expiring, unguessable PDF link for WhatsApp/SMS distribution and records
the distribution in the audit trail.

Configure bulk delivery in **Settings → Notifications**. SMS supports Africa's Talking, Twilio
and a generic HTTPS gateway. WhatsApp uses the Meta Cloud API. Real providers require valid
credentials, member consent and (for WhatsApp messages sent outside the 24-hour service window)
an approved Meta template. Until a provider is configured, the system keeps the in-system message
and records the external delivery as skipped rather than pretending it was sent.

## Deploying to Railway

`railway.json` ships with the repo: Nixpacks runs `npm ci && npm run build`, and each deploy
runs `npm run db:migrate` before `npm start`, so schema changes roll out with the release.

1. Create a Railway project and add a **PostgreSQL** service.
2. Add the app service from this repo; reference `DATABASE_URL` from the database service.
3. Set `AUTH_SECRET`, `ENCRYPTION_KEY`, `APP_URL` (and the `MPESA_*` values for payments).
4. Deploy — migrations run automatically at startup.

## Windows desktop installer

The same application ships as a native desktop app. It embeds the PostgreSQL
database (PGlite), runs the schema migrations automatically on first launch and
serves the Next.js app locally — no server, Docker or internet connection needed.

```bash
npm install
npm run dist:win     # builds release/CMA System-Setup-*.exe (NSIS installer)
npm run dist         # current platform
npm run dist:dir     # unpacked build (fast local smoke test)
npm run desktop:smoke  # verifies the packaged startup path end-to-end (after npm run build)
npm run desktop:dev  # dev mode: npm run dev:all first, then CMA_DEV_URL=http://localhost:3000 electron .
```

The installer is a normal per-user install. All data lives under the user's
application data directory (`%APPDATA%/CMA System`), with the database in
`pglite/` and a generated Super Administrator login written to
`first-run-credentials.txt` on first launch. Startup output (including any
failure cause) is written to `desktop.log` in the same directory, and the
failure dialog names that file.

CI builds Windows (NSIS), Linux (AppImage) and macOS (DMG) installers on every
`v*` tag via `.github/workflows/desktop-installer.yml`. See
[docs/desktop.md](docs/desktop.md) for the full details.

