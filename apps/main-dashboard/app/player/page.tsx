"use client";

import {
  Check,
  ChevronRight,
  Loader2,
  Play,
  PlayCircle,
  PlaySquare,
  X,
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth, PlayerSettingsItem } from "../../lib/api-client";
import { VedoraPlayer } from "@/components/player/vedora-player";

const controls = [
  "Play / Pause",
  "10s Backward",
  "10s Forward",
  "Full Screen",
  "Captions",
  "Volume",
  "Mute",
  "Progress",
  "Settings",
  "AirPlay",
  "Chromecast",
  "Current Time",
  "Duration",
];

const presetColors = [
  "#3b82f6",
  "#2563eb",
  "#06b6d4",
  "#10b981",
  "#facc15",
  "#f97316",
  "#f87171",
  "#fb7185",
  "#c084fc",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#64748b",
  "#6b7280",
  "#1e293b",
  "#fbbf24",
  "#e2e8f0",
  "#e5e7eb",
  "#ff7755",
];

export default function PlayerSettingsPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [primaryColor, setPrimaryColor] = useState("#3b82f6");
  const [controlBarBg, setControlBarBg] = useState("rgba(0, 0, 0, 0.7)");
  const [selectedPlayIcon, setSelectedPlayIcon] = useState<string>("default");
  const [watermarkPosition, setWatermarkPosition] = useState<string>("top-right");
  const [watermarkOpacity, setWatermarkOpacity] = useState<number>(80);
  const [enableSubtitles, setEnableSubtitles] = useState<boolean>(true);
  const [watermarkUrl, setWatermarkUrl] = useState<string>("");
  const [enabledControls, setEnabledControls] = useState<string[]>(controls);

  // Fetch settings from API
  const { data: settings, isLoading } = useQuery<PlayerSettingsItem>({
    queryKey: ["player-settings"],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth<PlayerSettingsItem>("/player-settings", token);
    },
  });

  // Populate local form state when settings load
  useEffect(() => {
    if (settings) {
      const timer = setTimeout(() => {
        if (settings.primary_color) setPrimaryColor(settings.primary_color);
        if (settings.control_bar_bg) setControlBarBg(settings.control_bar_bg);
        if (settings.play_icon_style) setSelectedPlayIcon(settings.play_icon_style);
        if (settings.watermark_position) setWatermarkPosition(settings.watermark_position);
        if (settings.watermark_opacity !== undefined)
          setWatermarkOpacity(settings.watermark_opacity);
        if (settings.enable_subtitles !== undefined)
          setEnableSubtitles(settings.enable_subtitles);
        if (settings.watermark_url) setWatermarkUrl(settings.watermark_url);
        if (settings.enabled_controls && Array.isArray(settings.enabled_controls))
          setEnabledControls(settings.enabled_controls);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [settings]);

  // Mutation to persist settings
  const updateMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      return fetchWithAuth<PlayerSettingsItem>("/player-settings", token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryColor,
          controlBarBg,
          playIconStyle: selectedPlayIcon,
          watermarkPosition,
          watermarkOpacity,
          enableSubtitles,
          watermarkUrl: watermarkUrl.trim() || null,
          enabledControls,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-settings"] });
      toast.success("Player settings saved successfully!");
    },
    onError: (err: Error) => {
      toast.error(`Failed to save settings: ${err.message}`);
    },
  });

  const toggleControl = (control: string) => {
    setEnabledControls((prev) =>
      prev.includes(control)
        ? prev.filter((c) => c !== control)
        : [...prev, control],
    );
  };

  return (
    <div className="text-black dark:text-white">
      {/* Breadcrumb */}
      <nav className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-6">
        <Link href="/" className="hover:underline">
          Dashboard
        </Link>
        <ChevronRight size={16} className="mx-2" />
        <span className="text-gray-700 dark:text-gray-300 font-medium">
          Player Settings
        </span>
      </nav>

      {/* Title */}
      <div className="space-y-1 mb-8">
        <h1 className="text-2xl font-semibold">Player Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[500px]">
          Customize your video player’s appearance, brand colors, watermarking, and behavior for a seamless playback experience.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Interactive Player Live Preview */}
          <div className="col-span-1 md:col-span-2 bg-white dark:bg-slate-900/50 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold">Live Player Preview</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Real-time preview of how your embedded video player will look with the current styling.
                </p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                Live Preview
              </span>
            </div>
            <div className="aspect-video max-w-2xl mx-auto rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-black shadow-lg">
              <VedoraPlayer
                streamUrl="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                title="Player Settings Live Preview"
                primaryColor={primaryColor}
                controlBarBg={controlBarBg}
                playIconStyle={selectedPlayIcon}
                watermarkUrl={watermarkUrl.trim() || null}
                watermarkPosition={watermarkPosition}
                watermarkOpacity={watermarkOpacity}
                enabledControls={enabledControls}
                isFreeTier={!watermarkUrl.trim()}
                autoFetchConfig={false}
                className="w-full h-full"
              />
            </div>
          </div>

          {/* Primary Color */}
          <div className="bg-white dark:bg-slate-900/50 rounded-md p-4 border border-slate-200 dark:border-slate-900">
            <label className="text-sm font-semibold mb-1 block">
              Primary Brand Color
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Accent color for the progress bar, volume slider, and interactive buttons.
            </p>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-gray-300 dark:border-gray-700"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="bg-slate-100 dark:bg-slate-800 text-sm px-3 py-2 rounded-md font-mono w-32 border border-slate-300 dark:border-slate-700"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {presetColors.map((color) => (
                <button
                  key={color}
                  onClick={() => setPrimaryColor(color)}
                  style={{ backgroundColor: color }}
                  className={`w-6 h-6 rounded-full border transition-transform ${
                    primaryColor === color ? "scale-125 border-white shadow-md ring-2 ring-blue-500" : "border-transparent"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Control Bar Background */}
          <div className="bg-white dark:bg-slate-900/50 rounded-md p-4 border border-slate-200 dark:border-slate-900">
            <label className="text-sm font-semibold mb-1 block">
              Control Bar Background
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Hex or rgba background style for the player control bar.
            </p>
            <input
              type="text"
              value={controlBarBg}
              onChange={(e) => setControlBarBg(e.target.value)}
              placeholder="rgba(0, 0, 0, 0.7)"
              className="w-full bg-slate-100 dark:bg-slate-800 text-sm px-3 py-2 rounded-md font-mono border border-slate-300 dark:border-slate-700"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setControlBarBg("rgba(0, 0, 0, 0.7)")}
                className="text-xs px-2.5 py-1 bg-slate-200 dark:bg-slate-800 rounded hover:bg-slate-300 transition"
              >
                Dark Glass (Default)
              </button>
              <button
                type="button"
                onClick={() => setControlBarBg("#000000")}
                className="text-xs px-2.5 py-1 bg-slate-200 dark:bg-slate-800 rounded hover:bg-slate-300 transition"
              >
                Solid Black
              </button>
              <button
                type="button"
                onClick={() => setControlBarBg("transparent")}
                className="text-xs px-2.5 py-1 bg-slate-200 dark:bg-slate-800 rounded hover:bg-slate-300 transition"
              >
                Transparent
              </button>
            </div>
          </div>

          {/* Play Icon Style */}
          <div className="bg-white dark:bg-slate-900/50 rounded-md p-4 border border-slate-200 dark:border-slate-900">
            <label className="text-sm font-semibold mb-1 block">
              Play Button Icon Style
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Choose the centerpiece play button visual aesthetic.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Default", id: "default", icon: <PlayCircle size={20} /> },
                { label: "Minimal", id: "minimal", icon: <Play size={20} /> },
                { label: "Glow", id: "glow", icon: <PlaySquare size={20} /> },
              ].map(({ label, id, icon }) => (
                <button
                  key={id}
                  onClick={() => setSelectedPlayIcon(id)}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-md border transition-all ${
                    selectedPlayIcon === id
                      ? "bg-blue-600 text-white border-blue-600 shadow"
                      : "bg-slate-100 dark:bg-slate-800/50 border-slate-300 dark:border-slate-800 text-gray-700 dark:text-gray-300 hover:bg-slate-200"
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Watermark Branding Settings */}
          <div className="bg-white dark:bg-slate-900/50 rounded-md p-4 border border-slate-200 dark:border-slate-900">
            <label className="text-sm font-semibold mb-1 block">
              Custom Watermark (Starter & Higher Plans)
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Free plans feature the verified Vedora badge. Paid plans display your custom watermark image.
            </p>
            <input
              type="url"
              value={watermarkUrl}
              onChange={(e) => setWatermarkUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full bg-slate-100 dark:bg-slate-800 text-sm px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 mb-3"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold block mb-1">Position</label>
                <select
                  value={watermarkPosition}
                  onChange={(e) => setWatermarkPosition(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 text-sm px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700"
                >
                  <option value="top-right">Top Right</option>
                  <option value="top-left">Top Left</option>
                  <option value="bottom-right">Bottom Right</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1">Opacity ({watermarkOpacity}%)</label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={watermarkOpacity}
                  onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                  className="w-full cursor-pointer accent-blue-600 mt-1"
                />
              </div>
            </div>
          </div>

          {/* Subtitles & Captions */}
          <div className="bg-white dark:bg-slate-900/50 rounded-md p-4 border border-slate-200 dark:border-slate-900">
            <label className="text-sm font-semibold mb-1 block">
              Subtitles & Closed Captions
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Automatically render subtitles track button when generated or provided.
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableSubtitles}
                onChange={(e) => setEnableSubtitles(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
              />
              <span className="text-sm font-medium">Enable subtitles support in player</span>
            </label>
          </div>

          {/* UI Controls Selection */}
          <div className="bg-white dark:bg-slate-900/50 rounded-md p-4 border border-slate-200 dark:border-slate-900">
            <label className="text-sm font-semibold mb-1 block">
              Enabled UI Controls
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Configure which control buttons appear on the player bar.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {controls.map((control) => (
                <button
                  key={control}
                  type="button"
                  onClick={() => toggleControl(control)}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-all flex items-center gap-1 ${
                    enabledControls.includes(control)
                      ? "bg-slate-800 text-white border-slate-800"
                      : "bg-slate-100 dark:bg-slate-800 text-gray-500 border-slate-300 dark:border-slate-700"
                  }`}
                >
                  {enabledControls.includes(control) ? (
                    <Check size={12} className="text-green-400" />
                  ) : (
                    <X size={12} className="text-red-400" />
                  )}
                  {control}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="w-full flex justify-end mt-8">
        <button
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending || isLoading}
          className="cursor-pointer inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition text-white rounded-md text-sm font-semibold shadow-md"
        >
          {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
