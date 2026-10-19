"use client";

import {
  ChevronRight,
  RefreshCcw,
  UploadCloud,
  X,
  Loader2,
  CheckCircle2,
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
import { storage } from "@oneminutecloud/storage-bucket-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchWithAuth, PlaylistItem } from "@/lib/api-client";

const uploadSchema = z.object({
  title: z.string().min(1, "Video title is required"),
  slug: z.string().min(1, "Slug is required"),
  description: z.string().optional(),
  tags: z.string().optional(),
  thumbnail: z
    .any()
    .optional(),
  timestamps: z.string().optional(),
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
      generateSubtitles: "yes",
      includeWatermark: "yes",
    },
  });

  const [isDragging, setIsDragging] = useState(false);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Upload progress and transfer speed metrics
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [transferSpeed, setTransferSpeed] = useState<string | null>(null);
  const [estimatedTime, setEstimatedTime] = useState<string | null>(null);
  const [uploadedObjectKey, setUploadedObjectKey] = useState<string | null>(null);

  const startTimeRef = useRef<number | null>(null);
  const router = useRouter();
  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Dynamically load user playlists for the dropdown
  const { data: playlists } = useQuery<PlaylistItem[]>({
    queryKey: ["playlists"],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth<PlaylistItem[]>("/playlists", token);
    },
    enabled: isLoaded && !!user,
  });

  const onSubmit = async (_data: UploadFormValues) => {
    if (!selectedFile) {
      toast.error("Please select a valid video file to upload");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setTransferSpeed(null);
    setEstimatedTime("Calculating...");
    setUploadedObjectKey(null);
    startTimeRef.current = Date.now();

    // Default bucket ID format (UUID) or configured bucket
    const bucketId =
      process.env.NEXT_PUBLIC_ONEMINUTECLOUD_BUCKET_ID ||
      "00000000-0000-0000-0000-000000000001";

    try {
      const uploadResult = await storage.upload(selectedFile, bucketId, {
        onProgress: (p: { percent: number; loaded?: number; total?: number }) => {
          const percent = Math.min(100, Math.max(0, Math.round(p.percent || 0)));
          setUploadProgress(percent);

          // Calculate speed & estimated remaining time safely
          if (startTimeRef.current && percent > 0 && percent < 100) {
            const elapsedSeconds = Math.max(0.1, (Date.now() - startTimeRef.current) / 1000);
            const totalBytes = p.total || selectedFile.size;
            const loadedBytes = p.loaded || (totalBytes * (percent / 100));

            const bytesPerSec = loadedBytes / elapsedSeconds;
            if (bytesPerSec > 0 && isFinite(bytesPerSec)) {
              const mbps = (bytesPerSec / (1024 * 1024)).toFixed(1);
              setTransferSpeed(`${mbps} MB/s`);

              const remainingBytes = Math.max(0, totalBytes - loadedBytes);
              const remainingSec = Math.ceil(remainingBytes / bytesPerSec);

              if (remainingSec < 60) {
                setEstimatedTime(`~${remainingSec}s remaining`);
              } else {
                const mins = Math.floor(remainingSec / 60);
                const secs = remainingSec % 60;
                setEstimatedTime(`~${mins}m ${secs}s remaining`);
              }
            }
          } else if (percent >= 100) {
            setEstimatedTime("Finalizing multipart upload...");
          }
        },
      });

      const objectKey = uploadResult.key;
      setUploadedObjectKey(objectKey);
      setUploadProgress(100);
      toast.success("Video uploaded successfully to cloud storage!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Upload error: ${msg}`);
    } finally {
      setIsUploading(false);
    }
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
    if (file && file.type.startsWith("video/")) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setVideoPreview(url);
      setValue("video", [file], { shouldValidate: true });
    } else {
      toast.error("Please drop a valid video file (MP4, WebM, etc.)");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setVideoPreview(url);
      setValue("video", e.target.files, { shouldValidate: true });
    }
  };

  const removeVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setVideoPreview(null);
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
        <div className="text-slate-900 dark:text-slate-50 relative min-h-screen max-w-6xl">
          {/* Breadcrumb */}
          <nav className="flex items-center text-sm text-slate-500 dark:text-slate-400 mb-6">
            <Link
              href="/"
              className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              Dashboard
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
              Ingest video content via OneMinute Cloud multipart storage.
            </p>
          </div>

          {/* Success Banner if Object Key returned */}
          {uploadedObjectKey && (
            <div className="mb-8 p-4 rounded-xl bg-green-500/10 border border-green-500/30 flex items-start gap-3">
              <CheckCircle2 size={22} className="text-green-500 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-green-500">
                  Upload Complete & Object Key Saved
                </h4>
                <p className="text-xs text-gray-300">
                  Object Key: <code className="font-mono text-green-400 bg-slate-900/80 px-2 py-0.5 rounded">{uploadedObjectKey}</code>
                </p>
                <p className="text-xs text-gray-400">
                  Media file is securely staged in cloud storage for downstream transcoding and HLS packaging.
                </p>
              </div>
            </div>
          )}

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
                      className="bg-slate-50 border dark:border-gray-800/50 dark:bg-slate-900/50"
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
                    placeholder="Enter details, timestamps, or summary of the video"
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
                      className="flex h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800/50 dark:bg-slate-900/50 dark:ring-offset-slate-950 dark:focus-visible:ring-slate-300"
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
                      <option value="yes">Yes (Whisper AI)</option>
                      <option value="no">No</option>
                    </select>
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
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timestamps">Timestamps (optional)</Label>
                  <Textarea
                    id="timestamps"
                    {...register("timestamps")}
                    rows={4}
                    placeholder={"00:00 Introduction\n01:30 Ingestion\n05:00 Streaming"}
                    className="bg-slate-50 border dark:border-gray-800/50 dark:bg-slate-900/50 resize-none font-mono text-xs"
                  />
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
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
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
                      <div className="p-2 text-xs text-gray-300 bg-slate-900/90 flex justify-between">
                        <span>{selectedFile.name}</span>
                        <span>{(selectedFile.size / (1024 * 1024)).toFixed(1)} MB</span>
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
                        Supports MP4, WebM, MOV (Multipart chunked uploads)
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
                disabled={isUploading || !selectedFile}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-32 cursor-pointer disabled:opacity-50"
              >
                {isUploading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Uploading...
                  </span>
                ) : (
                  "Upload Video"
                )}
              </Button>
            </div>

            {/* Upload Overlay with Progress, Speed & Time */}
            {isUploading && (
              <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white dark:bg-[#0E1525] rounded-2xl shadow-2xl p-8 max-w-md w-full space-y-6 border border-slate-200 dark:border-slate-800">
                  <div className="space-y-2 text-center">
                    <h3 className="text-lg font-semibold flex items-center justify-center gap-2">
                      <Loader2 size={20} className="animate-spin text-blue-500" />
                      Uploading Video...
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Sending chunks to OneMinute Cloud Storage. Please keep this tab open.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="h-3.5 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-200 dark:border-slate-800">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-200 ease-out"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 font-mono">
                      <span className="font-semibold text-blue-500">{uploadProgress}% Complete</span>
                      {transferSpeed && <span>{transferSpeed}</span>}
                      <span>{estimatedTime || "Calculating..."}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </>
  );
}
