import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import {
  emptyUsage,
  FOOD_ANALYSIS_MODEL,
  ImageValidationError,
  MAX_IMAGE_BYTES,
  NutritionEstimate,
  nutritionJsonSchema,
  parseNutritionEstimate,
  summarizeUsage,
  UsageSummary,
  validateImage,
} from "@/lib/nutrition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;
const CACHE_LIMIT = 100;

type AnalysisPayload = {
  nutrition: NutritionEstimate & { uncertain: boolean };
  usage: UsageSummary;
  meta: {
    model: typeof FOOD_ANALYSIS_MODEL;
    requestId: string;
    cached: boolean;
    generatedAt: string;
  };
};

type StoredAnalysis = Omit<AnalysisPayload, "usage">;
type ServerState = {
  cache: Map<string, { expiresAt: number; value: StoredAnalysis }>;
  inFlight: Map<string, Promise<StoredAnalysis & { usage: UsageSummary }>>;
  clients: Map<string, { count: number; resetAt: number }>;
};

declare global {
  var macroSnapAiState: ServerState | undefined;
}

const state = globalThis.macroSnapAiState ??= {
  cache: new Map(),
  inFlight: new Map(),
  clients: new Map(),
};

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function clientIdentifier(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const requestHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
    return Boolean(requestHost && new URL(origin).host === requestHost);
  } catch {
    return false;
  }
}

function applyRateLimit(request: Request) {
  const now = Date.now();
  const identifier = clientIdentifier(request);
  const current = state.clients.get(identifier);

  if (!current || current.resetAt <= now) {
    const resetAt = now + RATE_WINDOW_MS;
    state.clients.set(identifier, { count: 1, resetAt });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function pruneState() {
  const now = Date.now();
  for (const [key, entry] of state.cache) {
    if (entry.expiresAt <= now) state.cache.delete(key);
  }
  for (const [key, entry] of state.clients) {
    if (entry.resetAt <= now) state.clients.delete(key);
  }
  while (state.cache.size > CACHE_LIMIT) {
    const oldestKey = state.cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    state.cache.delete(oldestKey);
  }
}

function pricingConfigured() {
  return summarizeUsage(null).pricingConfigured;
}

async function requestAnalysis(bytes: Uint8Array, mediaType: string): Promise<StoredAnalysis & { usage: UsageSummary }> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    maxRetries: 1,
    timeout: 30_000,
  });

  const imageUrl = `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
  const response = await client.responses.create({
    model: FOOD_ANALYSIS_MODEL,
    store: false,
    max_output_tokens: 500,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "Identify the food and estimate nutrition for the entire visible serving.",
            "Return calories and protein, carbohydrates, and fat in grams.",
            "Use confidence='low' when the food, ingredients, or portion size is unclear.",
            "Explain material uncertainty briefly and list assumptions that affect the estimate.",
            "Do not claim medical or laboratory precision.",
          ].join(" "),
        },
        { type: "input_image", image_url: imageUrl, detail: "low" },
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "food_nutrition_estimate",
        strict: true,
        schema: nutritionJsonSchema,
      },
    },
  });

  if (!response.output_text) {
    throw new Error("The model returned no structured nutrition data.");
  }

  const estimate = parseNutritionEstimate(JSON.parse(response.output_text));
  const usage = summarizeUsage(response.usage);
  const requestId = response.id || randomUUID();

  console.info("[food-analysis]", JSON.stringify({
    requestId,
    model: FOOD_ANALYSIS_MODEL,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
    pricingConfigured: usage.pricingConfigured,
  }));

  return {
    nutrition: {
      ...estimate,
      uncertain: estimate.confidence !== "high" || Boolean(estimate.uncertaintyNote),
    },
    usage,
    meta: {
      model: FOOD_ANALYSIS_MODEL,
      requestId,
      cached: false,
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return json({
      error: {
        code: "ACCESS_CONTROL_REQUIRED",
        message: "Photo analysis is unavailable until account access controls are implemented.",
      },
    }, 403);
  }

  if (process.env.MACROSNAP_AI_ENABLED !== "true") {
    return json({ error: { code: "FEATURE_DISABLED", message: "Photo analysis is not available yet." } }, 403);
  }

  if (!sameOrigin(request)) {
    return json({ error: { code: "INVALID_ORIGIN", message: "This request is not allowed." } }, 403);
  }

  if (!process.env.OPENAI_API_KEY) {
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "Photo analysis is not configured." } }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_IMAGE_BYTES + 1024 * 1024) {
    return json({ error: { code: "IMAGE_TOO_LARGE", message: "The image is larger than 6 MB." } }, 413);
  }

  const rate = applyRateLimit(request);
  if (!rate.allowed) {
    return json(
      { error: { code: "RATE_LIMITED", message: "Too many analyses. Try again in a few minutes." } },
      429,
      { "Retry-After": String(rate.retryAfter) },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: { code: "INVALID_REQUEST", message: "Upload one food image." } }, 400);
  }

  const image = formData.get("image");
  if (!(image instanceof File)) {
    return json({ error: { code: "IMAGE_REQUIRED", message: "Upload one food image." } }, 400);
  }

  try {
    const bytes = new Uint8Array(await image.arrayBuffer());
    const mediaType = validateImage(bytes, image.type);
    const hash = createHash("sha256").update(bytes).digest("hex");
    pruneState();

    const cached = state.cache.get(hash);
    if (cached && cached.expiresAt > Date.now()) {
      return json({
        ...cached.value,
        usage: emptyUsage(pricingConfigured()),
        meta: { ...cached.value.meta, requestId: `cache_${hash.slice(0, 12)}`, cached: true },
      } satisfies AnalysisPayload);
    }

    const existingRequest = state.inFlight.get(hash);
    if (existingRequest) {
      const value = await existingRequest;
      return json({
        nutrition: value.nutrition,
        usage: emptyUsage(value.usage.pricingConfigured),
        meta: { ...value.meta, requestId: `dedupe_${hash.slice(0, 12)}`, cached: true },
      } satisfies AnalysisPayload);
    }

    const pending = requestAnalysis(bytes, mediaType);
    state.inFlight.set(hash, pending);

    try {
      const value = await pending;
      const stored: StoredAnalysis = { nutrition: value.nutrition, meta: value.meta };
      state.cache.set(hash, { expiresAt: Date.now() + CACHE_TTL_MS, value: stored });
      return json(value satisfies AnalysisPayload);
    } finally {
      state.inFlight.delete(hash);
    }
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return json({ error: { code: error.code, message: error.message } }, error.status);
    }

    const status = error instanceof OpenAI.APIError && error.status === 429 ? 429 : 502;
    console.error("[food-analysis] request failed", {
      status,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown analysis failure",
    });
    return json({
      error: {
        code: status === 429 ? "UPSTREAM_RATE_LIMITED" : "ANALYSIS_FAILED",
        message: status === 429
          ? "The analysis service is busy. Try again shortly."
          : "We couldn't analyze this photo. Try another clear image.",
      },
    }, status);
  }
}
