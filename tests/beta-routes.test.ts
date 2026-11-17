import assert from "node:assert/strict";
import test from "node:test";
import { POST as analyze } from "../app/api/analyze-food/route";
import { GET as getSession } from "../app/api/beta/session/route";
import { BETA_SESSION_COOKIE, createBetaSession, hashInvitationToken } from "../lib/beta-access";

const managedNames = [
  "NODE_ENV",
  "VERCEL_ENV",
  "MACROSNAP_AI_ENABLED",
  "MACROSNAP_BETA_ENABLED",
  "MACROSNAP_BETA_INVITE_HASHES_JSON",
  "MACROSNAP_SESSION_SECRET",
] as const;

async function withEnvironment(values: Partial<Record<(typeof managedNames)[number], string>>, callback: () => Promise<void>) {
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const previous = Object.fromEntries(managedNames.map(name => [name, process.env[name]]));
  try {
    for (const name of managedNames) delete mutableEnvironment[name];
    Object.assign(mutableEnvironment, values);
    await callback();
  } finally {
    for (const name of managedNames) {
      const value = previous[name];
      if (value === undefined) delete mutableEnvironment[name];
      else mutableEnvironment[name] = value;
    }
  }
}

test("the production API remains hard-disabled even when beta flags are true", async () => {
  await withEnvironment({ NODE_ENV: "production", VERCEL_ENV: "production", MACROSNAP_BETA_ENABLED: "true", MACROSNAP_AI_ENABLED: "true" }, async () => {
    const response = await analyze(new Request("https://macrosnap.example/api/analyze-food", { method: "POST" }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "PRODUCTION_AI_DISABLED");
  });
});

test("a beta preview rejects analysis without a signed session", async () => {
  await withEnvironment({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    MACROSNAP_BETA_ENABLED: "true",
    MACROSNAP_BETA_INVITE_HASHES_JSON: JSON.stringify({ tester: hashInvitationToken("a-long-random-invitation-token-for-tests") }),
    MACROSNAP_SESSION_SECRET: "a-preview-session-secret-that-is-longer-than-thirty-two-bytes",
  }, async () => {
    const response = await analyze(new Request("https://preview.example/api/analyze-food", {
      method: "POST",
      headers: { host: "preview.example", origin: "https://preview.example" },
    }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "BETA_SESSION_REQUIRED");
  });
});

test("the session endpoint recognizes a valid signed tester cookie", async () => {
  const configuration = {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    MACROSNAP_BETA_ENABLED: "true",
    MACROSNAP_BETA_INVITE_HASHES_JSON: JSON.stringify({ tester: hashInvitationToken("a-long-random-invitation-token-for-tests") }),
    MACROSNAP_SESSION_SECRET: "a-preview-session-secret-that-is-longer-than-thirty-two-bytes",
  };
  await withEnvironment(configuration, async () => {
    const token = createBetaSession("tester", process.env);
    const response = await getSession(new Request("https://preview.example/api/beta/session", {
      headers: { cookie: `${BETA_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.authenticated, true);
    assert.equal(body.testerId, "tester");
    assert.equal(body.analysesPerDay, 10);
  });
});
