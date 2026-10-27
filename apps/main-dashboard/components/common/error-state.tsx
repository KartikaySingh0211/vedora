import React from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Reusable ErrorState component providing accessible error messaging and retry capability.
 */
export function ErrorState({
  title = "Failed to load content",
  message,
  onRetry,
  className = "p-6",
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-red-600 dark:text-red-400 ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs mt-1 text-red-600/80 dark:text-red-400/80 leading-relaxed">
            {message}
          </p>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 border-red-500/30 hover:bg-red-500/20 text-xs font-medium cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
