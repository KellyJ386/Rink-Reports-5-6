# Rink Reports 5-6

Internal reporting tool for MFO/RinkReports.

## Project Structure

```
/app                  Next.js 15 App Router
/components           Shared UI components
/lib                  Utilities and server logic
/supabase/migrations  Database migrations
/public               Static assets
/types                TypeScript type definitions
/agents               Build agent briefs and prompts
```

## Getting Started

Copy `.env.example` to `.env.local` and fill in your credentials before starting the dev server.

```bash
pnpm install
pnpm dev
```

## Production deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full runbook: Supabase + Resend + Vercel setup, required env vars, cron schedule, and post-deploy smoke tests.
