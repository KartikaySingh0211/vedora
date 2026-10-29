export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

export interface ApiKeyItem {
  id: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiKeyItem {
  id: string;
  key: string;
  prefix: string;
  createdAt: string;
}

export interface PlaylistItem {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  playlistLimit: number;
  totalVideos: number;
  createdAt: string;
}

export type VideoStatus =
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'failed';

export interface VideoItem {
  id: string;
  userId: string;
  playlistId: string | null;
  title: string;
  slug: string;
  description: string | null;
  tags: string[];
  storageKey: string | null;
  bucketId: string | null;
  size: number;
  estimatedTranscodedSize: number;
  duration: number;
  status: VideoStatus;
  resolutions: string[];
  thumbnailUrl: string | null;
  generateSubtitles: boolean;
  includeWatermark: boolean;
  masterM3u8Key: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerSettingsItem {
  id: string;
  user_id: string;
  primary_color: string;
  control_bar_bg: string;
  play_icon_style: string;
  watermark_url: string | null;
  watermark_position: string;
  watermark_opacity: number;
  enable_subtitles: boolean;
  enabled_controls?: string[];
  created_at: string;
  updated_at: string;
}

export interface PublicPlayerConfig {
  videoId: string;
  title: string;
  duration: number;
  status: string;
  streamUrl: string | null;
  primaryColor: string;
  controlBarBg: string;
  playIconStyle: string;
  watermarkUrl: string | null;
  watermarkText: string | null;
  watermarkPosition: string;
  watermarkOpacity: number;
  enableSubtitles: boolean;
  enabledControls?: string[];
  isFreeTier: boolean;
}

export interface CountryBreakdownItem {
  country: string;
  visitors: number;
}

export interface TopReferrerItem {
  pathname: string;
  requests: number;
}

export interface AnalyticsMetricsResponse {
  totalViews: number;
  totalWatchTimeSeconds: number;
  totalWatchTimeMinutes: number;
  uniqueViewers: number;
  avgDurationSeconds: number;
  deviceBreakdown: { name: string; value: number; color?: string }[];
  browserBreakdown: { browser: string; share: number }[];
  viewsOverTime: { date: string; views: number }[];
  countryBreakdown?: CountryBreakdownItem[];
  topReferrers?: TopReferrerItem[];
}

export interface SubscriptionItem {
  id: string;
  userId: string;
  plan: string;
  displayName?: string;
  status: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes?: number;
  usagePercent?: number;
  storageCapBytes?: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export async function fetchWithAuth<T>(
  endpoint: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers || {});

  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.message) {
        errorMessage = Array.isArray(errJson.message)
          ? errJson.message.join(', ')
          : errJson.message;
      }
    } catch {
      // Use fallback error message
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
}
