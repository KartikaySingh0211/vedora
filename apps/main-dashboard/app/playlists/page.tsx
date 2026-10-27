"use client";

import { Plus, Edit3, Trash2, Loader2, PlaySquare, AlertCircle } from "lucide-react";
import React, { useState } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "timeago.js";
import { toast } from "sonner";
import { fetchWithAuth, PlaylistItem } from "@/lib/api-client";
import { PageHeader, LoadingState, ErrorState } from "@/components/common";

export default function PlaylistsPage() {
  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<PlaylistItem | null>(null);
  const [deletingPlaylist, setDeletingPlaylist] = useState<PlaylistItem | null>(null);

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");

  // 1. Fetch playlists with TanStack Query
  const {
    data: playlists,
    isLoading,
    isError,
    error,
  } = useQuery<PlaylistItem[]>({
    queryKey: ["playlists"],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth<PlaylistItem[]>("/playlists", token);
    },
    enabled: isLoaded && !!user,
  });

  // 2. Create Playlist Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; description?: string }) => {
      const token = await getToken();
      return fetchWithAuth<PlaylistItem>("/playlists", token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Playlist created successfully");
      setShowCreateModal(false);
      setFormName("");
      setFormDescription("");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create playlist");
    },
  });

  // 3. Update Playlist Mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: { name?: string; description?: string };
    }) => {
      const token = await getToken();
      return fetchWithAuth<PlaylistItem>(`/playlists/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Playlist updated successfully");
      setEditingPlaylist(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update playlist");
    },
  });

  // 4. Delete Playlist Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      return fetchWithAuth<{ success: boolean; id: string }>(
        `/playlists/${id}`,
        token,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Playlist deleted successfully");
      setDeletingPlaylist(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete playlist");
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error("Playlist name is required");
      return;
    }
    createMutation.mutate({
      name: formName.trim(),
      description: formDescription.trim() || undefined,
    });
  };

  const handleUpdateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlaylist || !formName.trim()) return;
    updateMutation.mutate({
      id: editingPlaylist.id,
      payload: {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
      },
    });
  };

  const openEditModal = (pl: PlaylistItem) => {
    setEditingPlaylist(pl);
    setFormName(pl.name);
    setFormDescription(pl.description || "");
  };

  const currentCount = playlists?.length || 0;
  const quotaLimit = 10;
  const isQuotaReached = currentCount >= quotaLimit;

  if (!isLoaded) {
    return null;
  }

  return (
    <div className="text-black dark:text-white max-w-6xl">
      <PageHeader
        title="My Playlists"
        description={`Organize and manage your video collections (${currentCount} / ${quotaLimit} used).`}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Playlists" },
        ]}
        actions={
          <button
            onClick={() => {
              setFormName("");
              setFormDescription("");
              setShowCreateModal(true);
            }}
            disabled={isQuotaReached}
            title={isQuotaReached ? "Playlist quota reached" : "Create a playlist"}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition cursor-pointer"
          >
            <Plus size={16} /> Create Playlist
          </button>
        }
      />

      {/* Quota Banner */}
      {isQuotaReached && (
        <div className="mb-6 p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>
            You have reached the limit of {quotaLimit} playlists. Delete an existing playlist to create a new one.
          </span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <LoadingState
          message="Loading your playlists..."
          className="py-20"
        />
      )}

      {/* Error state */}
      {isError && (
        <ErrorState
          title="Failed to load playlists"
          message={error instanceof Error ? error.message : "Unexpected error"}
          className="mb-6"
        />
      )}

      {/* Playlist Table */}
      {!isLoading && !isError && playlists && (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5 text-left font-medium">Playlist Name</th>
                <th className="px-5 py-3.5 text-left font-medium">Description</th>
                <th className="px-5 py-3.5 text-left font-medium">Videos</th>
                <th className="px-5 py-3.5 text-left font-medium">Created</th>
                <th className="px-5 py-3.5 text-right font-medium">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {playlists.map((pl) => (
                <tr
                  key={pl.id}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition"
                >
                  <td className="px-5 py-4 font-medium text-slate-900 dark:text-white">
                    {pl.name}
                  </td>
                  <td className="px-5 py-4 text-gray-500 dark:text-gray-400 text-xs max-w-xs truncate">
                    {pl.description || "—"}
                  </td>
                  <td className="px-5 py-4 text-gray-600 dark:text-gray-400">
                    {pl.totalVideos}
                  </td>
                  <td className="px-5 py-4 text-gray-600 dark:text-gray-400 text-xs">
                    {format(pl.createdAt)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-gray-400 hover:text-indigo-400 transition cursor-pointer"
                        title="Edit Playlist"
                        onClick={() => openEditModal(pl)}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="p-1.5 rounded hover:bg-red-500/10 text-red-400 hover:text-red-500 transition cursor-pointer"
                        title="Delete Playlist"
                        onClick={() => setDeletingPlaylist(pl)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {playlists.length === 0 && (
            <div className="text-center py-16 text-gray-500 dark:text-gray-400 space-y-2">
              <PlaySquare size={36} className="mx-auto text-gray-400/50" />
              <p className="text-sm font-medium">No playlists found</p>
              <p className="text-xs text-gray-400">
                Click &quot;Create Playlist&quot; to organize your video content.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/60 px-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-[#0E1525] text-slate-900 dark:text-white rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="px-6 pt-5 pb-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-semibold">Create New Playlist</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Organize videos internally for fast reference and categorization.
              </p>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="px-6 py-4 space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    Playlist Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    maxLength={100}
                    className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Next.js Architecture Masterclass"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5 text-gray-400">
                    Description (optional)
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    maxLength={500}
                    rows={3}
                    className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Internal notes about this playlist"
                  />
                </div>
              </div>

              <div className="flex justify-end items-center gap-3 px-6 pb-5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition cursor-pointer flex items-center gap-2"
                >
                  {createMutation.isPending && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  Create Playlist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingPlaylist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/60 px-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-[#0E1525] text-slate-900 dark:text-white rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="px-6 pt-5 pb-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-semibold">Edit Playlist</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Update playlist title and internal description.
              </p>
            </div>

            <form onSubmit={handleUpdateSubmit}>
              <div className="px-6 py-4 space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    Playlist Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    maxLength={100}
                    className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5 text-gray-400">
                    Description (optional)
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    maxLength={500}
                    rows={3}
                    className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end items-center gap-3 px-6 pb-5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPlaylist(null)}
                  className="px-4 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition cursor-pointer flex items-center gap-2"
                >
                  {updateMutation.isPending && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingPlaylist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/60 px-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-[#0E1525] text-slate-900 dark:text-white rounded-xl shadow-2xl border border-red-500/20">
            <div className="px-6 pt-5 pb-3 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-red-500 flex items-center gap-2">
                <Trash2 size={20} />
                Delete Playlist
              </h2>
            </div>

            <div className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 space-y-3">
              <p>
                Are you sure you want to delete{" "}
                <strong className="text-slate-900 dark:text-white">
                  &quot;{deletingPlaylist.name}&quot;
                </strong>
                ?
              </p>
              <p className="text-xs text-gray-400">
                This will remove the playlist categorization. Videos inside this playlist will not be deleted.
              </p>
            </div>

            <div className="flex justify-end items-center gap-3 px-6 pb-5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingPlaylist(null)}
                className="px-4 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deletingPlaylist.id)}
                className="px-4 py-2 text-xs rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold transition cursor-pointer flex items-center gap-2"
              >
                {deleteMutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
