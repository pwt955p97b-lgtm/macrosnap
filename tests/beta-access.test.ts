import assert from "node:assert/strict";
import test from "node:test";
import {
  aiAccessMode,
  BETA_SESSION_COOKIE,
  betaSessionCookieOptions,
  cookieValue,
  createBetaSession,
  hashBetaCode,
  sameOrigin,
  testerForBetaCode,
  verifyBetaSession,
} from "../lib/beta-access";
import {
  allowLoginAttempt,
  consumeAnalysisQuota,
  DEFAULT_GLOBAL_DAILY_ANALYSIS_LIMIT,
  TESTER_DAILY_ANALYSIS_LIMIT,
} from "../lib/beta-rate-limit";

const code = "high-entropy-test-code-that-is-not-used-in-production";
const environment = {
  MACROSNAP_BETA_CODE_HASHES_JSON: JSON.stringify({ "tester-01": hashBetaCode(code) }),
  MACROSNAP_SESSION_SECRET: "a-test-session-secret-that-is-longer-than-thirty-two-bytes",
};

test("production remains disabled while protected previews can use beta mode", () => {
  assert.equal(aiAccessMode({ NODE_ENV: "production", VERCEL_ENV: "production", MACROSNAP_BETA_ENABLED: "true" }), "disabled");
  assert.equal(aiAccessMode({ NODE_ENV: "production", VERCEL_ENV: "preview", MACROSNAP_BETA_ENABLED: "true" }), "beta");
  assert.equal(aiAccessMode({ NODE_ENV: "production", VERCEL_ENV: "preview", MACROSNAP_BETA_ENABLED: "false" }), "disabled");
  assert.equal(aiAccessMode({ NODE_ENV: "development", MACROSNAP_AI_ENABLED: "true" }), "development");
});

test("individual codes create signed, expiring, revocable sessions", () => {
  const now = Date.UTC(2026, 10, 16);
  assert.equal(testerForBetaCode(code, environment), "tester-01");
  assert.equal(testerForBetaCode(`${code}-wrong`, environment), null);

  const token = createBetaSession("tester-01", environment, now);
  assert.deepEqual(verifyBetaSession(token, environment, now + 1000)?.testerId, "tester-01");
  assert.equal(verifyBetaSession(`${token.slice(0, -1)}x`, environment, now + 1000), null);
  assert.equal(verifyBetaSession(token, environment, now + 8 * 24 * 60 * 60 * 1000), null);
  assert.equal(verifyBetaSession(token, { ...environment, MACROSNAP_BETA_CODE_HASHES_JSON: JSON.stringify({ other: hashBetaCode("other-code") }) }, now + 1000), null);
});

test("reads only the named cookie and enforces same-origin requests", () => {
  assert.equal(cookieValue(`other=1; ${BETA_SESSION_COOKIE}=signed.value; last=2`, BETA_SESSION_COOKIE), "signed.value");
  assert.equal(sameOrigin(new Request("https://preview.example/api", { headers: { host: "preview.example", origin: "https://preview.example" } })), true);
  assert.equal(sameOrigin(new Request("https://preview.example/api", { headers: { host: "preview.example", origin: "https://evil.example" } })), false);
});

test("beta sessions use hardened cookies on Vercel previews", () => {
  assert.deepEqual(betaSessionCookieOptions({ NODE_ENV: "production", VERCEL: "1" }), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
});

test("interprets atomic tester and global quota decisions", async () => {
  const allowedClient = { eval: async () => [1, 0, 1, 1] };
  const testerDeniedClient = { eval: async () => [0, 1, 10, 42] };
  const globalDeniedClient = { eval: async () => [0, 2, 3, 100] };
  const now = new Date("2026-11-16T12:00:00.000Z");

  const allowed = await consumeAnalysisQuota("tester-01", {}, now, allowedClient);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.testerLimit, TESTER_DAILY_ANALYSIS_LIMIT);
  assert.equal(allowed.globalLimit, DEFAULT_GLOBAL_DAILY_ANALYSIS_LIMIT);
  assert.equal(allowed.resetsAt, "2026-11-17T00:00:00.000Z");

  assert.equal((await consumeAnalysisQuota("tester-01", {}, now, testerDeniedClient)).reason, "tester");
  assert.equal((await consumeAnalysisQuota("tester-01", { MACROSNAP_BETA_GLOBAL_DAILY_LIMIT: "100" }, now, globalDeniedClient)).reason, "global");
});

test("durably limits repeated beta-code attempts", async () => {
  const allowedClient = { eval: async () => 10 };
  const deniedClient = { eval: async () => 11 };
  assert.equal((await allowLoginAttempt("192.0.2.1", {}, allowedClient)).allowed, true);
  assert.equal((await allowLoginAttempt("192.0.2.1", {}, deniedClient)).allowed, false);
});

test("rejects an invalid global cap instead of silently widening it", async () => {
  const client = { eval: async () => [1, 0, 1, 1] };
  await assert.rejects(
    consumeAnalysisQuota("tester-01", { MACROSNAP_BETA_GLOBAL_DAILY_LIMIT: "not-a-number" }, new Date(), client),
    /positive integer/,
  );
});
