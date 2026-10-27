import React from "react";
import { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Reusable EmptyState component displaying contextual icons, messages, and calls to action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "p-12",
}: EmptyStateProps) {
  return (
    <div
      className={`rounded-xl border border-gray-200 dark:border-[#1f2023] bg-white dark:bg-[#101217] flex flex-col items-center justify-center text-center ${className}`}
    >
      <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4">
        <Icon size={24} />
      </div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
        {title}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-6">
        {description}
      </p>
      {action && <div>{action}</div>}
    </div>
  );
}
