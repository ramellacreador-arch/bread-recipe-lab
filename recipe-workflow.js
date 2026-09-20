const SQUARE_HEADERS = ["Item Name", "Variation Name", "Description", "SKU", "Price"];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildSquareCsv(recipe) {
  const catalog = recipe.catalog || {};
  const row = [
    recipe.name || recipe.label?.productName || "",
    catalog.variationName || "Regular",
    catalog.description || "",
    catalog.sku || "",
    Number(catalog.price ?? recipe.pricing?.sellingPrice ?? 0).toFixed(2),
  ];
  return [SQUARE_HEADERS, row].map((values) => values.map(csvCell).join(",")).join("\r\n");
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function isSkuUnique(sku, recipes, recipeId = "") {
  const normalized = normalizeSku(sku);
  if (!normalized) return false;
  return !(recipes || []).some((recipe) => recipe.id !== recipeId && normalizeSku(recipe.catalog?.sku || recipe.label?.squareSku) === normalized);
}

function generateSku(recipe, recipes) {
  const words = String(recipe?.name || "ITEM").toUpperCase().match(/[A-Z0-9]+/g) || ["ITEM"];
  const base = normalizeSku(`FT-${words.map((word) => word.slice(0, 4)).join("-").slice(0, 24)}`) || "FT-ITEM";
  let candidate = base;
  let suffix = 2;
  while (!isSkuUnique(candidate, recipes, recipe?.id)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function getLabelReadiness(recipe, allergenStatement = "") {
  const label = recipe.label || {};
  const ingredients = recipe.ingredients || [];
  const weightedIngredients = ingredients.filter((item) => Number(item.grams) > 0);
  const blockers = [
    requirement("Producer identity", Boolean(label.businessName && ((label.useScdaId && label.scdaId) || (!label.useScdaId && label.address))), "Enter the producer name plus SCDA identification number or full address."),
    requirement("Standard product name", Boolean(label.productName || recipe.name), "Enter the product's standard name."),
    requirement("Ingredients by weight", weightedIngredients.length > 0 && weightedIngredients.every((item) => String(item.label || item.name || "").trim()), "Add a name or label to every ingredient with a positive canonical gram weight."),
    requirement("Valid ingredient amounts", ingredients.every((item) => {
      const grams = Number(item.grams);
      return !item.conversionError && Number.isFinite(grams) && grams >= 0;
    }), "Correct invalid ingredient amounts before printing."),
    requirement("Net quantity", Number(label.netWeightG) > 0 && Number(label.netWeightOz) > 0, "Enter net quantity in grams and ounces."),
    requirement("Allergen declaration", Boolean(allergenStatement) || label.allergenConfirmedNone, "Declare detected major allergens, or confirm that none are present."),
    requirement("Required disclosure", true, "The exact current SCDA disclosure is included."),
    requirement("No health claims", !label.healthClaims, "Remove voluntary health claims from the home-based food label."),
  ];
  const estimates = ingredients.filter((item) => item.conversionEstimated);
  const warnings = [
    warning("Conversion estimates", estimates.length === 0, estimates.length ? `${estimates.length} ingredient amount${estimates.length === 1 ? " is" : "s are"} density estimates; verify with a scale.` : "All source amounts use direct weight or known ingredient density."),
    warning("Food eligibility", !String(recipe.productType || "").match(/review|verify/i), "Confirm enriched, filled, refrigerated, or unusual products with current guidance."),
    warning("Local requirements", Boolean(label.localReviewComplete), "Confirm applicable city or county requirements."),
    warning("Allergen types", !/type not specified/i.test(allergenStatement), "Specify the fish or crustacean shellfish type when applicable."),
  ];
  return { blockers, warnings, ready: blockers.every((item) => item.ok) };
}

function requirement(title, ok, copy) {
  return { title, ok, level: ok ? "ok" : "bad", copy };
}

function warning(title, ok, copy) {
  return { title, ok, level: ok ? "ok" : "warn", copy };
}

export { buildSquareCsv, csvCell, generateSku, getLabelReadiness, isSkuUnique, normalizeSku, SQUARE_HEADERS };
