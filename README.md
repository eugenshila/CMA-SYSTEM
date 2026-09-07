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

## Deploying to Railway

`railway.json` ships with the repo: Nixpacks runs `npm ci && npm run build`, and each deploy
runs `npm run db:migrate` before `npm start`, so schema changes roll out with the release.

1. Create a Railway project and add a **PostgreSQL** service.
2. Add the app service from this repo; reference `DATABASE_URL` from the database service.
3. Set `AUTH_SECRET`, `ENCRYPTION_KEY`, `APP_URL` (and the `MPESA_*` values for payments).
4. Deploy — migrations run automatically at startup.
