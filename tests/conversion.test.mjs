import assert from "node:assert/strict";
import test from "node:test";
import {
  convertFromGrams,
  convertRecipeFromWeights,
  convertToGrams,
  formatMeasurement,
  normalizeUnit,
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

test("converts tablespoons and teaspoons from ingredient cup density", () => {
  assert.equal(convertToGrams("2", "tbsp", "flour").grams, 15);
  assert.equal(convertToGrams("3", "teaspoons", "sugar").grams, 12.5);
  assert.equal(convertFromGrams(15, "tablespoon", "flour").amount, 2);
});

test("converts ounces with the exact mass constant", () => {
  assert.equal(convertToGrams(1, "ounce", "flour").grams, 28.349523125);
  assert.equal(convertFromGrams(28.349523125, "oz", "flour").amount, 1);
});

test("converts grams and kilograms without density estimates", () => {
  assert.deepEqual(convertToGrams(250, "grams", "unknown").grams, 250);
  assert.equal(convertToGrams("1 1/2", "kilograms", "unknown").grams, 1500);
  assert.equal(convertToGrams(250, "g", "unknown").estimated, false);
});

test("normalizes common unit aliases", () => {
  assert.equal(normalizeUnit("Tablespoons"), "tbsp");
  assert.equal(normalizeUnit("teaspoon"), "tsp");
  assert.equal(normalizeUnit("ounces"), "oz");
  assert.equal(normalizeUnit("grams"), "g");
  assert.equal(normalizeUnit("kilograms"), "kg");
});

test("marks unknown ingredients as estimates", () => {
  const result = convertToGrams("1/2", "cup", "mystery ingredient");
  assert.equal(result.estimated, true);
  assert.equal(result.grams, 60);
  assert.match(result.estimateReason, /ingredient-specific density/i);
  assert.equal(convertToGrams("1", "oz", "mystery ingredient").estimated, false);
});

test("converts a recipe and formats output", () => {
  const result = convertRecipeFromWeights([{ name: "Bread flour", grams: 240 }], "cup");
  assert.equal(result[0].conversion.amount, 2);
  assert.equal(formatMeasurement(1.5, "cup"), "1.5 cups");
});

test("rejects unsupported or negative input", () => {
  assert.throws(() => convertToGrams("-1", "cup", "flour"), RangeError);
  assert.throws(() => convertToGrams("1", "pound", "flour"), /Unsupported unit "pound"/);
  assert.throws(() => convertToGrams("1/0", "cup", "flour"), /non-negative number or fraction/);
});
