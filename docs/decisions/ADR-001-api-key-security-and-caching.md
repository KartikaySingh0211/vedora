# ADR-001: API Key Security, Cryptographic Hashing, and Multi-Tier Caching

## Status
**Accepted** (Implemented in Phase 2)

## Context
Vedora provides public developer APIs for programmatic video ingestion, requiring high-throughput, low-latency API-key validation. Storing plaintext API keys or using weak hashing schemes (like SHA-256 or MD5) poses extreme security risks in the event of database exfiltration. Furthermore, querying the database and running CPU-intensive hashing algorithms on every incoming HTTP request would quickly saturate database CPU and exhaust server resources.

## Decision
1. **Key Format**: Standardized on `VDR_<32-hex-key-id>_<base64url-secret>`.
   - The 32 hex characters are bi-directionally mapped to RFC 4122 UUID format, allowing an $O(1)$ indexed lookup on the PostgreSQL primary key without table scans.
   - Plaintext keys are returned **only once** upon initial generation.
2. **Database Hashing**: Plaintext keys are hashed using **Argon2id** (`m=65536, t=3, p=1`) before persisting into `api_key.value`.
3. **Cache Storage Security**: Plaintext keys are **never** stored in Redis or local memory. Instead, an **HMAC-SHA256** digest derived with a dedicated server-side secret (`API_KEY_DIGEST_SECRET`) is stored in the cache record.
4. **Three-Tier Verification**:
   - **Level 1 (In-Memory LRU)**: Soft TTL 5 minutes, 100,000 maximum entries. Resolves keys in sub-millisecond time.
   - **Level 2 (Distributed Redis)**: Hard TTL 10 minutes. Shares cache across horizontally scaled instances and rehydrates Level 1.
   - **Level 3 (Neon PostgreSQL)**: Argon2id verification and cache repopulation.
5. **Immediate Invalidation**: On revocation or key regeneration, both Level 1 and Level 2 caches are purged before and after the database transaction to prevent stale rehydration.

## Consequences
### Positive
- Zero-knowledge storage: Compromise of the database or Redis dump does not yield usable API keys.
- Ultra-low latency: >99% of requests resolve in memory or Redis without hitting PostgreSQL.
- Fast rejection: Malformed keys are rejected via regex before executing crypto operations.

### Negative / Trade-offs
- Key secret cannot be recovered if lost by the developer; regeneration is mandatory.
- Memory usage for Level 1 cache (~100k records $\approx$ 15-20 MB RAM).
