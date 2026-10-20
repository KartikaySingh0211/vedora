# ADR-010: Subscription Billing Engine, Playback-Minute Accounting, and Quota Resets

## Status
Accepted

## Context
Vedora offers tiered pricing plans (Free, Starter, Pro, Business) governed by storage caps and playback-minute allowances. Subscription management, webhook synchronization from Stripe, usage attribution, and billing cycle resets must be resilient, idempotent, and accurate. Crucially, monthly billing renewal must reset accumulated playback minutes without resetting or wiping accrued storage usage.

## Decision
1. **Centralized Plan Entitlements & Allocation Architecture**:
   - Plan limits defined in `plans.config.ts`:
     - **Free**: 1,000 playback minutes / 5 GiB storage cap / 720p max resolution.
     - **Starter**: 10,000 playback minutes / 250 GiB storage cap / 720p max resolution.
     - **Pro**: 22,000 playback minutes / 600 GiB storage cap / 1080p max resolution.
     - **Business**: 50,000 playback minutes / 2 TiB storage cap / 1080p max resolution.
   - Database schema persists subscription status, plan identifier, customer IDs, and usage counters in `subscriptions` table. Default active Free tier record is provisioned on demand.

2. **Stripe Webhook Synchronization**:
   - Webhook controller (`POST /api/v1/billing/webhook`) validates Stripe signatures using `stripe.webhooks.constructEvent` (or cryptographic HMAC fallback in test/mock environments).
   - Handles `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.paid`.
   - Webhooks are idempotent: duplicate event IDs or repeated subscription deliveries update the single authoritative subscription record without side effects.
   - Direct client modification of subscription plans is strictly disallowed; billing state is entirely server-authoritative.

3. **Playback-Minute Accounting**:
   - Validated watch duration from the analytics ingestion pipeline is attributed to the video owner's subscription.
   - Partial minutes are converted using ceiling seconds (`ceil(seconds / 60)`).
   - Usage is incremented in `subscriptions.used_minutes` with concurrent atomic SQL updates (`used_minutes = used_minutes + :addedMinutes`).

4. **Monthly Playback Reset via UTC Scheduled Cron**:
   - Scheduled cron job (`BillingCycleCron`) configured with `@Cron('0 0 1 * *', { timeZone: 'UTC' })` executing at midnight on the first day of every month.
   - Iterates through subscriptions, archives prior period usage, and resets `used_minutes = 0`.
   - **Storage Preservation Rule**: Accrued raw video storage (`videos.size_bytes`) and transcoded storage (`videos.transcoded_size`) are strictly preserved and never reset, ensuring storage accounting remains accurate across billing periods.

## Consequences
- **Positive**: Single source of truth for billing and plan limits; seamless synchronization with Stripe webhooks; accurate usage accounting; storage is permanently protected from monthly reset cycles.
- **Negative**: Manual customer support intervention required if a customer exceeds minute allocations and overage charging is disabled.
