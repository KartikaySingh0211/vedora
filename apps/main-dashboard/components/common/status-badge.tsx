import React from "react";
import { VideoStatus } from "@/lib/api-client";

export interface StatusBadgeProps {
  status: VideoStatus | string;
  className?: string;
}

const statusConfig: Record<
  string,
  { label: string; containerClass: string; dotClass: string; ping?: boolean; pulse?: boolean }
> = {
  ready: {
    label: "Ready",
    containerClass:
      "bg-green-500/10 text-green-500 border-green-500/20",
    dotClass: "bg-green-500",
  },
  uploaded: {
    label: "Uploaded",
    containerClass:
      "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dotClass: "bg-blue-400",
  },
  processing: {
    label: "Processing",
    containerClass:
      "bg-purple-500/10 text-purple-400 border-purple-500/20",
    dotClass: "bg-purple-400",
    pulse: true,
  },
  uploading: {
    label: "Uploading",
    containerClass:
      "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dotClass: "bg-amber-400",
    ping: true,
  },
  failed: {
    label: "Failed",
    containerClass:
      "bg-red-500/10 text-red-400 border-red-500/20",
    dotClass: "bg-red-400",
  },
};

/**
 * Reusable StatusBadge component for video ingestion lifecycle states.
 */
export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const normalized = (status || "").toLowerCase();
  const config = statusConfig[normalized] || {
    label: status,
    containerClass: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    dotClass: "bg-gray-400",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.containerClass} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${config.dotClass} ${
          config.pulse ? "animate-pulse" : ""
        } ${config.ping ? "animate-ping" : ""}`}
      />
      {config.label}
    </span>
  );
}
