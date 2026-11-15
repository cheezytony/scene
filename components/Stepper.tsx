"use client";

export type Step = "script" | "settings" | "preview" | "export";

const STEPS: { id: Step; label: string }[] = [
  { id: "script", label: "Script" },
  { id: "settings", label: "Settings" },
  { id: "preview", label: "Preview" },
  { id: "export", label: "Export" },
];

/**
 * Where you are in the four steps. Steps you can reach are clickable; the rest wait quietly until
 * they make sense (there is nothing to preview before a scene exists).
 */
export default function Stepper({
  current,
  canGo,
  onGo,
  busy = false,
}: {
  current: Step;
  canGo: (step: Step) => boolean;
  onGo: (step: Step) => void;
  /** A scene is being made: the current step breathes gently. */
  busy?: boolean;
}) {
  const at = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center gap-1 sm:gap-2">
        {STEPS.map((s, i) => {
          const done = i < at;
          const active = i === at;
          const enabled = canGo(s.id) && !active;
          return (
            <li key={s.id} className="flex items-center gap-1 sm:gap-2">
              {i > 0 && <span aria-hidden className={`h-px w-4 sm:w-8 ${done || active ? "bg-white/35" : "bg-white/12"}`} />}
              <button
                onClick={() => onGo(s.id)}
                disabled={!enabled && !active}
                aria-current={active ? "step" : undefined}
                className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm transition-colors ${
                  active ? "bg-white/10 text-white" : enabled ? "text-white/70 hover:bg-white/6 hover:text-white" : "cursor-default text-white/30"
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    active ? `bg-[#ece7df] text-[#14161b] ${busy ? "breathe" : ""}` : done ? "bg-white/20 text-white" : "border border-white/15"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
