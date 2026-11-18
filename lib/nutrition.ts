export const FOOD_ANALYSIS_MODEL = "gpt-6-luna";
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];
export type Confidence = "low" | "medium" | "high";

export type NutritionEstimate = {
  foodName: string;
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  confidence: Confidence;
  uncertaintyNote: string | null;
  assumptions: string[];
};

export type UsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  pricingConfigured: boolean;
};

export const nutritionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    foodName: { type: "string", minLength: 1, maxLength: 100 },
    calories: { type: "number", minimum: 0, maximum: 10000 },
    protein: { type: "number", minimum: 0, maximum: 1000 },
    carbohydrates: { type: "number", minimum: 0, maximum: 1000 },
    fat: { type: "number", minimum: 0, maximum: 1000 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    uncertaintyNote: {
      anyOf: [{ type: "string", maxLength: 300 }, { type: "null" }],
    },
    assumptions: {
      type: "array",
      maxItems: 6,
      items: { type: "string", maxLength: 120 },
    },
  },
  required: [
    "foodName",
    "calories",
    "protein",
    "carbohydrates",
    "fat",
    "confidence",
    "uncertaintyNote",
    "assumptions",
  ],
} as const;

export class ImageValidationError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_IMAGE_TYPE" | "IMAGE_TOO_LARGE" | "EMPTY_IMAGE" | "IMAGE_TYPE_MISMATCH",
    readonly status: number,
  ) {
    super(message);
  }
}

function detectedImageType(bytes: Uint8Array): SupportedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export function validateImage(bytes: Uint8Array, declaredType: string): SupportedImageType {
  if (bytes.length === 0) {
    throw new ImageValidationError("The image is empty.", "EMPTY_IMAGE", 400);
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageValidationError(
      "The image is larger than 6 MB.",
      "IMAGE_TOO_LARGE",
      413,
    );
  }

  if (!SUPPORTED_IMAGE_TYPES.includes(declaredType as SupportedImageType)) {
    throw new ImageValidationError(
      "Use a JPEG, PNG, or WebP image.",
      "INVALID_IMAGE_TYPE",
      415,
    );
  }

  const detectedType = detectedImageType(bytes);
  if (detectedType !== declaredType) {
    throw new ImageValidationError(
      "The file contents do not match its image type.",
      "IMAGE_TYPE_MISMATCH",
      415,
    );
  }

  return detectedType;
}

function finiteNumber(value: unknown, field: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`Invalid ${field} value in model response.`);
  }
  return Math.round(value * 10) / 10;
}

export function parseNutritionEstimate(value: unknown): NutritionEstimate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The model response is not an object.");
  }

  const candidate = value as Record<string, unknown>;
  const foodName = typeof candidate.foodName === "string" ? candidate.foodName.trim() : "";
  if (!foodName || foodName.length > 100) {
    throw new Error("Invalid food name in model response.");
  }

  if (!(["low", "medium", "high"] as unknown[]).includes(candidate.confidence)) {
    throw new Error("Invalid confidence in model response.");
  }

  const uncertaintyNote = candidate.uncertaintyNote;
  if (uncertaintyNote !== null && (typeof uncertaintyNote !== "string" || uncertaintyNote.length > 300)) {
    throw new Error("Invalid uncertainty note in model response.");
  }

  if (
    !Array.isArray(candidate.assumptions) || candidate.assumptions.length > 6 ||
    candidate.assumptions.some((item) => typeof item !== "string" || item.length > 120)
  ) {
    throw new Error("Invalid assumptions in model response.");
  }

  return {
    foodName,
    calories: finiteNumber(candidate.calories, "calories", 10000),
    protein: finiteNumber(candidate.protein, "protein", 1000),
    carbohydrates: finiteNumber(candidate.carbohydrates, "carbohydrates", 1000),
    fat: finiteNumber(candidate.fat, "fat", 1000),
    confidence: candidate.confidence as Confidence,
    uncertaintyNote: typeof uncertaintyNote === "string" ? uncertaintyNote.trim() || null : null,
    assumptions: (candidate.assumptions as string[]).map((item) => item.trim()).filter(Boolean),
  };
}

function optionalRate(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function summarizeUsage(
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null | undefined,
  pricing = {
    inputPerMillion: optionalRate(process.env.OPENAI_GPT6_LUNA_INPUT_USD_PER_MILLION),
    outputPerMillion: optionalRate(process.env.OPENAI_GPT6_LUNA_OUTPUT_USD_PER_MILLION),
  },
): UsageSummary {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  const pricingConfigured = pricing.inputPerMillion !== null && pricing.outputPerMillion !== null;
  const estimatedCostUsd = pricingConfigured
    ? (inputTokens * pricing.inputPerMillion! + outputTokens * pricing.outputPerMillion!) / 1_000_000
    : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: estimatedCostUsd === null ? null : Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    pricingConfigured,
  };
}

export function emptyUsage(pricingConfigured: boolean): UsageSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: pricingConfigured ? 0 : null,
    pricingConfigured,
  };
}
