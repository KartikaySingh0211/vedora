import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // If request has been authenticated by DualAuthGuard, track by authenticated user ID
    // to avoid penalizing distinct users behind a shared NAT or corporate proxy.
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }

    // For public endpoints (e.g., /analytics/segment-ping), use the client IP.
    // Express sets req.ip safely based on whether 'trust proxy' is configured.
    // We fall back to req.socket?.remoteAddress and never trust raw unverified headers directly.
    const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    return `ip:${rawIp}`;
  }
}
