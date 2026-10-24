"use client";

import React, { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { VedoraPlayer } from "@/components/player/vedora-player";

function EmbedPlayerContent() {
  const params = useParams();
  const searchParams = useSearchParams();

  const rawVideoId = params?.videoid;
  const videoId = Array.isArray(rawVideoId) ? rawVideoId[0] : rawVideoId;

  // Read embed configuration options from query string
  const autoplay =
    searchParams.get("autoplay") === "1" ||
    searchParams.get("autoplay") === "true";
  const muted =
    searchParams.get("muted") === "1" ||
    searchParams.get("muted") === "true";
  const loop =
    searchParams.get("loop") === "1" ||
    searchParams.get("loop") === "true";
  const startTime = Number(searchParams.get("t") || searchParams.get("start") || 0);
  const colorOverride = searchParams.get("color") || searchParams.get("primaryColor");

  if (!videoId) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-white text-sm">
        Video ID missing
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-black m-0 p-0 overflow-hidden">
      <VedoraPlayer
        videoId={videoId}
        autoplay={autoplay}
        muted={muted}
        loop={loop}
        startTime={startTime}
        primaryColor={colorOverride || undefined}
        className="w-full h-full"
      />
    </div>
  );
}

export default function EmbedPlayerPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-black flex items-center justify-center text-white">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <EmbedPlayerContent />
    </Suspense>
  );
}
