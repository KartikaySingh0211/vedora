"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Hls from "hls.js";
import {
  AlertCircle,
  Check,
  FastForward,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture,
  Play,
  PlayCircle,
  PlaySquare,
  RotateCcw,
  RotateCw,
  Settings,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { API_BASE_URL, PublicPlayerConfig } from "@/lib/api-client";

export interface VedoraPlayerProps {
  videoId?: string;
  streamUrl?: string | null;
  title?: string;
  poster?: string;
  duration?: number;
  status?: string;
  primaryColor?: string;
  controlBarBg?: string;
  playIconStyle?: "default" | "minimal" | "glow" | string;
  watermarkUrl?: string | null;
  watermarkText?: string | null;
  watermarkPosition?: "top-right" | "top-left" | "bottom-right" | string;
  watermarkOpacity?: number;
  enableSubtitles?: boolean;
  enabledControls?: string[];
  isFreeTier?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  startTime?: number;
  className?: string;
  autoFetchConfig?: boolean;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
}

interface QualityLevel {
  index: number;
  height: number;
  bitrate: number;
  label: string;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const SAMPLE_STREAM_MP4 =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

export function VedoraPlayer({
  videoId,
  streamUrl: propStreamUrl,
  title: propTitle,
  poster,
  duration: propDuration,
  status: propStatus,
  primaryColor: propPrimaryColor,
  controlBarBg: propControlBarBg,
  playIconStyle: propPlayIconStyle,
  watermarkUrl: propWatermarkUrl,
  watermarkText: propWatermarkText,
  watermarkPosition: propWatermarkPosition,
  watermarkOpacity: propWatermarkOpacity,
  enabledControls: propEnabledControls,
  isFreeTier: propIsFreeTier,
  autoplay = false,
  muted = false,
  loop = false,
  startTime = 0,
  className = "",
  autoFetchConfig = true,
  onTimeUpdate,
  onPlay,
  onPause,
  onEnded,
}: VedoraPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fallbackAttemptedRef = useRef(false);

  // Configuration state (from props or fetched via API)
  const [config, setConfig] = useState<PublicPlayerConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState<boolean>(
    Boolean(autoFetchConfig && videoId && !propStreamUrl)
  );
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(propDuration || 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(muted ? 0 : 1);
  const [isMuted, setIsMuted] = useState(muted);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showRemainingTime, setShowRemainingTime] = useState(false);

  // UI Menus & Hover
  const [showControls, setShowControls] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);
  const [pulseIcon, setPulseIcon] = useState<"play" | "pause" | null>(null);

  // Quality levels (HLS)
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1); // -1 = Auto

  // Telemetry Session ID
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
  }, []);

  // 1. Fetch public config if videoId provided and autoFetchConfig enabled
  useEffect(() => {
    if (!videoId || !autoFetchConfig || propStreamUrl) {
      setLoadingConfig(false);
      return;
    }

    let isMounted = true;
    setLoadingConfig(true);

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
          if (data.duration) setDuration(data.duration);
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
  }, [videoId, autoFetchConfig, propStreamUrl]);

  // Derived effective settings (props take precedence, fallback to config, then defaults)
  const effectivePrimaryColor =
    propPrimaryColor || config?.primaryColor || "#3b82f6";
  const effectiveControlBarBg =
    propControlBarBg || config?.controlBarBg || "rgba(0, 0, 0, 0.75)";
  const effectivePlayIconStyle =
    propPlayIconStyle || config?.playIconStyle || "default";
  const effectiveWatermarkUrl =
    propWatermarkUrl !== undefined ? propWatermarkUrl : config?.watermarkUrl;
  const effectiveWatermarkPosition =
    propWatermarkPosition || config?.watermarkPosition || "top-right";
  const effectiveWatermarkOpacity =
    propWatermarkOpacity !== undefined
      ? propWatermarkOpacity
      : config?.watermarkOpacity ?? 80;
  const effectiveIsFreeTier =
    propIsFreeTier !== undefined ? propIsFreeTier : (config?.isFreeTier ?? true);
  const effectiveTitle = propTitle || config?.title || "Video";
  const effectiveEnabledControls =
    propEnabledControls || config?.enabledControls;
  const effectiveStreamUrl = propStreamUrl || config?.streamUrl || null;
  const effectiveStatus = propStatus || config?.status;

  const isControlEnabled = useCallback(
    (name: string) => {
      if (!effectiveEnabledControls || !Array.isArray(effectiveEnabledControls))
        return true;
      return effectiveEnabledControls.includes(name);
    },
    [effectiveEnabledControls]
  );

  const handlePlaybackFallback = useCallback(() => {
    if (fallbackAttemptedRef.current || !videoRef.current) return;
    fallbackAttemptedRef.current = true;
    setIsBuffering(false);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const video = videoRef.current;
    // If effectiveStreamUrl is available and not already playing natively, try native direct playback first
    if (effectiveStreamUrl && video.src !== effectiveStreamUrl) {
      video.src = effectiveStreamUrl;
      video.load();
      video.play().catch(() => {});
      return;
    }

    video.src = SAMPLE_STREAM_MP4;
    video.load();
    video.play().catch(() => {});
  }, [effectiveStreamUrl]);

  // 2. Initialize Video Stream (HLS or Direct MP4/WebM)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!effectiveStreamUrl) {
      if (effectiveStatus && effectiveStatus !== "ready") {
        setError(
          `This video is currently ${effectiveStatus}. Playback will begin once transcoding completes.`
        );
      }
      return;
    }

    setError(null);

    const isHlsManifest =
      effectiveStreamUrl.includes(".m3u8") ||
      effectiveStreamUrl.includes("application/x-mpegURL");

    if (isHlsManifest && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hlsRef.current = hls;
      hls.attachMedia(video);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(effectiveStreamUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        const levels: QualityLevel[] = data.levels.map((lvl, index) => ({
          index,
          height: lvl.height,
          bitrate: lvl.bitrate,
          label: lvl.height ? `${lvl.height}p` : `Stream ${index + 1}`,
        }));
        setQualityLevels(levels);

        if (startTime > 0) {
          video.currentTime = startTime;
        }

        if (autoplay) {
          video.play().catch(() => {
            // Autoplay with audio was prevented, fallback to muted autoplay
            video.muted = true;
            setIsMuted(true);
            video.play().catch(() => {});
          });
        }
      });

      let networkRetryCount = 0;
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              networkRetryCount++;
              if (networkRetryCount <= 2) {
                hls.startLoad();
              } else {
                hls.destroy();
                hlsRef.current = null;
                setIsBuffering(false);
                handlePlaybackFallback();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              hlsRef.current = null;
              setIsBuffering(false);
              handlePlaybackFallback();
              break;
          }
        }
      });
    } else {
      // Direct source (MP4 / WebM / native Safari HLS)
      video.src = effectiveStreamUrl;
      if (startTime > 0) {
        video.currentTime = startTime;
      }
      if (autoplay) {
        video.play().catch(() => {
          video.muted = true;
          setIsMuted(true);
          video.play().catch(() => {});
        });
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [
    effectiveStreamUrl,
    effectiveStatus,
    autoplay,
    startTime,
    handlePlaybackFallback,
  ]);

  // 3. Analytics Heartbeat Ping
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

  // 4. Progress bar hover & scrubbing
  const handleMouseMoveProgress = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos * 100);
    setHoverTime(pos * duration);
  };

  const handleMouseLeaveProgress = () => {
    setHoverTime(null);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !videoRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = pos * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Play / Pause Toggle
  const triggerPulse = (type: "play" | "pause") => {
    setPulseIcon(type);
    setTimeout(() => setPulseIcon(null), 500);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      triggerPulse("pause");
    } else {
      videoRef.current.play().catch(() => {});
      triggerPulse("play");
    }
  };

  // Skip
  const skip = (seconds: number) => {
    if (!videoRef.current) return;
    const target = Math.max(
      0,
      Math.min(duration, videoRef.current.currentTime + seconds)
    );
    videoRef.current.currentTime = target;
    setCurrentTime(target);
  };

  // Volume
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    const mutedState = val === 0;
    setIsMuted(mutedState);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = mutedState;
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted || volume === 0) {
      const restoreVol = volume > 0 ? volume : 0.6;
      videoRef.current.muted = false;
      videoRef.current.volume = restoreVol;
      setIsMuted(false);
      setVolume(restoreVol);
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  // Playback Speed
  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    setShowSpeedMenu(false);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  // Quality Level Change
  const changeQuality = (levelIndex: number) => {
    setSelectedQuality(levelIndex);
    setShowQualityMenu(false);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
    }
  };

  // Picture in Picture
  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {
      // Ignored
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

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
        case "j":
          e.preventDefault();
          skip(-5);
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          skip(5);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.min(1, prev + 0.1);
            if (videoRef.current) {
              videoRef.current.volume = next;
              videoRef.current.muted = false;
            }
            setIsMuted(false);
            return next;
          });
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.max(0, prev - 0.1);
            if (videoRef.current) {
              videoRef.current.volume = next;
              videoRef.current.muted = next === 0;
            }
            setIsMuted(next === 0);
            return next;
          });
          break;
        case "m":
        case "M":
          e.preventDefault();
          toggleMute();
          break;
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "p":
        case "P":
          e.preventDefault();
          togglePiP();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Controls auto-hide
  const handleMouseMoveContainer = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showQualityMenu && !showSpeedMenu) {
        setShowControls(false);
      }
    }, 2800);
  };

  // Video click handler: Single click = Play/Pause, Double click = Fullscreen
  const handleVideoClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      toggleFullscreen();
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        togglePlay();
      }, 250);
    }
  };

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? "0" : ""}${mins}:${
        secs < 10 ? "0" : ""
      }${secs}`;
    }
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

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
      <div
        className={`w-full h-full min-h-[320px] bg-black flex flex-col items-center justify-center text-white ${className}`}
      >
        <Loader2
          className="w-8 h-8 animate-spin"
          style={{ color: effectivePrimaryColor }}
        />
        <p className="text-xs text-gray-400 mt-2 font-medium">
          Loading player...
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMoveContainer}
      onMouseLeave={() => {
        if (isPlaying) setShowControls(false);
      }}
      className={`relative w-full h-full min-h-[280px] bg-black overflow-hidden select-none font-sans group flex items-center justify-center ${className}`}
      tabIndex={0}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        title={effectiveTitle}
        poster={poster}
        loop={loop}
        playsInline
        className="w-full h-full object-contain cursor-pointer"
        onClick={handleVideoClick}
        onPlay={() => {
          setIsPlaying(true);
          onPlay?.();
        }}
        onPause={() => {
          setIsPlaying(false);
          setIsBuffering(false);
          onPause?.();
        }}
        onCanPlay={() => setIsBuffering(false)}
        onCanPlayThrough={() => setIsBuffering(false)}
        onLoadedData={() => setIsBuffering(false)}
        onSeeked={() => setIsBuffering(false)}
        onWaiting={() => {
          if (isPlaying) {
            setIsBuffering(true);
          }
        }}
        onPlaying={() => setIsBuffering(false)}
        onError={() => {
          setIsBuffering(false);
          handlePlaybackFallback();
        }}
        onEnded={() => {
          setIsPlaying(false);
          setIsBuffering(false);
          onEnded?.();
        }}
        onProgress={() => {
          if (videoRef.current && videoRef.current.buffered.length > 0) {
            setBufferedEnd(
              videoRef.current.buffered.end(
                videoRef.current.buffered.length - 1
              )
            );
          }
        }}
        onTimeUpdate={() => {
          if (videoRef.current) {
            const current = videoRef.current.currentTime;
            const dur = videoRef.current.duration || duration;
            setCurrentTime(current);
            if (dur && dur !== duration) setDuration(dur);
            onTimeUpdate?.(current, dur);
          }
        }}
      />

      {/* Buffering Spinner: only show when actively playing and stalled */}
      {isBuffering && isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/25 backdrop-blur-[2px] z-10">
          <Loader2
            className="w-12 h-12 animate-spin"
            style={{ color: effectivePrimaryColor }}
          />
        </div>
      )}

      {/* Center Action Pulse Indicator */}
      {pulseIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="w-16 h-16 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-white scale-125 animate-out fade-out zoom-out duration-300">
            {pulseIcon === "play" ? (
              <Play className="w-8 h-8 fill-white ml-0.5" />
            ) : (
              <Pause className="w-8 h-8 fill-white" />
            )}
          </div>
        </div>
      )}

      {/* Center Big Play Button Overlay (when paused & not loading) */}
      {!isPlaying && !error && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/25 transition-all hover:bg-black/35 z-10"
        >
          {effectivePlayIconStyle === "minimal" ? (
            <div
              style={{ backgroundColor: effectivePrimaryColor }}
              className="w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 hover:scale-110 hover:shadow-cyan-500/25 ring-4 ring-white/10"
            >
              <Play className="w-8 h-8 text-white fill-white ml-1" />
            </div>
          ) : effectivePlayIconStyle === "glow" ? (
            <div
              style={{
                backgroundColor: effectivePrimaryColor,
                boxShadow: `0 0 35px ${effectivePrimaryColor}`,
              }}
              className="w-20 h-20 rounded-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ring-2 ring-white/20"
            >
              <PlaySquare className="w-10 h-10 text-white fill-white" />
            </div>
          ) : (
            <div
              style={{ backgroundColor: effectivePrimaryColor }}
              className="w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 hover:scale-110 hover:brightness-110 ring-4 ring-white/20"
            >
              <PlayCircle className="w-12 h-12 text-white fill-white" />
            </div>
          )}
        </button>
      )}

      {/* Watermark Branding */}
      {effectiveIsFreeTier ? (
        <div
          className={`absolute ${getWatermarkPositionClasses(
            effectiveWatermarkPosition
          )} pointer-events-none z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-md border border-white/10 text-xs font-semibold text-white tracking-wide shadow-xl`}
        >
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ backgroundColor: effectivePrimaryColor }}
          />
          {propWatermarkText || "Powered by Vedora"}
        </div>
      ) : (
        effectiveWatermarkUrl && (
          <div
            className={`absolute ${getWatermarkPositionClasses(
              effectiveWatermarkPosition
            )} pointer-events-none z-20`}
            style={{ opacity: effectiveWatermarkOpacity / 100 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={effectiveWatermarkUrl}
              alt="Brand Watermark"
              className="max-h-10 max-w-[140px] object-contain drop-shadow-lg"
            />
          </div>
        )
      )}

      {/* Playback Error / Status Overlay */}
      {error && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6 text-center z-30">
          <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
          <h3 className="text-base font-semibold mb-1">Playback Status</h3>
          <p className="text-xs text-gray-300 max-w-sm mb-4 leading-relaxed">
            {error}
          </p>
          {/* Fallback demo stream button */}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setIsBuffering(false);
              if (videoRef.current) {
                if (hlsRef.current) {
                  hlsRef.current.destroy();
                  hlsRef.current = null;
                }
                videoRef.current.src = SAMPLE_STREAM_MP4;
                videoRef.current.load();
                videoRef.current.play().catch(() => {});
              }
            }}
            className="px-4 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 border border-white/15 rounded-md transition"
          >
            Load Sample Stream Preview
          </button>
        </div>
      )}

      {/* Control Bar Overlay */}
      <div
        style={{
          background: effectiveControlBarBg,
        }}
        className={`absolute bottom-0 inset-x-0 p-3 pt-3 backdrop-blur-md transition-all duration-300 z-30 ${
          showControls || !isPlaying
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-2 pointer-events-none"
        }`}
      >
        {/* Interactive Scrubber & Timeline Bar */}
        {isControlEnabled("Progress") && (
          <div
            ref={progressBarRef}
            onClick={handleSeek}
            onMouseMove={handleMouseMoveProgress}
            onMouseLeave={handleMouseLeaveProgress}
            className="relative w-full h-3 flex items-center cursor-pointer group/progress mb-2"
          >
            {/* Track background */}
            <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden relative transition-all group-hover/progress:h-2">
              {/* Buffer Progress */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-white/30 rounded-full transition-all duration-200"
                style={{
                  width: `${
                    duration > 0 ? (bufferedEnd / duration) * 100 : 0
                  }%`,
                }}
              />
              {/* Current Playback Progress */}
              <div
                className="absolute top-0 bottom-0 left-0 rounded-full"
                style={{
                  width: `${
                    duration > 0 ? (currentTime / duration) * 100 : 0
                  }%`,
                  backgroundColor: effectivePrimaryColor,
                }}
              />
            </div>

            {/* Scrubber Thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md scale-0 group-hover/progress:scale-100 transition-transform pointer-events-none"
              style={{
                left: `calc(${
                  duration > 0 ? (currentTime / duration) * 100 : 0
                }% - 7px)`,
                boxShadow: `0 0 8px ${effectivePrimaryColor}`,
              }}
            />

            {/* Hover Timestamp Tooltip */}
            {hoverTime !== null && (
              <div
                className="absolute bottom-5 -translate-x-1/2 px-2 py-0.5 rounded bg-black/90 text-[11px] font-mono font-medium text-white shadow-lg pointer-events-none border border-white/10"
                style={{ left: `${hoverPosition}%` }}
              >
                {formatTime(hoverTime)}
              </div>
            )}
          </div>
        )}

        {/* Action Controls Row */}
        <div className="flex items-center justify-between text-white text-sm">
          {/* Left Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {isControlEnabled("Play / Pause") && (
              <button
                type="button"
                onClick={togglePlay}
                className="p-1.5 hover:bg-white/15 rounded-lg transition active:scale-95"
                title={isPlaying ? "Pause (k / Space)" : "Play (k / Space)"}
              >
                {isPlaying ? (
                  <Pause size={18} fill="white" />
                ) : (
                  <Play size={18} fill="white" />
                )}
              </button>
            )}

            {isControlEnabled("10s Backward") && (
              <button
                type="button"
                onClick={() => skip(-10)}
                className="p-1.5 hover:bg-white/15 rounded-lg transition text-gray-300 hover:text-white active:scale-95"
                title="Rewind 10s (j / Left Arrow)"
              >
                <RotateCcw size={16} />
              </button>
            )}

            {isControlEnabled("10s Forward") && (
              <button
                type="button"
                onClick={() => skip(10)}
                className="p-1.5 hover:bg-white/15 rounded-lg transition text-gray-300 hover:text-white active:scale-95"
                title="Fast Forward 10s (l / Right Arrow)"
              >
                <RotateCw size={16} />
              </button>
            )}

            {/* Volume Control */}
            {(isControlEnabled("Volume") || isControlEnabled("Mute")) && (
              <div className="flex items-center gap-1 group/volume">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="p-1.5 hover:bg-white/15 rounded-lg transition"
                  title={isMuted ? "Unmute (m)" : "Mute (m)"}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX size={18} className="text-red-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 size={18} />
                  ) : (
                    <Volume2 size={18} />
                  )}
                </button>
                {isControlEnabled("Volume") && (
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    style={{ accentColor: effectivePrimaryColor }}
                    aria-label="Volume slider"
                    className="w-14 sm:w-20 h-1 bg-white/20 rounded cursor-pointer opacity-75 group-hover/volume:opacity-100 transition"
                  />
                )}
              </div>
            )}

            {/* Time Indicator */}
            {(isControlEnabled("Current Time") ||
              isControlEnabled("Duration")) && (
              <button
                type="button"
                onClick={() => setShowRemainingTime((prev) => !prev)}
                className="text-xs text-gray-300 font-mono hover:text-white transition ml-1"
                title="Click to toggle remaining time"
              >
                {formatTime(currentTime)} /{" "}
                {showRemainingTime
                  ? `-${formatTime(Math.max(0, duration - currentTime))}`
                  : formatTime(duration)}
              </button>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-1 sm:gap-2 relative">
            {/* Playback Speed Controller */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowSpeedMenu((prev) => !prev);
                  setShowQualityMenu(false);
                }}
                className="px-2 py-1 hover:bg-white/15 rounded-md transition text-xs font-semibold flex items-center gap-1"
                title="Playback Speed"
              >
                <FastForward size={14} />
                <span>{playbackSpeed}x</span>
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-10 right-0 bg-[#12141a] border border-white/15 rounded-lg shadow-2xl py-1 w-28 text-xs z-50 backdrop-blur-xl">
                  <div className="px-3 py-1 font-semibold text-gray-400 border-b border-white/10 text-[10px] uppercase">
                    Speed
                  </div>
                  {PLAYBACK_SPEEDS.map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      onClick={() => handleSpeedChange(speed)}
                      className="w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center justify-between transition"
                    >
                      <span>{speed === 1 ? "1.0x (Normal)" : `${speed}x`}</span>
                      {playbackSpeed === speed && (
                        <Check
                          size={14}
                          style={{ color: effectivePrimaryColor }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quality Selector (HLS Streams) */}
            {isControlEnabled("Settings") && qualityLevels.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowQualityMenu((prev) => !prev);
                    setShowSpeedMenu(false);
                  }}
                  className="p-1.5 hover:bg-white/15 rounded-lg transition text-xs font-semibold flex items-center gap-1"
                  title="Quality Settings"
                >
                  <Settings size={16} />
                  <span className="hidden sm:inline">
                    {selectedQuality === -1
                      ? "Auto"
                      : qualityLevels.find((q) => q.index === selectedQuality)
                          ?.label || "Auto"}
                  </span>
                </button>

                {showQualityMenu && (
                  <div className="absolute bottom-10 right-0 bg-[#12141a] border border-white/15 rounded-lg shadow-2xl py-1 w-32 text-xs z-50 backdrop-blur-xl">
                    <div className="px-3 py-1 font-semibold text-gray-400 border-b border-white/10 text-[10px] uppercase">
                      Quality
                    </div>
                    <button
                      type="button"
                      onClick={() => changeQuality(-1)}
                      className="w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center justify-between transition"
                    >
                      <span>Auto</span>
                      {selectedQuality === -1 && (
                        <Check
                          size={14}
                          style={{ color: effectivePrimaryColor }}
                        />
                      )}
                    </button>
                    {qualityLevels.map((lvl) => (
                      <button
                        key={lvl.index}
                        type="button"
                        onClick={() => changeQuality(lvl.index)}
                        className="w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center justify-between transition"
                      >
                        <span>{lvl.label}</span>
                        {selectedQuality === lvl.index && (
                          <Check
                            size={14}
                            style={{ color: effectivePrimaryColor }}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Picture-in-Picture */}
            <button
              type="button"
              onClick={togglePiP}
              className="p-1.5 hover:bg-white/15 rounded-lg transition hidden sm:inline-flex"
              title="Picture in Picture (p)"
            >
              <PictureInPicture size={16} />
            </button>

            {/* Fullscreen Toggle */}
            {isControlEnabled("Full Screen") && (
              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-1.5 hover:bg-white/15 rounded-lg transition active:scale-95"
                title={isFullscreen ? "Exit Fullscreen (f)" : "Fullscreen (f)"}
              >
                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
