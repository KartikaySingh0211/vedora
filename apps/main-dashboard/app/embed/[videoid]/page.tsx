"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Hls from "hls.js";
import {
  AlertCircle,
  Check,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  PlayCircle,
  PlaySquare,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";

interface PublicPlayerConfig {
  videoId: string;
  title: string;
  duration: number;
  status: string;
  streamUrl: string | null;
  primaryColor: string;
  controlBarBg: string;
  playIconStyle: string;
  watermarkUrl: string | null;
  watermarkText: string | null;
  watermarkPosition: string;
  watermarkOpacity: number;
  enableSubtitles: boolean;
  isFreeTier: boolean;
}

interface QualityLevel {
  index: number;
  height: number;
  bitrate: number;
  label: string;
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

export default function EmbedPlayerPage() {
  const params = useParams();
  const rawVideoId = params?.videoid;
  const videoId = Array.isArray(rawVideoId) ? rawVideoId[0] : rawVideoId;

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [config, setConfig] = useState<PublicPlayerConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Quality levels
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1); // -1 = Auto
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Viewer Session ID (pseudonymous client session)
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
  }, []);

  // 1. Fetch public player configuration
  useEffect(() => {
    if (!videoId) return;

    let isMounted = true;

    fetch(`${API_BASE_URL}/player-settings/public/${videoId}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Video not found or unavailable (HTTP ${res.status})`);
        }
        return res.json() as Promise<PublicPlayerConfig>;
      })
      .then((data) => {
        if (isMounted) {
          setConfig(data);
          setDuration(data.duration || 0);
          setLoadingConfig(false);
        }
      })
      .catch((err: Error) => {
        if (isMounted) {
          setError(err.message);
          setLoadingConfig(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [videoId]);

  // 2. Initialize HLS Playback
  useEffect(() => {
    if (!config || !videoRef.current) return;

    const video = videoRef.current;
    const streamUrl = config.streamUrl;

    if (!streamUrl) {
      if (config.status !== "ready") {
        const timer = setTimeout(() => {
          setError(`This video is currently ${config.status}. Playback will be available once transcoding is ready.`);
        }, 0);
        return () => clearTimeout(timer);
      }
      return;
    }

    // Check if HLS.js is supported
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hlsRef.current = hls;
      hls.attachMedia(video);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(streamUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        const levels: QualityLevel[] = data.levels.map((lvl, index) => ({
          index,
          height: lvl.height,
          bitrate: lvl.bitrate,
          label: `${lvl.height}p`,
        }));
        setQualityLevels(levels);
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              setError("Fatal playback error loading stream manifest");
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native Safari HLS
      video.src = streamUrl;
    } else {
      setTimeout(() => {
        setError("Your browser does not support HLS video streaming.");
      }, 0);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [config]);

  // 3. Telemetry Ping Interval (every 10 seconds while playing)
  useEffect(() => {
    if (!isPlaying || !videoId) return;

    const pingInterval = setInterval(() => {
      fetch(`${API_BASE_URL}/analytics/segment-ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          sessionId: sessionIdRef.current,
          watchDurationSeconds: 10,
          segmentsRequested: 2,
        }),
      }).catch(() => {
        // Silently tolerate transient analytics drops
      });
    }, 10000);

    return () => clearInterval(pingInterval);
  }, [isPlaying, videoId]);

  // Handle Play/Pause
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => {});
    }
  };

  // Handle Quality Selection
  const changeQuality = (levelIndex: number) => {
    setSelectedQuality(levelIndex);
    setShowQualityMenu(false);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
    }
  };

  // Handle Seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(e.target.value);
    setCurrentTime(newTime);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  // Handle Volume
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = Number(e.target.value);
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      videoRef.current.muted = newVol === 0;
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
      videoRef.current.volume = volume || 0.5;
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  // Fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Controls auto-hide
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Watermark position styling
  const getWatermarkPositionClasses = (position: string): string => {
    switch (position) {
      case "top-left":
        return "top-4 left-4";
      case "bottom-right":
        return "bottom-16 right-4";
      case "top-right":
      default:
        return "top-4 right-4";
    }
  };

  if (loadingConfig) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="w-full h-screen bg-black flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mb-3" />
        <h2 className="text-lg font-semibold mb-1">Playback Unavailable</h2>
        <p className="text-sm text-gray-400 max-w-md">{error || "Video stream cannot be loaded."}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative w-full h-screen bg-black overflow-hidden select-none font-sans group flex items-center justify-center"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        playsInline
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
            if (videoRef.current.duration) setDuration(videoRef.current.duration);
          }
        }}
      />

      {/* Buffering Spinner */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
          <Loader2 className="w-12 h-12 animate-spin text-white" />
        </div>
      )}

      {/* Center Play Button Overlay (when paused) */}
      {!isPlaying && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/30 transition-opacity hover:bg-black/40"
        >
          {config.playIconStyle === "minimal" ? (
            <div
              style={{ backgroundColor: config.primaryColor }}
              className="w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-transform hover:scale-110"
            >
              <Play className="w-8 h-8 text-white fill-white ml-1" />
            </div>
          ) : config.playIconStyle === "glow" ? (
            <div
              style={{
                backgroundColor: config.primaryColor,
                boxShadow: `0 0 35px ${config.primaryColor}`,
              }}
              className="w-20 h-20 rounded-2xl flex items-center justify-center transition-transform hover:scale-110"
            >
              <PlaySquare className="w-10 h-10 text-white fill-white" />
            </div>
          ) : (
            <div
              style={{ backgroundColor: config.primaryColor }}
              className="w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-transform hover:scale-110"
            >
              <PlayCircle className="w-12 h-12 text-white fill-white" />
            </div>
          )}
        </button>
      )}

      {/* Watermark Rendering */}
      {config.isFreeTier ? (
        <div
          className={`absolute ${getWatermarkPositionClasses(
            config.watermarkPosition,
          )} pointer-events-none z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs font-semibold text-white tracking-wide shadow-lg`}
        >
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          Powered by Vedora
        </div>
      ) : (
        config.watermarkUrl && (
          <div
            className={`absolute ${getWatermarkPositionClasses(
              config.watermarkPosition,
            )} pointer-events-none z-20`}
            style={{ opacity: (config.watermarkOpacity || 80) / 100 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={config.watermarkUrl}
              alt="Watermark"
              className="max-h-10 max-w-[140px] object-contain drop-shadow-md"
            />
          </div>
        )
      )}

      {/* Control Bar Overlay */}
      <div
        style={{
          background: config.controlBarBg || "rgba(0, 0, 0, 0.75)",
        }}
        className={`absolute bottom-0 inset-x-0 p-3 pt-4 backdrop-blur-md transition-opacity duration-300 z-30 ${
          showControls || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Timeline Slider */}
        <div className="relative w-full flex items-center mb-2 group/slider">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            style={{
              accentColor: config.primaryColor,
            }}
            className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer transition-all hover:h-2.5"
          />
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between text-white text-sm">
          {/* Left Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="p-1.5 hover:bg-white/10 rounded-full transition"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} fill="white" />}
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-1.5 group/volume">
              <button
                onClick={toggleMute}
                className="p-1.5 hover:bg-white/10 rounded-full transition"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX size={18} className="text-red-400" />
                ) : (
                  <Volume2 size={18} />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                style={{ accentColor: config.primaryColor }}
                className="w-16 h-1 bg-white/20 rounded cursor-pointer opacity-80 group-hover/volume:opacity-100 transition"
              />
            </div>

            {/* Time Indicator */}
            <span className="text-xs text-gray-300 font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2 relative">
            {/* Quality Selector */}
            {qualityLevels.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowQualityMenu((prev) => !prev)}
                  className="p-1.5 hover:bg-white/10 rounded-md transition text-xs font-semibold flex items-center gap-1"
                >
                  <Settings size={16} />
                  <span>
                    {selectedQuality === -1
                      ? "Auto"
                      : qualityLevels.find((q) => q.index === selectedQuality)?.label || "Auto"}
                  </span>
                </button>

                {showQualityMenu && (
                  <div className="absolute bottom-10 right-0 bg-[#12141a] border border-white/10 rounded-md shadow-2xl py-1 w-28 text-xs z-50">
                    <button
                      onClick={() => changeQuality(-1)}
                      className="w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center justify-between"
                    >
                      <span>Auto</span>
                      {selectedQuality === -1 && <Check size={14} className="text-blue-400" />}
                    </button>
                    {qualityLevels.map((lvl) => (
                      <button
                        key={lvl.index}
                        onClick={() => changeQuality(lvl.index)}
                        className="w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center justify-between"
                      >
                        <span>{lvl.label}</span>
                        {selectedQuality === lvl.index && (
                          <Check size={14} className="text-blue-400" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 hover:bg-white/10 rounded-full transition"
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
