# ADR-003: Debounced Last-Used Activity Tracking with Fault-Tolerant Batching

## Status
**Accepted** (Implemented in Phase 2)

## Context
Displaying when an API key was last used is a vital security feature (helping users detect compromised keys). However, writing to PostgreSQL on every authenticated request introduces severe database write amplification and connection pool exhaustion under high ingestion loads.

## Decision
1. **Atomic Lock Debounce**:
   - On every request, acquire an atomic key-level lock in Redis:
     `SET vedora:api_key:last_used_lock:v1:<keyId> '1' EX 60 NX`.
   - If acquired: write the timestamp to the Redis hash `vedora:api_key:last_used:v1`.
   - If not acquired: skip recording (debounced for 60 seconds).
2. **Distributed Scheduled Batch Flush**:
   - Every 5 minutes, `@Cron(CronExpression.EVERY_5_MINUTES)` runs.
   - Acquires distributed lock `vedora:api_key:flush_lock` (TTL 120s) to prevent concurrent flushes across multi-instance clusters.
   - Reads all entries in `vedora:api_key:last_used:v1` and commits them in a single parameterized SQL transaction:
     ```sql
     UPDATE api_key SET last_used_at = $1 WHERE id = $2::uuid AND revoked_at IS NULL
     ```
   - Only after successful commit are the entries removed via `HDEL`.
3. **Self-Healing Fallback**:
   - If Redis is unavailable, maintain an in-memory debounced map (`memoryActivity`) and flush it to PostgreSQL on the same schedule.

## Consequences
### Positive
- Database writes reduced by $>99.9\%$.
- Zero data loss: Failed database flushes preserve entries in Redis / memory for retry on the next interval.
- Multi-instance safety: Process-level locks are replaced with Redis distributed locks.

### Negative / Trade-offs
- Last-used timestamps have a slight latency (up to 5 minutes) before persisting to the database.
