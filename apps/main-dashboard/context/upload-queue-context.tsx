"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { VedoraClient, UploadProgress, VideoRecord } from "@/lib/sdk";
import { fetchWithAuth, VideoItem } from "@/lib/api-client";

export type UploadItemStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "error";

export interface UploadQueueItem {
  id: string;
  videoId?: string;
  title: string;
  filename: string;
  fileSize: number;
  duration: number;
  progress: number; // 0 - 100
  speed: string;
  eta: string;
  status: UploadItemStatus;
  errorMessage?: string;
  createdAt: number;
}

export interface StartUploadParams {
  file: File;
  title: string;
  slug: string;
  description?: string;
  tags?: string[];
  playlistId?: string;
  resolutions?: ("720p" | "1080p")[];
  generateSubtitles?: boolean;
  includeWatermark?: boolean;
  duration?: number;
}

interface UploadQueueContextValue {
  queue: UploadQueueItem[];
  activeCount: number;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  startUpload: (params: StartUploadParams) => string;
  cancelUpload: (id: string) => void;
  dismissItem: (id: string) => void;
  clearCompleted: () => void;
}

const UploadQueueContext = createContext<UploadQueueContextValue | undefined>(
  undefined,
);

export function UploadQueueProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  // Keep references to active AbortControllers so cancel works across renders
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const updateItem = useCallback(
    (id: string, updates: Partial<UploadQueueItem>) => {
      setQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...updates } : item)),
      );
    },
    [],
  );

  const dismissItem = useCallback((id: string) => {
    // If it's still uploading, abort first
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(id);
    }
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setQueue((prev) =>
      prev.filter(
        (item) => item.status === "uploading" || item.status === "processing",
      ),
    );
  }, []);

  const cancelUpload = useCallback(
    (id: string) => {
      const controller = abortControllersRef.current.get(id);
      if (controller) {
        controller.abort();
        abortControllersRef.current.delete(id);
      }
      updateItem(id, {
        status: "error",
        errorMessage: "Upload cancelled by user",
      });
      toast.info("Upload cancelled");
    },
    [updateItem],
  );

  // Poll video status during background transcoding until ready or failed
  const pollTranscodingStatus = useCallback(
    async (itemId: string, videoId: string, title: string) => {
      let attempts = 0;
      const maxAttempts = 60; // Up to ~3 minutes

      const interval = setInterval(async () => {
        attempts++;
        try {
          const token = await getToken();
          const video = await fetchWithAuth<VideoItem>(
            `/videos/${videoId}`,
            token,
          );

          if (video.status === "ready") {
            clearInterval(interval);
            updateItem(itemId, {
              status: "ready",
              progress: 100,
              eta: "Ready for streaming",
            });
            queryClient.invalidateQueries({ queryKey: ["videos"] });
            queryClient.invalidateQueries({ queryKey: ["playlists"] });
            toast.success(`"${title}" is transcoded and ready!`);
          } else if (video.status === "failed") {
            clearInterval(interval);
            updateItem(itemId, {
              status: "error",
              errorMessage: "Transcoding failed. Please check source format.",
            });
            queryClient.invalidateQueries({ queryKey: ["videos"] });
            toast.error(`Transcoding failed for "${title}"`);
          } else {
            // Still processing or uploaded
            queryClient.invalidateQueries({ queryKey: ["videos"] });
          }
        } catch {
          // Non-fatal poll error, keep trying
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          queryClient.invalidateQueries({ queryKey: ["videos"] });
        }
      }, 3000);
    },
    [getToken, queryClient, updateItem],
  );

  const startUpload = useCallback(
    (params: StartUploadParams): string => {
      const {
        file,
        title,
        slug,
        description,
        tags = [],
        playlistId,
        resolutions = ["720p"],
        generateSubtitles = false,
        includeWatermark = false,
        duration = 0,
      } = params;

      const id = `upl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const controller = new AbortController();
      abortControllersRef.current.set(id, controller);

      const newItem: UploadQueueItem = {
        id,
        title,
        filename: file.name,
        fileSize: file.size,
        duration,
        progress: 0,
        speed: "0.0 MB/s",
        eta: "Starting upload...",
        status: "uploading",
        createdAt: Date.now(),
      };

      // Add to queue and open sidebar
      setQueue((prev) => [newItem, ...prev]);
      setIsSidebarOpen(true);

      // Launch async upload pipeline in background
      (async () => {
        try {
          const client = new VedoraClient({
            baseUrl:
              process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1",
            bearerToken: async () => {
              return await getToken();
            },
          });

          const result: VideoRecord = await client.videos.upload(
            file,
            {
              title,
              slug,
              description,
              tags,
              playlistId,
              resolutions,
              generateSubtitles,
              includeWatermark,
              duration,
            },
            {
              duration,
              signal: controller.signal,
              onProgress: (p: UploadProgress) => {
                const mbps = (p.speedBps / (1024 * 1024)).toFixed(1);
                let etaStr = "Calculating...";
                if (p.percent >= 100) {
                  etaStr = "Finalizing registration...";
                } else if (p.etaSeconds < 60) {
                  etaStr = `~${p.etaSeconds}s remaining`;
                } else {
                  const mins = Math.floor(p.etaSeconds / 60);
                  const secs = p.etaSeconds % 60;
                  etaStr = `~${mins}m ${secs}s remaining`;
                }

                updateItem(id, {
                  progress: p.percent,
                  speed: `${mbps} MB/s`,
                  eta: etaStr,
                });
              },
            },
          );

          abortControllersRef.current.delete(id);

          // Upload complete! Transition to processing
          updateItem(id, {
            videoId: result.id,
            status: "processing",
            progress: 100,
            speed: "Uploaded",
            eta: "FFmpeg transcoding in queue...",
          });

          // Invalidate video queries so my-videos displays the new record
          queryClient.invalidateQueries({ queryKey: ["videos"] });
          queryClient.invalidateQueries({ queryKey: ["playlists"] });
          toast.success(`"${title}" uploaded! Transcoding HLS in background.`);

          // Start monitoring background transcoding status
          if (result.id) {
            pollTranscodingStatus(id, result.id, title);
          }
        } catch (err: unknown) {
          abortControllersRef.current.delete(id);
          const isAborted = controller.signal.aborted;
          const msg = isAborted
            ? "Upload cancelled"
            : err instanceof Error
              ? err.message
              : String(err);

          updateItem(id, {
            status: "error",
            errorMessage: msg,
          });

          if (!isAborted) {
            toast.error(`Upload error: ${msg}`);
          }
        }
      })();

      return id;
    },
    [getToken, pollTranscodingStatus, queryClient, updateItem],
  );

  const activeCount = queue.filter(
    (item) => item.status === "uploading" || item.status === "processing",
  ).length;

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  return (
    <UploadQueueContext.Provider
      value={{
        queue,
        activeCount,
        isSidebarOpen,
        setIsSidebarOpen,
        toggleSidebar,
        startUpload,
        cancelUpload,
        dismissItem,
        clearCompleted,
      }}
    >
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue() {
  const context = useContext(UploadQueueContext);
  if (!context) {
    throw new Error("useUploadQueue must be used within an UploadQueueProvider");
  }
  return context;
}

