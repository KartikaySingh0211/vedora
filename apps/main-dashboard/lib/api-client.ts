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
