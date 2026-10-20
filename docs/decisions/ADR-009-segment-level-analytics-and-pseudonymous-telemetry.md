# ADR-009: Segment-Level Playback Analytics and Pseudonymous Telemetry

## Status
Accepted

## Context
Video infrastructure platforms require precise, privacy-conscious playback telemetry to quantify viewer engagement, session counts, watch duration, device distribution, geographic breakdown, and billing consumption. However, ingesting high-frequency segment-level pings directly into a relational database creates extreme write contention and connection saturation. Furthermore, raw IP addresses must not be persisted to respect user privacy and regulatory requirements.

## Decision
1. **Public Telemetry Endpoint & Abuse Controls**:
   - Implemented public ping ingestion: `POST /api/v1/analytics/segment-ping`.
   - Strict validation via `SegmentPingDto` rejects malformed or oversized payloads.
   - Video existence is checked server-side, deriving video ownership from the database rather than trusting client-submitted ownership claims.
   - Client-reported duration is bounded to realistic playback heartbeat intervals (maximum 30 seconds per ping) to prevent telemetry inflation attacks.

2. **Pseudonymous Viewer Identification**:
   - Raw IP addresses and full user agents are never persisted to disk or exposed in API responses.
   - Viewer identity is pseudonymized using a cryptographic HMAC-SHA256 hash:
     `HMAC_SHA256(secret, `${ip}:${cleanUserAgent}:${videoId}`)`.
   - Client provides a random session identifier (`sessionId`) for intra-session continuity; server binds it with the HMAC viewer token.

3. **Redis Buffering & Batched Persistence**:
   - Pings are pushed to a Redis list buffer under the namespace `vedora:analytics:buffer` via atomic `rpush`.
   - `AnalyticsProcessor` runs periodic flush cycles every 5 seconds.
   - Buffer is extracted in batches of up to 500 events using `lrange` and `ltrim`.
   - Events are aggregated into session-level records in PostgreSQL (`video_views` table) using single batch inserts, reducing database IOPS by orders of magnitude.

4. **Multi-Window Analytics Aggregation Engine**:
   - `GET /api/v1/analytics/metrics` supports query windows: `7d`, `30d`, and `90d`.
   - Queries are strictly scoped to videos owned by the authenticated user (`eq(schema.video_views.user_id, userId)`).
   - Efficient SQL aggregations compute:
     - Total Views (count of distinct viewer sessions).
     - Total Watch Time (sum of validated seconds, converted to minutes).
     - Unique Viewers (count of distinct HMAC viewer session hashes).
     - Average View Duration (`totalWatchDuration / totalViews`).
     - Breakdown by Device, Browser, Country, and daily time-series activity.

## Consequences
- **Positive**: Protects database against write spikes; safeguards user privacy through one-way hashing; provides fast, multi-dimensional analytics queries; bounds telemetry to prevent manipulation.
- **Negative**: Metrics have a sub-minute latency (typically 5 seconds) before appearing in the dashboard due to buffering.
