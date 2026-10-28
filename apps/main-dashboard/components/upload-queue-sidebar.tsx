"use client";

import React from "react";
import Link from "next/link";
import {
  X,
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileVideo,
  ChevronRight,
  Layers,
  Trash2,
  Plus,
} from "lucide-react";
import { useUploadQueue, UploadQueueItem } from "@/context/upload-queue-context";
import { formatBytes } from "@/lib/formatters";
import { Button } from "@/components/ui/button";

export default function UploadQueueSidebar() {
  const {
    queue,
    activeCount,
    isSidebarOpen,
    setIsSidebarOpen,
    toggleSidebar,
    cancelUpload,
    dismissItem,
    clearCompleted,
  } = useUploadQueue();

  // If there are no items in the queue ever, don't show anything
  if (queue.length === 0) {
    return null;
  }

  // Find the primary active item for the collapsed floating pill
  const activeItem = queue.find((i) => i.status === "uploading") || queue[0];

  return (
    <>
      {/* 1. Floating Quick-Status Pill (Visible when sidebar is closed) */}
      {!isSidebarOpen && (
        <div className="fixed bottom-6 right-6 z-40 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <button
            onClick={toggleSidebar}
            className={`
              flex items-center gap-3 px-4 py-2.5 rounded-full shadow-2xl border transition-all duration-200
              ${
                activeCount > 0
                  ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-500 shadow-blue-500/20 ring-4 ring-blue-500/20"
                  : "bg-slate-900 hover:bg-slate-800 text-slate-100 border-slate-700 shadow-black/40"
              }
            `}
          >
            {activeCount > 0 ? (
              <Loader2 size={16} className="animate-spin text-white" />
            ) : (
              <Layers size={16} className="text-slate-400" />
            )}

            <div className="flex items-center gap-2 text-xs font-medium">
              <span>
                {activeCount > 0
                  ? `Uploading (${activeCount})`
                  : "Upload Queue"}
              </span>
              {activeItem && activeItem.status === "uploading" && (
                <span className="font-mono bg-blue-700/80 px-1.5 py-0.5 rounded text-[11px]">
                  {activeItem.progress}%
                </span>
              )}
            </div>

            <ChevronRight size={14} className="opacity-75" />
          </button>
        </div>
      )}

      {/* 2. Slide-out Right Sidebar Drawer */}
      {isSidebarOpen && (
        <aside
          className={`
            fixed top-0 right-0 bottom-0 w-88 sm:w-96 z-50 flex flex-col
            bg-white dark:bg-[#0E1525] border-l border-slate-200 dark:border-slate-800 shadow-2xl
            animate-in slide-in-from-right duration-250 ease-out
          `}
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
                <UploadCloud size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">
                  Upload Queue
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {activeCount > 0
                    ? `${activeCount} task(s) active`
                    : "All uploads complete"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {queue.some((i) => i.status === "ready" || i.status === "error") && (
                <button
                  onClick={clearCompleted}
                  title="Clear completed"
                  className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              )}
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                title="Collapse queue"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Queue Items List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 divide-y divide-slate-100 dark:divide-slate-800/40">
            {queue.map((item) => (
              <QueueItemCard
                key={item.id}
                item={item}
                onCancel={() => cancelUpload(item.id)}
                onDismiss={() => dismissItem(item.id)}
              />
            ))}
          </div>

          {/* Footer Navigation */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
            <Link
              href="/uploads"
              className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              <Plus size={14} />
              Upload Another Video
            </Link>
          </div>
        </aside>
      )}
    </>
  );
}

function QueueItemCard({
  item,
  onCancel,
  onDismiss,
}: {
  item: UploadQueueItem;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const isUploading = item.status === "uploading";
  const isProcessing = item.status === "processing";
  const isReady = item.status === "ready";
  const isError = item.status === "error";

  return (
    <div className="pt-3 first:pt-0 space-y-2.5">
      {/* Title & Status Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate"
            title={item.title}
          >
            {item.title}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
            {item.filename} • {formatBytes(item.fileSize)}
          </p>
        </div>

        {/* Status Pill & Dismiss Button */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {isUploading && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
              <Loader2 size={10} className="animate-spin" />
              Uploading
            </span>
          )}
          {isProcessing && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              Transcoding
            </span>
          )}
          {isReady && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
              <CheckCircle2 size={10} />
              Ready
            </span>
          )}
          {isError && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
              <AlertCircle size={10} />
              Error
            </span>
          )}

          {isUploading ? (
            <button
              onClick={onCancel}
              title="Cancel upload"
              className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X size={12} />
            </button>
          ) : (
            <button
              onClick={onDismiss}
              title="Dismiss"
              className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-200 ease-out ${
              isError
                ? "bg-red-500"
                : isReady
                  ? "bg-green-500"
                  : isProcessing
                    ? "bg-purple-500 animate-pulse"
                    : "bg-blue-600"
            }`}
            style={{ width: `${Math.max(item.progress, 4)}%` }}
          />
        </div>

        {/* Speed & ETA Telemetry */}
        <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 dark:text-slate-400">
          <span>{item.progress}%</span>
          {isUploading && (
            <>
              <span className="text-blue-500 font-semibold">{item.speed}</span>
              <span>{item.eta}</span>
            </>
          )}
          {isProcessing && (
            <span className="text-purple-400">Transcoding HLS...</span>
          )}
          {isReady && <span className="text-green-500">Ready to play</span>}
          {isError && (
            <span className="text-red-400 truncate max-w-[180px]" title={item.errorMessage}>
              {item.errorMessage || "Failed"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

