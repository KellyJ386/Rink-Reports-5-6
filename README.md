# Rink Reports 5-6

Internal reporting tool for MFO/RinkReports.

## Project Structure

```
/src/app              Next.js 16 App Router
/src/components       Shared UI components
/src/lib              Utilities and server logic
/src/types            TypeScript type definitions
/supabase/migrations  Database migrations
/public               Static assets
/docs                 Deploy runbook + architecture notes
```

See `CLAUDE.md` for architecture details (auth/proxy flow, Supabase client
selection, the offline/PWA queue, and the report-form pattern).

## Getting Started

```bash
cp .env.example .env.local   # then fill in your Supabase credentials
pnpm install
pnpm dev
```

## Production deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full runbook: Supabase + Resend + Vercel setup, required env vars, cron schedule, and post-deploy smoke tests.
