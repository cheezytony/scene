"use client";

import { useRef, useState } from "react";
import { field, primaryBtn } from "./ui";

const MIN_CHARS = 20;
export const scriptReady = (script: string) => script.trim().length >= MIN_CHARS;

/** Step one: bring a script. Everything else follows from it. */
export default function ScriptStep({
  script,
  onScript,
  onExample,
  onImportFile,
  onContinue,
  importError,
  onWriteScript,
}: {
  script: string;
  onScript: (s: string) => void;
  onExample: () => void;
  onImportFile: (file: File) => void;
  onContinue: () => void;
  importError: string | null;
  /** Writes a short script from an idea. Rejects with a readable message if it can't. */
  onWriteScript: (idea: string) => Promise<string>;
}) {
  const [mode, setMode] = useState<"script" | "idea">("script");
  const [idea, setIdea] = useState("");
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  async function write() {
    setWriting(true);
    setWriteError(null);
    try {
      onScript(await onWriteScript(idea));
      setMode("script"); // show what was written, ready to read and edit
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : "That didn't work. Try again in a moment.");
    } finally {
      setWriting(false);
    }
  }

  const fileInput = useRef<HTMLInputElement>(null);
  const lines = script.split("\n").filter((l) => l.trim()).length;
  const minutes = Math.max(1, Math.round(lines / 55));
  const ready = scriptReady(script);

  return (
    <section className="rise mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="font-heading text-5xl tracking-tight sm:text-6xl">Let&apos;s start with your script.</h1>
        <p className="mx-auto max-w-xl text-lg text-white/55">
          Paste a scene, a few pages, or a whole act. We&apos;ll turn it into something you can walk around in.
        </p>
      </header>

      <div role="tablist" aria-label="How to begin" className="mx-auto flex gap-1 rounded-full border border-white/10 p-1 text-sm">
        {(["script", "idea"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full px-5 py-1.5 transition-colors ${mode === m ? "bg-white/12 text-white" : "text-white/55 hover:text-white"}`}
          >
            {m === "script" ? "I have a script" : "I just have an idea"}
          </button>
        ))}
      </div>

      {mode === "idea" ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-2xl bg-white/[0.04] px-5 py-4 text-sm leading-relaxed text-white/65">
            A short idea gives us less to go on, so we&apos;ll write a short script from it first, and it may come out a little generic.
            Nothing is final: you&apos;ll read it here, change anything you like, and only then carry on.
          </p>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            maxLength={4000}
            aria-label="Your idea"
            placeholder="Two strangers share an umbrella on the last train home, and one of them is carrying a secret."
            className={`${field} h-40 w-full resize-none rounded-2xl p-5 text-base leading-relaxed`}
          />
          {writeError && <p role="alert" className="rounded-xl bg-amber-400/10 px-4 py-3 text-sm text-amber-100/90">{writeError}</p>}
          <div className="flex justify-center">
            <button onClick={() => void write()} disabled={writing || idea.trim().length < 5} className={primaryBtn}>
              {writing ? "Writing…" : "Write me a script"}
            </button>
          </div>
        </div>
      ) : (
      <>
      <div className="flex flex-col gap-3">
        <textarea
          value={script}
          onChange={(e) => onScript(e.target.value)}
          spellCheck={false}
          autoFocus
          aria-label="Your script"
          placeholder={"INT. KITCHEN - MORNING\n\nSteam curls off a pot of coffee. MARA reads a letter she has read a dozen times…"}
          className="h-[46vh] min-h-72 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.03] p-6 font-mono text-[13px] leading-relaxed text-white/90 placeholder:text-white/25 focus:border-white/25 focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/40">
          <span>
            {ready
              ? `${lines} line${lines === 1 ? "" : "s"}, roughly ${minutes} minute${minutes === 1 ? "" : "s"} of screen time`
              : "A few lines is plenty to begin."}
          </span>
          <span className="flex gap-4">
            <button onClick={onExample} className="underline-offset-4 transition-colors hover:text-white/80 hover:underline">
              Try the example
            </button>
            <button onClick={() => fileInput.current?.click()} className="underline-offset-4 transition-colors hover:text-white/80 hover:underline">
              Open a saved scene
            </button>
          </span>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = ""; // so the same file can be chosen again
          }}
        />
        {importError && <p className="rounded-xl bg-amber-400/10 px-4 py-3 text-sm text-amber-100/90">{importError}</p>}
      </div>

      <div className="flex justify-center">
        <button onClick={onContinue} disabled={!ready} className={primaryBtn}>
          Continue
          <span aria-hidden>→</span>
        </button>
      </div>
      </>
      )}
    </section>
  );
}
