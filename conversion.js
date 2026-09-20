const GRAMS_PER_KILOGRAM = 1000;
const GRAMS_PER_OUNCE = 28.349523125;
const TABLESPOONS_PER_CUP = 16;
const TEASPOONS_PER_CUP = 48;
const GRAMS_PER_CUP = {
  flour: 120,
  sugar: 200,
  water: 236.588,
  milk: 240,
  butter: 227,
  oil: 218,
  salt: 273,
  yeast: 150,
  honey: 340,
  egg: 243,
  cinnamon: 125,
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
  ["honey", ["honey"]],
  ["egg", ["egg"]],
  ["cinnamon", ["cinnamon"]],
];

function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  const parts = text.split(/\s+/);
  if (parts.length === 2 && /^[-+]?\d+$/.test(parts[0]) && parts[1].includes("/")) {
    const fraction = parseFraction(parts[1]);
    if (!Number.isFinite(fraction)) return NaN;
    const whole = Number(parts[0]);
    return whole < 0 ? whole - fraction : whole + fraction;
  }
  if (text.includes("/")) {
    return parseFraction(text);
  }
  return Number(text);
}

function parseFraction(text) {
  if (!/^[-+]?\d+\s*\/\s*\d+$/.test(text)) return NaN;
  const [numerator, denominator] = text.split("/").map(Number);
  if (!denominator) return NaN;
  return numerator / denominator;
}

function normalizeUnit(unit) {
  const value = String(unit || "").trim().toLowerCase();
  if (["cup", "cups", "c"].includes(value)) return "cup";
  if (["tbsp", "tbs", "tablespoon", "tablespoons"].includes(value)) return "tbsp";
  if (["tsp", "teaspoon", "teaspoons"].includes(value)) return "tsp";
  if (["g", "gram", "grams"].includes(value)) return "g";
  if (["kg", "kilogram", "kilograms"].includes(value)) return "kg";
  if (["oz", "ounce", "ounces"].includes(value)) return "oz";
  return value;
}

function ingredientKey(ingredient) {
  const text = String(ingredient?.name || ingredient?.label || ingredient || "").toLowerCase();
  return INGREDIENT_ALIASES.find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0] || "unknown";
}

function conversionInfo(ingredient) {
  const key = ingredientKey(ingredient);
  const estimated = key === "unknown";
  return {
    key,
    gramsPerCup: GRAMS_PER_CUP[key],
    estimated,
    estimateReason: estimated
      ? "No ingredient-specific density was found; a flour-like estimate of 120 grams per cup was used."
      : "",
  };
}

function convertToGrams(value, unit, ingredient) {
  const amount = parseAmount(value);
  const normalizedUnit = normalizeUnit(unit);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Amount must be a non-negative number or fraction.");
  const { gramsPerCup, estimated, key, estimateReason } = conversionInfo(ingredient);
  const grams = normalizedUnit === "cup"
    ? amount * gramsPerCup
    : normalizedUnit === "tbsp"
      ? amount * (gramsPerCup / TABLESPOONS_PER_CUP)
      : normalizedUnit === "tsp"
        ? amount * (gramsPerCup / TEASPOONS_PER_CUP)
        : normalizedUnit === "oz"
          ? amount * GRAMS_PER_OUNCE
    : normalizedUnit === "kg"
      ? amount * GRAMS_PER_KILOGRAM
      : normalizedUnit === "g"
        ? amount
        : NaN;
  if (!Number.isFinite(grams)) {
    throw new RangeError(`Unsupported unit "${unit}". Use cups, tablespoons, teaspoons, grams, kilograms, or ounces.`);
  }
  const usesDensityEstimate = estimated && ["cup", "tbsp", "tsp"].includes(normalizedUnit);
  return { grams, ingredientKey: key, estimated: usesDensityEstimate, estimateReason: usesDensityEstimate ? estimateReason : "" };
}

function convertFromGrams(value, unit, ingredient) {
  const grams = parseAmount(value);
  const normalizedUnit = normalizeUnit(unit);
  if (!Number.isFinite(grams) || grams < 0) throw new RangeError("Weight must be a non-negative number.");
  const { gramsPerCup, estimated, key, estimateReason } = conversionInfo(ingredient);
  const amount = normalizedUnit === "cup"
    ? grams / gramsPerCup
    : normalizedUnit === "tbsp"
      ? grams / (gramsPerCup / TABLESPOONS_PER_CUP)
      : normalizedUnit === "tsp"
        ? grams / (gramsPerCup / TEASPOONS_PER_CUP)
        : normalizedUnit === "oz"
          ? grams / GRAMS_PER_OUNCE
    : normalizedUnit === "kg"
      ? grams / GRAMS_PER_KILOGRAM
      : normalizedUnit === "g"
        ? grams
        : NaN;
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Unsupported unit "${unit}". Use cups, tablespoons, teaspoons, grams, kilograms, or ounces.`);
  }
  const usesDensityEstimate = estimated && ["cup", "tbsp", "tsp"].includes(normalizedUnit);
  return {
    amount,
    unit: normalizedUnit,
    ingredientKey: key,
    estimated: usesDensityEstimate,
    estimateReason: usesDensityEstimate ? estimateReason : "",
  };
}

function formatMeasurement(value, unit) {
  const normalizedUnit = normalizeUnit(unit);
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  const decimals = ["cup", "tbsp", "tsp"].includes(normalizedUnit) ? 2 : normalizedUnit === "kg" ? 3 : 1;
  const rounded = Number(amount.toFixed(decimals));
  const unitLabel = normalizedUnit === "cup" ? (rounded === 1 ? "cup" : "cups") : normalizedUnit;
  return `${rounded.toLocaleString("en-US", { maximumFractionDigits: decimals })} ${unitLabel}`;
}

function convertRecipeToWeights(ingredients) {
  return (ingredients || []).map((ingredient) => {
    const sourceUnit = normalizeUnit(ingredient.sourceUnit || ingredient.unit || "g");
    const sourceAmount = ingredient.sourceAmount ?? ingredient.amount ?? ingredient.grams ?? 0;
    const result = convertToGrams(sourceAmount, sourceUnit, ingredient);
    return {
      ...ingredient,
      sourceAmount,
      sourceUnit,
      grams: result.grams,
      conversionEstimated: result.estimated,
      conversionEstimateReason: result.estimateReason,
    };
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
  normalizeUnit,
  parseAmount,
};
