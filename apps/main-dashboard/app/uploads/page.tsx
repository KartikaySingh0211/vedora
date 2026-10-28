"use client";

import {
  ChevronRight,
  UploadCloud,
  X,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser, useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchWithAuth, PlaylistItem } from "@/lib/api-client";
import { useUploadQueue } from "@/context/upload-queue-context";

const uploadSchema = z.object({
  title: z.string().min(1, "Video title is required"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must contain only lowercase alphanumeric characters and hyphens",
    ),
  description: z.string().optional(),
  tags: z.string().optional(),
  playlist: z.string().optional(),
  generateSubtitles: z.string().optional(),
  includeWatermark: z.string().optional(),
  video: z
    .any()
    .refine((files) => files && files.length > 0, "Video file is required"),
});

type UploadFormValues = z.infer<typeof uploadSchema>;

export default function UploadPage() {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      generateSubtitles: "no",
      includeWatermark: "no",
    },
  });

  const [isDragging, setIsDragging] = useState(false);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);

  // Selected resolutions (720p default, 1080p optional for paid tiers)
  const [resolutions, setResolutions] = useState<string[]>(["720p"]);

  const router = useRouter();
  const { startUpload } = useUploadQueue();
  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load playlists for selector
  const { data: playlists } = useQuery<PlaylistItem[]>({
    queryKey: ["playlists"],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth<PlaylistItem[]>("/playlists", token);
    },
    enabled: isLoaded && !!user,
  });

  const toggleResolution = (res: string) => {
    if (resolutions.includes(res)) {
      if (resolutions.length === 1) {
        toast.error("At least one resolution must be selected");
        return;
      }
      setResolutions(resolutions.filter((r) => r !== res));
    } else {
      setResolutions([...resolutions, res]);
    }
  };

  const calculateDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(Math.round(video.duration || 0));
      };
      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        resolve(0);
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error("Please select a valid video file (MP4, WebM, etc.)");
      return;
    }

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setVideoPreview(url);
    setValue("video", [file], { shouldValidate: true });

    // Derive duration
    const dur = await calculateDuration(file);
    setVideoDuration(dur);

    // Auto-generate slug if title already entered or from filename
    const currentTitle = watch("title");
    if (!currentTitle) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
      setValue("title", nameWithoutExt, { shouldValidate: true });
      const baseSlug = nameWithoutExt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");
      const suffix = Math.random().toString(36).substring(2, 6);
      setValue("slug", `${baseSlug}-${suffix}`, { shouldValidate: true });
    }
  };

  const onSubmit = (data: UploadFormValues) => {
    if (!selectedFile) {
      toast.error("Please select a video file to upload");
      return;
    }

    const tags = data.tags
      ? data.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    startUpload({
      file: selectedFile,
      title: data.title,
      slug: data.slug,
      description: data.description,
      tags,
      playlistId: data.playlist || undefined,
      resolutions: resolutions as ("720p" | "1080p")[],
      generateSubtitles: data.generateSubtitles === "yes",
      includeWatermark: data.includeWatermark === "yes",
      duration: videoDuration,
    });

    toast.success("Upload started! Monitoring progress in the queue.");
    router.push("/my-videos");
  };

  const generateSlug = () => {
    const titleVal = watch("title") || "";
    const baseSlug = titleVal
      ? titleVal
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)+/g, "")
      : "video";
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    setValue("slug", `${baseSlug}-${randomSuffix}`, { shouldValidate: true });
  };

  const triggerBrowse = () => fileInputRef.current?.click();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const removeVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setVideoPreview(null);
    setVideoDuration(0);
    setValue("video", null, { shouldValidate: true });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <>
      {!isLoaded ? (
        <div className="py-20 flex justify-center">
          <Loader2 size={32} className="animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="text-slate-900 dark:text-slate-50 relative min-h-screen max-w-6xl pb-16">
          {/* Breadcrumb */}
          <nav className="flex items-center text-sm text-slate-500 dark:text-slate-400 mb-6">
            <Link
              href="/"
              className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              Dashboard
            </Link>
            <ChevronRight size={16} className="mx-2" />
            <Link
              href="/my-videos"
              className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              My Videos
            </Link>
            <ChevronRight size={16} className="mx-2" />
            <span className="text-slate-900 dark:text-slate-200 font-medium">
              Upload Video
            </span>
          </nav>

          {/* Title & Subtitle */}
          <div className="space-y-1 mb-8">
            <h1 className="text-2xl font-bold tracking-tight">Upload Video</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Upload video directly to cloud storage using the Vedora SDK with plan quota checks.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
              {/* Left Column */}
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="title">
                    Video Title <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="title"
                    {...register("title")}
                    placeholder="e.g. Distributed Video Pipeline Tutorial"
                    className="bg-slate-50 border dark:border-gray-800/50 dark:bg-slate-900/50"
                  />
                  {errors.title && (
                    <p className="text-xs text-red-500 font-medium">
                      {errors.title.message as string}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="slug">
                    Slug <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="slug"
                      {...register("slug")}
                      placeholder="e.g. distributed-video-pipeline"
                      className="bg-slate-50 border dark:border-gray-800/50 dark:bg-slate-900/50 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={generateSlug}
                      title="Generate Slug"
                      className="shrink-0 border dark:border-gray-800/50 dark:bg-slate-900 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <RefreshCcw size={16} className="dark:text-white text-black" />
                    </Button>
                  </div>
                  {errors.slug && (
                    <p className="text-xs text-red-500 font-medium">
                      {errors.slug.message as string}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    {...register("description")}
                    rows={4}
                    placeholder="Enter details, summary, or chapters"
                    className="bg-slate-50 border dark:border-gray-800/50 dark:bg-slate-900/50 resize-none text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tags">Tags (comma separated)</Label>
                  <Input
                    id="tags"
                    {...register("tags")}
                    placeholder="e.g. video, infrastructure, transcoding"
                    className="bg-slate-50 border dark:border-gray-800/50 dark:bg-slate-900/50 text-sm"
                  />
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="playlist">Playlist</Label>
                    <select
                      {...register("playlist")}
                      className="flex h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800/50 dark:bg-slate-900/50"
                    >
                      <option value="">No Playlist</option>
                      {playlists?.map((pl) => (
                        <option key={pl.id} value={pl.id}>
                          {pl.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="generateSubtitles">
                      Generate Subtitles?
                    </Label>
                    <select
                      {...register("generateSubtitles")}
                      className="flex h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800/50 dark:bg-slate-900/50"
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes (Whisper AI)</option>
                    </select>
                  </div>
                </div>

                {/* Resolution Selector */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Encoding Resolutions</Label>
                    <span className="text-[11px] text-slate-500">1080p requires Starter+</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => toggleResolution("720p")}
                      className={`flex items-center justify-between p-3 rounded-lg border text-xs font-medium cursor-pointer transition-all ${
                        resolutions.includes("720p")
                          ? "border-blue-500 bg-blue-50/20 dark:bg-blue-950/30 text-blue-500"
                          : "border-slate-300 dark:border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <span>720p (HD)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">All Plans</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleResolution("1080p")}
                      className={`flex items-center justify-between p-3 rounded-lg border text-xs font-medium cursor-pointer transition-all ${
                        resolutions.includes("1080p")
                          ? "border-purple-500 bg-purple-50/20 dark:bg-purple-950/30 text-purple-400"
                          : "border-slate-300 dark:border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <span>1080p (Full HD)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300">Paid Plan</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="includeWatermark">
                    Include Brand Watermark?
                  </Label>
                  <select
                    {...register("includeWatermark")}
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800/50 dark:bg-slate-900/50"
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="h-px bg-slate-200 dark:bg-slate-800/50 my-6" />

            {/* Video Upload Area */}
            <div className="space-y-2">
              <Label>
                Video File <span className="text-red-500">*</span>
              </Label>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onClick={triggerBrowse}
                className={`
                  relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all duration-200
                  ${
                    isDragging
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 ring-4 ring-blue-500/10"
                      : "border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-900/50"
                  }
                `}
              >
                {videoPreview ? (
                  <div
                    className="relative w-full max-w-xl bg-black rounded-lg overflow-hidden shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <video
                      src={videoPreview}
                      controls
                      className="w-full aspect-video"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2 rounded-full h-8 w-8 cursor-pointer"
                      onClick={removeVideo}
                    >
                      <X size={16} />
                    </Button>
                    {selectedFile && (
                      <div className="p-2.5 text-xs text-gray-300 bg-slate-900/90 flex justify-between font-mono">
                        <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                        <span>
                          {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                          {videoDuration > 0 && ` • ${videoDuration}s`}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center space-y-3 py-6">
                    <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-blue-500">
                      <UploadCloud size={28} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Click to browse or drag and drop video
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Direct-to-cloud upload via Vedora SDK (MP4, WebM, MOV)
                      </p>
                    </div>
                  </div>
                )}
                <input
                  {...register("video")}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  ref={(e) => {
                    register("video").ref(e);
                    fileInputRef.current = e;
                  }}
                  onChange={handleFileChange}
                />
              </div>
              {errors.video && (
                <p className="text-xs text-red-500 font-medium mt-1">
                  {errors.video.message as string}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-4 justify-end pt-2">
              <Button
                type="button"
                variant="secondary"
                className="dark:bg-slate-800 dark:text-white cursor-pointer"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!selectedFile}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-36 cursor-pointer disabled:opacity-50"
              >
                Upload Video
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
