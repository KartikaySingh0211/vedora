/**
 * Centralized key registry for distributed locks, Redis queues, and caching namespaces.
 * Prevents key collision, typos, and maintains consistent namespace isolation across services.
 */
export const CACHE_KEYS = {
  /**
   * PostgreSQL transaction advisory lock resource keys
   */
  storageQuotaLock: (userId: string): string =>
    `vedora_storage_quota_${userId}`,
  playlistQuotaLock: (userId: string): string =>
    `vedora_playlist_quota_${userId}`,

  /**
   * Redis cache keys
   */
  apiKey: (keyId: string): string => `api_key:${keyId}`,
  apiKeyLastUsed: 'api_key_last_used',

  /**
   * Redis background queues and buffers
   */
  analyticsBuffer: 'vedora:analytics:buffer',
  transcodeQueue: 'vedora:transcode:queue',
} as const;
