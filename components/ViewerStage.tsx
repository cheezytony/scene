"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { fmtTime } from "./ui";

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

const fullscreenElement = () => document.fullscreenElement ?? (document as FsDocument).webkitFullscreenElement ?? null;

export interface StageControls {
  playing: boolean;
  onTogglePlay: () => void;
  t: number;
  duration: number;
  onSeek: (n: number) => void;
  viewMode: "orbit" | "shot";
  onToggleView: () => void;
  canUseCameraView: boolean;
}

/**
 * The big window onto the scene. It takes as much width as the page allows, can go full screen
 * (button, or the F key), and keeps its playback controls floating over the picture. In full
 * screen the controls tuck away after a moment of stillness and return when the pointer moves.
 */
export default function ViewerStage({
  controls: c,
  hint,
  children,
}: {
  controls: StageControls;
  hint?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // `native` is the browser's own full screen; `filled` is our fallback that fills the window
  // instead, for browsers that can't (iPhone Safari) or won't (embedded views, frames) go native.
  const [native, setNative] = useState(false);
  const [filled, setFilled] = useState(false);
  const full = native || filled;
  const [idle, setIdle] = useState(false);
  const timer = useRef(0);

  const toggle = useCallback(async () => {
    const el = ref.current as FsElement | null;
    if (!el) return;
    if (fullscreenElement()) {
      try {
        await (document.exitFullscreen?.() ?? (document as FsDocument).webkitExitFullscreen?.());
      } catch {
        // Already leaving.
      }
      return;
    }
    if (filled) {
      setFilled(false);
      return;
    }
    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (!request) {
      setFilled(true);
      return;
    }
    // Native full screen answers within a moment. If it refuses, or never answers (some embedded
    // views just wait on a permission), fill the window ourselves instead of leaving the button dead.
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => request.call(el))
        .then(
          () => "ok" as const,
          () => "refused" as const,
        ),
      new Promise<"slow">((resolve) => window.setTimeout(() => resolve("slow"), 600)),
    ]);
    if (outcome !== "ok") setFilled(true);
  }, [filled]);

  // Fill-the-window mode needs its own way out (Esc) and shouldn't let the page scroll behind it.
  useEffect(() => {
    if (!filled) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFilled(false);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [filled]);

  useEffect(() => {
    const onChange = () => {
      const isNative = fullscreenElement() === ref.current;
      setNative(isNative);
      if (isNative) setFilled(false); // the real thing arrived after all
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "f") return;
      const el = e.target as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      void toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), 2600);
  }, []);

  const hidden = full && idle;

  return (
    <div
      ref={ref}
      onPointerMove={wake}
      // `fixed` and `relative` must never be on together (the later rule would win), so pick one.
      className={`overflow-hidden bg-[#0e1117] ${
        filled
          ? "fixed inset-0 z-50"
          : native
            ? "relative h-screen w-screen"
            : "relative h-[clamp(440px,72vh,920px)] rounded-3xl border border-white/10 shadow-2xl shadow-black/40"
      }`}
    >
      {children}

      {hint && (
        <p className={`pointer-events-none absolute left-5 top-4 text-xs text-white/45 transition-opacity duration-500 ${hidden ? "opacity-0" : "opacity-100"}`}>
          {hint}
        </p>
      )}

      <div
        className={`absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-2xl bg-black/45 px-4 py-2.5 text-sm backdrop-blur-md transition-opacity duration-500 sm:inset-x-5 sm:bottom-5 ${
          hidden ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <button
          onClick={c.onTogglePlay}
          aria-label={c.playing ? "Pause" : "Play"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ece7df] text-[#14161b] transition hover:bg-white"
        >
          {c.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span className="w-11 shrink-0 text-right text-xs tabular-nums text-white/70">{fmtTime(c.t)}</span>
        <input
          type="range"
          aria-label="Timeline"
          min={0}
          max={c.duration}
          step={0.05}
          value={c.t}
          onChange={(e) => c.onSeek(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="w-11 shrink-0 text-xs tabular-nums text-white/45">{fmtTime(c.duration)}</span>
        <button
          onClick={c.onToggleView}
          disabled={!c.canUseCameraView}
          title="Switch between exploring freely and seeing through the scripted cameras"
          className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          {c.viewMode === "orbit" ? "Exploring" : "Through the camera"}
        </button>
        <button
          onClick={() => void toggle()}
          aria-label={full ? "Exit full screen" : "Full screen"}
          title={full ? "Exit full screen (F or Esc)" : "Full screen (F)"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/80 transition-colors hover:bg-white/10"
        >
          {full ? <ExitIcon /> : <EnterIcon />}
        </button>
      </div>
    </div>
  );
}

const icon = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function PlayIcon() {
  return (
    <svg {...icon} fill="currentColor" stroke="none" aria-hidden>
      <path d="M5 3.2v9.6a.5.5 0 0 0 .77.42l7.2-4.8a.5.5 0 0 0 0-.84l-7.2-4.8A.5.5 0 0 0 5 3.2Z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg {...icon} fill="currentColor" stroke="none" aria-hidden>
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}
function EnterIcon() {
  return (
    <svg {...icon} aria-hidden>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </svg>
  );
}
function ExitIcon() {
  return (
    <svg {...icon} aria-hidden>
      <path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" />
    </svg>
  );
}
