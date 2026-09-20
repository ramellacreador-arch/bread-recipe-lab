import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIRECT_WEIGHT_UNITS = new Set(["g", "gram", "grams"]);

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rounded(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function normalizedUnit(value) {
  return String(value || "g").trim().toLowerCase();
}

function hasNonzeroSourceAmount(value) {
  const source = String(value ?? "").trim();
  return Boolean(source) && !/^0(?:\.0+)?$/.test(source);
}

function parseWorkspaceExport(input) {
  const candidate = input?.state && typeof input.state === "object" ? input.state : input;
  if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.recipes)) {
    throw new TypeError("Expected a Bread Recipe Lab export containing a recipes array.");
  }
  return candidate;
}

function ingredientMapping(recipe, ingredient, index) {
  const unit = normalizedUnit(ingredient.sourceUnit || ingredient.unit);
  const directWeight = DIRECT_WEIGHT_UNITS.has(unit);
  const legacyValue = ingredient.sourceAmount ?? ingredient.grams ?? 0;
  return {
    recipeId: recipe.id,
    recipeName: recipe.name || "",
    ingredientId: ingredient.id || `${recipe.id}:ingredient:${index + 1}`,
    ingredientName: ingredient.name || "",
    proposedRecipeVersionIngredientId: ingredient.id || `${recipe.id}:ingredient:${index + 1}`,
    sourceAmount: String(legacyValue),
    sourceUnit: unit,
    canonicalGrams: directWeight ? finiteNumber(ingredient.grams, 0) : null,
    conversionStatus: directWeight ? "direct_weight" : "unverified",
    preserveId: Boolean(ingredient.id),
    warning: directWeight
      ? null
      : "Non-gram quantity preserved as entered; canonical grams remain unset until an ingredient-specific conversion is verified.",
  };
}

function weightReview(recipe, ingredientMappings) {
  const formulaWeightG = ingredientMappings.reduce(
    (sum, ingredient) => sum + (ingredient.canonicalGrams ?? 0),
    0,
  );
  const hasUnverifiedWeight = ingredientMappings.some(
    (ingredient) => ingredient.conversionStatus === "unverified" && hasNonzeroSourceAmount(ingredient.sourceAmount),
  );
  const baseYieldUnits = finiteNumber(recipe.yieldCount, 0);
  const targetUnitWeightG = finiteNumber(recipe.desiredLoafWeightG, 0);
  const expectedTargetWeightG = baseYieldUnits * targetUnitWeightG;
  const formulaDifferenceG = formulaWeightG - expectedTargetWeightG;
  const labelNetWeightG = finiteNumber(recipe.label?.netWeightG, 0);
  return {
    recipeId: recipe.id,
    recipeName: recipe.name || "",
    baseYieldUnits,
    targetUnitWeightG,
    expectedTargetWeightG: rounded(expectedTargetWeightG),
    directCanonicalFormulaWeightG: rounded(formulaWeightG),
    formulaWeightIncomplete: hasUnverifiedWeight,
    formulaDifferenceG: hasUnverifiedWeight ? null : rounded(formulaDifferenceG),
    matchesTargetWithinOneGram: hasUnverifiedWeight ? false : Math.abs(formulaDifferenceG) <= 1,
    labelNetWeightG: rounded(labelNetWeightG),
    labelToTargetUnitRatio: targetUnitWeightG > 0 ? rounded(labelNetWeightG / targetUnitWeightG) : null,
    requiresOwnerReview:
      hasUnverifiedWeight ||
      Math.abs(formulaDifferenceG) > 1 ||
      (targetUnitWeightG > 0 && Math.abs(labelNetWeightG - targetUnitWeightG) > 1),
  };
}

