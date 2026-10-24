"use client";

import React, { useState } from "react";
import { Check, Code2, Copy, ExternalLink, Sliders, X } from "lucide-react";
import { toast } from "sonner";
import { VedoraPlayer } from "../player/vedora-player";

export interface EmbedVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoId: string;
  videoTitle?: string;
}

export function EmbedVideoModal({
  isOpen,
  onClose,
  videoId,
  videoTitle = "Video",
}: EmbedVideoModalProps) {
  const [aspectMode, setAspectMode] = useState<"responsive" | "fixed">("responsive");
  const [fixedWidth, setFixedWidth] = useState(640);
  const [fixedHeight, setFixedHeight] = useState(360);
  const [autoplay, setAutoplay] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen) return null;

  // Build the embed query string
  const queryParams = new URLSearchParams();
  if (autoplay) queryParams.set("autoplay", "1");
  if (muted) queryParams.set("muted", "1");
  if (loop) queryParams.set("loop", "1");
  if (startTime > 0) queryParams.set("t", String(startTime));

  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://vedora.com";
  const embedUrl = `${origin}/embed/${videoId}${queryString}`;

  // Iframe snippet
  const iframeSnippet =
    aspectMode === "responsive"
      ? `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;">
  <iframe src="${embedUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>`
      : `<iframe src="${embedUrl}" width="${fixedWidth}" height="${fixedHeight}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="border-radius:12px;"></iframe>`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(iframeSnippet);
    setCopiedCode(true);
    toast.success("Embed iframe code copied to clipboard!");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(embedUrl);
    setCopiedLink(true);
    toast.success("Direct embed URL copied to clipboard!");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-4xl bg-white dark:bg-[#111317] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
              <Code2 size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Embed Player
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-md">
                {videoTitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Live Player Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span className="font-medium">Live Preview</span>
              <a
                href={embedUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-blue-500 hover:underline"
              >
                Open in new tab <ExternalLink size={12} />
              </a>
            </div>
            <div className="aspect-video w-full rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 bg-black shadow-inner">
              <VedoraPlayer
                videoId={videoId}
                autoplay={false}
                muted={muted}
                loop={loop}
                startTime={startTime}
                className="w-full h-full"
              />
            </div>
          </div>

          {/* Configuration Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Sizing Preset */}
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-900 dark:text-white">
                <Sliders size={14} className="text-blue-500" />
                <span>Player Sizing</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAspectMode("responsive")}
                  className={`px-3 py-2 text-xs rounded-lg font-medium border text-left transition ${
                    aspectMode === "responsive"
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100"
                  }`}
                >
                  <p className="font-semibold">Responsive (16:9)</p>
                  <p className="text-[11px] opacity-80">Fits any screen or card</p>
                </button>
                <button
                  type="button"
                  onClick={() => setAspectMode("fixed")}
                  className={`px-3 py-2 text-xs rounded-lg font-medium border text-left transition ${
                    aspectMode === "fixed"
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100"
                  }`}
                >
                  <p className="font-semibold">Fixed Size</p>
                  <p className="text-[11px] opacity-80">Exact pixel dimensions</p>
                </button>
              </div>

              {aspectMode === "fixed" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-1">
                      Width (px)
                    </label>
                    <input
                      type="number"
                      value={fixedWidth}
                      onChange={(e) => setFixedWidth(Number(e.target.value))}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-1">
                      Height (px)
                    </label>
                    <input
                      type="number"
                      value={fixedHeight}
                      onChange={(e) => setFixedHeight(Number(e.target.value))}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Playback Behaviors */}
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 space-y-2.5">
              <span className="text-xs font-semibold text-gray-900 dark:text-white block">
                Playback Behavior
              </span>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={autoplay}
                    onChange={(e) => setAutoplay(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Autoplay video on page load</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={muted}
                    onChange={(e) => setMuted(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Start with audio muted</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={loop}
                    onChange={(e) => setLoop(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Loop playback indefinitely</span>
                </label>
                <div className="flex items-center gap-2 pt-1">
                  <label className="text-xs text-gray-500 shrink-0">
                    Start at (sec):
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={startTime}
                    onChange={(e) => setStartTime(Number(e.target.value))}
                    className="w-20 text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Code Snippet Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-900 dark:text-white">
                HTML Embed Code
              </span>
              <span className="text-[11px]">Copy and paste into your website</span>
            </div>
            <div className="relative">
              <pre className="p-3.5 bg-gray-900 dark:bg-black/90 text-gray-200 text-xs font-mono rounded-xl overflow-x-auto border border-gray-800 leading-relaxed">
                <code>{iframeSnippet}</code>
              </pre>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/[0.02]">
          <button
            type="button"
            onClick={handleCopyLink}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 transition"
          >
            {copiedLink ? (
              <Check size={14} className="text-green-500" />
            ) : (
              <Copy size={14} />
            )}
            {copiedLink ? "Link Copied" : "Copy Direct Embed Link"}
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleCopyCode}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition active:scale-95"
            >
              {copiedCode ? <Check size={14} /> : <Copy size={14} />}
              {copiedCode ? "Embed Code Copied!" : "Copy Iframe Code"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
