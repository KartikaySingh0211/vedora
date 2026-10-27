/**
 * Utility functions for user-agent classification and referrer normalization.
 * Lightweight, zero-dependency string heuristics optimized for low-latency analytics ingestion.
 */

export function detectBrowser(userAgent = ''): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'Edge';
  if (ua.includes('chrome')) return 'Chrome';
  if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
  if (ua.includes('firefox')) return 'Firefox';
  return 'Other';
}

export function detectDevice(userAgent = ''): string {
  const ua = userAgent.toLowerCase();
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(ua))
    return 'mobile';
  return 'desktop';
}

export function cleanReferrer(ref?: string): string {
  if (!ref) return 'direct';
  try {
    const url = new URL(ref);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return 'direct';
  }
}
