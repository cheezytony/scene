"use client";

import { useEffect, useState } from "react";
import { MAKING_LINES } from "@/lib/voice";
import { ghostBtn } from "./ui";

const SECONDS_PER_LINE = 7;

/** While the scene is being made: unhurried, honest about how long it can take, and easy to leave. */
export default function GeneratingView({ onCancel }: { onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const line = MAKING_LINES[Math.min(Math.floor(elapsed / SECONDS_PER_LINE), MAKING_LINES.length - 1)];
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <section className="rise mx-auto flex min-h-[55vh] w-full max-w-xl flex-col items-center justify-center gap-8 text-center" aria-live="polite">
      <div className="flex gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="breathe h-2 w-2 rounded-full bg-[#ece7df]" style={{ animationDelay: `${i * 0.4}s` }} />
        ))}
      </div>
      <h1 key={line} className="rise font-heading text-4xl tracking-tight sm:text-5xl">
        {line}
      </h1>
      <p className="max-w-md text-white/50">
        This usually takes a minute or two, and longer for longer scripts. Feel free to make a tea; just keep this tab open.
      </p>
      <p className="text-sm tabular-nums text-white/30">
        {mm}:{ss}
      </p>
      <button onClick={onCancel} className={ghostBtn}>
        Never mind
      </button>
    </section>
  );
}
