import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  title: string;
  description?: string;
  action?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Reusable PageHeader component providing uniform breadcrumb navigation,
 * page title, descriptive subtitle, and contextual action buttons across dashboard pages.
 */
export function PageHeader({
  breadcrumbs,
  title,
  description,
  action,
  actions,
  className = "",
}: PageHeaderProps) {
  const effectiveAction = action ?? actions;
  return (
    <div className={`mb-8 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumbs"
          className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-6 flex-wrap"
        >
          {breadcrumbs.map((item, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <React.Fragment key={index}>
                {index > 0 && (
                  <ChevronRight size={16} className="mx-2 shrink-0 opacity-70" />
                )}
                {item.href && !isLast ? (
                  <Link href={item.href} className="hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className={
                      isLast
                        ? "text-gray-700 dark:text-gray-300 font-medium"
                        : ""
                    }
                  >
                    {item.label}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </nav>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {effectiveAction && <div className="shrink-0">{effectiveAction}</div>}
      </div>
    </div>
  );
}
