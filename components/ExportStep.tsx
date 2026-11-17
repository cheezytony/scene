"use client";

import { useState } from "react";
import type { Scene } from "@/lib/schema";
import { baseName, sceneJson, sceneSummary, shotListCsv, transcriptMarkdown } from "@/lib/export";
import { downloadText } from "@/lib/download";
import { card, ghostBtn, primaryBtn } from "./ui";

interface Format {
  id: string;
  title: string;
  blurb: string;
  ext: string;
  mime: string;
  build: (scene: Scene) => string;
  /** Only offered when the scene has something to put in it. */
  has?: (scene: Scene) => boolean;
  /** Offer a copy-to-clipboard button too (only for things you would paste somewhere). */
  copyable?: boolean;
}

const FORMATS: Format[] = [
  {
    id: "scene",
    title: "Scene file",
    blurb: "Everything, exactly as it is now. Open it again later and keep going.",
    ext: "json",
    mime: "application/json",
    build: sceneJson,
  },
  {
    id: "transcript",
    title: "Transcript",
    blurb: "The story in reading order, beat by beat, with timings. Lovely for sharing.",
    ext: "md",
    mime: "text/markdown",
    build: transcriptMarkdown,
    has: (s) => s.transcript.length > 0,
    copyable: true,
  },
  {
    id: "shots",
    title: "Shot list",
    blurb: "Every camera with its timing, position and direction, ready for a spreadsheet.",
    ext: "csv",
    mime: "text/csv",
    build: shotListCsv,
    has: (s) => s.cameras.length > 0,
  },
];

/** Step four: take it with you. */
export default function ExportStep({
  scene,
  onBack,
  onNewScene,
  onMovie,
}: {
  scene: Scene;
  onBack: () => void;
  onNewScene: () => void;
  onMovie: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const s = sceneSummary(scene);
  const stem = baseName(scene);

  async function copy(f: Format) {
    try {
      await navigator.clipboard.writeText(f.build(scene));
      setCopied(f.id);
      window.setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 2000);
    } catch {
      // Clipboard access can be blocked; downloading still works.
    }
  }

  return (
    <section className="rise mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="font-heading text-5xl tracking-tight sm:text-6xl">Take it with you.</h1>
        <p className="mx-auto max-w-xl text-lg text-white/55">
          {scene.title ? <em className="font-heading not-italic text-white/80">{scene.title}</em> : "Your scene"} is {s.duration} long, with{" "}
          {s.beats} beat{s.beats === 1 ? "" : "s"}, {s.characters} character{s.characters === 1 ? "" : "s"}, {s.objects} object
          {s.objects === 1 ? "" : "s"} and {s.cameras} camera{s.cameras === 1 ? "" : "s"}.
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {FORMATS.filter((f) => !f.has || f.has(scene)).map((f) => (
          <li key={f.id} className={`${card} flex flex-wrap items-center justify-between gap-4 px-6 py-5`}>
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-2xl">
                {f.title} <span className="ml-1 font-sans text-xs uppercase tracking-[0.12em] text-white/30">.{f.ext}</span>
              </h2>
              <p className="mt-1 text-sm text-white/50">{f.blurb}</p>
            </div>
            <div className="flex gap-2">
              {f.copyable && (
                <button onClick={() => void copy(f)} className={ghostBtn}>
                  {copied === f.id ? "Copied" : "Copy"}
                </button>
              )}
              <button onClick={() => downloadText(`${stem}.${f.ext}`, f.build(scene), f.mime)} className={primaryBtn}>
                Download
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className={`${card} flex flex-wrap items-center justify-between gap-4 px-6 py-5`}>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-2xl">Make it a film</h2>
          <p className="mt-1 text-sm text-white/50">Use your scene to direct an AI video model, shot by shot. You&apos;ll see the cost first.</p>
        </div>
        <button onClick={onMovie} className={primaryBtn}>
          Continue <span aria-hidden>→</span>
        </button>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={onBack} className={ghostBtn}>
          <span aria-hidden>←</span> Back to the preview
        </button>
        {!confirmNew ? (
          <button onClick={() => setConfirmNew(true)} className="text-sm text-white/40 underline-offset-4 hover:text-white/70 hover:underline">
            Start a new scene
          </button>
        ) : (
          <span className="flex items-center gap-3 text-sm text-white/60">
            Clear this scene and begin again?
            <button onClick={onNewScene} className="text-white underline underline-offset-4">
              Yes, fresh start
            </button>
            <button onClick={() => setConfirmNew(false)} className="text-white/50 underline underline-offset-4">
              Keep it
            </button>
          </span>
        )}
      </div>
    </section>
  );
}
