import React from "react";
import { Loader2 } from "lucide-react";

export interface LoadingStateProps {
  message?: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Reusable LoadingState component providing uniform loading indicators across views.
 */
export function LoadingState({
  message,
  className = "p-12",
  iconClassName = "w-8 h-8",
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 ${className}`}
    >
      <Loader2 className={`animate-spin text-blue-500 ${iconClassName}`} />
      {message && <p className="mt-3 text-sm font-medium">{message}</p>}
      <span className="sr-only">Loading...</span>
    </div>
  );
}
