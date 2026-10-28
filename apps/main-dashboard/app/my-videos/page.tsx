"use client";

import { useUser, useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  VideoIcon,
  FolderOpen,
  Copy,
  Check,
  Code,
  LayoutGrid,
  List,
  Loader2,
  Upload,
  HardDrive,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchWithAuth, VideoItem, PlaylistItem } from "@/lib/api-client";
import { EmbedVideoModal } from "@/components/modals/embed-video-modal";
import { formatBytes, formatDuration } from "@/lib/formatters";
import {
  PageHeader,
  StatusBadge,
  LoadingState,
  ErrorState,
  EmptyState,
} from "@/components/common";
import { useUploadQueue } from "@/context/upload-queue-context";

export default function MyVideosPage() {
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("all");

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [embedModalVideo, setEmbedModalVideo] = useState<VideoItem | null>(null);

  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { activeCount, toggleSidebar } = useUploadQueue();

  // 1. Fetch real video records with automatic reactive polling for active processing states
  const {
    data: videoList,
    isLoading: isVideosLoading,
    error: videosError,
  } = useQuery<VideoItem[]>({
    queryKey: ["videos", selectedPlaylistId],
    queryFn: async () => {
      const token = await getToken();
      const endpoint =
        selectedPlaylistId && selectedPlaylistId !== "all"
          ? `/videos?playlistId=${encodeURIComponent(selectedPlaylistId)}`
          : "/videos";
      return fetchWithAuth<VideoItem[]>(endpoint, token);
    },
    enabled: isLoaded && !!user,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasActive = data?.some((v) =>
        ["uploading", "uploaded", "processing"].includes(v.status),
      );
      // Automatically poll every 2.5 seconds when any video is uploading or transcoding
      return hasActive ? 2500 : false;
    },
  });

  // 2. Fetch playlists for filtering & name mapping
  const { data: playlists } = useQuery<PlaylistItem[]>({
    queryKey: ["playlists"],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth<PlaylistItem[]>("/playlists", token);
    },
    enabled: isLoaded && !!user,
  });

  const playlistMap = new Map(playlists?.map((p) => [p.id, p.name]));

  // 3. Delete mutation with quota & playlist invalidation
  const deleteMutation = useMutation({
    mutationFn: async (videoId: string) => {
      const token = await getToken();
      return fetchWithAuth<{ success: boolean; id: string }>(
        `/videos/${videoId}`,
        token,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Video deleted and storage quota released");
      setShowDeleteModal(false);
      setSelectedVideo(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Delete failed: ${msg}`);
    },
  });

  const openDeleteModal = (video: VideoItem) => {
    setSelectedVideo(video);
    setShowDeleteModal(true);
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    toast.success("Video ID copied to clipboard");
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleOpenEmbed = (video: VideoItem) => {
    setEmbedModalVideo(video);
  };

  if (!isLoaded || isVideosLoading) {
    return (
      <LoadingState
        message="Loading your video library..."
        className="py-24"
      />
    );
  }

  return (
    <div className="text-slate-900 dark:text-slate-50 relative min-h-screen max-w-7xl pb-16">
      <PageHeader
        title="My Videos"
        description="Manage your uploaded videos, resolution presets, and cloud storage assets."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "My Videos" },
        ]}
        actions={
          <div className="flex items-center gap-3">
            {/* Playlist filter */}
            <select
              value={selectedPlaylistId}
              onChange={(e) => setSelectedPlaylistId(e.target.value)}
              className="h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-xs dark:border-slate-800 dark:bg-slate-900/50"
            >
              <option value="all">All Playlists</option>
              {playlists?.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>

            {/* View Mode Toggle */}
            <div className="flex items-center border border-slate-200 dark:border-slate-800 rounded-md p-0.5 bg-slate-100 dark:bg-slate-900">
              <button
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded cursor-pointer ${
                  viewMode === "table"
                    ? "bg-white dark:bg-slate-800 shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
                title="Table View"
              >
                <List size={16} />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-white dark:bg-slate-800 shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
                title="Grid View"
              >
                <LayoutGrid size={16} />
              </button>
            </div>

            {activeCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={toggleSidebar}
                className="text-xs gap-1.5 border-blue-500/40 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 cursor-pointer"
              >
                <Loader2 size={13} className="animate-spin text-blue-400" />
                Upload Queue ({activeCount})
              </Button>
            )}

            <Link href="/uploads">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5 cursor-pointer">
                <Upload size={14} />
                Upload Video
              </Button>
            </Link>
          </div>
        }
      />

      {videosError && (
        <ErrorState
          title="Failed to load video library"
          message={videosError.message}
          className="mb-6"
        />
      )}

      {/* Empty State */}
      {(!videoList || videoList.length === 0) && (
        <EmptyState
          icon={VideoIcon}
          title="No videos in your library"
          description="Get started by uploading your first video via the Vedora direct-to-cloud upload pipeline."
          action={
            <div className="flex items-center gap-2">
              {activeCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleSidebar}
                  className="text-xs gap-1.5 border-blue-500/40 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 cursor-pointer"
                >
                  <Loader2 size={13} className="animate-spin text-blue-400" />
                  Upload Queue ({activeCount})
                </Button>
              )}
              <Link href="/uploads">
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5 cursor-pointer">
                  <Upload size={14} />
                  Upload Video
                </Button>
              </Link>
            </div>
          }
        />
      )}

      {/* Table View */}
      {videoList && videoList.length > 0 && viewMode === "table" && (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800/60 rounded-xl bg-white dark:bg-[#0E1525]/40 backdrop-blur-xs">
          <table className="min-w-full text-sm text-left">
            <thead>
              <tr className="text-xs uppercase text-slate-400 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
                <th className="px-4 py-3.5">Video Details</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Resolutions</th>
                <th className="px-4 py-3.5">Playlist</th>
                <th className="px-4 py-3.5">Size / Duration</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {videoList.map((video) => (
                <tr
                  key={video.id}
                  className="hover:bg-slate-50/60 dark:hover:bg-slate-800/20 transition-colors"
                >
                  {/* Thumbnail & Title */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-9 rounded bg-slate-800 shrink-0 flex items-center justify-center overflow-hidden border border-slate-700">
                        {video.thumbnailUrl ? (
                          <Image
                            src={video.thumbnailUrl}
                            alt={video.title}
                            width={56}
                            height={36}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <VideoIcon size={18} className="text-slate-400" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-xs">
                          {video.title}
                        </span>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
                          <span>{video.slug}</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-4">
                    <StatusBadge status={video.status} />
                  </td>

                  {/* Resolutions */}
                  <td className="px-4 py-4">
                    <div className="flex gap-1 flex-wrap">
                      {(video.resolutions || ["720p"]).map((r) => (
                        <span
                          key={r}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Playlist */}
                  <td className="px-4 py-4 text-xs">
                    {video.playlistId && playlistMap.has(video.playlistId) ? (
                      <span className="inline-flex items-center gap-1 text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-md font-medium">
                        <FolderOpen size={12} />
                        {playlistMap.get(video.playlistId)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* Size & Duration */}
                  <td className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    <div className="flex flex-col">
                      <span>{formatBytes(video.size)}</span>
                      <span>{formatDuration(video.duration)}</span>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                        title={copiedId === video.id ? "Copied!" : "Copy Video ID"}
                        onClick={() => handleCopyId(video.id)}
                      >
                        {copiedId === video.id ? (
                          <Check size={14} className="text-green-500" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </Button>

                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-slate-400 hover:text-blue-400 hover:bg-slate-800 cursor-pointer"
                        title="Embed Video Player"
                        onClick={() => handleOpenEmbed(video)}
                      >
                        <Code size={14} />
                      </Button>

                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
                        title="Delete Video"
                        onClick={() => openDeleteModal(video)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Grid View */}
      {videoList && videoList.length > 0 && viewMode === "grid" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {videoList.map((video) => (
            <div
              key={video.id}
              className="group border border-slate-200 dark:border-slate-800/80 rounded-xl bg-white dark:bg-[#0E1525]/40 backdrop-blur-xs overflow-hidden hover:border-slate-400 dark:hover:border-slate-700 transition-all duration-200 flex flex-col justify-between"
            >
              <div>
                <div className="aspect-video bg-slate-900 relative flex items-center justify-center overflow-hidden border-b border-slate-800">
                  {video.thumbnailUrl ? (
                    <Image
                      src={video.thumbnailUrl}
                      alt={video.title}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <VideoIcon size={32} className="text-slate-600" />
                  )}
                  <div className="absolute top-2.5 left-2.5">
                    <StatusBadge status={video.status} />
                  </div>
                  <div className="absolute bottom-2.5 right-2.5 bg-black/80 px-2 py-0.5 rounded text-[11px] font-mono text-white">
                    {formatDuration(video.duration)}
                  </div>
                </div>

                <div className="p-4 space-y-2">
                  <h3 className="font-semibold text-sm line-clamp-1" title={video.title}>
                    {video.title}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono truncate">{video.slug}</p>

                  <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/60 font-mono">
                    <span className="flex items-center gap-1">
                      <HardDrive size={12} />
                      {formatBytes(video.size)}
                    </span>
                    <div className="flex gap-1">
                      {(video.resolutions || ["720p"]).map((r) => (
                        <span key={r} className="px-1 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-4 pb-3.5 pt-1 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/40">
                <span className="text-[11px] text-slate-500">
                  {new Date(video.createdAt).toLocaleDateString()}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-slate-400 hover:text-white"
                    title="Copy Video ID"
                    onClick={() => handleCopyId(video.id)}
                  >
                    {copiedId === video.id ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-slate-400 hover:text-blue-400"
                    title="Embed Video Player"
                    onClick={() => handleOpenEmbed(video)}
                  >
                    <Code size={12} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-slate-400 hover:text-red-500"
                    title="Delete Video"
                    onClick={() => openDeleteModal(video)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md bg-white dark:bg-[#0E1525] text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 pt-6 pb-3">
              <h3 className="text-base font-semibold">Delete Video</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Are you sure you want to delete <span className="font-semibold text-white">&quot;{selectedVideo.title}&quot;</span>?
              </p>
            </div>

            <div className="px-6 py-3 text-xs text-slate-300 bg-red-500/10 border-y border-red-500/20 space-y-1">
              <p className="font-medium text-red-400">This action cannot be undone.</p>
              <p className="text-slate-400">
                The storage reservation of {formatBytes(selectedVideo.size)} will be released back to your plan quota, and playlist counts will be updated.
              </p>
            </div>

            <div className="flex justify-end items-center gap-3 px-6 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedVideo(null);
                }}
                disabled={deleteMutation.isPending}
                className="cursor-pointer border-slate-700 hover:bg-slate-800 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteMutation.mutate(selectedVideo.id)}
                disabled={deleteMutation.isPending}
                className="cursor-pointer text-xs bg-red-600 hover:bg-red-700"
              >
                {deleteMutation.isPending ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin" />
                    Deleting...
                  </span>
                ) : (
                  "Delete Video"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Embed Player Modal */}
      {embedModalVideo && (
        <EmbedVideoModal
          isOpen={!!embedModalVideo}
          onClose={() => setEmbedModalVideo(null)}
          videoId={embedModalVideo.id}
          videoTitle={embedModalVideo.title}
        />
      )}
    </div>
  );
}
