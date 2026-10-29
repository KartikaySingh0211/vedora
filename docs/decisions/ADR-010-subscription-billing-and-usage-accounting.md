# ADR-010: Subscription Billing Engine, Playback-Minute Accounting, and Quota Resets

## Status
Superseded (Replaced by 100% Open-Source Architecture & Technical Ingestion Safeguards)

## Context
Originally, Vedora was modeled with tiered commercial plans (Free, Starter, Pro, Business) integrated with Stripe subscriptions and billing cycle crons. However, Vedora has transitioned into a pure open-source MIT developer platform with zero monetization, zero recurring vendor costs, and no third-party payment infrastructure.

## Decision
1. **Complete Removal of Stripe & Subscription Billing**:
   - Dropped the `subscriptions` database table via migration `0005_bouncy_boomerang.sql`.
   - Removed the `stripe` npm dependency, `BillingModule`, `BillingController`, `BillingService`, and `BillingCycleCron`.
   - Removed billing routes (`/billing`), Stripe webhook endpoints (`POST /api/v1/billing/webhook`), and plan upgrade UI flows across the dashboard and landing page.

2. **Transition to Technical Ingestion Safeguards (`plans.config.ts`)**:
   - Replaced commercial plan tier limits with configurable operational safeguards:
     - `MAX_FILE_SIZE_BYTES`: Defaults to 10 GiB per file.
     - `USER_STORAGE_CAP_BYTES`: Defaults to 500 GiB active storage per user.
     - `ALLOWED_RESOLUTIONS`: All users have access to the full adaptive ladder up to 1080p.
   - Enforced atomically during upload initialization via PostgreSQL transaction advisory locks (`pg_advisory_xact_lock`).

3. **Telemetry & Watch Duration**:
   - Playback duration and unique viewer telemetry remain fully functional for analytics and creator dashboards, without deducting from artificial commercial minute allowances.

## Consequences
- **Positive**: Zero vendor lock-in or recurring service costs; simplified operational maintenance; completely independent open-source platform; clean technical safeguards prevent resource exhaustion.
- **Negative**: Commercial monetization requires external billing wrappers or custom API extensions.
