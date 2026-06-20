# Billing Audit Report — RinkReports 5-6
**Date:** 2026-06-20  
**Status:** Complete audit cycle  

---

## Executive Summary

**Verdict:** **BILLING ENTIRELY ABSENT**  
**Grade:** N/A (product does not currently gate access on subscription status)  
**Risk Level:** Low (by design)

---

## Findings

### 1. Stripe Integration
- **Status:** Not present
- **Evidence:** 
  - No `stripe` or `@stripe/*` packages in `package.json` (lines 16–40)
  - No `STRIPE_*` or `NEXT_PUBLIC_STRIPE_*` env vars in `.env.example`
  - No `stripe` references in source code (`src/`) or migrations (`supabase/migrations/`)
  - Only "stripe" match: `dashboard/page.tsx:164` is a visual CSS comment ("Subzero-style stripe"), not Stripe payment API

### 2. Subscription/Billing Schema
- **Status:** No tables or columns present
- **Evidence:**
  - Grep across all migrations for `subscription|billing|plan|payment` returns only contextual references (facility operation checklist items like "payment processing," "billing for events/rentals")
  - Database types file (`src/types/database.ts`) contains 0 billing/subscription table definitions
  - No custom RLS policies for subscription gating

### 3. Billing-Related Routes/Endpoints
- **Status:** No billing endpoints
- **Evidence:**
  - `vercel.json` cron routes (lines 4–20): only operational flows—`drain-notifications`, `send-communications`, `run-retention-purge`, `expire-scheduling`
  - No `/api/checkout`, `/api/webhooks/stripe`, `/api/billing/*` routes in filesystem
  - No server actions or client components for payment processing

### 4. Access Control
- **Current Model:** Facility-based multi-tenancy (RLS at `facility_id`)
  - `src/lib/auth` exposes `getCurrentUser()`, `requireUser()`, `requireAdmin()`
  - Admin check: `users.is_super_admin = true` OR `employees` row with `role.key in (admin, gm, super_admin)` scoped to `facility_id`
  - **No subscription status check in any auth guard or middleware**

### 5. Business Model Confirmation
- **Current State:** Free tier only; no paid tiers defined
- **Tennity "Free Pilot" Requirement Moot:** Since no billing integration exists, this is a forward design decision, not a bug

---

## Implications

1. **All users** with valid employee/admin credentials get **unrestricted access** to all modules (daily, refrigeration, incidents, air-quality, ice-depth, communications, scheduling, accidents, ice-operations, facility-paperwork)
2. **No payment flow exists** to gate feature access, trial periods, or license enforcement
3. **Future billing work** (if planned) must:
   - Add Stripe SDK (`stripe` package)
   - Create `subscriptions`, `billing_customers`, `plan_features` tables
   - Implement RLS policies to enforce plan-level module access
   - Add webhook route for subscription state changes (cancel, upgrade, downgrade)
   - Update `requireAdmin()` to check subscription status before granting access to premium modules

---

## Summary Table

| Component | Present? | Details |
|-----------|----------|---------|
| Stripe SDK | No | Not in `package.json` |
| Env secrets | No | `.env.example` has no `STRIPE_*` vars |
| DB tables | No | No `subscriptions`, `billing_*`, or `plan_*` tables |
| Routes | No | No `/api/checkout`, `/api/webhooks/stripe` endpoints |
| RLS policies | No | Auth guards do not check subscription status |
| Payment UI | No | No checkout forms or subscription management UI |

---

## Audit Methodology

- **Grep search:** `stripe` (case-insensitive), `STRIPE_`, `price_`, `webhook`, `subscription`, `billing`, `checkout` across entire repo
- **Package audit:** Inspected `package.json` dependencies (lines 16–40)
- **Environment audit:** Checked `.env.example` for billing secrets
- **Schema audit:** Queried `src/types/database.ts` for billing table definitions
- **Route audit:** Examined `vercel.json` cron routes and filesystem structure
- **Auth audit:** Reviewed `src/lib/auth` guards for subscription checks

---

## Conclusion

RinkReports 5-6 is **a free multi-tenant SaaS with no billing infrastructure**. All authenticated users have unrestricted access. Future monetization (if planned) requires full billing integration—this is not scaffolded or partially implemented.

**No billing vulnerabilities found.**