function buildDryRunReport(input, options = {}) {
  const workspace = parseWorkspaceExport(input);
  const recipes = workspace.recipes;
  const ingredientMappings = recipes.flatMap((recipe) =>
    (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map((ingredient, index) =>
      ingredientMapping(recipe, ingredient, index),
    ),
  );
  const nonGramIngredients = ingredientMappings.filter(
    (ingredient) => ingredient.conversionStatus === "unverified",
  );
  const steps = recipes.flatMap((recipe) =>
    (Array.isArray(recipe.steps) ? recipe.steps : []).map((step, index) => ({
      recipeId: recipe.id,
      legacyStepId: step.id || null,
      proposedStepId: step.id || `${recipe.id}:step:${index + 1}`,
      preserveId: Boolean(step.id),
    })),
  );
  const tests = recipes.flatMap((recipe) =>
    (Array.isArray(recipe.batches) ? recipe.batches : []).map((batch, index) => ({
      recipeId: recipe.id,
      legacyBatchId: batch.id || null,
      proposedRecipeTestId: batch.id || `${recipe.id}:test:${index + 1}`,
      preserveId: Boolean(batch.id),
    })),
  );
  const proposedRecipeMappings = recipes.map((recipe) => ({
    legacyRecipeId: recipe.id,
    proposedRecipeId: recipe.id,
    proposedRecipeVersionId: `${recipe.id}:v1`,
    preserveRecipeId: Boolean(recipe.id),
    legacyStatus: recipe.status || "Draft",
    proposedStatus: recipe.status || "Draft",
    proposedMastered: false,
  }));
  const productReviewCandidates = recipes
    .filter((recipe) => String(recipe.label?.productName || "").trim())
    .map((recipe) => ({
      recipeId: recipe.id,
      recipeName: recipe.name || "",
      labelName: recipe.label.productName,
      proposedStatus: "candidate",
      proposedActive: false,
      proposedSku: null,
      existingSku: recipe.catalog?.sku || recipe.label?.squareSku || null,
      decision: "owner_review_required",
    }));
  const weightDiscrepancies = recipes.map((recipe) => {
    const mappings = ingredientMappings.filter((ingredient) => ingredient.recipeId === recipe.id);
    return weightReview(recipe, mappings);
  });
  const warnings = [];
  if (nonGramIngredients.length) {
    warnings.push(`${nonGramIngredients.length} non-gram ingredient row(s) require ingredient-specific conversion review.`);
  }
  const discrepantRecipes = weightDiscrepancies.filter((item) => item.requiresOwnerReview);
  if (discrepantRecipes.length) {
    warnings.push(`${discrepantRecipes.length} recipe(s) have incomplete or discrepant formula, target, or label weights.`);
  }
  if (recipes.some((recipe) => String(recipe.status).toLowerCase() === "approved")) {
    warnings.push("Approved recipes remain Approved; the dry run never proposes Mastered status.");
  }
  warnings.push("Product records are review candidates only; none are activated and no SKU is generated.");
  warnings.push("This report describes one source export only and never merges owner-scoped workspaces.");

  return {
    mode: "dry-run",
    writesPerformed: false,
    source: {
      label: options.sourceLabel || "unidentified-owner-scope",
      checksumSha256: options.checksumSha256 || null,
      revision: input?.revision ?? options.sourceRevision ?? null,
    },
    safeguards: {
      legacyWorkspacesAltered: false,
      productionRecordsMigrated: false,
      ownerScopesMerged: false,
      skusGenerated: false,
      productsActivated: false,
      recipesMastered: false,
    },
    recordCounts: {
      recipes: recipes.length,
      proposedRecipeVersions: recipes.length,
      ingredients: ingredientMappings.length,
      steps: steps.length,
      recipeTests: tests.length,
      lots: Array.isArray(workspace.lots) ? workspace.lots.length : 0,
      orders: Array.isArray(workspace.orders) ? workspace.orders.length : 0,
      productReviewCandidates: productReviewCandidates.length,
    },
    preservedIds: {
      recipes: proposedRecipeMappings.filter((item) => item.preserveRecipeId).map((item) => item.legacyRecipeId),
      ingredients: ingredientMappings.filter((item) => item.preserveId).map((item) => item.ingredientId),
      steps: steps.filter((item) => item.preserveId).map((item) => item.legacyStepId),
      recipeTests: tests.filter((item) => item.preserveId).map((item) => item.legacyBatchId),
    },
    proposedMappings: {
      recipes: proposedRecipeMappings,
      ingredients: ingredientMappings,
      steps,
      recipeTests: tests,
      productReviewCandidates,
    },
    nonGramIngredients,
    weightDiscrepancies,
    warnings,
  };
}

function parseArguments(argv) {
  const positional = [];
  let sourceLabel = "unidentified-owner-scope";
  let sourceRevision = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source-label") {
      sourceLabel = argv[++index];
    } else if (argument === "--source-revision") {
      sourceRevision = finiteNumber(argv[++index], null);
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 1) {
    throw new Error("Provide exactly one legacy export. Multiple owner-scoped exports are never merged by this tool.");
  }
  if (!sourceLabel) throw new Error("--source-label must not be blank.");
  return { inputPath: resolve(positional[0]), sourceLabel, sourceRevision };
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const sourceText = await readFile(options.inputPath, "utf8");
  const checksumSha256 = createHash("sha256").update(sourceText).digest("hex").toUpperCase();
  const parsed = JSON.parse(sourceText);
  const report = buildDryRunReport(parsed, {
    sourceLabel: options.sourceLabel,
    sourceRevision: options.sourceRevision,
    checksumSha256,
  });
  report.source.fileName = basename(options.inputPath);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export { buildDryRunReport, parseWorkspaceExport };
