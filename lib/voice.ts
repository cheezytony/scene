/**
 * The words the app uses when it talks to you. Calm, warm, a little understated: it never shouts,
 * never blames, and says what to do next. Keep new copy in this voice.
 */

/** Shown one at a time while a scene is being made, in roughly the order the work happens. */
export const MAKING_LINES = [
  "Reading your script, slowly.",
  "Meeting the people in it.",
  "Finding the props that matter.",
  "Setting the stage.",
  "Placing everyone where they belong.",
  "Choosing where the cameras go.",
  "Tidying up the last few details.",
  "Nearly there. Good things take a minute.",
];

/** A friendly wrapper for whatever went wrong. The detail stays visible; the tone stays gentle. */
export function gentleError(detail: string): { title: string; detail: string } {
  const text = detail.trim().replace(/\.*$/, ".");
  if (/access code/i.test(text)) return { title: "That access code didn't open the door", detail: text };
  if (/timed out|too large|too long|shorter/i.test(text)) return { title: "That was a bit much in one go", detail: text };
  if (/credential|api key|authentication/i.test(text)) return { title: "We couldn't reach the writer", detail: text };
  if (/rate limit|too many/i.test(text)) return { title: "Let's give it a moment", detail: text };
  return { title: "That didn't quite work", detail: text };
}

/** "about 2 minutes", "a few seconds": for how long a scene took. */
export function howLong(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 10) return "a few seconds";
  if (s < 90) return `about ${s} seconds`;
  return `about ${Math.round(s / 60)} minutes`;
}
