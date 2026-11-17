import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIMITS } from "./limits";
import { estimatePreview, formatMoney } from "./cost";
import { DEFAULT_PREVIEW, pricesFor } from "./catalog";

const base = { scriptChars: 12_000, limits: DEFAULT_LIMITS, model: DEFAULT_PREVIEW };
const usd = (outputs: Parameters<typeof estimatePreview>[0]["outputs"]) => estimatePreview({ ...base, outputs }).usd!.expected;

test("each extra output costs more, and the default is the cheapest useful run", () => {
  const beatsOnly = usd({ transcript: false });
  const withTranscript = usd({});
  const withCast = usd({ cast: true });
  const everything = usd({ cast: true, cameras: true });
  assert.ok(beatsOnly < withTranscript && withTranscript < withCast && withCast < everything);
});
test("a longer script costs more", () => {
  const short = estimatePreview({ ...base, scriptChars: 2000, outputs: { cast: true } }).usd!.expected;
  const long = estimatePreview({ ...base, scriptChars: 40_000, outputs: { cast: true } }).usd!.expected;
  assert.ok(long > short * 2);
});
test("a cheaper model costs proportionally less; an unpriced model yields no dollar figure", () => {
  const haiku = estimatePreview({ ...base, outputs: {}, model: { provider: "anthropic", model: "claude-haiku-5-5" } }).usd!.expected;
  assert.ok(haiku < usd({}) / 10);
  assert.equal(estimatePreview({ ...base, outputs: {}, model: { provider: "openai", model: "x" } }).usd, null);
  assert.equal(pricesFor({ provider: "openai", model: "x", inPerM: 1, outPerM: 2 }).known, true);
});
test("the range brackets the expectation", () => {
  const u = estimatePreview({ ...base, outputs: { cast: true } }).usd!;
  assert.ok(u.low < u.expected && u.expected < u.high);
});
test("money is shown in dollars and naira", () => {
  assert.equal(formatMoney(0.5, "USD", 1500), "$0.50");
  assert.equal(formatMoney(2, "NGN", 1500), "₦3,000");
});
