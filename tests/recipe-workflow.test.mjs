import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSquareCsv,
  generateSku,
  getLabelReadiness,
  isSkuUnique,
  normalizeSku,
} from "../recipe-workflow.js";

test("builds a Square CSV with required columns and correct escaping", () => {
  const csv = buildSquareCsv({
    name: 'Bread, "Country"',
    catalog: { variationName: "Regular", description: "Line one\nLine two", sku: "FT-001", price: 12.5 },
  });
  assert.equal(csv.split("\r\n")[0], "Item Name,Variation Name,Description,SKU,Price");
  assert.match(csv, /"Bread, ""Country"""/);
  assert.match(csv, /"Line one\nLine two"/);
  assert.match(csv, /FT-001,12\.50/);
});

test("normalizes, validates, and generates collision-free SKUs", () => {
  assert.equal(normalizeSku(" ft country loaf "), "FT-COUNTRY-LOAF");
  const recipes = [
    { id: "a", catalog: { sku: "FT-COUN-LOAF" } },
    { id: "b", catalog: { sku: "FT-COUN-LOAF-2" } },
  ];
  assert.equal(isSkuUnique("ft-coun-loaf", recipes, "b"), false);
  assert.equal(generateSku({ id: "c", name: "Country Loaf" }, recipes), "FT-COUN-LOAF-3");
});

test("label readiness separates blockers from warnings and honors estimate metadata", () => {
  const recipe = {
    name: "Country Bread",
    productType: "Shelf-stable bread",
    ingredients: [{ name: "Flour", label: "wheat flour", grams: 500, conversionEstimated: true }],
    label: {
      businessName: "Faithful & True",
      useScdaId: true,
      scdaId: "SCDA-123",
      productName: "Country Bread",
      netWeightG: 680,
      netWeightOz: 24,
      localReviewComplete: false,
    },
  };
  const result = getLabelReadiness(recipe, "Contains: Wheat");
  assert.equal(result.ready, true);
  assert.equal(result.blockers.every((item) => item.ok), true);
  assert.equal(result.warnings.find((item) => item.title === "Conversion estimates").level, "warn");
});

test("label readiness blocks printing when required identity or allergens are missing", () => {
  const result = getLabelReadiness({
    name: "",
    ingredients: [],
    label: { businessName: "", useScdaId: true, scdaId: "", netWeightG: 0, netWeightOz: 0 },
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.filter((item) => !item.ok).length >= 4);
});

test("label readiness blocks unnamed ingredients with positive weight", () => {
  const recipe = {
    name: "Country Bread",
    ingredients: [
      { name: "Flour", grams: 500 },
      { name: "  ", label: "", grams: 25 },
    ],
    label: {
      businessName: "Faithful & True",
      useScdaId: true,
      scdaId: "SCDA-123",
      netWeightG: 525,
      netWeightOz: 18.5,
    },
  };

  const result = getLabelReadiness(recipe, "Contains: Wheat");
  assert.equal(result.ready, false);
  assert.equal(result.blockers.find((item) => item.title === "Ingredients by weight").ok, false);
});

test("label readiness blocks invalid source conversions", () => {
  const recipe = {
    name: "Country Bread",
    ingredients: [{ name: "Flour", grams: Number.NaN, conversionError: "Invalid amount" }],
    label: {
      businessName: "Faithful & True",
      useScdaId: true,
      scdaId: "SCDA-123",
      netWeightG: 500,
      netWeightOz: 17.6,
    },
  };

  const result = getLabelReadiness(recipe, "Contains: Wheat");
  assert.equal(result.ready, false);
  assert.equal(result.blockers.find((item) => item.title === "Valid ingredient amounts").ok, false);
});

test("label readiness blocks negative canonical gram weights", () => {
  const recipe = {
    name: "Country Bread",
    ingredients: [
      { name: "Flour", grams: 500 },
      { name: "Salt", grams: -10 },
    ],
    label: {
      businessName: "Faithful & True",
      useScdaId: true,
      scdaId: "SCDA-123",
      netWeightG: 490,
      netWeightOz: 17.3,
    },
  };

  const result = getLabelReadiness(recipe, "Contains: Wheat");
  assert.equal(result.ready, false);
  assert.equal(result.blockers.find((item) => item.title === "Valid ingredient amounts").ok, false);
});
