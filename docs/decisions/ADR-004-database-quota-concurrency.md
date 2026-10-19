# ADR-004: Atomic Quota Enforcement via PostgreSQL Advisory Locks

## Status
**Accepted** (Implemented in Phase 3)

## Context
Vedora enforces a business limit of **10 playlists per user**. In web applications, naive quota checks (`SELECT COUNT(*) FROM playlist WHERE user_id = $1` followed by `INSERT`) are vulnerable to race conditions under concurrent requests. Two simultaneous requests when the user has 9 playlists can both read 9 and both insert, yielding 11 playlists.

## Decision
1. **Transaction-Scoped Advisory Locks**:
   - Wrap the quota check and insert in a database transaction (`this.db.transaction`).
   - Acquire an advisory transaction lock keyed on a 32-bit hash of the user ID:
     ```sql
     SELECT pg_advisory_xact_lock(hashtext('vedora_playlist_quota_' || userId))
     ```
   - Advisory locks are managed entirely in PostgreSQL memory and automatically release when the transaction commits or aborts.
2. **User-Scoped Serialization**:
   - Only concurrent requests originating from the **same user** are serialized.
   - Requests from different users proceed completely in parallel without contention.
3. **Strict Validation**:
   - If count $\ge 10$, throw `BadRequestException('Playlist quota exceeded')`.

## Consequences
### Positive
- 100% guarantee against quota bypasses without table-level locking.
- Zero overhead for other tenants.
- Automatic release on transaction failure (no dangling locks).

### Negative / Trade-offs
- Slight serialization latency for concurrent creation attempts by the exact same user account.
