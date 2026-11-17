"use client";

import { useEffect, useRef, useState } from "react";
import { pricesFor } from "@/lib/catalog";
import { OUTPUT_INFO, presentOutputs, type OutputId } from "@/lib/outputs";
import { estimateMovie, type Clip } from "@/lib/movie";
import { formatTokens } from "@/lib/cost";
import type { Prefs } from "@/lib/prefs";
import type { Scene } from "@/lib/schema";
import CostPanel, { Money } from "./CostPanel";
import { PreviewModelPicker, VideoModelPicker, type Ready } from "./ModelPicker";
import { card, field, ghostBtn, primaryBtn } from "./ui";

type ClipStatus = "waiting" | "rendering" | "done" | "failed";
interface Shot extends Clip {
  status: ClipStatus;
  url?: string;
  error?: string;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (window.clearTimeout(t), reject(new DOMException("Cancelled", "AbortError"))), { once: true });
  });

/** Step five: turn the scene into a film, using as much of it as you choose. */
export default function MovieStep({
  scene,
  prefs,
  onPrefs,
  ready,
  accessCode,
  onBack,
}: {
  scene: Scene;
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
  ready: Ready;
  accessCode: string;
  onBack: () => void;
}) {
  const have = presentOutputs(scene);
  // Only what the scene actually contains can feed the movie.
  const inputs = {
    beats: true,
    transcript: prefs.movieInputs.transcript && have.transcript,
    cast: prefs.movieInputs.cast && have.cast,
    cameras: prefs.movieInputs.cameras && have.cameras && have.cast && prefs.movieInputs.cast,
  };
  const [style, setStyle] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [playing, setPlaying] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const blobs = useRef<string[]>([]);

  useEffect(() => () => blobs.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const est = estimateMovie(scene, inputs, prefs.preview, prefs.video);
  const rate = prefs.usdToNgn;
  const headers = { "Content-Type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) };
  const patch = (id: string, p: Partial<Shot>) => setShots((all) => all.map((s) => (s.id === id ? { ...s, ...p } : s)));

  async function api<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const data = JSON.parse((await res.text()) || "null") as (T & { error?: string }) | null;
    if (!res.ok) throw new Error(data?.error ?? `The server hit a snag (${res.status}).`);
    return data as T;
  }

  async function render(clip: Clip, signal: AbortSignal) {
    patch(clip.id, { status: "rendering", error: undefined });
    try {
      const { id } = await api<{ id: string }>("/api/movie/start", {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({ provider: prefs.video.provider, model: prefs.video.model, prompt: clip.prompt, seconds: clip.seconds }),
      });
      for (let i = 0; i < 150; i++) {
        await sleep(4000, signal);
        const r = await api<{ state: "running" | "done" | "failed"; url?: string; error?: string }>(
          `/api/movie/status?provider=${prefs.video.provider}&id=${encodeURIComponent(id)}`,
          { headers, signal },
        );
        if (r.state === "failed") throw new Error(r.error ?? "The clip failed.");
        if (r.state === "done" && r.url) {
          let url = r.url;
          if (url.startsWith("/")) {
            // Our own route needs the access code, which a plain <video src> can't send.
            const res = await fetch(url, { headers, signal });
            if (!res.ok) throw new Error("The finished clip couldn't be fetched.");
            url = URL.createObjectURL(await res.blob());
            blobs.current.push(url);
          }
          patch(clip.id, { status: "done", url });
          return;
        }
      }
      throw new Error("This shot is taking too long.");
    } catch (e) {
      if (signal.aborted) throw e;
      patch(clip.id, { status: "failed", error: e instanceof Error ? e.message : "The clip failed." });
    }
  }

  async function make() {
    setConfirming(false);
    setError(null);
    setRunning(true);
    setShots([]);
    setPlaying(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const plan = await api<{ clips: Clip[] }>("/api/movie/plan", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({ scene, inputs, style, maxClipSec: prefs.video.maxClipSec, model: prefs.preview }),
      });
      setShots(plan.clips.map((c) => ({ ...c, status: "waiting" as const })));
      // A few shots at a time, so a long film doesn't hit the service's limits.
      let next = 0;
      const worker = async () => {
        while (next < plan.clips.length) await render(plan.clips[next++], controller.signal);
      };
      await Promise.all(Array.from({ length: Math.min(3, plan.clips.length) }, worker));
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  const done = shots.filter((s) => s.status === "done");
  const player = shots.filter((s) => s.url);
  const current = player[Math.min(playing, player.length - 1)];
  const missingPrice = prefs.video.perSecond === null;

  return (
    <section className="rise mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="font-heading text-5xl tracking-tight sm:text-6xl">Now, the film.</h1>
        <p className="mx-auto max-w-xl text-lg text-white/55">
          We&apos;ll write a prompt for every shot from your scene, then have a video model film them. The more of your scene you feed it, the closer the film
          sticks to what you built, and the more it costs.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-2xl">What should it follow?</h2>
        <ul className={`${card} divide-y divide-white/8`}>
          {OUTPUT_INFO.map((o) => {
            const available = have[o.id] && (o.id !== "cameras" || have.cast);
            const checked = inputs[o.id];
            return (
              <li key={o.id}>
                <label className={`flex items-start gap-4 px-5 py-4 ${o.locked || !available ? "" : "cursor-pointer"} ${available ? "" : "opacity-45"}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={o.locked || !available || running}
                    onChange={(e) => onPrefs({ ...prefs, movieInputs: { ...prefs.movieInputs, [o.id as OutputId]: e.target.checked } })}
                    className="mt-1 h-4 w-4 accent-[#ece7df]"
                  />
                  <span>
                    <span className="block text-[15px]">{o.label}</span>
                    <span className="block text-sm text-white/40">{available ? o.hint : "This scene was made without it."}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-2xl">Who films it?</h2>
        <div className={`${card} flex flex-col gap-5 p-5`}>
          <div>
            <p className="mb-2 text-sm text-white/55">Video model</p>
            <VideoModelPicker value={prefs.video} onChange={(video) => onPrefs({ ...prefs, video })} ready={ready} />
          </div>
          <div className="-mx-5 border-t border-white/8" />
          <div className="-mx-5 -mb-4">
            <p className="mb-0 px-5 text-sm text-white/55">Director (writes each shot&apos;s prompt)</p>
            <PreviewModelPicker value={prefs.preview} onChange={(preview) => onPrefs({ ...prefs, preview })} ready={ready} />
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-2">
        <span className="font-heading text-2xl">A word on the look</span>
        <input
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          maxLength={600}
          placeholder="e.g. soft 35mm film, warm tungsten light, handheld"
          className={`${field} w-full`}
        />
      </label>

      <CostPanel
        title="Estimated cost of the film"
        usd={est.totalUsd === null ? null : { low: est.totalUsd * 0.85, high: est.totalUsd * 1.3 }}
        rate={rate}
        onRate={(usdToNgn) => onPrefs({ ...prefs, usdToNgn })}
        footnote="Video is billed per second, so the shots below are the main cost. Some services charge for failed clips."
        rows={[
          { label: `Shots (${est.clips}), ${Math.round(est.seconds)}s of video`, value: <Money usd={est.videoUsd} rate={rate} /> },
          {
            label: `Director: ${formatTokens(est.director.input)} tokens in, ${formatTokens(est.director.output)} out`,
            value: <Money usd={est.directorUsd} rate={rate} />,
          },
          ...(missingPrice ? [{ label: "Tip", value: "enter the video model's price to count it" }] : []),
          ...(pricesFor(prefs.preview).known ? [] : [{ label: "Tip", value: "enter the director's prices to count it" }]),
        ]}
      />

      {error && (
        <p role="alert" className="rounded-2xl bg-amber-400/10 px-5 py-4 text-sm text-amber-100/90">
          {error} Nothing is lost; try again whenever you like.
        </p>
      )}

      {shots.length > 0 && (
        <div className="flex flex-col gap-4">
          {current && (
            <video
              key={current.id}
              src={current.url}
              controls
              autoPlay={playing > 0}
              onEnded={() => setPlaying((p) => (p + 1 < player.length ? p + 1 : p))}
              className="aspect-video w-full rounded-2xl bg-black"
            />
          )}
          <p className="text-sm text-white/50">
            {done.length} of {shots.length} shots ready{current ? `. Playing shot ${playing + 1} of ${player.length}; the next follows on its own.` : "."}
          </p>
          <ul className={`${card} divide-y divide-white/8 text-sm`}>
            {shots.map((s, i) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="text-white/80">Shot {i + 1}</span> <span className="text-white/40">· {s.seconds}s · {s.prompt.slice(0, 90)}…</span>
                  {s.error && <span className="block text-amber-200/80">{s.error}</span>}
                </span>
                <span className="flex items-center gap-3 text-white/55">
                  {s.status === "rendering" && <span className="breathe">filming…</span>}
                  {s.status === "waiting" && "waiting"}
                  {s.status === "done" && s.url && (
                    <a href={s.url} download={`shot-${i + 1}.mp4`} className="underline underline-offset-4 hover:text-white">
                      Download
                    </a>
                  )}
                  {s.status === "failed" && !running && (
                    <button
                      onClick={() => {
                        const c = new AbortController();
                        abort.current = c;
                        void render(s, c.signal).catch(() => {});
                      }}
                      className="underline underline-offset-4 hover:text-white"
                    >
                      Try again
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <button onClick={onBack} className={ghostBtn}>
          <span aria-hidden>←</span> Back
        </button>
        {running ? (
          <button onClick={() => abort.current?.abort()} className={ghostBtn}>
            Stop (shots already started are still billed)
          </button>
        ) : confirming ? (
          <span className="flex flex-wrap items-center justify-end gap-3 text-sm text-white/65">
            This will spend about <Money usd={est.totalUsd} rate={rate} />.
            <button onClick={() => void make()} className={primaryBtn}>
              Yes, make it
            </button>
            <button onClick={() => setConfirming(false)} className="text-white/50 underline underline-offset-4">
              Not yet
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} disabled={!prefs.video.model.trim()} className={primaryBtn}>
            {shots.length ? "Make it again" : "Make the movie"}
          </button>
        )}
      </div>
    </section>
  );
}
