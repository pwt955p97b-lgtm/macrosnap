import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const BETA_SESSION_COOKIE = "macrosnap_beta_session";
export const BETA_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type AiAccessMode = "disabled" | "development" | "beta";
export type BetaSession = { testerId: string; expiresAt: number };

type Environment = Record<string, string | undefined>;

export class BetaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BetaConfigurationError";
  }
}

export function aiAccessMode(environment: Environment = process.env): AiAccessMode {
  if (environment.VERCEL_ENV === "production") return "disabled";
  if (environment.VERCEL_ENV === "preview") {
    return environment.MACROSNAP_BETA_ENABLED === "true" ? "beta" : "disabled";
  }
  if (environment.NODE_ENV === "production") return "disabled";
  if (environment.MACROSNAP_BETA_ENABLED === "true") return "beta";
  return environment.MACROSNAP_AI_ENABLED === "true" ? "development" : "disabled";
}

export function hashBetaCode(code: string) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function configuredBetaCodes(environment: Environment = process.env) {
  const raw = environment.MACROSNAP_BETA_CODE_HASHES_JSON;
  if (!raw) throw new BetaConfigurationError("Beta access codes are not configured.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BetaConfigurationError("MACROSNAP_BETA_CODE_HASHES_JSON must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BetaConfigurationError("Beta access codes must be a tester-to-hash object.");
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 100) {
    throw new BetaConfigurationError("Configure between 1 and 100 beta testers.");
  }

  const codes = new Map<string, string>();
  for (const [testerId, value] of entries) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(testerId) || typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
      throw new BetaConfigurationError("Beta tester IDs or code hashes are invalid.");
    }
    codes.set(testerId, value.toLowerCase());
  }
  return codes;
}

function sessionSecret(environment: Environment = process.env) {
  const secret = environment.MACROSNAP_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new BetaConfigurationError("MACROSNAP_SESSION_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function testerForBetaCode(code: string, environment: Environment = process.env) {
  const candidate = hashBetaCode(code);
  let match: string | null = null;
  for (const [testerId, expected] of configuredBetaCodes(environment)) {
    if (safeEqualText(candidate, expected)) match = testerId;
  }
  return match;
}

export function createBetaSession(testerId: string, environment: Environment = process.env, now = Date.now()) {
  if (!configuredBetaCodes(environment).has(testerId)) {
    throw new BetaConfigurationError("Cannot create a session for an unknown tester.");
  }
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    testerId,
    expiresAt: now + BETA_SESSION_MAX_AGE_SECONDS * 1000,
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", sessionSecret(environment)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyBetaSession(token: string | undefined, environment: Environment = process.env, now = Date.now()): BetaSession | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expected = createHmac("sha256", sessionSecret(environment)).update(payload).digest("base64url");
  if (!safeEqualText(signature, expected)) return null;

  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (value.version !== 1 || typeof value.testerId !== "string" || typeof value.expiresAt !== "number") return null;
    if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now) return null;
    if (!configuredBetaCodes(environment).has(value.testerId)) return null;
    return { testerId: value.testerId, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

export function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1) continue;
    const key = item.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return undefined;
}

export function betaSessionCookieOptions(environment: Environment = process.env) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: environment.VERCEL === "1" || environment.NODE_ENV === "production",
    path: "/",
    maxAge: BETA_SESSION_MAX_AGE_SECONDS,
  };
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    return Boolean(host && new URL(origin).host === host);
  } catch {
    return false;
  }
}
