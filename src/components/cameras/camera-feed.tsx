// Live feed surface for one camera.
//
// Browsers play HLS natively only on Safari, so an .m3u8 feed loads hls.js
// lazily in the browser (never during server rendering). MP4 and MJPEG play
// directly; an embed address is shown in an iframe. When no playable address is
// recorded the card says so instead of rendering an empty black box.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, VideoOff } from "lucide-react";
import { cameraStreamKind, type CameraRow } from "@/lib/cameras";

export function CameraFeed({ camera }: { camera: CameraRow }) {
  const kind = cameraStreamKind(camera);
  const url = String(camera.stream_url ?? "").trim();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (kind !== "hls" || !url) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      return;
    }
    let cancelled = false;
    let instance: { destroy: () => void } | null = null;
    void (async () => {
      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (cancelled || !Hls.isSupported()) {
          if (!cancelled) setError("This browser cannot play the live stream.");
          return;
        }
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        instance = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) setError("The live stream did not answer.");
        });
      } catch {
        if (!cancelled) setError("The live stream player could not be loaded.");
      }
    })();
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [kind, url]);

  if (kind === "none" || !url) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground">
        <VideoOff className="h-6 w-6" aria-hidden />
        <p className="px-4 text-center text-xs">
          No feed address recorded for {camera.camera_id}. Add one to watch it here.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 text-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden />
        <p className="px-4 text-center text-xs">{error}</p>
      </div>
    );
  }

  if (kind === "mjpeg") {
    return (
      <img
        src={url}
        alt={`Live view from ${camera.name}`}
        className="aspect-video w-full rounded-md border border-border bg-muted object-cover"
        onError={() => setError("The camera image did not load.")}
      />
    );
  }

  if (kind === "embed") {
    return (
      <iframe
        src={url}
        title={`Live view from ${camera.name}`}
        className="aspect-video w-full rounded-md border border-border bg-muted"
        allow="autoplay; fullscreen; picture-in-picture"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <video
      ref={videoRef}
      className="aspect-video w-full rounded-md border border-border bg-muted object-cover"
      src={kind === "mp4" ? url : undefined}
      poster={camera.snapshot_url ?? undefined}
      controls
      muted
      autoPlay
      playsInline
      onError={() => setError("The camera feed did not load.")}
    />
  );
}
