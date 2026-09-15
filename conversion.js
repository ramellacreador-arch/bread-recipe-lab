const GRAMS_PER_KILOGRAM = 1000;
const GRAMS_PER_CUP = {
  flour: 120,
  sugar: 200,
  water: 236.588,
  milk: 240,
  butter: 227,
  oil: 218,
  salt: 273,
  yeast: 150,
  unknown: 120,
};

const INGREDIENT_ALIASES = [
  ["flour", ["flour", "wheat", "meal"]],
  ["sugar", ["sugar"]],
  ["water", ["water"]],
  ["milk", ["milk"]],
  ["butter", ["butter"]],
  ["oil", ["oil", "olive oil", "vegetable oil", "canola oil"]],
  ["salt", ["salt"]],
  ["yeast", ["yeast"]],
];

function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  const parts = text.split(/\s+/);
  if (parts.length === 2 && parts[1].includes("/")) {
    const [numerator, denominator] = parts[1].split("/").map(Number);
    return Number(parts[0]) + numerator / denominator;
  }
  if (text.includes("/")) {
    const [numerator, denominator] = text.split("/").map(Number);
    return numerator / denominator;
  }
  return Number(text);
}

function normalizeUnit(unit) {
  const value = String(unit || "").trim().toLowerCase();
  if (["cup", "cups", "c"].includes(value)) return "cup";
  if (["g", "gram", "grams"].includes(value)) return "g";
  if (["kg", "kilogram", "kilograms"].includes(value)) return "kg";
  return value;
}

function ingredientKey(ingredient) {
  const text = String(ingredient?.name || ingredient?.label || ingredient || "").toLowerCase();
  return INGREDIENT_ALIASES.find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0] || "unknown";
}

function conversionInfo(ingredient) {
  const key = ingredientKey(ingredient);
  return { key, gramsPerCup: GRAMS_PER_CUP[key], estimated: key === "unknown" };
}

function convertToGrams(value, unit, ingredient) {
  const amount = parseAmount(value);
  const normalizedUnit = normalizeUnit(unit);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Amount must be a non-negative number or fraction.");
  const { gramsPerCup, estimated, key } = conversionInfo(ingredient);
  const grams = normalizedUnit === "cup"
    ? amount * gramsPerCup
    : normalizedUnit === "kg"
      ? amount * GRAMS_PER_KILOGRAM
      : normalizedUnit === "g"
        ? amount
        : NaN;
  if (!Number.isFinite(grams)) throw new RangeError("Supported units are cups, grams, and kilograms.");
  return { grams, ingredientKey: key, estimated };
}

function convertFromGrams(value, unit, ingredient) {
  const grams = parseAmount(value);
  const normalizedUnit = normalizeUnit(unit);
  if (!Number.isFinite(grams) || grams < 0) throw new RangeError("Weight must be a non-negative number.");
  const { gramsPerCup, estimated, key } = conversionInfo(ingredient);
  const amount = normalizedUnit === "cup"
    ? grams / gramsPerCup
    : normalizedUnit === "kg"
      ? grams / GRAMS_PER_KILOGRAM
      : normalizedUnit === "g"
        ? grams
        : NaN;
  if (!Number.isFinite(amount)) throw new RangeError("Supported units are cups, grams, and kilograms.");
  return { amount, unit: normalizedUnit, ingredientKey: key, estimated };
}

function formatMeasurement(value, unit) {
  const normalizedUnit = normalizeUnit(unit);
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  const decimals = normalizedUnit === "cup" ? 2 : normalizedUnit === "kg" ? 3 : 1;
  const rounded = Number(amount.toFixed(decimals));
  const unitLabel = normalizedUnit === "cup" ? (rounded === 1 ? "cup" : "cups") : normalizedUnit;
  return `${rounded.toLocaleString("en-US", { maximumFractionDigits: decimals })} ${unitLabel}`;
}

function convertRecipeToWeights(ingredients) {
  return (ingredients || []).map((ingredient) => {
    const sourceUnit = normalizeUnit(ingredient.unit || "g");
    const result = convertToGrams(ingredient.amount ?? ingredient.grams ?? 0, sourceUnit, ingredient);
    return { ...ingredient, grams: result.grams, sourceUnit, estimated: result.estimated };
  });
}

function convertRecipeFromWeights(ingredients, outputUnit = "cup") {
  return (ingredients || []).map((ingredient) => ({
    ...ingredient,
    conversion: convertFromGrams(ingredient.grams ?? 0, outputUnit, ingredient),
  }));
}

export {
  convertFromGrams,
  convertRecipeFromWeights,
  convertRecipeToWeights,
  convertToGrams,
  formatMeasurement,
  ingredientKey,
  parseAmount,
};
