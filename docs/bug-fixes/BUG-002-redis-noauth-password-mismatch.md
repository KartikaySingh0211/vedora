# BUG-002: Redis Client NOAUTH HELLO Authentication Rejection

- **ID**: BUG-002
- **Date**: 2026-10-24
- **Component**: Infrastructure / Redis (`services/src/config/configuration.ts`, `infra/docker-compose.yml`)
- **Severity**: High (Blocked queue processors and rate limiting)
- **Status**: Resolved

---

## 1. Symptoms & Error Log

During backend startup with Docker Compose active, the `ioredis` client emitted authentication warnings and connection retries:

```text
[Nest] 30544 - 24/10/2026, 11:53:48 pm WARN [RedisService] NOAUTH HELLO must be called with the client already authenticated, otherwise the HELLO command will fail.
```

---

## 2. Root Cause Analysis

In `infra/docker-compose.yml`, the Redis service is configured with authentication:

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --requirepass vedorasecret
  ports:
    - "6379:6379"
```

In `services/src/config/configuration.ts`, Redis options were configured as:

```ts
redis: {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
}
```

Because `services/.env` did not define `REDIS_PASSWORD`, `configuration.ts` passed `undefined`. Consequently, `ioredis` attempted to connect without a password, causing the Redis server to reject the handshake with `NOAUTH`.

---

## 3. Implementation Details

- **File**: `services/src/config/configuration.ts`
- Updated `redis.password` to default to `'vedorasecret'` when `process.env.REDIS_PASSWORD` is unset:
  ```ts
  password: process.env.REDIS_PASSWORD || 'vedorasecret',
  ```
- Updated `services/.env.example` to document `REDIS_PASSWORD=vedorasecret`.

---

## 4. Verification & Testing

- Inspected startup logs: `[Nest] LOG [RedisService] Connected to Redis server`.
- Verified Redis ping response: Connection established cleanly without NOAUTH warnings.
