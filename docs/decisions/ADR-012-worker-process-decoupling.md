# ADR-012: Headless Worker Process Decoupling, Database Fencing, and Queue Durability

## Status
Accepted

## Context
In previous releases (Phases 1 through 3), video ingestion, API request serving, Redis queue polling, FFmpeg media processing, and HLS rendition packaging all ran concurrently within a single NestJS process. While convenient for rapid local prototyping, this coupled topology introduced several critical architectural risks for production environments:

1. **Child Process Resource Starvation vs Event Loop**: FFmpeg processes spawned via `child_process` execute as independent OS processes consuming substantial CPU and memory. While child execution does not block the Node.js event loop directly, heavy FFmpeg encoding saturates multi-core CPU time and exhausts system RAM, inducing CPU starvation and memory thrashing that degrades API HTTP request latency.
2. **Uncontrolled Process Termination**: In an in-process worker model, restarting or redeploying the HTTP API unceremoniously severs running FFmpeg encoding child processes, stranding intermediate files on disk and leaving database records in inconsistent transient states.
3. **Ghost Writes & Fencing Violations**: When an active worker experiences network partitions or extreme GC pauses, its distributed lock may expire. A newer worker could claim the job, re-transcode the assets, and mark the video ready. If the initial stale worker revives, it could overwrite newer HLS playlists or database state.
4. **Queue Durability Risks**: A default Redis cache instance configured with volatile eviction or volatile TTL could silently evict queue items under memory pressure, causing silent transcode job loss.

## Decision

We have decoupled the Transcoder Engine into dedicated process execution roles with strict database-level fencing, bounded concurrency, and safe lifecycle termination:

### 1. Process Role Topology (`APP_ROLE`)
The backend codebase supports three operational modes via the `APP_ROLE` environment variable:
- `api`: Pure headless HTTP REST API. Spawns zero queue pollers or background sweeper intervals. Handles multipart upload sessions, video CRUD, metadata queries, and enqueues jobs to Redis and PostgreSQL.
- `worker`: Headless background transcoder daemon (`services/src/worker.ts`). Spawns zero HTTP listeners. Executes a 4-second queue polling loop (`RPOPLPUSH`), a 60-second recovery sweeper, FFmpeg child process lifecycle management, R2 storage uploads, and database fencing state updates.
- `monolith` (default): Preserves zero-friction local developer workflows by running both HTTP API and embedded worker intervals in a single process.

### 2. Monotonic Database Fencing
PostgreSQL serves as the durable authoritative source of truth. Every video record contains a monotonic integer column `attempt` (defaulting to `1`):
- **Claim Fencing**: A worker can only claim and transition a record to `processing` when `attempt = :targetAttempt AND (status = 'uploaded' OR (status = 'processing' AND (heartbeat_lease IS NULL OR heartbeat_lease < NOW())))`. Workers cannot claim already-ready or already-failed records, nor can they steal from an active worker with a valid lease.
- **Ready Fencing**: A worker can only mark a video `ready` when `attempt = :targetAttempt AND status = 'processing' AND active_job_id = :lockToken`. If a worker's lock expired and a sweeper or subsequent worker incremented `attempt` or updated `active_job_id`, the stale worker's commit query yields 0 updated rows and immediately aborts, preventing ghost writes.
- **Failure Fencing (`markWorkerJobFailed`)**: A worker can only mark a video `failed` when `id = :videoId AND attempt = :targetAttempt AND status = 'processing' AND active_job_id = :ownerToken AND heartbeat_lease > NOW()`. `ownerToken` is strictly mandatory. Stale workers whose lease expired or was superseded cannot mark videos failed. External webhooks invoke `markWebhookJobFailed` requiring `status = 'processing'` and `(heartbeat_lease IS NULL OR heartbeat_lease < NOW())`, preventing webhooks from clobbering active workers. Sweeper retries use `markSweeperJobFailed` under identical lease safety.
- **Sweeper Concurrency Fencing**: Background recovery sweeper updates `attempt = attempt + 1` conditionally matching `attempt = :currentAttempt AND status = 'processing'` with `.returning({ id })`. Only the single sweeper instance that successfully acquires the row update pushes the next attempt payload to Redis.

### 3. PostgreSQL-Backed Enqueue Marker Lifecycle & `active_job_id` State-Machine Contract
To prevent duplicate queue entries during backlogs and API-crash windows, while maintaining strict ownership fencing:
- The video entity maintains an enum state `enqueue_state ('pending' | 'enqueued' | 'processing')` and an `enqueued_at` timestamp.
- **State-Dependent `active_job_id` Contract**:
  - `enqueue_state = 'pending'`: `active_job_id = null`.
  - `enqueue_state = 'enqueued'`: `active_job_id = 'vdr_job_<videoId>_<attempt>'` (deterministic dispatch marker ensuring idempotent redispatch and preventing duplicate queue pushes).
  - `enqueue_state = 'processing'`: `active_job_id = '<worker_uuid_token>'` (worker's private in-memory lock token fencing out stale worker writes and lease renewals).
  - Terminal States (`ready`, `failed`): `active_job_id = null`.
- Upload completion atomically transitions `enqueue_state` from `pending` to `enqueued` with `active_job_id = vdr_job_<videoId>_<attempt>`.
- If Redis enqueueing fails (e.g., Redis OOM or network partition), `enqueue_state` reverts to `pending` and `active_job_id` to `null`.
- Videos queued in Redis with `enqueue_state = 'enqueued'` are immune to redundant sweeper dispatch during heavy queue backlogs, as the sweeper only re-dispatches stranded dispatches exceeding a 15-minute lease threshold.

### 4. Bounded Concurrency, Lock Verification & Child Process Lifecycle
- Worker concurrency is strictly pinned to 1 initially (`isProcessing` mutex).
- Active FFmpeg processes are tracked in an internal map `activeProcesses: Map<string, ChildProcess>`.
- **Continuous Lock Verification**: Before beginning and throughout R2 artifact uploads, workers verify that `redisService.get(lockKey) === lockToken`. If ownership is lost or superseded, uploads immediately halt.
- **Graceful Shutdown Recovery**: On application shutdown (`SIGTERM`/`SIGINT`), the worker stops claiming new jobs, awaits active FFmpeg process termination, cleans temporary job directories, resets `enqueue_state` to `enqueued` (preserving `attempt` and `jobId`), safely requeues the job payload to `QUEUE_KEY` from `PROCESSING_QUEUE_KEY`, and only then releases the distributed lock. Intentional shutdown never marks videos as failed.

### 5. Redis Queue Durability Hardening
- Redis Docker configurations are updated with `--maxmemory-policy noeviction` (preventing silent drop of queue items under memory pressure) and `--appendonly yes` (enabling Append-Only File persistence for durability across container restarts).

## Consequences

### Positive
- **Fault Isolation**: Intensive video encoding workload is completely isolated from HTTP client traffic, preventing API starvation.
- **Data Integrity**: Database-level fencing eliminates ghost write hazards and stale worker overwrite bugs.
- **Graceful Lifecycle**: Zero orphaned FFmpeg processes or stranded temporary directories on host disk upon container restarts.
- **Backward Compatibility**: Developers running `npm start` or Docker Compose continue to run seamlessly using `APP_ROLE=monolith`.

### Negative
- **Resource Footprint**: Running separate API and worker containers increases idle memory consumption slightly (approx. 60-80 MB per Node.js container).
