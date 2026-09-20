import assert from "node:assert/strict";
import test from "node:test";
import { buildDryRunReport } from "../scripts/migration-dry-run.mjs";

function sampleWorkspace() {
  return {
    recipes: [
      {
        id: "recipe-1",
        name: "Test Rolls",
        status: "Approved",
        yieldCount: 4,
        desiredLoafWeightG: 60,
        ingredients: [
          { id: "ingredient-g", name: "Flour", grams: 200, unit: "g" },
          { id: "ingredient-cup", name: "Milk", grams: 0.5, unit: "cup" },
        ],
        steps: [{ id: "step-1", name: "Mix" }],
        batches: [{ id: "batch-1", finishedWeightG: 240 }],
        label: { productName: "Test Rolls Four-Pack", netWeightG: 240 },
      },
    ],
    lots: [],
    orders: [],
  };
}

test("dry run preserves ids and performs no migration actions", () => {
  const report = buildDryRunReport(sampleWorkspace(), { sourceLabel: "owner-a" });
  assert.equal(report.mode, "dry-run");
  assert.equal(report.writesPerformed, false);
  assert.deepEqual(report.preservedIds.recipes, ["recipe-1"]);
  assert.deepEqual(report.preservedIds.ingredients, ["ingredient-g", "ingredient-cup"]);
  assert.deepEqual(report.preservedIds.steps, ["step-1"]);
  assert.deepEqual(report.preservedIds.recipeTests, ["batch-1"]);
  assert.equal(report.safeguards.productionRecordsMigrated, false);
  assert.equal(report.safeguards.ownerScopesMerged, false);
});

test("gram values map directly while volume quantities remain unverified", () => {
  const report = buildDryRunReport(sampleWorkspace());
  const gram = report.nonGramIngredients.find((item) => item.ingredientId === "ingredient-g");
  const cup = report.nonGramIngredients.find((item) => item.ingredientId === "ingredient-cup");
  assert.equal(gram, undefined);
  assert.equal(cup.sourceAmount, "0.5");
  assert.equal(cup.sourceUnit, "cup");
  assert.equal(cup.canonicalGrams, null);
  assert.equal(cup.conversionStatus, "unverified");
});

test("new source-unit fields take precedence over the legacy display unit", () => {
  const workspace = sampleWorkspace();
  workspace.recipes[0].ingredients[0].sourceAmount = "1 1/2";
  workspace.recipes[0].ingredients[0].sourceUnit = "cup";
  const report = buildDryRunReport(workspace);
  const flour = report.nonGramIngredients.find((item) => item.ingredientId === "ingredient-g");
  assert.equal(flour.sourceAmount, "1 1/2");
  assert.equal(flour.sourceUnit, "cup");
  assert.equal(report.weightDiscrepancies[0].formulaWeightIncomplete, true);
});

test("approved stays approved and products remain inactive without generated skus", () => {
  const report = buildDryRunReport(sampleWorkspace());
  assert.equal(report.proposedMappings.recipes[0].proposedStatus, "Approved");
  assert.equal(report.proposedMappings.recipes[0].proposedMastered, false);
  assert.equal(report.proposedMappings.productReviewCandidates[0].proposedStatus, "candidate");
  assert.equal(report.proposedMappings.productReviewCandidates[0].proposedActive, false);
  assert.equal(report.proposedMappings.productReviewCandidates[0].proposedSku, null);
  assert.equal(report.safeguards.skusGenerated, false);
  assert.equal(report.safeguards.productsActivated, false);
  assert.equal(report.safeguards.recipesMastered, false);
});

test("weight review reports incomplete canonical weight when a non-gram row is present", () => {
  const report = buildDryRunReport(sampleWorkspace());
  const review = report.weightDiscrepancies[0];
  assert.equal(review.directCanonicalFormulaWeightG, 200);
  assert.equal(review.expectedTargetWeightG, 240);
  assert.equal(review.formulaWeightIncomplete, true);
  assert.equal(review.formulaDifferenceG, null);
  assert.equal(review.requiresOwnerReview, true);
});

test("rejects exports without a recipes array", () => {
  assert.throws(() => buildDryRunReport({ lots: [] }), /recipes array/);
});
