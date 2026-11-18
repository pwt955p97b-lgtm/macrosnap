import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

export const TESTER_DAILY_ANALYSIS_LIMIT = 10;
export const DEFAULT_GLOBAL_DAILY_ANALYSIS_LIMIT = 100;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_ATTEMPT_LIMIT = 10;

type Environment = Record<string, string | undefined>;
type EvalClient = {
  eval: (script: string, keys: string[], args: (string | number)[]) => Promise<unknown>;
};

export class DurableStoreUnavailableError extends Error {
  constructor(message = "The durable beta usage store is unavailable.") {
    super(message);
    this.name = "DurableStoreUnavailableError";
  }
}

const QUOTA_SCRIPT = `
local tester = tonumber(redis.call("GET", KEYS[1]) or "0")
local global = tonumber(redis.call("GET", KEYS[2]) or "0")
local testerLimit = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
local expiresAt = tonumber(ARGV[3])
if tester >= testerLimit then return {0, 1, tester, global} end
if global >= globalLimit then return {0, 2, tester, global} end
tester = redis.call("INCR", KEYS[1])
global = redis.call("INCR", KEYS[2])
redis.call("EXPIREAT", KEYS[1], expiresAt)
redis.call("EXPIREAT", KEYS[2], expiresAt)
return {1, 0, tester, global}
`;

const LOGIN_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return count
`;

const REDEEM_INVITATION_SCRIPT = `
local claimed = redis.call("SET", KEYS[1], ARGV[1], "NX")
if claimed then return 1 end
return 0
`;

let redisClient: Redis | null = null;

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new DurableStoreUnavailableError("MACROSNAP_BETA_GLOBAL_DAILY_LIMIT must be a positive integer.");
  }
  return parsed;
}

export function globalDailyLimit(environment: Environment = process.env) {
  return positiveInteger(environment.MACROSNAP_BETA_GLOBAL_DAILY_LIMIT, DEFAULT_GLOBAL_DAILY_ANALYSIS_LIMIT);
}

function redisFromEnvironment(environment: Environment = process.env): EvalClient {
  const url = environment.UPSTASH_REDIS_REST_URL || environment.KV_REST_API_URL;
  const token = environment.UPSTASH_REDIS_REST_TOKEN || environment.KV_REST_API_TOKEN;
  if (!url || !token) throw new DurableStoreUnavailableError("Redis credentials are not configured.");
  if (!redisClient) redisClient = new Redis({ url, token });
  return redisClient as unknown as EvalClient;
}

function nextUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function utcDay(now: Date) {
  return now.toISOString().slice(0, 10);
}

export type AnalysisQuota = {
  allowed: boolean;
  reason: "ok" | "tester" | "global";
  testerUsed: number;
  testerLimit: number;
  globalUsed: number;
  globalLimit: number;
  resetsAt: string;
};

export async function consumeAnalysisQuota(
  testerId: string,
  environment: Environment = process.env,
  now = new Date(),
  client?: EvalClient,
): Promise<AnalysisQuota> {
  const globalLimit = globalDailyLimit(environment);
  const reset = nextUtcDay(now);
  const keys = [
    `macrosnap:beta:analysis:${utcDay(now)}:tester:${testerId}`,
    `macrosnap:beta:analysis:${utcDay(now)}:global`,
  ];

  try {
    const result = await (client || redisFromEnvironment(environment)).eval(
      QUOTA_SCRIPT,
      keys,
      [TESTER_DAILY_ANALYSIS_LIMIT, globalLimit, Math.floor(reset.getTime() / 1000)],
    ) as number[];
    if (!Array.isArray(result) || result.length !== 4) throw new Error("Invalid quota response.");
    return {
      allowed: result[0] === 1,
      reason: result[1] === 1 ? "tester" : result[1] === 2 ? "global" : "ok",
      testerUsed: Number(result[2]),
      testerLimit: TESTER_DAILY_ANALYSIS_LIMIT,
      globalUsed: Number(result[3]),
      globalLimit,
      resetsAt: reset.toISOString(),
    };
  } catch (error) {
    if (error instanceof DurableStoreUnavailableError) throw error;
    throw new DurableStoreUnavailableError(error instanceof Error ? error.message : undefined);
  }
}

export async function allowLoginAttempt(identifier: string, environment: Environment = process.env, client?: EvalClient) {
  const digest = createHash("sha256").update(identifier).digest("hex").slice(0, 32);
  const window = Math.floor(Date.now() / (LOGIN_WINDOW_SECONDS * 1000));
  try {
    const count = await (client || redisFromEnvironment(environment)).eval(
      LOGIN_SCRIPT,
      [`macrosnap:beta:login:${window}:${digest}`],
      [LOGIN_WINDOW_SECONDS],
    ) as number;
    return { allowed: Number(count) <= LOGIN_ATTEMPT_LIMIT, retryAfter: LOGIN_WINDOW_SECONDS };
  } catch (error) {
    if (error instanceof DurableStoreUnavailableError) throw error;
    throw new DurableStoreUnavailableError(error instanceof Error ? error.message : undefined);
  }
}

export async function redeemInvitation(
  testerId: string,
  invitationHash: string,
  environment: Environment = process.env,
  client?: EvalClient,
) {
  try {
    const result = await (client || redisFromEnvironment(environment)).eval(
      REDEEM_INVITATION_SCRIPT,
      [`macrosnap:beta:invitation:${invitationHash}`],
      [testerId],
    );
    return Number(result) === 1;
  } catch (error) {
    if (error instanceof DurableStoreUnavailableError) throw error;
    throw new DurableStoreUnavailableError(error instanceof Error ? error.message : undefined);
  }
}
