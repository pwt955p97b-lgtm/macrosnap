import assert from "node:assert/strict";
import test from "node:test";
import {
  ImageValidationError,
  MAX_IMAGE_BYTES,
  parseNutritionEstimate,
  summarizeUsage,
  validateImage,
} from "../lib/nutrition";

test("validates supported image signatures", () => {
  assert.equal(validateImage(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"), "image/jpeg");
  assert.equal(
    validateImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"),
    "image/png",
  );
  assert.equal(
    validateImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"),
    "image/webp",
  );
});

test("rejects mismatched and oversized images", () => {
  assert.throws(
    () => validateImage(new Uint8Array([0xff, 0xd8, 0xff]), "image/png"),
    (error: unknown) => error instanceof ImageValidationError && error.code === "IMAGE_TYPE_MISMATCH",
  );
  assert.throws(
    () => validateImage(new Uint8Array(MAX_IMAGE_BYTES + 1), "image/jpeg"),
    (error: unknown) => error instanceof ImageValidationError && error.code === "IMAGE_TOO_LARGE",
  );
});

test("parses and rounds a structured nutrition estimate", () => {
  assert.deepEqual(parseNutritionEstimate({
    foodName: " Chicken rice bowl ",
    calories: 642.44,
    protein: 43.26,
    carbohydrates: 71.04,
    fat: 18.55,
    confidence: "medium",
    uncertaintyNote: " Portion size is estimated. ",
    assumptions: [" 1.5 cups rice ", "6 oz chicken"],
  }), {
    foodName: "Chicken rice bowl",
    calories: 642.4,
    protein: 43.3,
    carbohydrates: 71,
    fat: 18.6,
    confidence: "medium",
    uncertaintyNote: "Portion size is estimated.",
    assumptions: ["1.5 cups rice", "6 oz chicken"],
  });
});

test("rejects unsafe model values", () => {
  assert.throws(() => parseNutritionEstimate({
    foodName: "Mystery meal",
    calories: -1,
    protein: 1,
    carbohydrates: 1,
    fat: 1,
    confidence: "high",
    uncertaintyNote: null,
    assumptions: [],
  }), /Invalid calories/);
});

test("tracks tokens and calculates configured request cost", () => {
  assert.deepEqual(summarizeUsage(
    { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 },
    { inputPerMillion: 2, outputPerMillion: 8 },
  ), {
    inputTokens: 1200,
    outputTokens: 300,
    totalTokens: 1500,
    estimatedCostUsd: 0.0048,
    pricingConfigured: true,
  });
});
