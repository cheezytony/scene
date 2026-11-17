"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Scene } from "@/lib/schema";
import { createHistory, historyReducer } from "@/lib/history";
import { DEFAULT_LIMITS, type Limits } from "@/lib/limits";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from "@/lib/prefs";
import { SCHEMA_VERSION, SceneFormatError, migrateScene } from "@/lib/migrate";
import { SAMPLE_SCRIPT } from "@/lib/sample";
import { gentleError, howLong } from "@/lib/voice";
import MovieStep from "@/components/MovieStep";
import type { Ready } from "@/components/ModelPicker";
import ExportStep from "@/components/ExportStep";
import GeneratingView from "@/components/GeneratingView";
import PreviewStep from "@/components/PreviewStep";
import ScriptStep, { scriptReady } from "@/components/ScriptStep";
import SettingsStep from "@/components/SettingsStep";
import Stepper, { type Step } from "@/components/Stepper";
import type { EditFn } from "@/components/ui";

/**
 * Calm steps: bring a script (or an idea), tweak a few settings, preview the scene, export it, and, if you like, turn it into a film.
 * This component only conducts; each step lives in its own component.
 */
export default function Home() {
  const [step, setStep] = useState<Step>("script");
  const [script, setScript] = useState("");
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [accessCode, setAccessCode] = useState("");
  // Choices (what to make, which models, the exchange rate) are remembered in this browser. The first
  // screen shows nothing that depends on them, so reading storage here is hydration-safe.
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === "undefined" ? DEFAULT_PREFS : loadPrefs()));
  useEffect(() => savePrefs(prefs), [prefs]);
  // Which AI services have a key on the server, so settings can say what is ready.
  const [ready, setReady] = useState<Ready>(null);
  useEffect(() => {
    fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : null))
      .then(setReady)
      .catch(() => setReady(null));
  }, []);

  // The scene lives in an undo history: every edit is undoable, and opening a scene starts fresh.
  const [history, dispatch] = useReducer(historyReducer<Scene | null>, createHistory<Scene | null>(null));
  const scene = history.present;
  const edit = useCallback<EditFn>(
    (fn, key) => dispatch({ type: "edit", next: (s) => (s ? fn(s) : s), key, now: Date.now() }),
    [],
  );
  // Bumped whenever a different scene is opened, so the preview starts from the beginning.
  const [sceneKey, setSceneKey] = useState(0);
  const [violations, setViolations] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  function openScene(next: Scene, extra: { violations?: string[]; notice?: string | null } = {}) {
    dispatch({ type: "reset", present: next });
    setSceneKey((k) => k + 1);
    setViolations(extra.violations ?? []);
    setNotice(extra.notice ?? null);
    setError(null);
    setImportError(null);
    setStep("preview");
  }

  /** Open a previously exported scene file, bringing older formats up to date. */
  async function importFile(file: File) {
    setImportError(null);
    try {
      const { scene: imported, fromVersion } = migrateScene(JSON.parse(await file.text()));
      openScene(imported, {
        notice:
          fromVersion < SCHEMA_VERSION
            ? `Opened “${file.name}”, and brought it up to date from an older format.`
            : `Opened “${file.name}”.`,
      });
    } catch (e) {
      setImportError(
        e instanceof SceneFormatError
          ? e.message
          : e instanceof SyntaxError
            ? "That doesn't look like a scene file. It should be a .json file saved from here."
            : "We couldn't open that file.",
      );
    }
  }

  async function createScene() {
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) },
        body: JSON.stringify({ script, limits, outputs: prefs.outputs, model: prefs.preview }),
        signal: controller.signal,
      });
      // Platform errors (timeouts, size limits) are not JSON, so parse defensively.
      let data: { scene?: Scene; violations?: string[]; error?: string; stats?: { totalMs?: number } } | null = null;
      try {
        data = JSON.parse(await res.text());
      } catch {}
      if (!res.ok) {
        throw new Error(
          data?.error ??
            (res.status === 504 || res.status === 408
              ? "That took longer than the server allows. Try a shorter excerpt."
              : res.status === 413
                ? "That script is too large to send in one go."
                : `The server hit a snag (${res.status}).`),
        );
      }
      if (!data?.scene) throw new Error("The server's answer wasn't something we could read.");
      openScene(data.scene, {
        violations: data.violations,
        notice: data.stats?.totalMs ? `Made in ${howLong(data.stats.totalMs)}.` : null,
      });
    } catch (e) {
      if (!controller.signal.aborted) setError(gentleError(e instanceof Error ? e.message : "Something went wrong."));
      setStep("settings");
    } finally {
      setLoading(false);
      if (abort.current === controller) abort.current = null;
    }
  }

  /** Writes a script from an idea (the script step shows it for reading and editing before anything else). */
  async function writeScript(idea: string): Promise<string> {
    const res = await fetch("/api/script", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) },
      body: JSON.stringify({ idea, model: prefs.preview }),
    });
    let data: { script?: string; error?: string } | null = null;
    try {
      data = JSON.parse(await res.text());
    } catch {}
    if (!res.ok || !data?.script) throw new Error(data?.error ?? `The server hit a snag (${res.status}).`);
    return data.script;
  }

  function newScene() {
    dispatch({ type: "reset", present: null });
    setViolations([]);
    setNotice(null);
    setStep("script");
  }

  // Ctrl/Cmd+Z and Shift+Z, unless you're typing in a field (which keeps its own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (k === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canGo = (s: Step) => {
    if (loading) return false;
    if (s === "script") return true;
    if (s === "settings") return scriptReady(script);
    return !!scene; // preview, export and the movie need a scene
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto grid w-full max-w-[1600px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-6 sm:px-10">
        <button
          onClick={() => !loading && setStep("script")}
          className="justify-self-start font-heading text-4xl tracking-tight text-white/90 transition-colors hover:text-white"
          aria-label="Scene, back to the start"
        >
          scene
        </button>
        <Stepper current={loading ? "preview" : step} canGo={canGo} onGo={setStep} busy={loading} />
        <span />
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-5 pb-16 pt-4 sm:px-10">
        {loading ? (
          <GeneratingView onCancel={() => abort.current?.abort()} />
        ) : step === "script" ? (
          <ScriptStep
            script={script}
            onScript={setScript}
            onExample={() => setScript(SAMPLE_SCRIPT)}
            onImportFile={(f) => void importFile(f)}
            onContinue={() => setStep("settings")}
            importError={importError}
            onWriteScript={writeScript}
          />
        ) : step === "settings" ? (
          <SettingsStep
            script={script}
            prefs={prefs}
            onPrefs={setPrefs}
            ready={ready}
            limits={limits}
            onLimits={setLimits}
            accessCode={accessCode}
            onAccessCode={setAccessCode}
            error={error}
            hasScene={!!scene}
            onBack={() => setStep("script")}
            onBackToScene={() => setStep("preview")}
            onCreate={() => void createScene()}
          />
        ) : step === "preview" && scene ? (
          <PreviewStep
            key={sceneKey}
            scene={scene}
            edit={edit}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onUndo={() => dispatch({ type: "undo" })}
            onRedo={() => dispatch({ type: "redo" })}
            violations={violations}
            notice={notice}
            onContinue={() => setStep("export")}
          />
        ) : step === "export" && scene ? (
          <ExportStep scene={scene} onBack={() => setStep("preview")} onNewScene={newScene} onMovie={() => setStep("movie")} />
        ) : step === "movie" && scene ? (
          <MovieStep scene={scene} prefs={prefs} onPrefs={setPrefs} ready={ready} accessCode={accessCode} onBack={() => setStep("export")} />
        ) : null}
      </main>
    </div>
  );
}
