import assert from "node:assert/strict";
import test from "node:test";
import {
  convertFromGrams,
  convertRecipeFromWeights,
  convertToGrams,
  formatMeasurement,
  parseAmount,
} from "../conversion.js";

test("parses decimal and mixed-number cup values", () => {
  assert.equal(parseAmount("1.25"), 1.25);
  assert.equal(parseAmount("1 1/2"), 1.5);
  assert.equal(parseAmount("3/4"), 0.75);
});

test("uses ingredient-specific cup weights", () => {
  assert.equal(Math.round(convertToGrams("1", "cup", "flour").grams), 120);
  assert.equal(Math.round(convertToGrams("1", "cup", "sugar").grams), 200);
  assert.notEqual(convertToGrams("1", "cup", "water").grams, convertToGrams("1", "cup", "flour").grams);
});

test("converts grams and kilograms back to cups", () => {
  assert.equal(Math.round(convertFromGrams(240, "cup", "milk").amount * 100) / 100, 1);
  assert.equal(convertFromGrams(1000, "kg", "water").amount, 1);
});

test("marks unknown ingredients as estimates", () => {
  const result = convertToGrams("1/2", "cup", "mystery ingredient");
  assert.equal(result.estimated, true);
  assert.equal(result.grams, 60);
});

test("converts a recipe and formats output", () => {
  const result = convertRecipeFromWeights([{ name: "Bread flour", grams: 240 }], "cup");
  assert.equal(result[0].conversion.amount, 2);
  assert.equal(formatMeasurement(1.5, "cup"), "1.5 cups");
});

test("rejects unsupported or negative input", () => {
  assert.throws(() => convertToGrams("-1", "cup", "flour"), RangeError);
  assert.throws(() => convertToGrams("1", "tbsp", "flour"), RangeError);
});
