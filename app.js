import { convertFromGrams, convertToGrams, formatMeasurement } from "./conversion.js";
import { buildSquareCsv, generateSku, getLabelReadiness, isSkuUnique, normalizeSku } from "./recipe-workflow.js";

const STORAGE_KEY = "bread-recipe-lab-v1";
const RECIPE_SEED_KEY = "bread-recipe-lab-seeds-v1";
const DISCLOSURE =
  "PROCESSED AND PREPARED BY A HOME-BASED FOOD PRODUCTION OPERATION THAT IS NOT SUBJECT TO SOUTH CAROLINA'S FOOD SAFETY REGULATIONS.";
const MAJOR_ALLERGENS = [
  "wheat",
  "milk",
  "egg",
  "soy",
  "peanuts",
  "tree nuts",
  "sesame",
  "finfish",
  "crustacean shellfish",
];
const TREE_NUT_WORDS = [
  "almond",
  "almonds",
  "pecan",
  "pecans",
  "walnut",
  "walnuts",
  "cashew",
  "cashews",
  "hazelnut",
  "hazelnuts",
  "pistachio",
  "pistachios",
  "macadamia",
  "macadamias",
];
const STORAGE_PROFILES = {
  "Room temp": { days: 1, instruction: "Use fresh-milled flour the same day, or move it to cold storage." },
  Refrigerated: { days: 7, instruction: "Refrigerate in an airtight container." },
  Frozen: { days: 90, instruction: "Freeze in an airtight, labeled container." },
  "Vacuum frozen": { days: 180, instruction: "Vacuum seal and freeze for longer storage." },
  "Whole berries cool/dry": { days: 365, instruction: "Store whole berries sealed in a cool, dry place." },
  Custom: { days: 1, instruction: "Use your own validated storage plan." },
};
const ORDER_LEAD_TIMES = {
  regular: { label: "Regular bread", hours: 12 },
  artisan: { label: "Artisan bread", hours: 24 },
  seasonal: { label: "Special seasonal bread", hours: 24 },
};
const IMPORT_PLACEHOLDER = `Paste a recipe from ChatGPT here.

Example:
My Sandwich Bread - Version 2
Yield: 2 loaves
Total dough: 920 g
500 g bread flour
320 g water
50 g milk
1 large egg
30 g honey
20 g butter
10 g salt
7 g instant yeast

Mix, rest, knead, bulk rise, shape, proof, and bake.`;
const PREFS_KEY = "bread-recipe-lab-prefs-v1";
const MAX_HISTORY = 60;
const INGREDIENT_LIBRARY = [
  { name: "Hard White Wheat", label: "fresh-milled hard white wheat flour (wheat)", role: "flour", unit: "g", allergens: "wheat", costPerKg: 2.8, favorite: true },
  { name: "Soft White Wheat", label: "fresh-milled soft white wheat flour (wheat)", role: "flour", unit: "g", allergens: "wheat", costPerKg: 2.65, favorite: true },
  { name: "Hard Red Wheat", label: "fresh-milled hard red wheat flour (wheat)", role: "flour", unit: "g", allergens: "wheat", costPerKg: 2.75, favorite: true },
  { name: "Bread flour", label: "bread flour (wheat)", role: "flour", unit: "g", allergens: "wheat", costPerKg: 1.65, favorite: false },
  { name: "Whole milk", label: "whole milk", role: "water", unit: "g", allergens: "milk", costPerKg: 1.25, favorite: true },
  { name: "Water", label: "water", role: "water", unit: "g", allergens: "", costPerKg: 0, favorite: false },
  { name: "Large egg", label: "egg", role: "add-in", unit: "g", allergens: "egg", costPerKg: 4.6, favorite: true },
  { name: "Unsalted butter", label: "unsalted butter (milk)", role: "fat", unit: "g", allergens: "milk", costPerKg: 6.8, favorite: true },
  { name: "Honey", label: "honey", role: "sweetener", unit: "g", allergens: "", costPerKg: 7.5, favorite: true },
  { name: "Brown sugar", label: "brown sugar", role: "sweetener", unit: "g", allergens: "", costPerKg: 2.4, favorite: false },
  { name: "Sea salt", label: "sea salt", role: "salt", unit: "g", allergens: "", costPerKg: 1.2, favorite: true },
  { name: "Instant yeast", label: "instant yeast", role: "yeast", unit: "g", allergens: "", costPerKg: 12, favorite: true },
  { name: "Fresh strawberries", label: "fresh strawberries", role: "add-in", unit: "g", allergens: "", costPerKg: 5.5, favorite: false },
  { name: "Very ripe bananas", label: "bananas", role: "add-in", unit: "g", allergens: "", costPerKg: 1.8, favorite: false },
  { name: "Vanilla extract", label: "vanilla extract", role: "add-in", unit: "g", allergens: "", costPerKg: 45, favorite: false },
  { name: "Cinnamon", label: "cinnamon", role: "other", unit: "g", allergens: "", costPerKg: 18, favorite: false },
];

let state = loadState();
let activeTab = new URLSearchParams(location.search).get("tab") === "label" ? "label" : "recipe";
let undoStack = [];
let redoStack = [];
let activeDragIngredientId = "";

const workspace = document.querySelector("#workspace-panel");
const recipeList = document.querySelector("#recipe-list");
const recipeCount = document.querySelector("#recipe-count");
const saveStatus = document.querySelector("#save-status");
const importFile = document.querySelector("#import-file");

applySavedTheme();
if (window.BREAD_CLOUD) {
  workspace.innerHTML = '<p role="status">Opening your private bakery workspace...</p>';
  document.querySelector('.topbar-actions').insertAdjacentHTML('beforeend', '<button class="ghost-button" id="recover-cloud-edits" type="button">Recover Edits</button><a class="ghost-button" href="/signout-with-chatgpt?return_to=%2F">Sign out</a>');
  document.querySelector('.app-shell').inert = true;
  window.breadCloud.start(() => state, (remote) => {
    state = normalizeAppState(remote);
    undoStack = [];
    redoStack = [];
    render();
  }).then(() => { render(); document.querySelector('.app-shell').inert = false; }).catch(() => {
    workspace.innerHTML = '<p>Unable to open shared recipes. Check your connection and reload.</p><a href="/">Try again</a>';
    workspace.inert = false;
    document.querySelector('.app-shell').inert = false;
    document.querySelector('.topbar-actions').inert = true;
    document.querySelector('.floating-actions').inert = true;
  });
} else render();
setInterval(() => saveState("Auto-saved"), 5000);
window.addEventListener("resize", () => fitProductLabels(document));
window.addEventListener("beforeprint", handleBeforePrint);

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.tab) {
    activeTab = target.dataset.tab;
    render();
    return;
  }

  if (target.dataset.recipeId) {
    state.activeRecipeId = target.dataset.recipeId;
    render();
    return;
  }

  const recipe = getActiveRecipe();
  const action = target.dataset.action || target.id;
  switch (action) {
    case "recover-cloud-edits":
      window.breadCloud?.recover();
      break;
    case "manual-save":
      saveState("Saved");
      showToast(window.BREAD_CLOUD ? "Check the sync status for your latest save." : "Saved.");
      updateComputedViews();
      break;
    case "generate-sku":
      rememberUndo();
      recipe.catalog.sku = generateSku(recipe, state.recipes);
      persistAndRender(`SKU ${recipe.catalog.sku} generated.`);
      break;
    case "workflow-save":
      saveState("Saved");
      showToast("Recipe saved.");
      updateComputedViews();
      break;
    case "workflow-enter":
    case "workflow-adjust":
    case "workflow-square":
      activeTab = "recipe";
      render();
      requestAnimationFrame(() => focusWorkflowTarget(action));
      break;
    case "workflow-label":
      activeTab = "label";
      render();
      requestAnimationFrame(() => document.querySelector("#label-readiness")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      break;
    case "undo-action":
      undoChange();
      break;
    case "redo-action":
      redoChange();
      break;
    case "toggle-theme":
      toggleTheme();
      break;
    case "print-recipe":
      window.print();
      break;
    case "new-recipe":
      rememberUndo();
      createRecipe();
      break;
    case "duplicate-recipe":
      rememberUndo();
      duplicateRecipe();
      break;
    case "delete-recipe":
      deleteRecipe();
      break;
    case "export-json":
      exportJson();
      break;
    case "import-json":
      importFile.click();
      break;
    case "import-chatgpt-recipe":
      importChatGptRecipe();
      break;
    case "clear-chatgpt-import":
      clearChatGptImporter();
      break;
    case "add-ingredient":
      rememberUndo();
      recipe.ingredients.push(newIngredient());
      syncRecipeDerivedFields(recipe);
      persistAndRender("Ingredient added.");
      break;
    case "add-step":
      rememberUndo();
      recipe.steps.push(newStep());
      syncRecipeDerivedFields(recipe);
      persistAndRender("Step added.");
      break;
    case "scale-to-yield":
      scaleActiveRecipeToYield();
      break;
    case "scale-by-multiplier":
      scaleActiveRecipeByMultiplier();
      break;
    case "convert-cups-to-weight":
      convertCupsToWeight(recipe);
      break;
    case "convert-weight-to-cups":
      convertWeightToCups(recipe);
      break;
    case "adjust-dough-weight":
      adjustDoughWeightMetric();
      break;
    case "adjust-flour-weight":
      adjustFlourWeightMetric();
      break;
    case "adjust-hydration":
      adjustHydrationMetric();
      break;
    case "adjust-salt":
      adjustSaltMetric();
      break;
    case "adjust-process-time":
      adjustProcessTimeMetric();
      break;
    case "add-batch":
      rememberUndo();
      addBatch();
      break;
    case "add-flour-lot":
      addFlourLot();
      break;
    case "add-order":
      addOrder();
      break;
    case "reset-order-draft":
      resetOrderDraft();
      break;
    case "mark-final":
      rememberUndo();
      recipe.status = "Final";
      persistAndRender("Recipe marked final.");
      break;
    case "copy-label":
      copyLabelText();
      break;
    case "download-barcode":
      downloadBarcode(recipe);
      break;
    case "print-label":
      printProductLabel(recipe);
      break;
    case "export-recipe-csv":
      exportRecipeCsv(recipe);
      break;
    case "export-square-csv":
      exportSquareCsv(recipe);
      break;
    case "export-recipe-pdf":
      window.print();
      break;
    default:
      if (target.dataset.generateLotCode) {
        generateLotCode(target.dataset.generateLotCode);
      }
      if (target.dataset.addLotUse) {
        addLotUse(target.dataset.addLotUse);
      }
      if (target.dataset.removeLotUse) {
        removeLotUse(target.dataset.removeLotUse, target.dataset.useId);
      }
      if (target.dataset.copyLotStorage) {
        copyLotStorage(target.dataset.copyLotStorage);
      }
      if (target.dataset.removeLot) {
        removeLot(target.dataset.removeLot);
      }
      if (target.dataset.copyPaymentRequest) {
        copyPaymentRequest(target.dataset.copyPaymentRequest);
      }
      if (target.dataset.markOrderPaid) {
        updateOrderPayment(target.dataset.markOrderPaid, "Paid");
      }
      if (target.dataset.markOrderReady) {
        updateOrderStatus(target.dataset.markOrderReady, "Ready");
      }
      if (target.dataset.markOrderPickedUp) {
        updateOrderStatus(target.dataset.markOrderPickedUp, "Picked up");
      }
      if (target.dataset.removeOrder) {
        removeOrder(target.dataset.removeOrder);
      }
      if (target.dataset.removeIngredient) {
        if (!window.confirm("Delete this ingredient row?")) return;
        rememberUndo();
        recipe.ingredients = recipe.ingredients.filter(
          (item) => item.id !== target.dataset.removeIngredient,
        );
        syncRecipeDerivedFields(recipe);
        persistAndRender("Ingredient removed.");
      }
      if (target.dataset.duplicateIngredient) {
        rememberUndo();
        duplicateIngredient(target.dataset.duplicateIngredient);
      }
      if (target.dataset.addLibraryIngredient) {
        rememberUndo();
        addLibraryIngredient(target.dataset.addLibraryIngredient);
      }
      if (target.dataset.removeStep) {
        if (!window.confirm("Delete this process step?")) return;
        rememberUndo();
        recipe.steps = recipe.steps.filter((item) => item.id !== target.dataset.removeStep);
        syncRecipeDerivedFields(recipe);
        persistAndRender("Step removed.");
      }
      if (target.dataset.removeBatch) {
        if (!window.confirm("Delete this batch record?")) return;
        rememberUndo();
        recipe.batches = recipe.batches.filter((item) => item.id !== target.dataset.removeBatch);
        persistAndRender("Batch removed.");
      }
  }
});

document.addEventListener("input", (event) => {
  handleFieldChange(event.target);
});

document.addEventListener("change", (event) => {
  handleFieldChange(event.target);
});

document.addEventListener("keydown", handleKeyboardShortcuts);
document.addEventListener("dragstart", handleIngredientDragStart);
document.addEventListener("dragover", handleIngredientDragOver);
document.addEventListener("drop", handleIngredientDrop);

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.recipes)) throw new Error("Missing recipes array.");
    state = normalizeAppState({
      activeRecipeId: parsed.activeRecipeId || parsed.recipes[0]?.id,
      recipes: parsed.recipes.map(normalizeRecipe),
      activeLotId: parsed.activeLotId,
      lots: parsed.lots || [],
      orders: parsed.orders || [],
      orderDraft: parsed.orderDraft || {},
    });
    if (!state.activeRecipeId && state.recipes[0]) state.activeRecipeId = state.recipes[0].id;
    if (!state.activeLotId && state.lots[0]) state.activeLotId = state.lots[0].id;
    saveState();
    showToast("Recipes imported.");
    render();
  } catch (error) {
    showToast(`Import failed: ${error.message}`);
  } finally {
    importFile.value = "";
  }
});

function handleFieldChange(element) {
  if (element.id === "ingredient-search") {
    filterIngredientRows(element.value);
    return;
  }

  if (element.matches("[data-order-draft-field], [data-order-field]")) {
    handleOrderFieldChange(element);
    return;
  }

  if (element.matches("[data-lot-field], [data-lot-use-field]")) {
    handleLotFieldChange(element);
    return;
  }

  if (!element.matches("[data-bind], [data-ingredient-field], [data-step-field], [data-label-field], [data-batch-field], [data-allergen-field]")) {
    return;
  }

  const recipe = getActiveRecipe();
  if (!recipe) return;
  const value = readElementValue(element);
  const previousName = recipe.name;
  const previousIngredients = snapshotRecipeIngredients(recipe);
  let shouldSyncDerivedFields = false;
  let shouldRefreshSyncedTextFields = false;
  rememberUndo();

  if (element.dataset.bind) {
    const oldSellingPrice = Number(recipe.pricing?.sellingPrice || 0);
    setDeepValue(recipe, element.dataset.bind, value);
    if (element.dataset.bind === "productType") recipe.productTypeLocked = true;
    shouldSyncDerivedFields = ["name", "yieldCount", "pricing.sellingPrice"].includes(element.dataset.bind);
    if (element.dataset.bind === "catalog.sku") {
      recipe.catalog.sku = normalizeSku(value);
      element.value = recipe.catalog.sku;
      const unique = isSkuUnique(recipe.catalog.sku, state.recipes, recipe.id);
      element.setCustomValidity(unique ? "" : "SKU must be unique across saved recipes.");
      element.setAttribute("aria-invalid", String(!unique));
    }
    if (element.dataset.bind === "pricing.sellingPrice" && (!recipe.catalog.price || Number(recipe.catalog.price) === oldSellingPrice)) {
      recipe.catalog.price = Number(value || 0);
    }
    if (element.dataset.bind === "catalog.price") recipe.pricing.sellingPrice = Number(value || 0);
  }

  if (element.dataset.ingredientField) {
    const item = recipe.ingredients.find((ingredient) => ingredient.id === element.dataset.ingredientId);
    if (item) {
      const beforeIngredient = previousIngredients.find((ingredient) => ingredient.id === item.id) || snapshotIngredientReference(item);
      item[element.dataset.ingredientField] = value;
      if (element.dataset.ingredientField === "name") applyIngredientSuggestion(item);
      if (["sourceAmount", "sourceUnit", "name"].includes(element.dataset.ingredientField)) {
        updateIngredientConversion(item);
      }
      if (element.dataset.ingredientField === "grams") {
        item.sourceAmount = String(value);
        item.sourceUnit = "g";
        item.conversionEstimated = false;
        item.conversionEstimateReason = "";
        item.conversionError = "";
      }
      if (shouldSyncIngredientReferences(element.dataset.ingredientField)) {
        syncIngredientReferencesInRecipeText(recipe, beforeIngredient, item, previousIngredients);
        shouldRefreshSyncedTextFields = true;
      }
    }
    shouldSyncDerivedFields = true;
  }

  if (element.dataset.allergenField) {
    toggleManualAllergen(recipe, element.dataset.allergenField, element.checked);
  }

  if (element.dataset.stepField) {
    const item = recipe.steps.find((step) => step.id === element.dataset.stepId);
    if (item) item[element.dataset.stepField] = value;
    shouldSyncDerivedFields = true;
  }

  if (element.dataset.labelField) {
    recipe.label[element.dataset.labelField] = value;
    if (["netWeightG", "netWeightOz"].includes(element.dataset.labelField)) {
      recipe.label.packageWeightLocked = true;
      if (element.dataset.labelField === "netWeightG") recipe.label.netWeightOz = gramsToOunces(value);
      else recipe.label.netWeightG = Math.round(Number(value) * 28.349523125 * 10) / 10;
      syncVisibleDerivedControls(recipe);
    }
  }

  if (element.dataset.batchField) {
    recipe.draftBatch[element.dataset.batchField] = value;
  }

  if (shouldSyncDerivedFields) syncRecipeDerivedFields(recipe, previousName);
  recipe.updatedAt = new Date().toISOString();
  saveState();
  if (shouldRefreshSyncedTextFields) refreshSyncedRecipeTextFields(recipe);
  updateComputedViews();
}

function readElementValue(element) {
  if (element.type === "checkbox") return element.checked;
  if (element.type === "number" || element.type === "range") return Number(element.value || 0);
  return element.value;
}

function snapshotRecipeIngredients(recipe) {
  return (recipe?.ingredients || []).map(snapshotIngredientReference);
}

function snapshotIngredientReference(ingredient) {
  return {
    id: ingredient?.id || "",
    name: ingredient?.name || "",
    label: ingredient?.label || "",
    grams: Number(ingredient?.grams || 0),
    unit: ingredient?.unit || "g",
  };
}

function shouldSyncIngredientReferences(fieldName) {
  return ["name", "label", "grams", "sourceAmount", "sourceUnit"].includes(fieldName);
}

function syncAllIngredientReferencesInRecipeText(recipe, previousIngredients) {
  if (!recipe || !Array.isArray(previousIngredients)) return;
  (recipe.ingredients || []).forEach((ingredient) => {
    const beforeIngredient = previousIngredients.find((item) => item.id === ingredient.id);
    if (beforeIngredient) {
      syncIngredientReferencesInRecipeText(recipe, beforeIngredient, ingredient, previousIngredients);
    }
  });
}

function syncIngredientReferencesInRecipeText(recipe, beforeIngredient, afterIngredient, previousIngredients = []) {
  if (!recipe || !beforeIngredient || !afterIngredient) return;
  const before = snapshotIngredientReference(beforeIngredient);
  const after = snapshotIngredientReference(afterIngredient);
  const syncText = (value) => syncIngredientReferenceText(value, before, after, previousIngredients);

  recipe.starterNote = syncText(recipe.starterNote);
  (recipe.steps || []).forEach((step) => {
    step.name = syncText(step.name);
    step.notes = syncText(step.notes);
  });
}

function refreshSyncedRecipeTextFields(recipe) {
  if (typeof document === "undefined" || !recipe) return;
  setSyncedFieldValue('[data-bind="starterNote"]', recipe.starterNote || "");
  (recipe.steps || []).forEach((step) => {
    const stepId = cssAttributeValue(step.id);
    setSyncedFieldValue(`[data-step-id="${stepId}"][data-step-field="name"]`, step.name || "");
    setSyncedFieldValue(`[data-step-id="${stepId}"][data-step-field="notes"]`, step.notes || "");
  });
}

function setSyncedFieldValue(selector, value) {
  const field = document.querySelector(selector);
  if (!field || document.activeElement === field) return;
  field.value = value;
}

function cssAttributeValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function syncIngredientReferenceText(value, before, after, previousIngredients) {
  if (!value) return value;
  let text = String(value);
  text = replaceIngredientQuantities(text, before, after, previousIngredients);
  text = replaceIngredientNames(text, before, after);
  return text;
}

function replaceIngredientQuantities(text, before, after, previousIngredients) {
  if (sameQuantity(before, after)) return text;
  const oldQuantity = quantityPattern(before);
  const newQuantity = formatIngredientQuantity(after);
  if (!oldQuantity || !newQuantity) return text;

  let updated = text;
  const terms = uniqueTextValues([
    ...ingredientTerms(before),
    ...ingredientTerms(after),
  ]);

  terms.forEach((term) => {
    const termPattern = ingredientTermPattern(term);
    if (!termPattern) return;
    const beforeTermRegex = new RegExp(`\\b${oldQuantity}\\b(?=[^.!?\\n]{0,100}${termPattern})`, "gi");
    const afterTermRegex = new RegExp(`(${termPattern}[^.!?\\n]{0,100}?)\\b${oldQuantity}\\b`, "gi");
    updated = updated.replace(beforeTermRegex, newQuantity);
    updated = updated.replace(afterTermRegex, `$1${newQuantity}`);
  });

  if (isUniquePreviousQuantity(before, previousIngredients)) {
    const globalQuantityRegex = new RegExp(`\\b${oldQuantity}\\b`, "gi");
    updated = updated.replace(globalQuantityRegex, newQuantity);
  }

  return updated;
}

function replaceIngredientNames(text, before, after) {
  let updated = text;
  const seen = new Set();
  const replacements = [
    [before.name, after.name],
    [before.label, after.label],
    [plainIngredientLabel(before.label), plainIngredientLabel(after.label)],
  ]
    .filter(([from, to]) => from && to && normalizeComparableText(from) !== normalizeComparableText(to))
    .filter(([from]) => {
      const key = normalizeComparableText(from);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(([left], [right]) => String(right).length - String(left).length);
  const protectedReplacements = [];

  replacements.forEach(([from, to]) => {
    const pattern = ingredientTermPattern(from);
    if (!pattern) return;
    updated = updated.replace(new RegExp(pattern, "gi"), (match) => {
      const token = `INGREDIENT_SYNC_TOKEN_${protectedReplacements.length}`;
      protectedReplacements.push([token, matchIngredientCase(match, to)]);
      return token;
    });
  });

  protectedReplacements.forEach(([token, replacement]) => {
    updated = updated.replaceAll(token, replacement);
  });

  return updated;
}

function ingredientTerms(ingredient) {
  return uniqueTextValues([
    ingredient.name,
    ingredient.label,
    plainIngredientLabel(ingredient.label),
    simplifyIngredientName(ingredient.name),
    simplifyIngredientName(ingredient.label),
  ]).filter((term) => term.length >= 3);
}

function plainIngredientLabel(value) {
  return String(value || "")
    .replace(/\s*\([^)]*\)/g, "")
    .trim();
}

function simplifyIngredientName(value) {
  return plainIngredientLabel(value)
    .replace(/\b(fresh[-\s]?milled|flour|berries|from|for|optional)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ingredientTermPattern(term) {
  const cleanTerm = String(term || "").trim().replace(/\s+/g, " ");
  if (!cleanTerm || cleanTerm.length < 3) return "";
  const escaped = escapeRegExp(cleanTerm).replace(/\\ /g, "\\s+");
  return `(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`;
}

function quantityPattern(ingredient) {
  const amount = Number(ingredient?.grams || 0);
  if (!Number.isFinite(amount) || amount < 0) return "";
  const amountOptions = uniqueTextValues([
    escapeRegExp(String(amount)),
    escapeRegExp(round(amount)),
    Number.isInteger(amount) ? `${amount}(?:\\.0+)?` : "",
  ]).filter(Boolean);
  const unit = String(ingredient?.unit || "g").toLowerCase();
  const unitPattern = {
    g: "(?:g|gram|grams)",
    kg: "(?:kg|kilogram|kilograms)",
    oz: "(?:oz|ounce|ounces)",
    lb: "(?:lb|lbs|pound|pounds)",
    each: "(?:each|ea)",
    tsp: "(?:tsp|teaspoon|teaspoons)",
    tbsp: "(?:tbsp|tablespoon|tablespoons)",
    cup: "(?:cup|cups)",
  }[unit] || escapeRegExp(unit);
  return `(?:${amountOptions.join("|")})\\s*${unitPattern}`;
}

function formatIngredientQuantity(ingredient) {
  const amount = Number(ingredient?.grams || 0);
  if (!Number.isFinite(amount)) return "";
  return `${round(amount)} ${ingredient?.unit || "g"}`;
}

function sameQuantity(before, after) {
  return Number(before?.grams || 0) === Number(after?.grams || 0)
    && String(before?.unit || "g") === String(after?.unit || "g");
}

function isUniquePreviousQuantity(ingredient, previousIngredients) {
  const amount = Number(ingredient?.grams || 0);
  const unit = String(ingredient?.unit || "g");
  if (!Number.isFinite(amount) || amount <= 0 || !Array.isArray(previousIngredients)) return false;
  return previousIngredients.filter((item) => (
    Number(item.grams || 0) === amount && String(item.unit || "g") === unit
  )).length === 1;
}

function uniqueTextValues(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeComparableText(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeComparableText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function matchIngredientCase(original, replacement) {
  const prefix = original.match(/^[^A-Za-z0-9]*/)?.[0] || "";
  const core = original.slice(prefix.length);
  if (core && core === core.toUpperCase()) return `${prefix}${replacement.toUpperCase()}`;
  if (core && core.charAt(0) === core.charAt(0).toUpperCase()) {
    return `${prefix}${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}`;
  }
  return `${prefix}${replacement}`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rememberUndo() {
  const snapshot = JSON.stringify(state);
  if (undoStack.at(-1) === snapshot) return;
  undoStack.push(snapshot);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

function undoChange() {
  if (!undoStack.length) {
    showToast("Nothing to undo.");
    return;
  }
  const current = JSON.stringify(state);
  const previous = undoStack.pop();
  redoStack.push(current);
  restoreStateSnapshot(previous, "Undo");
}

function redoChange() {
  if (!redoStack.length) {
    showToast("Nothing to redo.");
    return;
  }
  const current = JSON.stringify(state);
  const next = redoStack.pop();
  undoStack.push(current);
  restoreStateSnapshot(next, "Redo");
}

function restoreStateSnapshot(snapshot, message) {
  state = normalizeAppState(JSON.parse(snapshot));
  saveState();
  render();
  showToast(message);
}

function applySavedTheme() {
  let prefs = {};
  try {
    prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    prefs = {};
  }
  document.documentElement.dataset.theme = prefs.theme || "light";
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: nextTheme }));
  showToast(nextTheme === "dark" ? "Dark mode on." : "Light mode on.");
}

function handleKeyboardShortcuts(event) {
  const isCommand = event.ctrlKey || event.metaKey;
  if (isCommand && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveState("Saved");
    showToast("Saved.");
    return;
  }
  if (isCommand && event.key.toLowerCase() === "z" && !event.shiftKey) {
    event.preventDefault();
    undoChange();
    return;
  }
  if ((isCommand && event.key.toLowerCase() === "y") || (isCommand && event.shiftKey && event.key.toLowerCase() === "z")) {
    event.preventDefault();
    redoChange();
    return;
  }
  if (isCommand && event.key.toLowerCase() === "p") {
    event.preventDefault();
    if (activeTab === "label") printProductLabel(getActiveRecipe());
    else window.print();
    return;
  }
  if (event.key === "Enter" && event.target.matches("#conversion-cups, #conversion-weight")) {
    event.preventDefault();
    const recipe = getActiveRecipe();
    if (event.target.id === "conversion-cups") convertCupsToWeight(recipe);
    else convertWeightToCups(recipe);
    return;
  }
  if (event.key === "Enter" && event.target.closest(".ingredient-sheet")) {
    event.preventDefault();
    focusNextSpreadsheetField(event.target);
  }
}

function focusNextSpreadsheetField(current) {
  const fields = [...document.querySelectorAll(".ingredient-sheet input, .ingredient-sheet select, .ingredient-sheet textarea")];
  const index = fields.indexOf(current);
  const next = fields[index + 1];
  if (next) {
    next.focus();
    if (typeof next.select === "function") next.select();
    return;
  }
  const recipe = getActiveRecipe();
  rememberUndo();
  recipe.ingredients.push(newIngredient());
  syncRecipeDerivedFields(recipe);
  saveState();
  render();
  const last = document.querySelector(".ingredient-sheet tbody tr:last-child input");
  if (last) last.focus();
}

function handleIngredientDragStart(event) {
  const row = event.target.closest("[data-ingredient-row]");
  if (!row) return;
  activeDragIngredientId = row.dataset.ingredientRow;
  row.classList.add("is-dragging");
  event.dataTransfer?.setData("text/plain", activeDragIngredientId);
}

function handleIngredientDragOver(event) {
  if (!event.target.closest("[data-ingredient-row]")) return;
  event.preventDefault();
}

function handleIngredientDrop(event) {
  const row = event.target.closest("[data-ingredient-row]");
  if (!row || !activeDragIngredientId) return;
  event.preventDefault();
  const recipe = getActiveRecipe();
  const fromIndex = recipe.ingredients.findIndex((item) => item.id === activeDragIngredientId);
  const toIndex = recipe.ingredients.findIndex((item) => item.id === row.dataset.ingredientRow);
  activeDragIngredientId = "";
  document.querySelectorAll(".is-dragging").forEach((node) => node.classList.remove("is-dragging"));
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
  rememberUndo();
  const [moved] = recipe.ingredients.splice(fromIndex, 1);
  recipe.ingredients.splice(toIndex, 0, moved);
  persistAndRender("Ingredient reordered.");
}

function duplicateIngredient(ingredientId) {
  const recipe = getActiveRecipe();
  const index = recipe.ingredients.findIndex((item) => item.id === ingredientId);
  if (index < 0) return;
  const copy = { ...recipe.ingredients[index], id: uid(), name: `${recipe.ingredients[index].name} copy` };
  recipe.ingredients.splice(index + 1, 0, copy);
  syncRecipeDerivedFields(recipe);
  persistAndRender("Ingredient duplicated.");
}

function addLibraryIngredient(name) {
  const recipe = getActiveRecipe();
  const found = INGREDIENT_LIBRARY.find((entry) => entry.name === name);
  const item = newIngredient();
  item.name = found?.name || name;
  if (found) {
    item.label = found.label;
    item.role = found.role;
    item.unit = found.unit;
    item.allergens = found.allergens;
    item.costPerKg = found.costPerKg;
  }
  recipe.ingredients.push(item);
  syncRecipeDerivedFields(recipe);
  persistAndRender(`${item.name} added.`);
}

function applyIngredientSuggestion(item) {
  const found = INGREDIENT_LIBRARY.find((entry) => entry.name.toLowerCase() === String(item.name || "").toLowerCase());
  if (!found) return;
  item.label = item.label || found.label;
  item.role = item.role && item.role !== "other" ? item.role : found.role;
  item.unit = item.unit || found.unit;
  item.allergens = item.allergens || found.allergens;
  if (!Number(item.costPerKg || 0)) item.costPerKg = found.costPerKg;
}

function updateIngredientConversion(item) {
  try {
    const result = convertToGrams(item.sourceAmount, item.sourceUnit, item);
    item.grams = result.grams < 100 ? Math.round(result.grams * 10) / 10 : Math.round(result.grams);
    item.conversionEstimated = result.estimated;
    item.conversionEstimateReason = result.estimateReason || "";
    item.conversionError = "";
  } catch (error) {
    item.grams = NaN;
    item.conversionEstimated = false;
    item.conversionEstimateReason = "";
    item.conversionError = error.message;
  }
}

function syncIngredientSourceFromGrams(item) {
  try {
    const result = convertFromGrams(item.grams, item.sourceUnit || "g", item);
    item.sourceAmount = formatSourceAmount(result.amount);
    item.sourceUnit = result.unit;
    item.conversionEstimated = result.estimated;
    item.conversionEstimateReason = result.estimateReason || "";
    item.conversionError = "";
  } catch {
    item.sourceAmount = formatSourceAmount(Number(item.grams));
    item.sourceUnit = "g";
    item.conversionEstimated = false;
    item.conversionEstimateReason = "";
    item.conversionError = "";
  }
}

function filterIngredientRows(query) {
  const needle = String(query || "").trim().toLowerCase();
  document.querySelectorAll("[data-ingredient-row]").forEach((row) => {
    const haystack = row.dataset.searchText || row.textContent.toLowerCase();
    row.hidden = Boolean(needle) && !haystack.includes(needle);
  });
}

function toggleManualAllergen(recipe, allergen, checked) {
  const current = new Set(recipe.label.manualAllergens || []);
  if (checked) current.add(allergen);
  else current.delete(allergen);
  recipe.label.manualAllergens = [...current];
}

function exportRecipeCsv(recipe) {
  const rows = [
    ["Ingredient", "Source amount", "Source unit", "Canonical grams", "Baker %", "Cost per kg", "Line cost", "Notes"],
    ...recipe.ingredients.map((ingredient) => {
      const metrics = getMetrics(recipe);
      const bakerPercent = metrics.flour ? (Number(ingredient.grams || 0) / metrics.flour) * 100 : 0;
      return [
        ingredient.name,
        ingredient.sourceAmount,
        ingredient.sourceUnit || "g",
        ingredient.grams,
        round(bakerPercent),
        ingredient.costPerKg || 0,
        roundMoney(getIngredientCost(ingredient)),
        ingredient.notes || "",
      ];
    }),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(recipe.name || "recipe")}-ingredients.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportSquareCsv(recipe) {
  const itemName = recipe.name || recipe.label?.productName || "";
  const sku = recipe.catalog?.sku || "";
  const price = Number(recipe.catalog?.price ?? recipe.pricing?.sellingPrice ?? 0);

  if (!itemName) return showToast("Enter a recipe name before Square export.");
  if (!sku) return showToast("Assign a Square SKU before export.");
  if (!isSkuUnique(sku, state.recipes, recipe.id)) return showToast("This SKU is already used by another recipe. Generate or enter a unique SKU.");
  if (!(price > 0)) return showToast("Set a selling price before Square export.");
  const csv = buildSquareCsv(recipe);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(itemName)}-square-import.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Square import CSV exported.");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function setDeepValue(object, path, value) {
  const keys = path.split(".");
  let cursor = object;
  keys.slice(0, -1).forEach((key) => {
    if (!cursor[key]) cursor[key] = {};
    cursor = cursor[key];
  });
  cursor[keys.at(-1)] = value;
}

function handleLotFieldChange(element) {
  const lot = state.lots.find((item) => item.id === element.dataset.lotId);
  if (!lot) return;
  const value = readElementValue(element);

  if (element.dataset.lotField) {
    lot[element.dataset.lotField] = value;
    if (element.dataset.lotField === "storageProfile" && value !== "Custom") {
      lot.shelfDays = STORAGE_PROFILES[value]?.days || lot.shelfDays;
      lot.storageInstructions = STORAGE_PROFILES[value]?.instruction || lot.storageInstructions;
    }
  }

  if (element.dataset.lotUseField) {
    lot.draftUse[element.dataset.lotUseField] = value;
  }

  lot.updatedAt = new Date().toISOString();
  saveState();
  updateComputedViews();
}

function handleOrderFieldChange(element) {
  const value = readElementValue(element);

  if (element.dataset.orderDraftField) {
    state.orderDraft[element.dataset.orderDraftField] = value;
    if (element.dataset.orderDraftField === "recipeId") {
      const recipe = state.recipes.find((item) => item.id === value);
      if (recipe) {
        state.orderDraft.productName = recipe.label?.productName || recipe.name;
        state.orderDraft.breadType = inferOrderBreadType(recipe);
      }
    }
  }

  if (element.dataset.orderField) {
    const order = state.orders.find((item) => item.id === element.dataset.orderId);
    if (order) {
      order[element.dataset.orderField] = value;
      if (element.dataset.orderField === "paymentStatus" && value === "Paid") {
        order.amountPaid = getOrderTotal(order);
      }
      order.updatedAt = new Date().toISOString();
    }
  }

  saveState();
  updateComputedViews();
}

function render() {
  if (!getActiveRecipe()) {
    state.recipes = [makeDefaultRecipe()];
    state.activeRecipeId = state.recipes[0].id;
    saveState();
  }

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === activeTab);
  });

  renderRecipeList();
  const recipe = getActiveRecipe();
  if (activeTab === "recipe") workspace.innerHTML = renderRecipeTab(recipe);
  if (activeTab === "batch") workspace.innerHTML = renderBatchTab(recipe);
  if (activeTab === "lots") workspace.innerHTML = renderLotsTab();
  if (activeTab === "orders") workspace.innerHTML = renderOrdersTab();
  if (activeTab === "label") workspace.innerHTML = renderLabelTab(recipe);
  if (activeTab === "importer") workspace.innerHTML = renderImporterTab();
  if (activeTab === "rules") workspace.innerHTML = renderRulesTab();
  updateComputedViews();
}

function renderRecipeList() {
  recipeCount.textContent = String(state.recipes.length);
  recipeList.innerHTML = state.recipes
    .map((recipe) => {
      const metrics = getMetrics(recipe);
      return `
        <button class="recipe-card ${recipe.id === state.activeRecipeId ? "is-active" : ""}" type="button" data-recipe-id="${recipe.id}">
          <strong>${escapeHtml(recipe.name || "Untitled recipe")}</strong>
          <span>${escapeHtml(recipe.status)} / ${round(metrics.totalWeight)} g / ${round(metrics.hydration)}% hydration</span>
        </button>
      `;
    })
    .join("");
}

function renderRecipeTab(recipe) {
  const metrics = getMetrics(recipe);
  const costing = getCostMetrics(recipe);
  return `
    <datalist id="ingredient-library">
      ${INGREDIENT_LIBRARY.map((item) => `<option value="${escapeAttr(item.name)}">${escapeHtml(item.label)}</option>`).join("")}
    </datalist>

    <div class="recipe-dashboard">
      ${renderProductionWorkflow(recipe, "recipe")}
      <header class="recipe-hero">
        <div>
          <p class="eyebrow">Master recipe database</p>
          <h2>${escapeHtml(recipe.name)}</h2>
          <p>Enter the formula once. The lab keeps production math, allergens, costing, packaging, and labels in sync.</p>
        </div>
        <div class="recipe-primary-actions">
          <button class="secondary-button" data-action="export-square-csv" type="button" title="Download required Square catalog columns for template import">Export for Square</button>
          <details class="action-menu">
            <summary class="ghost-button">More</summary>
            <div class="action-menu-panel">
              <button class="ghost-button" id="duplicate-recipe" type="button" title="Duplicate recipe">Duplicate recipe</button>
              <button class="ghost-button" data-action="export-recipe-csv" type="button" title="Export ingredient CSV">Ingredient CSV</button>
              <button class="ghost-button" data-action="export-recipe-pdf" type="button" title="Print or save recipe as PDF">Print / PDF</button>
              <button class="danger-button" id="delete-recipe" type="button" title="Delete recipe">Delete recipe</button>
            </div>
          </details>
        </div>
      </header>

      ${renderRecipeInfoCard(recipe, 1)}
      ${renderProcessMethodCard(recipe, metrics, 2)}

      <div id="metric-strip" class="metric-strip dashboard-metrics"></div>

      <nav class="workflow-nav" aria-label="Recipe workflow">
        ${workflowPill("Recipe", "recipe-info")}
        ${workflowPill("Process", "process")}
        ${workflowPill("Ingredients", "ingredients")}
        ${workflowPill("Calculations", "calculations")}
        ${workflowPill("Costing", "costing")}
        ${workflowPill("Packaging", "packaging")}
      </nav>

      <div class="recipe-dashboard-grid">
        <div class="workflow-stack">
          <details class="workflow-card" id="ingredients" open>
            <summary>
              <span>3</span>
              <div>
                <strong>Ingredients</strong>
                <small>Spreadsheet entry with baker percentages and cost</small>
              </div>
            </summary>
            <div class="sheet-toolbar">
              <div class="field search-field">
                <label>Search ingredients</label>
                <input id="ingredient-search" type="search" placeholder="Type hard, milk, salt..." />
              </div>
              <div class="row-actions">
                <button class="secondary-button" id="add-ingredient" type="button">Add Ingredient</button>
              </div>
            </div>
            ${renderIngredientSuggestions(recipe)}
            <div class="table-wrap">
              <table class="data-table ingredient-sheet">
                <thead>
                  <tr>
                    <th aria-label="Reorder"></th>
                    <th>Ingredient</th>
                    <th>Source amount</th>
                    <th>Source unit</th>
                    <th>Canonical grams</th>
                    <th>Baker %</th>
                    <th>Cost/kg</th>
                    <th>Line Cost</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${recipe.ingredients.map(renderIngredientRow).join("")}
                </tbody>
              </table>
            </div>
          </details>

          <details class="workflow-card" id="calculations" open>
            <summary>
              <span>4</span>
              <div>
                <strong>Dough Calculations</strong>
                <small>Scale, hydration, dough weight, and yield</small>
              </div>
            </summary>
            <div class="calculation-grid">
              <div class="scale-box">
                <div class="field">
                  <label>Target yield count</label>
                  <input id="scale-target-yield" type="number" min="1" step="1" value="${escapeAttr(recipe.yieldCount)}" />
                </div>
                <button class="secondary-button" id="scale-to-yield" type="button">Scale</button>
              </div>
              <div class="scale-box">
                <div class="field">
                  <label>Multiplier</label>
                  <input id="scale-multiplier" type="number" min="0.1" step="0.05" value="2" />
                </div>
                <button class="secondary-button" id="scale-by-multiplier" type="button">Apply</button>
              </div>
              ${quickCalc("Flour", `${round(metrics.flour)} g`)}
              ${quickCalc("Liquid", `${round(metrics.water)} g`)}
              ${quickCalc("Salt", `${round(metrics.saltPercent)}%`)}
              ${quickCalc("Yield", `${metrics.loafYield} items`)}
            </div>
            <div class="conversion-panel">
              <div class="section-title">
                <div>
                  <h4>Ingredient measurements</h4>
                  <p class="hint">Cups use ingredient-specific density estimates. Grams remain the recipe's canonical weight.</p>
                </div>
              </div>
              <div class="form-grid compact">
                <div class="field">
                  <label for="conversion-ingredient">Ingredient</label>
                  <select id="conversion-ingredient">
                    ${recipe.ingredients.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name || "Unnamed ingredient")}</option>`).join("")}
                  </select>
                </div>
                <div class="field">
                  <label for="conversion-cups">Cup amount</label>
                  <input id="conversion-cups" type="text" inputmode="decimal" placeholder="1 1/2" />
                </div>
                <div class="field">
                  <label>Weight output</label>
                  <output id="conversion-result" class="conversion-result" for="conversion-ingredient conversion-cups" aria-live="polite">Enter a cup amount</output>
                </div>
              </div>
              <button class="secondary-button" id="convert-cups-to-weight" type="button">Convert cups to grams</button>
              <div class="form-grid compact conversion-reverse">
                <div class="field">
                  <label for="conversion-weight">Weight amount</label>
                  <input id="conversion-weight" type="number" min="0" step="0.1" placeholder="240" />
                </div>
                <div class="field">
                  <label for="conversion-weight-unit">Weight unit</label>
                  <select id="conversion-weight-unit"><option value="g">grams</option><option value="kg">kilograms</option></select>
                </div>
                <div class="field">
                  <label>Volume output</label>
                  <output id="conversion-reverse-result" class="conversion-result" for="conversion-ingredient conversion-weight conversion-weight-unit" aria-live="polite">Enter a weight</output>
                </div>
              </div>
              <button class="ghost-button" id="convert-weight-to-cups" type="button">Convert weight to cups</button>
              <div class="table-wrap conversion-table-wrap">
                <table class="data-table">
                  <thead><tr><th>Ingredient</th><th>Weight output</th><th>Approx. cups</th></tr></thead>
                  <tbody>
                    ${recipe.ingredients.filter((item) => Number(item.grams) > 0).map((item) => {
                      const conversion = convertFromGrams(item.grams, "cup", item);
                      return `<tr><td>${escapeHtml(item.name || item.label || "Unnamed ingredient")}</td><td>${escapeHtml(formatMeasurement(item.grams, "g"))} / ${escapeHtml(formatMeasurement(item.grams / 1000, "kg"))}</td><td>${escapeHtml(formatMeasurement(conversion.amount, "cup"))}${conversion.estimated ? " (estimate)" : ""}</td></tr>`;
                    }).join("") || `<tr><td colspan="3">Add ingredient weights to see recipe-wide output.</td></tr>`}
                  </tbody>
                </table>
              </div>
              <p class="hint">Unknown ingredients use a flour-like estimate and are marked as estimates. Confirm with a scale before selling or printing a final label.</p>
            </div>
          </details>

          <details class="workflow-card" id="costing" open>
            <summary>
              <span>5</span>
              <div>
                <strong>Cost Analysis</strong>
                <small>Batch cost, price, profit, and margin</small>
              </div>
            </summary>
            <div class="form-grid compact">
              ${field("Selling price/item", "number", recipe.pricing.sellingPrice, "pricing.sellingPrice")}
              ${field("Target margin (%)", "number", recipe.pricing.targetMargin, "pricing.targetMargin")}
              ${field("Package cost/item", "number", recipe.pricing.packageCost, "pricing.packageCost")}
            </div>
            <dl id="cost-summary" class="summary-list cost-summary">
              ${summaryItem("Ingredient cost", formatMoney(costing.ingredientCost))}
              ${summaryItem("Total batch cost", formatMoney(costing.batchCost))}
              ${summaryItem("Cost per item", formatMoney(costing.costPerItem))}
              ${summaryItem("Suggested price", formatMoney(costing.suggestedPrice))}
              ${summaryItem("Gross profit", formatMoney(costing.grossProfit))}
              ${summaryItem("Profit margin", `${round(costing.margin)}%`)}
            </dl>
          </details>

          <details class="workflow-card" id="square-catalog" open>
            <summary>
              <span>6</span>
              <div>
                <strong>Square Catalog</strong>
                <small>Unique SKU, product description, price, and CSV export</small>
              </div>
            </summary>
            <div class="form-grid compact">
              ${field("SKU", "text", recipe.catalog.sku, "catalog.sku")}
              ${field("Variation name", "text", recipe.catalog.variationName, "catalog.variationName")}
              ${field("Selling price", "number", recipe.catalog.price, "catalog.price")}
            </div>
            ${textareaField("Description", recipe.catalog.description, "catalog.description")}
            <div class="button-row">
              <button class="secondary-button" id="generate-sku" type="button">Generate unique SKU</button>
              <button class="primary-button" data-action="export-square-csv" type="button">Download Square CSV</button>
            </div>
            <p class="hint" id="sku-status" role="status" aria-live="polite">${escapeHtml(getSkuStatus(recipe))}</p>
            <p class="hint">Square recommends starting with the latest catalog template exported from your own Square Dashboard. Match these columns during import; enabled-location fields may also be required for multi-location catalogs.</p>
          </details>

          <details class="workflow-card" id="packaging" open>
            <summary>
              <span>7</span>
              <div>
                <strong>Packaging</strong>
                <small>Label preview, shelf life, storage, and selling notes</small>
              </div>
            </summary>
            <div class="packaging-grid">
              <div class="form-grid compact">
                ${labelField("Product name", "text", recipe.label.productName, "productName")}
                ${labelField("Net weight (g)", "number", recipe.label.netWeightG, "netWeightG")}
                ${labelField("Best by", "date", recipe.label.bestBy, "bestBy")}
                ${labelField("Lot code", "text", recipe.label.lotCode, "lotCode")}
                ${textareaField("Storage", recipe.label.storage, "storage", "label")}
              </div>
              <div class="mini-label-preview">${renderLabelPreview(recipe)}</div>
            </div>
          </details>
        </div>

        <aside class="command-panel">
          <section class="summary-panel">
            <h3>Formula Summary</h3>
            <dl id="formula-summary" class="summary-list"></dl>
          </section>
          <section class="summary-panel">
            <h3>Allergens</h3>
            ${renderAllergenControls(recipe)}
            <p class="hint ingredient-statement"><strong>Ingredient statement:</strong> ${escapeHtml(getIngredientStatement(recipe) || "Add ingredients to generate statement.")}</p>
          </section>
          <section class="summary-panel">
            <h3>Production Sheet</h3>
            <p class="hint">Print from this screen for a production sheet or save as PDF from the print dialog.</p>
            <div class="button-row">
              <button class="secondary-button" data-action="print-recipe" type="button">Print Recipe</button>
              <button class="ghost-button" data-action="export-recipe-csv" type="button">Export CSV</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  `;
}

function renderRecipeInfoCard(recipe, stepNumber) {
  return `
    <details class="workflow-card recipe-info-card" id="recipe-info" open>
      <summary>
        <span>${stepNumber}</span>
        <div>
          <strong>Recipe Information</strong>
          <small>Name, category, yield, status, and environment</small>
        </div>
      </summary>
      <div class="form-grid compact">
        ${field("Recipe name", "text", recipe.name, "name")}
        ${selectField("Status", recipe.status, "status", ["Testing", "Approved", "Production", "Draft", "Final"])}
        ${selectField("Category", recipe.productType, "productType", [
          "Shelf-stable bread",
          "Commercial-starter sourdough bread",
          "Shelf-stable rolls",
          "Enriched bread - review ingredients",
          "Quick bread - review ingredients",
          "Other - verify allowed",
        ])}
        ${field("Yield", "number", recipe.yieldCount, "yieldCount")}
        ${field("Target item weight (g)", "number", recipe.desiredLoafWeightG, "desiredLoafWeightG")}
        ${field("Room temp (F)", "number", recipe.environment.roomTempF, "environment.roomTempF")}
        ${field("Dough temp target (F)", "number", recipe.environment.targetDoughTempF, "environment.targetDoughTempF")}
        ${field("Humidity (%)", "number", recipe.environment.humidity, "environment.humidity")}
      </div>
    </details>
  `;
}

function renderProcessMethodCard(recipe, metrics, stepNumber) {
  return `
    <details class="workflow-card process-method-card" id="process" open>
      <summary>
        <span>${stepNumber}</span>
        <div>
          <strong>Process Timeline</strong>
          <small>Recipe notes, mixing, rising, shaping, baking, and cooling</small>
        </div>
      </summary>
      <div>
        <div class="timeline-toolbar">
          <button class="secondary-button" id="add-step" type="button">Add Step</button>
          <span class="hint">Total process: <strong>${formatMinutes(metrics.processMinutes)}</strong></span>
        </div>
        <div class="process-timeline process-method">
          ${recipe.steps.map(renderStepRow).join("")}
        </div>
        <div class="process-notes-panel process-notes-bottom">
          ${textareaField("Fresh-milled notes / recipe notes", recipe.starterNote, "starterNote")}
        </div>
      </div>
    </details>
  `;
}

function workflowPill(label, targetId) {
  return `<a href="#${targetId}">${label}</a>`;
}

function renderProductionWorkflow(recipe, currentTab) {
  const metrics = getMetrics(recipe);
  const readiness = getLabelReadiness(recipe, getAllergenStatement(recipe, true));
  const steps = [
    ["Enter", "workflow-enter", Boolean(recipe.name && recipe.ingredients.some((item) => Number(item.grams) > 0))],
    ["Save", "workflow-save", Boolean(recipe.updatedAt)],
    ["Adjust", "workflow-adjust", metrics.totalWeight > 0 && Number(recipe.yieldCount) > 0],
    ["Square", "workflow-square", Boolean(recipe.catalog.sku && isSkuUnique(recipe.catalog.sku, state.recipes, recipe.id) && Number(recipe.catalog.price) > 0)],
    ["Label", "workflow-label", readiness.ready],
  ];
  return `
    <nav class="production-workflow" aria-label="Recipe production workflow">
      <p>Production workflow</p>
      <ol>
        ${steps.map(([label, action, complete]) => `
          <li class="${complete ? "is-complete" : ""}">
            <button type="button" data-action="${action}" ${currentTab === "label" && action === "workflow-label" ? 'aria-current="step"' : ""}>
              <span aria-hidden="true">${complete ? "✓" : steps.findIndex((step) => step[0] === label) + 1}</span>
              ${label}
            </button>
          </li>
        `).join("")}
      </ol>
    </nav>
  `;
}

function focusWorkflowTarget(action) {
  const selector = {
    "workflow-enter": '[data-bind="name"]',
    "workflow-adjust": "#calculations",
    "workflow-square": "#square-catalog",
  }[action];
  const target = document.querySelector(selector);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (target?.matches("input, button, select, textarea")) target.focus();
  else target?.querySelector("input, button, select, textarea")?.focus();
}

function quickCalc(label, value) {
  return `
    <div class="quick-calc">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderIngredientSuggestions(recipe) {
  const usedNames = new Set((recipe.ingredients || []).map((item) => String(item.name || "").toLowerCase()).filter(Boolean));
  const favorites = INGREDIENT_LIBRARY.filter((item) => item.favorite);
  const recent = (recipe.ingredients || [])
    .filter((item) => item.name)
    .slice(-4)
    .map((item) => item.name);

  return `
    <div class="ingredient-suggestion-row">
      <span>Favorites</span>
      ${favorites.map((item) => `<button class="chip-button" type="button" title="Add favorite ingredient" data-add-library-ingredient="${escapeAttr(item.name)}">${escapeHtml(item.name)}</button>`).join("")}
      ${recent.length ? `<span>Recent</span>${recent.map((name) => `<button class="chip-button muted" type="button" title="Add recently used ingredient" data-add-library-ingredient="${escapeAttr(name)}">${escapeHtml(name)}</button>`).join("")}` : ""}
    </div>
  `;
}

function renderAllergenControls(recipe) {
  const statement = getAllergenStatement(recipe, false);
  const detected = statement.toLowerCase();
  const manual = new Set(recipe.label.manualAllergens || []);
  return `
    <div class="allergen-grid">
      ${MAJOR_ALLERGENS.map((allergen) => {
        const checked = detected.includes(allergen) || manual.has(allergen);
        return `
          <label class="checkbox-row allergen-check">
            <input type="checkbox" data-allergen-field="${escapeAttr(allergen)}" ${checked ? "checked" : ""} />
            <span>${escapeHtml(title(allergen))}</span>
          </label>
        `;
      }).join("")}
    </div>
    <p class="hint">${escapeHtml(getAllergenStatement(recipe, true) || "No major allergens detected yet.")}</p>
  `;
}

function renderRecipeTabOld(recipe) {
  return `
    <div class="section-title">
      <div>
        <h2>${escapeHtml(recipe.name)}</h2>
        <p>Build the formula, capture the process, and keep baker's math visible while you test.</p>
      </div>
      <div class="row-actions">
        <button class="ghost-button" id="duplicate-recipe" type="button">Duplicate</button>
        <button class="danger-button" id="delete-recipe" type="button">Delete</button>
      </div>
    </div>

    <div id="metric-strip" class="metric-strip"></div>

    <div class="panel-grid">
      <div>
        <section class="section-band">
          <h3>Recipe Setup</h3>
          <div class="form-grid">
            ${field("Recipe name", "text", recipe.name, "name")}
            ${selectField("Status", recipe.status, "status", ["Draft", "Testing", "Final"])}
            ${selectField("Product type", recipe.productType, "productType", [
              "Shelf-stable bread",
              "Commercial-starter sourdough bread",
              "Shelf-stable rolls",
              "Enriched bread - review ingredients",
              "Other - verify allowed",
            ])}
            ${field("Yield count", "number", recipe.yieldCount, "yieldCount")}
            ${field("Target dough temp (F)", "number", recipe.environment.targetDoughTempF, "environment.targetDoughTempF")}
            ${field("Room temp (F)", "number", recipe.environment.roomTempF, "environment.roomTempF")}
            ${field("Humidity (%)", "number", recipe.environment.humidity, "environment.humidity")}
            ${field("Starter note", "text", recipe.starterNote, "starterNote")}
            ${field("Desired loaf weight (g)", "number", recipe.desiredLoafWeightG, "desiredLoafWeightG")}
          </div>
        </section>

        <section class="section-band">
          <div class="section-title">
            <div>
              <h3>Scale Recipe</h3>
              <p>Resize the formula by yield or multiplier. Process times stay unchanged so you can adjust them after testing.</p>
            </div>
          </div>
          <div class="scale-grid">
            <div class="scale-box">
              <div class="field">
                <label>Target yield count</label>
                <input id="scale-target-yield" type="number" min="1" step="1" value="${escapeAttr(recipe.yieldCount)}" />
              </div>
              <button class="secondary-button" id="scale-to-yield" type="button">Scale To Yield</button>
            </div>
            <div class="scale-box">
              <div class="field">
                <label>Multiplier</label>
                <input id="scale-multiplier" type="number" min="0.1" step="0.05" value="2" />
              </div>
              <button class="secondary-button" id="scale-by-multiplier" type="button">Apply Multiplier</button>
            </div>
          </div>
        </section>

        <section class="section-band">
          <div class="section-title">
            <div>
              <h3>Ingredients</h3>
              <p>Rows sort into the label by weight. Starter is counted as half flour and half water for quick math.</p>
            </div>
            <button class="secondary-button" id="add-ingredient" type="button">Add Ingredient</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Label wording</th>
                  <th>Grams</th>
                  <th>Role</th>
                  <th>Baker %</th>
                  <th>Allergens</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${recipe.ingredients.map(renderIngredientRow).join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section class="section-band">
          <div class="section-title">
            <div>
              <h3>Process</h3>
              <p>Track kneading, rests, rise windows, proofing, bake, and cooling as repeatable steps.</p>
            </div>
            <button class="secondary-button" id="add-step" type="button">Add Step</button>
          </div>
          <div class="table-wrap">
            <table class="data-table process-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Minutes</th>
                  <th>Temp note</th>
                  <th>Instructions</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${recipe.steps.map(renderStepRow).join("")}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <aside class="summary-panel">
        <h3>Formula Summary</h3>
        <dl id="formula-summary" class="summary-list"></dl>
        <p class="hint">For high-stakes sale decisions, confirm ingredient and process eligibility with SCDA or your local jurisdiction before printing labels.</p>
      </aside>
    </div>
  `;
}

function renderBatchTab(recipe) {
  const batch = recipe.draftBatch;
  return `
    <div class="section-title">
      <div>
        <h2>Batch Log</h2>
        <p>Capture the kitchen conditions and outcome for each test bake.</p>
      </div>
      <span class="status-pill">${recipe.batches.length} saved</span>
    </div>

    <div class="wide-grid">
      <section class="section-band">
        <h3>New Batch</h3>
        <div class="form-grid two">
          ${batchField("Batch or lot code", "text", batch.lotCode, "lotCode")}
          ${batchField("Bake date", "date", batch.bakeDate, "bakeDate")}
          ${batchField("Room temp (F)", "number", batch.roomTempF, "roomTempF")}
          ${batchField("Humidity (%)", "number", batch.humidity, "humidity")}
          ${batchField("Dough temp after mix (F)", "number", batch.doughTempF, "doughTempF")}
          ${batchField("Water temp (F)", "number", batch.waterTempF, "waterTempF")}
          ${batchField("Kneading time (min)", "number", batch.kneadMinutes, "kneadMinutes")}
          ${batchField("Bulk rise time (min)", "number", batch.bulkMinutes, "bulkMinutes")}
          ${batchField("Proof time (min)", "number", batch.proofMinutes, "proofMinutes")}
          ${batchField("Bake time (min)", "number", batch.bakeMinutes, "bakeMinutes")}
          ${batchField("Finished weight (g)", "number", batch.finishedWeightG, "finishedWeightG")}
          ${batchField("Outcome rating", "range", batch.rating, "rating", "1", "10")}
        </div>
        <div class="form-grid two">
          ${textareaField("Result notes", batch.notes, "notes", "batch")}
          ${textareaField("Next adjustment", batch.adjustment, "adjustment", "batch")}
        </div>
        <div class="button-row">
          <button class="primary-button" id="add-batch" type="button">Save Batch</button>
          <span class="hint">Current rating: <strong id="rating-output">${batch.rating}</strong>/10</span>
        </div>
      </section>

      <section>
        <h3>Saved Batches</h3>
        <div class="journal-list">
          ${
            recipe.batches.length
              ? recipe.batches.map(renderBatchEntry).join("")
              : `<div class="empty-state">No batches yet. Save your next test bake here.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderLotsTab() {
  const lots = state.lots || [];
  return `
    <div class="section-title">
      <div>
        <h2>Flour Lots</h2>
        <p>Track fresh-milled flour or whole-grain lots, generated codes, shelf time, usage, availability, and storage instructions.</p>
      </div>
      <button class="primary-button" id="add-flour-lot" type="button">Add Flour Lot</button>
    </div>

    <div class="lot-list">
      ${
        lots.length
          ? lots.map(renderLotCard).join("")
          : `<div class="empty-state">No flour lots yet. Add a lot when you mill grain or open a stored grain batch.</div>`
      }
    </div>
  `;
}

function renderLotCard(lot) {
  const bestBy = getLotBestBy(lot);
  const available = getLotAvailableGrams(lot);
  return `
    <article class="lot-card">
      <div class="lot-card-header">
        <div>
          <h3>${escapeHtml(lot.name || "Fresh-Milled Flour")}</h3>
          <span class="lot-code">${escapeHtml(lot.lotCode || "No lot code")}</span>
        </div>
        <div class="row-actions">
          <button class="ghost-button" type="button" data-generate-lot-code="${lot.id}">Generate Code</button>
          <button class="secondary-button" type="button" data-copy-lot-storage="${lot.id}">Copy Storage</button>
          <button class="danger-button" type="button" data-remove-lot="${lot.id}">Delete</button>
        </div>
      </div>

      <div class="form-grid">
        ${lotField(lot, "Lot name", "text", "name")}
        ${lotField(lot, "Grain or flour", "text", "grain")}
        ${lotField(lot, "Lot code", "text", "lotCode")}
        ${lotField(lot, "Milled date", "date", "milledDate")}
        ${lotField(lot, "Milled time", "time", "milledTime")}
        ${lotSelect(lot, "Storage", "storageProfile", Object.keys(STORAGE_PROFILES))}
        ${lotField(lot, "Shelf days", "number", "shelfDays")}
        ${lotField(lot, "Grams milled", "number", "gramsMilled")}
        ${lotField(lot, "Safety reserve (g)", "number", "reserveGrams")}
      </div>

      <div class="lot-metrics">
        ${metricCard("Available", `<span data-lot-available="${lot.id}">${round(available)} g</span>`)}
        ${metricCard("Used", `<span data-lot-used="${lot.id}">${round(getLotUsedGrams(lot))} g</span>`)}
        ${metricCard("Best by", `<span data-lot-best-by="${lot.id}">${escapeHtml(bestBy || "Set date")}</span>`)}
      </div>

      <div class="form-grid two">
        ${textareaFieldForLot(lot, "Storage instructions", "storageInstructions")}
        ${textareaFieldForLot(lot, "Lot notes", "notes")}
      </div>

      <section class="section-band">
        <h4>Log Usage</h4>
        <div class="form-grid">
          ${lotUseField(lot, "Use date", "date", "date")}
          ${lotUseField(lot, "Used grams", "number", "grams")}
          ${lotUseField(lot, "Recipe or note", "text", "note")}
        </div>
        <div class="button-row">
          <button class="secondary-button" type="button" data-add-lot-use="${lot.id}">Add Use</button>
          <span class="hint">Availability updates after each usage entry.</span>
        </div>
        <div class="lot-use-list">
          ${
            lot.uses.length
              ? lot.uses.map((use) => renderLotUse(lot, use)).join("")
              : `<div class="empty-state">No usage logged for this lot.</div>`
          }
        </div>
      </section>
    </article>
  `;
}

function renderLotUse(lot, use) {
  return `
    <div class="lot-use-row">
      <span>${escapeHtml(use.date || "No date")} / ${round(use.grams)} g / ${escapeHtml(use.note || "No note")}</span>
      <button class="remove-button" type="button" data-remove-lot-use="${lot.id}" data-use-id="${use.id}">x</button>
    </div>
  `;
}

function renderOrdersTab() {
  const draft = state.orderDraft;
  const openOrders = state.orders.filter((order) => order.status !== "Picked up" && order.status !== "Cancelled");
  const unpaidTotal = state.orders.reduce((total, order) => total + Math.max(0, getOrderTotal(order) - Number(order.amountPaid || 0)), 0);
  return `
    <div class="section-title">
      <div>
        <h2>Orders and Payments</h2>
        <p>Create customer orders, calculate bread-ready times, and track manual payments.</p>
      </div>
      <div class="row-actions">
        <span class="status-pill">${openOrders.length} open</span>
        <span class="status-pill">${formatMoney(unpaidTotal)} unpaid</span>
      </div>
    </div>

    <div class="order-layout">
      <section class="section-band">
        <h3>New Order</h3>
        <div class="form-grid two">
          ${orderDraftField("Customer name", "text", draft.customerName, "customerName")}
          ${orderDraftField("Phone or email", "text", draft.contact, "contact")}
          ${orderRecipeSelect(draft)}
          ${orderDraftField("Product name", "text", draft.productName, "productName")}
          ${orderBreadTypeSelect(draft)}
          ${orderDraftField("Quantity", "number", draft.quantity, "quantity")}
          ${orderDraftField("Unit price", "number", draft.unitPrice, "unitPrice")}
          ${orderPaymentStatusSelect(draft)}
          ${orderDraftField("Amount paid", "number", draft.amountPaid, "amountPaid")}
          ${orderPaymentMethodSelect(draft)}
          ${orderDraftField("Order placed", "datetime-local", draft.orderedAt, "orderedAt")}
          ${orderDraftField("Payment link/reference", "text", draft.paymentLink, "paymentLink")}
        </div>
        ${orderDraftTextarea("Customer notes", draft.notes, "notes")}
        <div class="button-row">
          <button class="primary-button" id="add-order" type="button">Place Order</button>
          <button class="ghost-button" id="reset-order-draft" type="button">Clear</button>
        </div>
        <div id="order-preview" class="order-preview"></div>
      </section>

      <section>
        <h3>Order Board</h3>
        <div class="order-list">
          ${
            state.orders.length
              ? state.orders.map(renderOrderCard).join("")
              : `<div class="empty-state">No orders yet. Create the first order from the form.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderOrderCard(order) {
  const total = getOrderTotal(order);
  const balance = Math.max(0, total - Number(order.amountPaid || 0));
  return `
    <article class="order-card">
      <div class="order-card-header">
        <div>
          <h3>${escapeHtml(order.productName || "Bread order")}</h3>
          <span class="hint">${escapeHtml(order.customerName || "No customer")} / ${escapeHtml(order.contact || "No contact")}</span>
        </div>
        <div class="row-actions">
          <button class="ghost-button" type="button" data-copy-payment-request="${order.id}">Copy Pay Text</button>
          <button class="danger-button" type="button" data-remove-order="${order.id}">Delete</button>
        </div>
      </div>
      <div class="order-meta">
        <span class="mini-pill">${escapeHtml(getOrderTypeLabel(order.breadType))}</span>
        <span class="mini-pill">Ready ${escapeHtml(formatDateTime(order.readyAt))}</span>
        <span class="mini-pill">${escapeHtml(order.status)}</span>
        <span class="mini-pill">${escapeHtml(order.paymentStatus)}</span>
      </div>
      <div class="order-money">
        <strong>Total ${formatMoney(total)}</strong>
        <strong>Paid ${formatMoney(order.amountPaid)}</strong>
        <strong>Balance ${formatMoney(balance)}</strong>
      </div>
      <div class="form-grid two">
        ${orderSelectField(order, "Status", "status", ["Placed", "In production", "Ready", "Picked up", "Cancelled"])}
        ${orderSelectField(order, "Payment", "paymentStatus", ["Unpaid", "Deposit paid", "Paid", "Refunded"])}
        ${orderNumberField(order, "Amount paid", "amountPaid")}
        ${orderSelectField(order, "Method", "paymentMethod", ["Cash", "Card", "Venmo", "PayPal", "Zelle", "Check", "Other"])}
      </div>
      ${order.notes ? `<p class="hint">${escapeHtml(order.notes)}</p>` : ""}
      <div class="button-row">
        <button class="secondary-button" type="button" data-mark-order-paid="${order.id}">Mark Paid</button>
        <button class="secondary-button" type="button" data-mark-order-ready="${order.id}">Mark Ready</button>
        <button class="ghost-button" type="button" data-mark-order-picked-up="${order.id}">Picked Up</button>
      </div>
    </article>
  `;
}

function renderOrderPreview(draft) {
  const preview = getOrderPreview(draft);
  return `
    <dl>
      ${summaryItem("Ready time", formatDateTime(preview.readyAt))}
      ${summaryItem("Lead time", `${preview.leadHours} hours`)}
      ${summaryItem("Order total", formatMoney(preview.total))}
      ${summaryItem("Amount paid", formatMoney(draft.amountPaid))}
      ${summaryItem("Balance", formatMoney(preview.balance))}
    </dl>
    <p class="hint">Regular bread is ready in 12 hours. Artisan and special seasonal breads are ready in 24 hours.</p>
  `;
}

function renderLabelTab(recipe) {
  const readiness = getRecipeLabelReadiness(recipe);
  return `
    ${renderProductionWorkflow(recipe, "label")}
    <div class="section-title">
      <div>
        <h2>Product Label</h2>
        <p>Generate a print-ready cottage bakery label from the finalized formula.</p>
      </div>
      <div class="row-actions">
        <button class="ghost-button" id="mark-final" type="button">Mark Final</button>
        <button class="secondary-button" id="copy-label" type="button">Copy Text</button>
        <button class="primary-button" id="print-label" type="button" ${readiness.ready ? "" : "disabled"}>Print Labels</button>
      </div>
    </div>

    <div class="label-layout">
      <div class="label-controls">
        <section class="section-band">
          <h3>Business and Package</h3>
          <div class="form-grid two">
            ${labelField("Business name", "text", recipe.label.businessName, "businessName")}
            ${labelField("Product name", "text", recipe.label.productName, "productName")}
            ${labelField("Street address", "text", recipe.label.address, "address")}
            ${labelField("SCDA Home-based Food ID", "text", recipe.label.scdaId, "scdaId")}
            ${labelField("Net weight (g)", "number", recipe.label.netWeightG, "netWeightG")}
            ${labelField("Net weight (oz)", "number", recipe.label.netWeightOz, "netWeightOz")}
            ${labelField("Lot code", "text", recipe.label.lotCode, "lotCode")}
            ${labelField("Baked on", "date", recipe.label.bakedOn, "bakedOn")}
            ${labelField("Packaged on", "date", recipe.label.packageDate, "packageDate")}
            ${labelField("Best by", "date", recipe.label.bestBy, "bestBy")}
            ${labelField("Contact", "text", recipe.label.contact, "contact")}
            ${labelField("GTIN / UPC (optional)", "text", recipe.label.gtin, "gtin")}
          </div>
          <div class="barcode-tools">
            <p class="hint">The barcode uses the recipe's Square SKU. Leave GTIN blank unless you have a legitimate GS1-issued number.</p>
            <div class="barcode-preview">${renderBarcode(recipe.catalog.sku)}</div>
            <button class="ghost-button" id="download-barcode" type="button">Download Code 128 barcode</button>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" data-label-field="useScdaId" ${recipe.label.useScdaId ? "checked" : ""} />
            Use SCDA ID instead of street address
          </label>
          <label class="checkbox-row">
            <input type="checkbox" data-label-field="localReviewComplete" ${recipe.label.localReviewComplete ? "checked" : ""} />
            Local city or county requirements checked
          </label>
          <label class="checkbox-row">
            <input type="checkbox" data-label-field="allergenConfirmedNone" ${recipe.label.allergenConfirmedNone ? "checked" : ""} />
            I reviewed the formula and no major allergens are present
          </label>
          <div class="form-grid two">
            ${selectLabelField("Allergen statement", recipe.label.allergenMode, "allergenMode", [
              ["detected", "List detected allergens"],
              ["allMajor", "May contain any major allergen"],
            ])}
            ${labelField("Voluntary health claims", "text", recipe.label.healthClaims, "healthClaims")}
          </div>
          ${textareaField("Storage or handling note", recipe.label.storage, "storage", "label")}
          <h3>Label Design</h3>
          ${selectLabelField("Print style", recipe.label.printStyle, "printStyle", [["thermal", "Black and white thermal"], ["color", "Original logo colors"]])}
          <label class="checkbox-row"><input type="checkbox" data-label-field="wholeGrainBadge" ${recipe.label.wholeGrainBadge ? "checked" : ""} />100% fresh-milled whole grain badge</label>
          ${labelField("Product tagline", "text", recipe.label.tagline, "tagline")}
          ${textareaField("Scripture", recipe.label.scripture, "scripture", "label")}
          ${labelField("Scripture reference", "text", recipe.label.scriptureReference, "scriptureReference")}
        </section>

        <section class="section-band" id="label-readiness">
          <div class="readiness-heading">
            <div>
              <h3>Label Readiness</h3>
              <p>${readiness.ready ? "Required label information is present." : `${readiness.blockers.filter((item) => !item.ok).length} blocking requirement(s) remain.`}</p>
            </div>
            <span class="status-pill ${readiness.ready ? "ready" : "not-ready"}">${readiness.ready ? "Ready to print" : "Not ready"}</span>
          </div>
          <div id="label-checklist" class="checklist">${renderReadinessChecklist(readiness)}</div>
          <p class="hint">Preparation aid only. Final label accuracy and legal compliance remain the operator's responsibility.</p>
        </section>
      </div>

      <section class="label-panel">
        <p class="hint">4 x 6 in portrait · FT-LBL-002</p>
        <div id="label-print-guard" class="label-print-guard${readiness.ready ? "" : " is-visible"}">${renderLabelPrintGuard(readiness)}</div>
        <div id="label-preview" class="label-preview"></div>
        <p id="label-fit-message" class="hint" role="status"></p>
      </section>
    </div>
  `;
}

function renderImporterTab() {
  return `
    <div class="section-title">
      <div>
        <h2>Paste From ChatGPT</h2>
        <p>Drop in a recipe conversation, formula, or rough notes. The importer looks for gram amounts, yield, title, process steps, and common bread ingredients.</p>
      </div>
    </div>

    <div class="import-layout">
      <section class="section-band">
        <h3>Recipe Text</h3>
        <textarea id="chatgpt-import-text" class="import-textarea" placeholder="${escapeAttr(IMPORT_PLACEHOLDER)}"></textarea>
        <div class="button-row">
          <button class="primary-button" id="import-chatgpt-recipe" type="button">Import Recipe</button>
          <button class="ghost-button" id="clear-chatgpt-import" type="button">Clear</button>
          <span class="hint">Nothing leaves this browser.</span>
        </div>
      </section>

      <aside class="summary-panel">
        <h3>What It Understands</h3>
        <div class="import-results">
          <div class="import-result">
            <strong>Amounts</strong>
            <span class="small-copy">Gram lines like "500 g flour" and common egg lines like "1 large egg".</span>
          </div>
          <div class="import-result">
            <strong>Yield</strong>
            <span class="small-copy">Phrases like "yielded 4 buns", "Yield: 2 loaves", or "makes 12 rolls".</span>
          </div>
          <div class="import-result">
            <strong>Process</strong>
            <span class="small-copy">Instruction lines with mix, rest, knead, rise, shape, proof, bake, or tangzhong.</span>
          </div>
          <div class="import-result">
            <strong>Review Needed</strong>
            <ul class="small-copy">
              <li>Check guessed weights for eggs or volume-only ingredients.</li>
              <li>Review cottage-food eligibility for enriched breads.</li>
              <li>Confirm the final label before selling.</li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  `;
}

function renderRulesTab() {
  return `
    <div class="section-title">
      <div>
        <h2>Rules Snapshot</h2>
        <p>Built from sources checked July 6, 2026. This is a practical checklist, not legal advice; verify every requirement against current SCDA guidance before sale.</p>
      </div>
    </div>
    <div class="rules-grid">
      <section class="source-panel">
        <h3>South Carolina Cottage Food</h3>
        <ul class="source-list">
          <li>SCDA says it does not issue permits, licenses, certificates, or registrations for home-based food production operators, but it can provide an ID number on request.</li>
          <li>Allowed cottage food must be non-time/temperature controlled for safety and made in the home kitchen.</li>
          <li>Food must be sold directly to consumers, including online or mail order, or to retail stores within South Carolina.</li>
          <li>South Carolina Code Section 44-1-143 says local ordinances can apply, so local review still matters.</li>
        </ul>
      </section>
      <section class="source-panel">
        <h3>Required Label Fields</h3>
        <ul class="source-list">
          <li>Name and address of the home-based food operation, or the SCDA Home-based Food ID number.</li>
          <li>Standard product name.</li>
          <li>Ingredients in descending order by weight.</li>
          <li>The exact South Carolina disclosure statement in all caps with clear contrast.</li>
          <li>Major allergen statement and no health claims.</li>
          <li>Net quantity in metric and inch/pound units for packaged consumer goods.</li>
        </ul>
      </section>
      <section class="source-panel">
        <h3>Bread-Specific Notes</h3>
        <ul class="source-list">
          <li>SCDA's 2026 fact sheet lists shelf-stable cakes, cookies, cupcakes, high-acid pies, dried herbs and spices, roasted nuts, and sourdough bread made with commercial sourdough starter as allowed examples.</li>
          <li>It lists time/temperature controlled foods, bottled beverages, cheesecake, charcuterie boards, hot sauce, and BBQ sauce as not allowed examples.</li>
          <li>If a bread uses dairy, egg, meat, cream filling, or other higher-risk additions, treat it as a review item before sale.</li>
        </ul>
      </section>
      <section class="source-panel">
        <h3>Official Sources</h3>
        <ul class="source-list">
          <li><a href="https://agriculture.sc.gov/permits-and-inspections/retail-food-safety/" target="_blank" rel="noreferrer">SCDA Retail Food Safety</a></li>
          <li><a href="https://agriculture.sc.gov/wp-content/uploads/2026/05/Home-basedFoodProduction2026.pdf" target="_blank" rel="noreferrer">SCDA 2026 Home-based Food Production Fact Sheet</a></li>
          <li><a href="https://www.scstatehouse.gov/code/t44c001.php" target="_blank" rel="noreferrer">SC Code Section 44-1-143</a></li>
          <li><a href="https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies" target="_blank" rel="noreferrer">FDA Food Allergies and Major Allergens</a></li>
          <li><a href="https://www.ftc.gov/legal-library/browse/rules/fair-packaging-labeling-act-regulations-under-section-4-fair-packaging-labeling-act" target="_blank" rel="noreferrer">FTC Fair Packaging and Labeling Act summary</a></li>
          <li><a href="https://laurenscounty.us/starting-a-business" target="_blank" rel="noreferrer">Laurens County Starting a Business</a></li>
          <li><a href="https://laurenscounty.us/codes-ordinances" target="_blank" rel="noreferrer">Laurens County Code of Ordinances</a></li>
        </ul>
      </section>
      <section class="source-panel">
        <h3>Verification required</h3>
        <ul class="source-list">
          <li>Verify the exact disclosure wording, capitalization, placement, and contrast currently required by SCDA.</li>
          <li>Verify recipe eligibility and any current federal, state, or local requirements for dairy, egg, fillings, toppings, and other higher-risk ingredients.</li>
          <li>The app supports ingredient ordering, allergen identification, net weight, product information, and disclosure output; it does not certify legal compliance.</li>
        </ul>
      </section>
    </div>
  `;
}

function renderIngredientRow(item) {
  const searchText = `${item.name} ${item.label} ${item.role} ${item.allergens} ${item.notes || ""}`.toLowerCase();
  const conversionClass = item.conversionError ? "is-error" : item.conversionEstimated ? "is-estimate" : "is-exact";
  const conversionText = item.conversionError || (item.conversionEstimated ? "Estimated density - verify with a scale" : "Converted to canonical grams");
  return `
    <tr draggable="true" data-ingredient-row="${item.id}" data-search-text="${escapeAttr(searchText)}">
      <td><span class="drag-handle" title="Drag to reorder">::</span></td>
      <td class="ingredient-name-cell">
        <input class="name-input" type="text" list="ingredient-library" value="${escapeAttr(item.name)}" data-ingredient-id="${item.id}" data-ingredient-field="name" />
        <input class="sub-input" type="text" value="${escapeAttr(item.label)}" placeholder="Label wording" data-ingredient-id="${item.id}" data-ingredient-field="label" />
        <select class="sub-select" data-ingredient-id="${item.id}" data-ingredient-field="role">
          ${["flour", "water", "starter", "salt", "yeast", "sweetener", "fat", "add-in", "topping", "other"]
            .map((role) => `<option value="${role}" ${role === item.role ? "selected" : ""}>${title(role)}</option>`)
            .join("")}
        </select>
        <input class="sub-input" type="text" value="${escapeAttr(item.allergens)}" placeholder="Allergens" data-ingredient-id="${item.id}" data-ingredient-field="allergens" />
      </td>
      <td><input class="source-amount" type="text" inputmode="decimal" aria-label="${escapeAttr(item.name || "Ingredient")} source amount" value="${escapeAttr(item.sourceAmount)}" data-ingredient-id="${item.id}" data-ingredient-field="sourceAmount" /></td>
      <td>
        <select aria-label="${escapeAttr(item.name || "Ingredient")} source unit" data-ingredient-id="${item.id}" data-ingredient-field="sourceUnit">
          ${["cup", "tbsp", "tsp", "g", "kg", "oz"].map((unit) => `<option value="${unit}" ${unit === (item.sourceUnit || "g") ? "selected" : ""}>${unit}</option>`).join("")}
        </select>
      </td>
      <td class="canonical-weight">
        <label class="sr-only" for="grams-${item.id}">${escapeHtml(item.name || "Ingredient")} canonical grams</label>
        <input id="grams-${item.id}" class="compact-number" type="number" min="0" step="0.1" value="${round(item.grams)}" data-ingredient-id="${item.id}" data-ingredient-field="grams" />
        <small class="conversion-status ${conversionClass}" data-conversion-status="${item.id}" role="status">${escapeHtml(conversionText)}</small>
      </td>
      <td class="percent-cell" data-baker-percent="${item.id}">0%</td>
      <td><input class="compact-number" type="number" min="0" step="0.01" value="${escapeAttr(item.costPerKg || 0)}" data-ingredient-id="${item.id}" data-ingredient-field="costPerKg" /></td>
      <td class="money-cell" data-ingredient-cost="${item.id}">${formatMoney(getIngredientCost(item))}</td>
      <td><input type="text" value="${escapeAttr(item.notes || "")}" placeholder="Prep, brand, lot, nutrition" data-ingredient-id="${item.id}" data-ingredient-field="notes" /></td>
      <td class="row-tool-cell">
        <button class="icon-button" type="button" title="Duplicate ingredient" data-duplicate-ingredient="${item.id}">+</button>
        <button class="remove-button" type="button" title="Remove ingredient" data-remove-ingredient="${item.id}">x</button>
      </td>
    </tr>
  `;
}

function renderStepRow(step) {
  const bucket = detectProcessBucket(`${step.name || ""} ${step.notes || ""}`) || "other";
  return `
    <article class="timeline-step method-step ${bucket}">
      <div class="timeline-node"></div>
      <div class="timeline-step-body method-step-body">
        <div class="method-step-heading">
          <input class="name-input step-name-input method-title-input" type="text" value="${escapeAttr(step.name)}" data-step-id="${step.id}" data-step-field="name" />
          <div class="method-step-meta">
            <label>
              <span>Min</span>
              <input class="compact-number" type="number" min="0" step="1" value="${step.duration}" data-step-id="${step.id}" data-step-field="duration" aria-label="Step minutes" />
            </label>
            <label>
              <span>Condition</span>
              <input class="step-temp-input" type="text" value="${escapeAttr(step.temp)}" placeholder="Temp / condition" data-step-id="${step.id}" data-step-field="temp" />
            </label>
          </div>
          <button class="remove-button" type="button" title="Remove step" data-remove-step="${step.id}">x</button>
        </div>
        <textarea class="step-notes-input method-copy-input" data-step-id="${step.id}" data-step-field="notes" placeholder="Instructions">${escapeHtml(step.notes)}</textarea>
      </div>
    </article>
  `;
}

function renderBatchEntry(batch) {
  return `
    <article class="journal-entry">
      <div>
        <h4>${escapeHtml(batch.lotCode || "Batch")}</h4>
        <p>${escapeHtml(batch.notes || "No result notes recorded.")}</p>
        <div class="journal-meta">
          <span class="mini-pill">${escapeHtml(batch.bakeDate || "No date")}</span>
          <span class="mini-pill">${batch.roomTempF || 0} F room</span>
          <span class="mini-pill">${batch.kneadMinutes || 0} min knead</span>
          <span class="mini-pill">${batch.bulkMinutes || 0} min bulk</span>
          <span class="mini-pill">${batch.rating || 0}/10</span>
        </div>
        ${batch.adjustment ? `<p class="hint">Next: ${escapeHtml(batch.adjustment)}</p>` : ""}
      </div>
      <button class="remove-button" type="button" data-remove-batch="${batch.id}" title="Remove batch">x</button>
    </article>
  `;
}

function field(label, type, value, bind) {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" value="${escapeAttr(value)}" data-bind="${bind}" />
    </div>
  `;
}

function labelField(label, type, value, fieldName) {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" value="${escapeAttr(value)}" data-label-field="${fieldName}" />
    </div>
  `;
}

function batchField(label, type, value, fieldName, min = "", max = "") {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" value="${escapeAttr(value)}" ${min ? `min="${min}"` : ""} ${max ? `max="${max}"` : ""} data-batch-field="${fieldName}" />
    </div>
  `;
}

function orderDraftField(label, type, value, fieldName) {
  const numberAttrs =
    type === "number" ? `min="0" step="${fieldName === "unitPrice" || fieldName === "amountPaid" ? "0.01" : "1"}"` : "";
  return `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" value="${escapeAttr(value)}" ${numberAttrs} data-order-draft-field="${fieldName}" />
    </div>
  `;
}

function orderDraftTextarea(label, value, fieldName) {
  return `
    <div class="field">
      <label>${label}</label>
      <textarea data-order-draft-field="${fieldName}">${escapeHtml(value || "")}</textarea>
    </div>
  `;
}

function orderRecipeSelect(draft) {
  return `
    <div class="field">
      <label>Recipe or product</label>
      <select data-order-draft-field="recipeId">
        <option value="">Custom product</option>
        ${state.recipes.map((recipe) => `<option value="${recipe.id}" ${recipe.id === draft.recipeId ? "selected" : ""}>${escapeHtml(recipe.label?.productName || recipe.name)}</option>`).join("")}
      </select>
    </div>
  `;
}

function orderBreadTypeSelect(draft) {
  return `
    <div class="field">
      <label>Ready time type</label>
      <select data-order-draft-field="breadType">
        ${Object.entries(ORDER_LEAD_TIMES)
          .map(([value, detail]) => `<option value="${value}" ${value === draft.breadType ? "selected" : ""}>${detail.label} (${detail.hours} hr)</option>`)
          .join("")}
      </select>
    </div>
  `;
}

function orderPaymentStatusSelect(draft) {
  return `
    <div class="field">
      <label>Payment status</label>
      <select data-order-draft-field="paymentStatus">
        ${["Unpaid", "Deposit paid", "Paid"].map((option) => `<option value="${option}" ${option === draft.paymentStatus ? "selected" : ""}>${option}</option>`).join("")}
      </select>
    </div>
  `;
}

function orderPaymentMethodSelect(draft) {
  return `
    <div class="field">
      <label>Payment method</label>
      <select data-order-draft-field="paymentMethod">
        ${["Cash", "Card", "Venmo", "PayPal", "Zelle", "Check", "Other"].map((option) => `<option value="${option}" ${option === draft.paymentMethod ? "selected" : ""}>${option}</option>`).join("")}
      </select>
    </div>
  `;
}

function orderSelectField(order, label, fieldName, options) {
  return `
    <div class="field">
      <label>${label}</label>
      <select data-order-id="${order.id}" data-order-field="${fieldName}">
        ${options.map((option) => `<option value="${option}" ${option === order[fieldName] ? "selected" : ""}>${option}</option>`).join("")}
      </select>
    </div>
  `;
}

function orderNumberField(order, label, fieldName) {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="number" min="0" step="0.01" value="${escapeAttr(order[fieldName])}" data-order-id="${order.id}" data-order-field="${fieldName}" />
    </div>
  `;
}

function lotField(lot, label, type, fieldName) {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" value="${escapeAttr(lot[fieldName])}" data-lot-id="${lot.id}" data-lot-field="${fieldName}" />
    </div>
  `;
}

function lotUseField(lot, label, type, fieldName) {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" value="${escapeAttr(lot.draftUse[fieldName])}" data-lot-id="${lot.id}" data-lot-use-field="${fieldName}" />
    </div>
  `;
}

function lotSelect(lot, label, fieldName, options) {
  return `
    <div class="field">
      <label>${label}</label>
      <select data-lot-id="${lot.id}" data-lot-field="${fieldName}">
        ${options.map((option) => `<option value="${escapeAttr(option)}" ${option === lot[fieldName] ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
    </div>
  `;
}

function textareaFieldForLot(lot, label, fieldName) {
  return `
    <div class="field">
      <label>${label}</label>
      <textarea data-lot-id="${lot.id}" data-lot-field="${fieldName}">${escapeHtml(lot[fieldName] || "")}</textarea>
    </div>
  `;
}

function textareaField(label, value, fieldName, scope) {
  const dataName = scope === "label" ? "data-label-field" : scope === "batch" ? "data-batch-field" : "data-bind";
  return `
    <div class="field">
      <label>${label}</label>
      <textarea ${dataName}="${fieldName}">${escapeHtml(value || "")}</textarea>
    </div>
  `;
}

function selectField(label, value, bind, options) {
  return `
    <div class="field">
      <label>${label}</label>
      <select data-bind="${bind}">
        ${options.map((option) => `<option value="${escapeAttr(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
    </div>
  `;
}

function selectLabelField(label, value, fieldName, options) {
  return `
    <div class="field">
      <label>${label}</label>
      <select data-label-field="${fieldName}">
        ${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${optionLabel}</option>`).join("")}
      </select>
    </div>
  `;
}

function updateComputedViews() {
  const recipe = getActiveRecipe();
  if (!recipe) return;
  renderRecipeList();

  const metrics = getMetrics(recipe);
  const metricStrip = document.querySelector("#metric-strip");
  if (metricStrip) {
    metricStrip.innerHTML = `
      ${metricAdjustCard("Dough weight", `${round(metrics.totalWeight)} g`, "metric-dough-weight", round(metrics.totalWeight), "g", "adjust-dough-weight", "1")}
      ${metricAdjustCard("Flour", `${round(metrics.flour)} g`, "metric-flour-weight", round(metrics.flour), "g", "adjust-flour-weight", "1")}
      ${metricAdjustCard("Hydration", `${round(metrics.hydration)}%`, "metric-hydration", round(metrics.hydration), "%", "adjust-hydration", "0.5")}
      ${metricAdjustCard("Salt", `${round(metrics.saltPercent)}%`, "metric-salt", round(metrics.saltPercent), "%", "adjust-salt", "0.1")}
      ${metricAdjustCard("Total process", `${formatMinutes(metrics.processMinutes)}`, "metric-process-time", metrics.processMinutes, "min", "adjust-process-time", "1")}
    `;
  }
  syncVisibleDerivedControls(recipe);

  document.querySelectorAll("[data-baker-percent]").forEach((cell) => {
    const item = recipe.ingredients.find((ingredient) => ingredient.id === cell.dataset.bakerPercent);
    const bakerPercent = metrics.flour ? ((Number(item?.grams || 0) / metrics.flour) * 100).toFixed(1) : "0.0";
    cell.textContent = `${bakerPercent}%`;
  });

  document.querySelectorAll("[data-ingredient-cost]").forEach((cell) => {
    const item = recipe.ingredients.find((ingredient) => ingredient.id === cell.dataset.ingredientCost);
    cell.textContent = formatMoney(getIngredientCost(item));
  });

  document.querySelectorAll("[data-conversion-status]").forEach((node) => {
    const item = recipe.ingredients.find((ingredient) => ingredient.id === node.dataset.conversionStatus);
    if (!item) return;
    node.className = `conversion-status ${item.conversionError ? "is-error" : item.conversionEstimated ? "is-estimate" : "is-exact"}`;
    node.textContent = item.conversionError || (item.conversionEstimated ? "Estimated density - verify with a scale" : "Converted to canonical grams");
    const gramsInput = node.parentElement?.querySelector('[data-ingredient-field="grams"]');
    if (gramsInput && document.activeElement !== gramsInput) gramsInput.value = round(item.grams);
    const sourceInput = node.closest("tr")?.querySelector('[data-ingredient-field="sourceAmount"]');
    if (sourceInput) {
      sourceInput.setAttribute("aria-invalid", String(Boolean(item.conversionError)));
      if (document.activeElement !== sourceInput) sourceInput.value = item.sourceAmount;
    }
    const sourceUnit = node.closest("tr")?.querySelector('[data-ingredient-field="sourceUnit"]');
    if (sourceUnit && document.activeElement !== sourceUnit) sourceUnit.value = item.sourceUnit;
  });

  const summary = document.querySelector("#formula-summary");
  if (summary) {
    summary.innerHTML = `
      ${summaryItem("Total ingredients", `${round(metrics.totalWeight)} g`)}
      ${summaryItem("Approx. loaf yield", `${metrics.loafYield} loaves`)}
      ${summaryItem("Water + starter water", `${round(metrics.water)} g`)}
      ${summaryItem("Salt grams", `${round(metrics.salt)} g`)}
      ${summaryItem("Sweetener", `${round(metrics.sweetener)} g`)}
      ${summaryItem("Fat", `${round(metrics.fat)} g`)}
      ${summaryItem("Detected allergens", getAllergenStatement(recipe, false) || "None entered")}
      ${summaryItem("Room target", `${recipe.environment.roomTempF || 0} F / ${recipe.environment.humidity || 0}% RH`)}
    `;
  }

  const costSummary = document.querySelector("#cost-summary");
  if (costSummary) {
    const costing = getCostMetrics(recipe);
    costSummary.innerHTML = `
      ${summaryItem("Ingredient cost", formatMoney(costing.ingredientCost))}
      ${summaryItem("Total batch cost", formatMoney(costing.batchCost))}
      ${summaryItem("Cost per item", formatMoney(costing.costPerItem))}
      ${summaryItem("Suggested price", formatMoney(costing.suggestedPrice))}
      ${summaryItem("Gross profit", formatMoney(costing.grossProfit))}
      ${summaryItem("Profit margin", `${round(costing.margin)}%`)}
    `;
  }

  const ratingOutput = document.querySelector("#rating-output");
  if (ratingOutput) ratingOutput.textContent = recipe.draftBatch.rating;

  document.querySelectorAll("[data-lot-available]").forEach((node) => {
    const lot = state.lots.find((item) => item.id === node.dataset.lotAvailable);
    if (lot) node.textContent = `${round(getLotAvailableGrams(lot))} g`;
  });

  document.querySelectorAll("[data-lot-used]").forEach((node) => {
    const lot = state.lots.find((item) => item.id === node.dataset.lotUsed);
    if (lot) node.textContent = `${round(getLotUsedGrams(lot))} g`;
  });

  document.querySelectorAll("[data-lot-best-by]").forEach((node) => {
    const lot = state.lots.find((item) => item.id === node.dataset.lotBestBy);
    if (lot) node.textContent = getLotBestBy(lot) || "Set date";
  });

  const orderPreview = document.querySelector("#order-preview");
  if (orderPreview) orderPreview.innerHTML = renderOrderPreview(state.orderDraft);

  const labelPreview = document.querySelector("#label-preview");
  if (labelPreview) labelPreview.innerHTML = renderLabelPreview(recipe);
  document.querySelectorAll(".mini-label-preview").forEach((node) => { node.innerHTML = renderLabelPreview(recipe); });
  fitProductLabels(document);

  updateLabelReadinessState(recipe);
  const skuStatus = document.querySelector("#sku-status");
  if (skuStatus) skuStatus.textContent = getSkuStatus(recipe);
}

function syncVisibleDerivedControls(recipe) {
  setVisibleControlValue('[data-bind="productType"]', recipe.productType);
  setVisibleControlValue('[data-bind="desiredLoafWeightG"]', recipe.desiredLoafWeightG);
  setVisibleControlValue('[data-label-field="productName"]', recipe.label.productName);
  setVisibleControlValue('[data-label-field="netWeightG"]', recipe.label.netWeightG);
  setVisibleControlValue('[data-label-field="netWeightOz"]', recipe.label.netWeightOz);
  setVisibleControlValue('[data-batch-field="kneadMinutes"]', recipe.draftBatch.kneadMinutes);
  setVisibleControlValue('[data-batch-field="bulkMinutes"]', recipe.draftBatch.bulkMinutes);
  setVisibleControlValue('[data-batch-field="proofMinutes"]', recipe.draftBatch.proofMinutes);
  setVisibleControlValue('[data-batch-field="bakeMinutes"]', recipe.draftBatch.bakeMinutes);
  setVisibleControlValue('[data-batch-field="finishedWeightG"]', recipe.draftBatch.finishedWeightG);
}

function setVisibleControlValue(selector, value) {
  const element = document.querySelector(selector);
  if (!element || document.activeElement === element) return;
  element.value = value ?? "";
}

function metricCard(label, value) {
  return `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function metricAdjustCard(label, value, inputId, inputValue, unit, buttonId, step) {
  return `
    <div class="metric metric-adjust">
      <span>${label}</span>
      <strong>${value}</strong>
      <div class="metric-control">
        <input id="${inputId}" type="number" min="0" step="${step}" value="${escapeAttr(inputValue)}" aria-label="Target ${escapeAttr(label)}" />
        <button class="ghost-button" id="${buttonId}" type="button">Apply ${escapeHtml(unit)}</button>
      </div>
    </div>
  `;
}

function summaryItem(label, value) {
  return `
    <div>
      <dt>${label}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function renderLabelPreview(recipe) {
  const label = recipe.label;
  const productName = label.productName || recipe.name || "Bread";
  const business = label.businessName || "Your Bakery Name";
  const producerLine = label.useScdaId
    ? `SCDA Home-based Food ID: ${label.scdaId || "ID needed"}`
    : label.address || "Street address or SCDA ID needed";
  const ingredients = getIngredientStatement(recipe);
  const allergens = getAllergenStatement(recipe, true);
  const barcode = recipe.catalog?.sku ? `<div class="ft-barcode">${renderBarcode(recipe.catalog.sku)}</div>` : "";
  return `
    <article class="ft-label ${label.printStyle === "color" ? "ft-color" : "ft-thermal"}">
      <div class="ft-label-content">
        <header class="ft-brand">
          <img src="faithful-true-logo.png" alt="Faithful &amp; True Bread &amp; Baked Goods" />
          ${business !== "Faithful & True Bread and Baked Goods" ? `<p>${escapeHtml(business)}</p>` : ""}
        </header>
        ${label.wholeGrainBadge ? `<div class="ft-badge"><strong>100%</strong><b>FRESH-MILLED WHOLE GRAIN</b><em>Fresh-Milled Daily</em></div>` : ""}
        <section class="ft-product"><h2>${escapeHtml(productName)}</h2>${label.tagline ? `<p>${escapeHtml(label.tagline)}</p>` : ""}</section>
        <div class="ft-details">
          <section class="ft-ingredients"><b>INGREDIENTS</b><p>${escapeHtml(ingredients || "Add ingredients in the recipe tab.")}</p><p class="ft-allergens"><strong>${escapeHtml(allergens || "No major allergens identified from entered data.")}</strong></p></section>
          <section class="ft-package">
            <p><b>NET WT.</b><span>${Number(label.netWeightG) > 0 ? `${round(label.netWeightOz)} oz (${round(label.netWeightG)} g)` : "________________"}</span></p>
            <p><b>BAKED ON</b><span>${label.bakedOn ? escapeHtml(formatDate(label.bakedOn)) : "________________"}</span></p>
            <p><b>BEST BY</b><span>${label.bestBy ? escapeHtml(formatDate(label.bestBy)) : "________________"}</span></p>
            ${label.lotCode ? `<p><b>LOT</b><span>${escapeHtml(label.lotCode)}</span></p>` : ""}
          </section>
        </div>
        ${label.storage ? `<p class="ft-storage">${escapeHtml(label.storage)}</p>` : ""}
        <p class="ft-disclosure">${DISCLOSURE}</p>
        <div class="ft-producer">${label.useScdaId ? `<b>HOME-BASED FOOD PRODUCTION ID</b><p>${escapeHtml(label.scdaId || "ID needed")}</p>` : escapeHtml(producerLine)}${label.contact ? `<p>${escapeHtml(label.contact)}</p>` : ""}</div>
        ${barcode}
        ${label.scripture ? `<div class="ft-scripture"><p>${escapeHtml(label.scripture)}</p><b>${escapeHtml(label.scriptureReference || "")}</b></div>` : ""}
        <footer class="ft-footer"><b>FRESHLY BAKED IN SOUTH CAROLINA</b><em>Freshly Milled. Faithfully Made.</em></footer>
      </div>
    </article>
  `;
}

function renderLabelPrintGuard(readiness) {
  const blockers = readiness.blockers.filter((item) => !item.ok);
  if (!blockers.length) return "";
  return `
    <h3>Label printing blocked</h3>
    <p>Complete these blocking requirements before printing:</p>
    <ul>
      ${blockers.map((item) => `<li><strong>${escapeHtml(item.title)}:</strong> ${escapeHtml(item.copy)}</li>`).join("")}
    </ul>
  `;
}

function getCode128Patterns() {
  return [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
  ];
}

function code128Svg(value, className = "barcode-svg") {
  const text = String(value || "").replace(/[^\x20-\x7e]/g, "");
  if (!text) return "";
  const codes = [104];
  for (const character of text) codes.push(character.charCodeAt(0) - 32);
  const checksum = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  codes.push(checksum, 106);
  let x = 10;
  const bars = [];
  codes.forEach((code) => {
    const pattern = getCode128Patterns()[code];
    let black = true;
    for (const width of pattern) {
      const scaled = Number(width) * 2;
      if (black) bars.push(`<rect x="${x}" y="4" width="${scaled}" height="42"/>`);
      x += scaled;
      black = !black;
    }
  });
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} 64" role="img" aria-label="Code 128 barcode for ${escapeAttr(text)}"><rect width="100%" height="100%" fill="#fff"/>${bars.join("")}<text x="${(x + 10) / 2}" y="59" text-anchor="middle">${escapeHtml(text)}</text></svg>`;
}

function renderBarcode(value) {
  return value ? code128Svg(value) : `<p class="hint">Square SKU will appear here.</p>`;
}

function downloadBarcode(recipe) {
  const sku = recipe.catalog.sku;
  if (!sku) {
    showToast("Enter a Square SKU first.");
    return;
  }
  const svg = code128Svg(sku);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(recipe.name || "product")}-${slugify(sku)}-barcode.svg`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Barcode downloaded.");
}

function fitProductLabels(root) {
  let fits = true;
  root.querySelectorAll(".ft-label").forEach((label) => {
    const preview = label.closest(".label-preview, .mini-label-preview");
    label.style.zoom = preview ? Math.min(1, preview.clientWidth / 384) : 1;
    let size = 12;
    label.style.setProperty("--label-font", `${size}px`);
    let content = label.querySelector(".ft-label-content");
    while ((label.scrollHeight > label.clientHeight + 1 || (content && content.scrollHeight > content.clientHeight + 1)) && size > 8) {
      size -= 0.25;
      label.style.setProperty("--label-font", `${size}px`);
      content = label.querySelector(".ft-label-content");
    }
    if (
      label.scrollHeight > label.clientHeight + 1 ||
      label.scrollWidth > label.clientWidth + 1 ||
      (content && content.scrollHeight > content.clientHeight + 1)
    ) fits = false;
  });
  const message = root.querySelector("#label-fit-message");
  if (message) message.textContent = fits ? "" : "This label is too full. Shorten the optional tagline, scripture, or storage note before printing.";
  return fits;
}

function printProductLabel(recipe) {
  const readiness = getRecipeLabelReadiness(recipe);
  if (!readiness.ready) {
    showToast("Complete all blocking label requirements before printing.");
    document.querySelector("#label-readiness")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  document.querySelector("#label-print-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "label-print-frame";
  frame.title = "4 x 6 product label";
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:384px;height:576px;border:0";
  frame.onload = async () => {
    const doc = frame.contentDocument;
    await Promise.all(Array.from(doc.images, (img) => img.decode().catch(() => {})));
    await doc.fonts.ready;
    if (!fitProductLabels(doc)) {
      showToast("Label is too full. Shorten optional text before printing.");
      frame.remove();
      return;
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };
  frame.srcdoc = `<!doctype html><html><head><base href="${escapeHtml(new URL(".", location.href).href)}"><link rel="stylesheet" href="label-design.css"><title>${escapeHtml(recipe.label.productName || recipe.name)}</title></head><body class="ft-print">${renderLabelPreview(recipe)}</body></html>`;
  document.body.appendChild(frame);
}

function getRecipeLabelReadiness(recipe) {
  return getLabelReadiness(recipe, getAllergenStatement(recipe, true));
}

function updateLabelReadinessState(recipe = getActiveRecipe(), readiness = getRecipeLabelReadiness(recipe)) {
  const checklist = document.querySelector("#label-checklist");
  if (checklist) checklist.innerHTML = renderReadinessChecklist(readiness);

  const printButton = document.querySelector("#print-label");
  if (printButton) {
    printButton.disabled = !readiness.ready;
    printButton.title = readiness.ready ? "Print product labels" : "Complete all blocking label requirements before printing.";
  }

  const readinessCopy = document.querySelector(".readiness-heading p");
  const readinessPill = document.querySelector(".readiness-heading .status-pill");
  if (readinessCopy) readinessCopy.textContent = readiness.ready
    ? "Required label information is present."
    : `${readiness.blockers.filter((item) => !item.ok).length} blocking requirement(s) remain.`;
  if (readinessPill) {
    readinessPill.className = `status-pill ${readiness.ready ? "ready" : "not-ready"}`;
    readinessPill.textContent = readiness.ready ? "Ready to print" : "Not ready";
  }

  const printGuard = document.querySelector("#label-print-guard");
  if (printGuard) {
    printGuard.innerHTML = renderLabelPrintGuard(readiness);
    printGuard.classList.toggle("is-visible", !readiness.ready);
  }

  document.body.dataset.labelPrintBlocked = activeTab === "label" && !readiness.ready ? "true" : "false";
  return readiness;
}

function handleBeforePrint() {
  if (activeTab !== "label") {
    document.body.dataset.labelPrintBlocked = "false";
    return;
  }
  updateLabelReadinessState(getActiveRecipe());
}

function getLabelText(recipe) {
  const label = recipe.label;
  const lines = [
    label.businessName || "Your Bakery Name",
    label.productName || recipe.name || "Bread",
    `NET WT ${round(label.netWeightOz || 0)} oz (${round(label.netWeightG || 0)} g)`,
    recipe.catalog?.sku ? `Square SKU: ${recipe.catalog.sku}` : "",
    label.gtin ? `GTIN: ${label.gtin}` : "",
    `Ingredients: ${getIngredientStatement(recipe)}`,
    getAllergenStatement(recipe, true),
    label.storage,
    label.useScdaId ? `SCDA Home-based Food ID: ${label.scdaId || ""}` : label.address,
    label.contact,
    label.lotCode ? `Lot: ${label.lotCode}` : "",
    label.packageDate ? `Packaged: ${formatDate(label.packageDate)}` : "",
    label.bakedOn ? `Baked on: ${formatDate(label.bakedOn)}` : "",
    label.bestBy ? `Best by: ${formatDate(label.bestBy)}` : "",
    DISCLOSURE,
    label.scripture,
    label.scriptureReference,
  ];
  return lines.filter(Boolean).join("\n");
}

function getIngredientStatement(recipe) {
  const grouped = new Map();
  recipe.ingredients
    .filter((item) => Number(item.grams) > 0 && (item.label || item.name))
    .forEach((item) => {
      const label = item.label || item.name;
      grouped.set(label, {
        label,
        grams: Number(item.grams || 0) + Number(grouped.get(label)?.grams || 0),
      });
    });

  return [...grouped.values()]
    .sort((a, b) => b.grams - a.grams)
    .map((item) => item.label)
    .join(", ");
}

function getAllergenStatement(recipe, withPrefix) {
  if (recipe.label.allergenMode === "allMajor") {
    return withPrefix ? "May contain any major food allergen." : "May contain any major food allergen";
  }

  const detected = new Map();
  (recipe.label.manualAllergens || []).forEach((allergen) => {
    detected.set(allergen, title(allergen));
  });
  recipe.ingredients
    .filter((ingredient) => Number(ingredient.grams || 0) > 0)
    .forEach((ingredient) => {
    const text = `${ingredient.name} ${ingredient.label} ${ingredient.allergens}`.toLowerCase();
    MAJOR_ALLERGENS.forEach((allergen) => {
      if (text.includes(allergen)) detected.set(allergen, title(allergen));
    });
    const nutMatches = TREE_NUT_WORDS.filter((nut) => text.includes(nut));
    if (nutMatches.length) {
      const uniqueNuts = [...new Set(nutMatches.map((nut) => nut.replace(/s$/, "")))];
      detected.set("tree nuts", `Tree nuts (${uniqueNuts.join(", ")})`);
    }
    const fishMatches = ["salmon", "tuna", "cod", "anchovy", "trout", "tilapia"].filter((fish) => text.includes(fish));
    if (fishMatches.length) detected.set("finfish", `Fish (${[...new Set(fishMatches)].join(", ")})`);
    else if (/\bfish\b/.test(text)) detected.set("finfish", "Fish (type not specified)");
    const shellfishMatches = ["crab", "lobster", "shrimp", "prawn", "crayfish"].filter((shellfish) => text.includes(shellfish));
    if (shellfishMatches.length) detected.set("crustacean shellfish", `Crustacean shellfish (${[...new Set(shellfishMatches)].join(", ")})`);
    else if (/shellfish|crustacean/.test(text)) detected.set("crustacean shellfish", "Crustacean shellfish (type not specified)");
  });

  const ordered = MAJOR_ALLERGENS.filter((allergen) => detected.has(allergen)).map((allergen) => detected.get(allergen));
  if (!ordered.length) return "";
  return `${withPrefix ? "Contains: " : ""}${ordered.join(", ")}`;
}

function renderCheck(item) {
  const icon = item.level === "ok" ? "OK" : item.level === "warn" ? "!" : "x";
  return `
    <div class="check-item ${item.level}">
      <span class="check-icon">${icon}</span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span class="check-copy">${escapeHtml(item.copy)}</span>
      </div>
    </div>
  `;
}

function renderReadinessChecklist(readiness) {
  return `
    <h4>Required before printing</h4>
    ${readiness.blockers.map(renderCheck).join("")}
    <h4>Warnings to review</h4>
    ${readiness.warnings.map(renderCheck).join("")}
  `;
}

function getMetrics(recipe) {
  const ingredients = recipe.ingredients || [];
  const totalWeight = sum(ingredients, "grams");
  const flour = ingredients.reduce((total, item) => {
    const grams = Number(item.grams || 0);
    if (item.role === "flour") return total + grams;
    if (item.role === "starter") return total + grams / 2;
    return total;
  }, 0);
  const water = ingredients.reduce((total, item) => {
    const grams = Number(item.grams || 0);
    if (item.role === "water") return total + grams;
    if (item.role === "starter") return total + grams / 2;
    return total;
  }, 0);
  const salt = roleSum(ingredients, "salt");
  const sweetener = roleSum(ingredients, "sweetener");
  const fat = roleSum(ingredients, "fat");
  const processMinutes = sum(recipe.steps || [], "duration");
  const desiredLoaf = Number(recipe.desiredLoafWeightG || 0);
  return {
    totalWeight,
    flour,
    water,
    hydration: flour ? (water / flour) * 100 : 0,
    salt,
    saltPercent: flour ? (salt / flour) * 100 : 0,
    sweetener,
    fat,
    processMinutes,
    loafYield: desiredLoaf ? Math.max(1, Math.floor(totalWeight / desiredLoaf)) : recipe.yieldCount || 1,
  };
}

function getIngredientCost(ingredient) {
  if (!ingredient) return 0;
  return (Number(ingredient.grams || 0) / 1000) * Number(ingredient.costPerKg || 0);
}

function getCostMetrics(recipe) {
  const metrics = getMetrics(recipe);
  const ingredientCost = (recipe.ingredients || []).reduce((total, ingredient) => total + getIngredientCost(ingredient), 0);
  const yieldCount = Math.max(1, Number(recipe.yieldCount || metrics.loafYield || 1));
  const packageCost = Number(recipe.pricing?.packageCost || 0) * yieldCount;
  const batchCost = ingredientCost + packageCost;
  const costPerItem = batchCost / yieldCount;
  const targetMargin = Math.min(95, Math.max(1, Number(recipe.pricing?.targetMargin || 65)));
  const suggestedPrice = costPerItem / (1 - targetMargin / 100);
  const sellingPrice = Number(recipe.pricing?.sellingPrice || suggestedPrice || 0);
  const grossProfit = (sellingPrice * yieldCount) - batchCost;
  const margin = sellingPrice ? ((sellingPrice - costPerItem) / sellingPrice) * 100 : 0;
  return {
    ingredientCost: roundMoney(ingredientCost),
    batchCost: roundMoney(batchCost),
    costPerItem: roundMoney(costPerItem),
    suggestedPrice: roundMoney(suggestedPrice),
    sellingPrice: roundMoney(sellingPrice),
    grossProfit: roundMoney(grossProfit),
    margin,
  };
}

function getLotUsedGrams(lot) {
  return (lot.uses || []).reduce((total, use) => total + Number(use.grams || 0), 0);
}

function getLotAvailableGrams(lot) {
  return Math.max(0, Number(lot.gramsMilled || 0) - getLotUsedGrams(lot) - Number(lot.reserveGrams || 0));
}

function getLotBestBy(lot) {
  if (!lot.milledDate || !lot.shelfDays) return "";
  return addDays(lot.milledDate, Number(lot.shelfDays || 0));
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildLotCode(lot) {
  const datePart = (lot.milledDate || new Date().toISOString().slice(0, 10)).replaceAll("-", "").slice(2);
  const grainPart = lotInitials(lot.grain || lot.name || "grain");
  const prefix = lot.storageProfile === "Whole berries cool/dry" ? "GB" : "FM";
  const root = `${prefix}-${datePart}-${grainPart}`;
  const sequence =
    state.lots.filter((item) => item.id !== lot.id && String(item.lotCode || "").startsWith(root)).length + 1;
  return `${root}-${String(sequence).padStart(2, "0")}`;
}

function lotInitials(value) {
  const words = String(value || "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !["fresh", "milled", "flour", "grain", "berries", "wheat"].includes(word.toLowerCase()));
  const initials = words.map((word) => word[0]).join("").toUpperCase().slice(0, 4);
  return initials || "GRN";
}

function buildLotStorageText(lot) {
  const bestBy = getLotBestBy(lot);
  const available = getLotAvailableGrams(lot);
  return [
    `${lot.name || "Fresh-milled flour"} (${lot.lotCode || "no lot code"})`,
    `Milled: ${lot.milledDate || "not recorded"}${lot.milledTime ? ` at ${lot.milledTime}` : ""}`,
    `Best by: ${bestBy || "not generated"}`,
    `Available: ${round(available)} g`,
    lot.storageInstructions || STORAGE_PROFILES[lot.storageProfile]?.instruction || "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getOrderPreview(orderLike) {
  const readyAt = getOrderReadyAt(orderLike);
  const total = getOrderTotal(orderLike);
  const balance = Math.max(0, total - Number(orderLike.amountPaid || 0));
  return {
    readyAt,
    total,
    balance,
    leadHours: getOrderLeadHours(orderLike.breadType),
  };
}

function getOrderReadyAt(orderLike) {
  return addHoursToLocalDateTime(orderLike.orderedAt || localDateTimeValue(), getOrderLeadHours(orderLike.breadType));
}

function getOrderLeadHours(breadType) {
  return ORDER_LEAD_TIMES[breadType]?.hours || 12;
}

function getOrderTypeLabel(breadType) {
  const detail = ORDER_LEAD_TIMES[breadType] || ORDER_LEAD_TIMES.regular;
  return `${detail.label} / ${detail.hours} hr`;
}

function getOrderTotal(orderLike) {
  return roundMoney(Number(orderLike.quantity || 0) * Number(orderLike.unitPrice || 0));
}

function inferOrderBreadType(recipe) {
  const text = `${recipe.name} ${recipe.productType} ${recipe.label?.productName || ""}`.toLowerCase();
  if (/seasonal|holiday|special/.test(text)) return "seasonal";
  if (/artisan|hearth|sourdough|focaccia/.test(text)) return "artisan";
  return "regular";
}

function buildOrderNumber() {
  const datePart = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  const sequence = state.orders.filter((order) => String(order.orderNumber || "").includes(datePart)).length + 1;
  return `ORD-${datePart}-${String(sequence).padStart(3, "0")}`;
}

function buildPaymentRequestText(order) {
  const total = getOrderTotal(order);
  const balance = Math.max(0, total - Number(order.amountPaid || 0));
  return [
    `Hi ${order.customerName || "there"}, your order ${order.orderNumber || ""} is confirmed.`,
    `${order.quantity} x ${order.productName} = ${formatMoney(total)}.`,
    `Bread ready: ${formatDateTime(order.readyAt)}.`,
    balance > 0 ? `Balance due: ${formatMoney(balance)}.` : "Payment is marked paid. Thank you!",
    order.paymentLink ? `Payment link/reference: ${order.paymentLink}` : `Payment method: ${order.paymentMethod || "TBD"}.`,
    "Thank you!",
  ]
    .filter(Boolean)
    .join("\n");
}

function addHoursToLocalDateTime(value, hours) {
  const date = parseLocalDateTime(value);
  date.setHours(date.getHours() + Number(hours || 0));
  return toLocalDateTimeValue(date);
}

function parseLocalDateTime(value) {
  if (!value) return new Date();
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function localDateTimeValue(date = new Date()) {
  return toLocalDateTimeValue(date);
}

function toLocalDateTimeValue(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value) {
  if (!value) return "Not set";
  const date = parseLocalDateTime(value);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(value) {
  return `$${roundMoney(value).toFixed(2)}`;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roleSum(ingredients, role) {
  return ingredients
    .filter((item) => item.role === role)
    .reduce((total, item) => total + Number(item.grams || 0), 0);
}

function sum(items, fieldName) {
  return items.reduce((total, item) => total + Number(item[fieldName] || 0), 0);
}

function createRecipe() {
  const recipe = makeBlankRecipe(`New Bread ${state.recipes.length + 1}`);
  syncRecipeDerivedFields(recipe);
  state.recipes.unshift(recipe);
  state.activeRecipeId = recipe.id;
  activeTab = "recipe";
  persistAndRender("New recipe created.");
}

function duplicateRecipe() {
  const source = getActiveRecipe();
  const copy = normalizeRecipe(JSON.parse(JSON.stringify(source)));
  copy.id = uid();
  copy.name = `${source.name} Copy`;
  copy.status = "Draft";
  copy.catalog.sku = generateSku(copy, state.recipes);
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;
  copy.ingredients = copy.ingredients.map((item) => ({ ...item, id: uid() }));
  copy.steps = copy.steps.map((item) => ({ ...item, id: uid() }));
  copy.batches = [];
  state.recipes.unshift(copy);
  state.activeRecipeId = copy.id;
  persistAndRender("Recipe duplicated.");
}

function deleteRecipe() {
  if (!window.confirm("Delete this recipe? This cannot be undone.")) return;
  if (state.recipes.length === 1) {
    showToast("Keep at least one recipe in the workspace.");
    return;
  }
  rememberUndo();
  const activeId = state.activeRecipeId;
  state.recipes = state.recipes.filter((recipe) => recipe.id !== activeId);
  state.activeRecipeId = state.recipes[0].id;
  persistAndRender("Recipe deleted.");
}

function scaleActiveRecipeToYield() {
  const recipe = getActiveRecipe();
  const targetYield = Number(document.querySelector("#scale-target-yield")?.value || 0);
  const currentYield = Number(recipe.yieldCount || 0);
  if (!targetYield || targetYield <= 0 || !currentYield || currentYield <= 0) {
    showToast("Enter a valid target yield.");
    return;
  }
  scaleRecipe(recipe, targetYield / currentYield, targetYield);
}

function scaleActiveRecipeByMultiplier() {
  const recipe = getActiveRecipe();
  const multiplier = Number(document.querySelector("#scale-multiplier")?.value || 0);
  if (!multiplier || multiplier <= 0) {
    showToast("Enter a valid multiplier.");
    return;
  }
  const newYield = Math.max(1, Math.round(Number(recipe.yieldCount || 1) * multiplier));
  scaleRecipe(recipe, multiplier, newYield);
}

function adjustDoughWeightMetric() {
  const recipe = getActiveRecipe();
  const target = readPositiveMetricValue("#metric-dough-weight", "Enter a valid dough weight.");
  if (!target) return;
  const metrics = getMetrics(recipe);
  if (!metrics.totalWeight) {
    showToast("Add ingredients before changing dough weight.");
    return;
  }
  scaleRecipe(recipe, target / metrics.totalWeight, recipe.yieldCount, `Adjusted dough weight to ${round(target)} g.`);
}

function adjustFlourWeightMetric() {
  const recipe = getActiveRecipe();
  const target = readPositiveMetricValue("#metric-flour-weight", "Enter a valid flour weight.");
  if (!target) return;
  const metrics = getMetrics(recipe);
  if (!metrics.flour) {
    showToast("Add flour before changing flour weight.");
    return;
  }
  scaleRecipe(recipe, target / metrics.flour, recipe.yieldCount, `Adjusted flour to ${round(target)} g.`);
}

function adjustHydrationMetric() {
  const recipe = getActiveRecipe();
  const targetPercent = readPositiveMetricValue("#metric-hydration", "Enter a valid hydration percentage.");
  if (!targetPercent) return;
  const metrics = getMetrics(recipe);
  if (!metrics.flour) {
    showToast("Add flour before changing hydration.");
    return;
  }
  const starterWater = getStarterWaterGrams(recipe);
  const targetWater = metrics.flour * (targetPercent / 100);
  const targetDirectWater = targetWater - starterWater;
  if (targetDirectWater < 0) {
    showToast("Starter already contributes more water than that target.");
    return;
  }
  const previousIngredients = snapshotRecipeIngredients(recipe);
  setRoleTotal(recipe, "water", targetDirectWater, () => ({
    id: uid(),
    name: "Water",
    label: "water",
    grams: targetDirectWater,
    role: "water",
    allergens: "",
  }));
  syncAllIngredientReferencesInRecipeText(recipe, previousIngredients);
  syncRecipeWeights(recipe);
  persistAndRender(`Adjusted hydration to ${round(targetPercent)}%.`);
}

function adjustSaltMetric() {
  const recipe = getActiveRecipe();
  const targetPercent = readPositiveMetricValue("#metric-salt", "Enter a valid salt percentage.");
  if (!targetPercent) return;
  const metrics = getMetrics(recipe);
  if (!metrics.flour) {
    showToast("Add flour before changing salt.");
    return;
  }
  const targetSalt = metrics.flour * (targetPercent / 100);
  const previousIngredients = snapshotRecipeIngredients(recipe);
  setRoleTotal(recipe, "salt", targetSalt, () => ({
    id: uid(),
    name: "Salt",
    label: "salt",
    grams: targetSalt,
    role: "salt",
    allergens: "",
  }));
  syncAllIngredientReferencesInRecipeText(recipe, previousIngredients);
  syncRecipeWeights(recipe);
  persistAndRender(`Adjusted salt to ${round(targetPercent)}%.`);
}

function adjustProcessTimeMetric() {
  const recipe = getActiveRecipe();
  const targetMinutes = readPositiveMetricValue("#metric-process-time", "Enter valid total process minutes.");
  if (!targetMinutes) return;
  const metrics = getMetrics(recipe);
  if (!metrics.processMinutes || !recipe.steps.length) {
    showToast("Add process steps before changing total process time.");
    return;
  }
  scaleStepDurations(recipe, Math.round(targetMinutes));
  recipe.updatedAt = new Date().toISOString();
  persistAndRender(`Adjusted total process to ${formatMinutes(Math.round(targetMinutes))}.`);
}

function readPositiveMetricValue(selector, message) {
  const value = Number(document.querySelector(selector)?.value || 0);
  if (!value || value <= 0) {
    showToast(message);
    return 0;
  }
  return value;
}

function scaleRecipe(recipe, factor, newYield, message) {
  const previousIngredients = snapshotRecipeIngredients(recipe);
  recipe.ingredients = recipe.ingredients.map((ingredient) => {
    if (ingredient.conversionError || !Number.isFinite(Number(ingredient.grams))) {
      return { ...ingredient };
    }
    const scaled = {
      ...ingredient,
      grams: scaleGramValue(ingredient.grams, factor),
    };
    syncIngredientSourceFromGrams(scaled);
    return scaled;
  });
  syncAllIngredientReferencesInRecipeText(recipe, previousIngredients);

  recipe.yieldCount = Number(newYield || recipe.yieldCount || 1);
  const metrics = getMetrics(recipe);
  if (!recipe.label.packageWeightLocked) {
    recipe.label.netWeightG = scaleGramValue(metrics.totalWeight, 1);
    recipe.label.netWeightOz = gramsToOunces(recipe.label.netWeightG);
  }
  recipe.draftBatch.finishedWeightG = scaleGramValue(metrics.totalWeight, 1);
  recipe.draftBatch.notes = [
    recipe.draftBatch.notes,
    `Formula scaled by ${round(factor)}x on ${new Date().toLocaleDateString()}.`,
  ]
    .filter(Boolean)
    .join(" ");
  recipe.updatedAt = new Date().toISOString();
  persistAndRender(message || `Scaled recipe to ${recipe.yieldCount} yield.`);
}

function scaleGramValue(value, factor) {
  const scaled = Number(value || 0) * Number(factor || 1);
  if (scaled < 100) return Math.round(scaled * 10) / 10;
  return Math.round(scaled);
}

function conversionIngredient(recipe) {
  const id = document.querySelector("#conversion-ingredient")?.value;
  return recipe.ingredients.find((item) => item.id === id) || recipe.ingredients[0];
}

function convertCupsToWeight(recipe) {
  const ingredient = conversionIngredient(recipe);
  const input = document.querySelector("#conversion-cups")?.value;
  const output = document.querySelector("#conversion-result");
  if (!ingredient) {
    showToast("Add an ingredient before converting.");
    return;
  }
  try {
    const result = convertToGrams(input, "cup", ingredient);
    if (output) {
      output.textContent = `${formatMeasurement(result.grams, "g")}${result.estimated ? " (estimate)" : ""}`;
    }
  } catch (error) {
    if (output) output.textContent = "Enter a valid cup amount";
    showToast(error.message);
  }
}

function convertWeightToCups(recipe) {
  const ingredient = conversionIngredient(recipe);
  const value = document.querySelector("#conversion-weight")?.value;
  const unit = document.querySelector("#conversion-weight-unit")?.value || "g";
  const output = document.querySelector("#conversion-reverse-result");
  if (!ingredient) {
    showToast("Add an ingredient before converting.");
    return;
  }
  try {
    const grams = convertToGrams(value, unit, ingredient).grams;
    const result = convertFromGrams(grams, "cup", ingredient);
    if (output) output.textContent = `${formatMeasurement(result.amount, "cup")}${result.estimated ? " (estimate)" : ""}`;
  } catch (error) {
    if (output) output.textContent = "Enter a valid weight";
    showToast(error.message);
  }
}

function syncRecipeWeights(recipe) {
  syncRecipeDerivedFields(recipe);
  recipe.updatedAt = new Date().toISOString();
}

function syncRecipeDerivedFields(recipe, previousName = "") {
  if (!recipe) return;
  const metrics = getMetrics(recipe);
  const totalWeight = scaleGramValue(metrics.totalWeight, 1);
  const currentProductType = recipe.productType || "";
  const inferredProductType = inferRecipeProductType(recipe);

  if (!recipe.label) recipe.label = makeDefaultLabel();
  if (!recipe.catalog) recipe.catalog = makeDefaultCatalog(recipe);
  if (!recipe.draftBatch) recipe.draftBatch = makeDraftBatch();
  if (!recipe.label.productName || recipe.label.productName === previousName) {
    recipe.label.productName = recipe.name;
  }
  if (!recipe.productTypeLocked && isAutoProductType(currentProductType)) {
    recipe.productType = inferredProductType;
  }

  if (!recipe.label.packageWeightLocked) {
    recipe.label.netWeightG = totalWeight;
    recipe.label.netWeightOz = gramsToOunces(totalWeight);
  }
  recipe.draftBatch.finishedWeightG = totalWeight;

  if (Number(recipe.yieldCount || 0) > 0 && totalWeight > 0) {
    recipe.desiredLoafWeightG = Math.round(totalWeight / Number(recipe.yieldCount));
  }

  const processBuckets = inferProcessBuckets(recipe.steps || []);
  if (processBuckets.kneadMinutes !== null) recipe.draftBatch.kneadMinutes = processBuckets.kneadMinutes;
  if (processBuckets.bulkMinutes !== null) recipe.draftBatch.bulkMinutes = processBuckets.bulkMinutes;
  if (processBuckets.proofMinutes !== null) recipe.draftBatch.proofMinutes = processBuckets.proofMinutes;
  if (processBuckets.bakeMinutes !== null) recipe.draftBatch.bakeMinutes = processBuckets.bakeMinutes;
}

function inferRecipeProductType(recipe) {
  const text = [
    recipe.name,
    recipe.label?.productName,
    ...(recipe.ingredients || [])
      .filter((item) => Number(item.grams || 0) > 0)
      .map((item) => `${item.name} ${item.label}`),
  ]
    .join(" ")
    .toLowerCase();
  if (/sourdough/.test(text)) return "Commercial-starter sourdough bread";
  if (/milk|egg|butter|cream|cheese|yogurt/.test(text)) return "Enriched bread - review ingredients";
  if (/roll|rolls|bun|buns|hot dog|hamburger/.test(text)) return "Shelf-stable rolls";
  return "Shelf-stable bread";
}

function isAutoProductType(productType) {
  return !productType || [
    "Shelf-stable bread",
    "Commercial-starter sourdough bread",
    "Shelf-stable rolls",
    "Enriched bread - review ingredients",
  ].includes(productType);
}

function inferProcessBuckets(steps) {
  const buckets = {
    kneadMinutes: null,
    bulkMinutes: null,
    proofMinutes: null,
    bakeMinutes: null,
  };

  steps.forEach((step) => {
    const duration = Number(step.duration || 0);
    if (!duration) return;
    const text = `${step.name || ""} ${step.notes || ""}`.toLowerCase();
    const bucket = detectProcessBucket(text);
    if (!bucket) return;
    buckets[bucket] = Number(buckets[bucket] || 0) + duration;
  });

  return buckets;
}

function detectProcessBucket(text) {
  if (/preheat/.test(text)) return "";
  if (/bake/.test(text)) return "bakeMinutes";
  if (/proof|second rise|final rise|pan rim|above.*rim/.test(text)) return "proofMinutes";
  if (/bulk|first rise|ferment|doubled|double in size/.test(text)) return "bulkMinutes";
  if (/knead|stretch|fold|develop/.test(text)) return "kneadMinutes";
  return "";
}

function getStarterWaterGrams(recipe) {
  return (recipe.ingredients || [])
    .filter((ingredient) => ingredient.role === "starter")
    .reduce((total, ingredient) => total + Number(ingredient.grams || 0) / 2, 0);
}

function setRoleTotal(recipe, role, targetTotal, makeFallbackIngredient) {
  const items = recipe.ingredients.filter((ingredient) => (
    ingredient.role === role &&
    !ingredient.conversionError &&
    Number.isFinite(Number(ingredient.grams))
  ));
  if (!items.length) {
    const ingredient = makeFallbackIngredient();
    syncIngredientSourceFromGrams(ingredient);
    recipe.ingredients.push(ingredient);
    return;
  }

  const currentTotal = roleSum(recipe.ingredients, role);
  if (!currentTotal) {
    items[0].grams = scaleGramValue(targetTotal, 1);
    syncIngredientSourceFromGrams(items[0]);
    return;
  }

  const factor = targetTotal / currentTotal;
  items.forEach((ingredient, index) => {
    ingredient.grams = index === items.length - 1 ? ingredient.grams : scaleGramValue(ingredient.grams, factor);
  });

  const adjustedExceptLast = items
    .slice(0, -1)
    .reduce((total, ingredient) => total + Number(ingredient.grams || 0), 0);
  items[items.length - 1].grams = Math.max(0, scaleGramValue(targetTotal - adjustedExceptLast, 1));
  items.forEach(syncIngredientSourceFromGrams);
}

function scaleStepDurations(recipe, targetMinutes) {
  const steps = recipe.steps.filter((step) => Number(step.duration || 0) > 0);
  if (!steps.length) return;
  const currentTotal = steps.reduce((total, step) => total + Number(step.duration || 0), 0);
  const factor = targetMinutes / currentTotal;
  steps.forEach((step) => {
    step.duration = Math.max(1, Math.round(Number(step.duration || 0) * factor));
  });
  const adjustedTotal = steps.reduce((total, step) => total + Number(step.duration || 0), 0);
  const difference = targetMinutes - adjustedTotal;
  const largest = steps.reduce((best, step) => (step.duration > best.duration ? step : best), steps[0]);
  largest.duration = Math.max(1, largest.duration + difference);
}

function addBatch() {
  const recipe = getActiveRecipe();
  const batch = {
    ...recipe.draftBatch,
    id: uid(),
    savedAt: new Date().toISOString(),
  };
  recipe.batches.unshift(batch);
  if (batch.roomTempF) recipe.environment.roomTempF = batch.roomTempF;
  if (batch.humidity) recipe.environment.humidity = batch.humidity;
  recipe.label.lotCode = batch.lotCode || recipe.label.lotCode;
  recipe.label.packageDate = batch.bakeDate || recipe.label.packageDate;
  recipe.draftBatch = makeDraftBatch();
  persistAndRender("Batch saved.");
}

function addFlourLot() {
  const lot = makeDefaultLot();
  state.lots.unshift(lot);
  state.activeLotId = lot.id;
  activeTab = "lots";
  persistAndRender("Flour lot added.");
}

function addOrder() {
  const draft = normalizeOrderDraft(state.orderDraft);
  if (!draft.customerName || !draft.productName) {
    showToast("Enter customer and product first.");
    return;
  }
  const order = normalizeOrder({
    ...draft,
    id: uid(),
    orderNumber: buildOrderNumber(),
    readyAt: getOrderReadyAt(draft),
    status: "Placed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  state.orders.unshift(order);
  state.orderDraft = makeDefaultOrderDraft();
  activeTab = "orders";
  persistAndRender(`Order ${order.orderNumber} placed.`);
}

function resetOrderDraft() {
  state.orderDraft = makeDefaultOrderDraft();
  saveState();
  render();
  showToast("Order form cleared.");
}

function updateOrderPayment(orderId, paymentStatus) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  order.paymentStatus = paymentStatus;
  if (paymentStatus === "Paid") order.amountPaid = getOrderTotal(order);
  order.updatedAt = new Date().toISOString();
  persistAndRender("Payment updated.");
}

function updateOrderStatus(orderId, status) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  persistAndRender("Order status updated.");
}

function removeOrder(orderId) {
  state.orders = state.orders.filter((order) => order.id !== orderId);
  persistAndRender("Order deleted.");
}

async function copyPaymentRequest(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  const text = buildPaymentRequestText(order);
  try {
    await navigator.clipboard.writeText(text);
    showToast("Payment request copied.");
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
    showToast("Payment request copied.");
  }
}

function generateLotCode(lotId) {
  const lot = state.lots.find((item) => item.id === lotId);
  if (!lot) return;
  lot.lotCode = buildLotCode(lot);
  lot.updatedAt = new Date().toISOString();
  persistAndRender("Lot code generated.");
}

function addLotUse(lotId) {
  const lot = state.lots.find((item) => item.id === lotId);
  if (!lot) return;
  const grams = Number(lot.draftUse.grams || 0);
  if (grams <= 0) {
    showToast("Enter grams used first.");
    return;
  }
  lot.uses.unshift({
    id: uid(),
    date: lot.draftUse.date || new Date().toISOString().slice(0, 10),
    grams,
    note: lot.draftUse.note || "",
  });
  lot.draftUse = makeDraftLotUse();
  lot.updatedAt = new Date().toISOString();
  persistAndRender("Usage logged.");
}

function removeLotUse(lotId, useId) {
  const lot = state.lots.find((item) => item.id === lotId);
  if (!lot) return;
  lot.uses = lot.uses.filter((use) => use.id !== useId);
  lot.updatedAt = new Date().toISOString();
  persistAndRender("Usage removed.");
}

async function copyLotStorage(lotId) {
  const lot = state.lots.find((item) => item.id === lotId);
  if (!lot) return;
  const text = buildLotStorageText(lot);
  try {
    await navigator.clipboard.writeText(text);
    showToast("Storage text copied.");
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
    showToast("Storage text copied.");
  }
}

function removeLot(lotId) {
  state.lots = state.lots.filter((lot) => lot.id !== lotId);
  state.activeLotId = state.lots[0]?.id || "";
  persistAndRender("Flour lot deleted.");
}

async function copyLabelText() {
  const text = getLabelText(getActiveRecipe());
  try {
    await navigator.clipboard.writeText(text);
    showToast("Label text copied.");
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
    showToast("Label text copied.");
  }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bread-recipe-lab-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importChatGptRecipe() {
  const source = document.querySelector("#chatgpt-import-text")?.value || "";
  if (!source.trim()) {
    showToast("Paste a recipe first.");
    return;
  }

  const recipe = parseChatGptRecipe(source);
  if (!recipe.ingredients.length) {
    showToast("I could not find ingredient amounts. Add gram lines and try again.");
    return;
  }

  const importedRecipe = normalizeRecipe(recipe);
  syncRecipeDerivedFields(importedRecipe);
  state.recipes.unshift(importedRecipe);
  state.activeRecipeId = state.recipes[0].id;
  activeTab = "recipe";
  persistAndRender(`Imported ${recipe.name}.`);
}

function clearChatGptImporter() {
  const box = document.querySelector("#chatgpt-import-text");
  if (box) box.value = "";
  showToast("Importer cleared.");
}

function parseChatGptRecipe(source) {
  const lines = source
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map(cleanImportLine)
    .filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const title = detectRecipeTitle(lines);
  const yieldCount = detectYieldCount(source);
  const totalDoughG = detectTotalDoughGrams(source);
  const ingredientItems = refineImportedIngredients(parseIngredientLines(lines));
  const steps = parseProcessSteps(lines, source, ingredientItems);
  const totalFormulaG = sum(ingredientItems, "grams");
  const labelWeightG = totalDoughG || totalFormulaG;
  const productType = detectProductType(source, ingredientItems);

  return {
    id: uid(),
    name: title,
    status: /tested|version|v\d/i.test(source) ? "Testing" : "Draft",
    productType,
    yieldCount,
    desiredLoafWeightG: yieldCount ? Math.round(labelWeightG / yieldCount) : 0,
    starterNote: buildImportNote(source, totalDoughG, totalFormulaG),
    environment: {
      targetDoughTempF: 78,
      roomTempF: 74,
      humidity: 55,
    },
    ingredients: ingredientItems,
    steps,
    batches: [],
    draftBatch: {
      ...makeDraftBatch(),
      finishedWeightG: labelWeightG,
      notes: "Imported from pasted ChatGPT recipe text.",
    },
    label: {
      ...makeDefaultLabel(),
      businessName: "Laurens Home Bakery",
      productName: title,
      netWeightG: labelWeightG,
      netWeightOz: gramsToOunces(labelWeightG),
      packageDate: today,
      storage: "Store in a cool, dry place. Freeze for longer storage.",
      allergenMode: "detected",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function cleanImportLine(line) {
  return line
    .trim()
    .replace(/^(?:[-*]|\u2022)\s*/, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ");
}

function detectRecipeTitle(lines) {
  const ignored = /^(recipe|ingredients?|dough|method|instructions?|directions?|steps?|notes?|formula|batch log)$/i;
  const found = lines.find((line) => {
    if (ignored.test(line)) return false;
    if (/^\d+(\.\d+)?\s*(g|gram|grams|oz|ounce|ounces|tsp|tbsp|cup|cups)\b/i.test(line)) return false;
    if (/^(yield|makes|total dough|dough total)\b/i.test(line)) return false;
    return /bread|bun|buns|roll|rolls|loaf|loaves|bagel|bagels|focaccia|sourdough|brioche|pizza|naan/i.test(line);
  });
  return titleCase(found || "Imported Bread Recipe");
}

function detectYieldCount(source) {
  const yieldMatch =
    source.match(/yield(?:ed|s)?\s*:?\s*(\d+)\s*(buns?|rolls?|loaves|loaf|bagels?|pieces?)/i) ||
    source.match(/makes\s+(\d+)\s*(buns?|rolls?|loaves|loaf|bagels?|pieces?)/i) ||
    source.match(/(\d+)\s*(hot\s*dog\s*)?(buns?|rolls?|loaves|loaf|bagels?)/i);
  return yieldMatch ? Number(yieldMatch[1]) : 1;
}

function detectTotalDoughGrams(source) {
  const match =
    source.match(/total\s+(?:dough|weight)[^0-9]{0,12}(\d+(?:\.\d+)?)\s*g/i) ||
    source.match(/dough\s*\([^)]*total[^0-9]{0,12}(\d+(?:\.\d+)?)\s*g/i);
  return match ? Number(match[1]) : 0;
}

function parseIngredientLines(lines) {
  const ingredients = [];
  lines.forEach((line, index) => {
    const gramMatch = line.match(/^(\d+(?:\.\d+)?)\s*(?:g|grams?)\b\.?\s+(.+)$/i);
    const eggMatch = line.match(/^(\d+(?:\.\d+)?)\s+large\s+eggs?\b(.*)$/i);
    const mediumEggMatch = line.match(/^(\d+(?:\.\d+)?)\s+medium\s+eggs?\b(.*)$/i);
    const smallEggMatch = line.match(/^(\d+(?:\.\d+)?)\s+small\s+eggs?\b(.*)$/i);

    if (gramMatch) {
      ingredients.push(makeImportedIngredient(gramMatch[2], Number(gramMatch[1]), index));
      return;
    }
    if (eggMatch) {
      ingredients.push(makeImportedIngredient(`large egg ${eggMatch[2] || ""}`, Number(eggMatch[1]) * 50, index));
      return;
    }
    if (mediumEggMatch) {
      ingredients.push(makeImportedIngredient(`medium egg ${mediumEggMatch[2] || ""}`, Number(mediumEggMatch[1]) * 44, index));
      return;
    }
    if (smallEggMatch) {
      ingredients.push(makeImportedIngredient(`small egg ${smallEggMatch[2] || ""}`, Number(smallEggMatch[1]) * 38, index));
    }
  });
  return ingredients;
}

function makeImportedIngredient(rawName, grams, index) {
  const cleanName = cleanIngredientName(rawName);
  return {
    id: uid(),
    index,
    name: titleCase(cleanName),
    label: makeLabelIngredient(cleanName),
    grams,
    role: inferIngredientRole(cleanName),
    allergens: inferAllergens(cleanName).join(", "),
  };
}

function refineImportedIngredients(ingredients) {
  const flourItems = ingredients.filter((item) => item.role === "flour");
  return ingredients
    .filter((item) => !isDuplicateFlourAggregate(item, flourItems))
    .filter((item) => !isTangzhongSubsetFlour(item, flourItems))
    .map(({ index, ...item }) => item);
}

function isDuplicateFlourAggregate(item, flourItems) {
  const name = `${item.name} ${item.label}`.toLowerCase();
  if (!/(fresh[- ]?milled flour|flour blend|total flour)/.test(name)) return false;
  const laterFlours = flourItems.filter((candidate) => candidate.index > item.index && candidate.index <= item.index + 6);
  const primaryLaterFlours = laterFlours.filter((candidate) => !/tangzhong/i.test(`${candidate.name} ${candidate.label}`));
  const laterTotal = sum(primaryLaterFlours, "grams");
  return primaryLaterFlours.length >= 2 && Math.abs(laterTotal - item.grams) <= 1;
}

function isTangzhongSubsetFlour(item, flourItems) {
  const name = `${item.name} ${item.label}`.toLowerCase();
  if (!/tangzhong/.test(name) || !/\bflour\b/.test(name)) return false;
  return flourItems.some((candidate) => candidate.index < item.index && candidate.index !== item.index);
}

function cleanIngredientName(rawName) {
  return rawName
    .replace(/\([^)]*%[^)]*\)/g, "")
    .replace(/\badditional\b/gi, "")
    .replace(/\bfor\s+tangzhong\b/gi, "")
    .replace(/\btangzhong\s+base\b/gi, "")
    .replace(/\badded\s+after\s+rest\b/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[,:;]+$/g, "")
    .trim();
}

function makeLabelIngredient(name) {
  const lower = name.toLowerCase();
  if (/hard white wheat/.test(lower)) return "fresh-milled hard white wheat flour (wheat)";
  if (/soft white wheat/.test(lower)) return "fresh-milled soft white wheat flour (wheat)";
  if (/\bflour\b|wheat/.test(lower)) return `${nameForLabel(name)} (wheat)`;
  if (/\bbutter\b/.test(lower)) return "butter (milk)";
  if (/\bmilk\b/.test(lower)) return "milk";
  if (/\begg\b/.test(lower)) return "egg";
  if (/\bsesame\b/.test(lower)) return `${nameForLabel(name)} (sesame)`;
  if (/\bsoy\b/.test(lower)) return `${nameForLabel(name)} (soy)`;
  return nameForLabel(name);
}

function nameForLabel(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inferIngredientRole(name) {
  const lower = name.toLowerCase();
  if (/starter|levain/.test(lower)) return "starter";
  if (/flour|wheat|rye|spelt|einkorn/.test(lower)) return "flour";
  if (/water|milk|buttermilk|cream/.test(lower)) return "water";
  if (/salt/.test(lower)) return "salt";
  if (/yeast/.test(lower)) return "yeast";
  if (/honey|sugar|maple|molasses|malt/.test(lower)) return "sweetener";
  if (/butter|oil|shortening|lard/.test(lower)) return "fat";
  return "add-in";
}

function inferAllergens(name) {
  const lower = name.toLowerCase();
  const allergens = [];
  if (/flour|wheat|spelt|einkorn|semolina|durum/.test(lower)) allergens.push("wheat");
  if (/milk|butter|cream|buttermilk|whey/.test(lower)) allergens.push("milk");
  if (/\begg\b/.test(lower)) allergens.push("egg");
  if (/\bsoy\b/.test(lower)) allergens.push("soy");
  if (/peanut/.test(lower)) allergens.push("peanuts");
  if (/sesame/.test(lower)) allergens.push("sesame");
  if (TREE_NUT_WORDS.some((nut) => lower.includes(nut))) allergens.push("tree nuts");
  return [...new Set(allergens)];
}

function parseProcessSteps(lines, source, ingredients) {
  const processWords = /(tangzhong|mix|autolyse|rest|knead|fold|rise|bulk|shape|proof|bake|cool)/i;
  const imported = lines
    .filter((line) => processWords.test(line))
    .filter((line) => !/^(\d+(?:\.\d+)?)\s*(g|grams?)\b/i.test(line))
    .map((line) => makeImportedStep(line));
  if (imported.length) return imported.slice(0, 12);

  const fallback = [];
  if (/tangzhong/i.test(source)) {
    fallback.push({
      id: uid(),
      name: "Tangzhong",
      duration: 6,
      temp: "Cook gently",
      notes: "Cook the tangzhong flour and liquid until thickened, then cool.",
    });
  }
  fallback.push(
    { id: uid(), name: "Mix", duration: 10, temp: "Room temp", notes: "Mix ingredients until combined." },
    { id: uid(), name: "Rest", duration: /rest/i.test(source) ? 20 : 0, temp: "Covered", notes: "Rest dough if called for in the source notes." },
  );
  if (ingredients.some((item) => item.role === "fat")) {
    fallback.push({
      id: uid(),
      name: "Add fat and knead",
      duration: 10,
      temp: "Soft fat",
      notes: "Add butter or oil after the rest if the source calls for it.",
    });
  }
  fallback.push(
    { id: uid(), name: "Bulk rise", duration: 60, temp: "Warm room", notes: "Rise until puffy." },
    { id: uid(), name: "Shape", duration: 15, temp: "Bench", notes: "Divide and shape for the recorded yield." },
    { id: uid(), name: "Final proof", duration: 45, temp: "Warm room", notes: "Proof until expanded." },
    { id: uid(), name: "Bake", duration: 20, temp: "Oven", notes: "Bake until fully set, then cool before packaging." },
  );
  return fallback;
}

function makeImportedStep(line) {
  const cleaned = line.replace(/^\d+[\.)]\s*/, "");
  const nameMatch = cleaned.match(/^(tangzhong|mix|autolyse|rest|knead|fold|bulk rise|rise|shape|proof|bake|cool)\b/i);
  const durationMatch = cleaned.match(/(\d+)\s*(?:minutes?|mins?|min|hours?|hrs?|hr)\b/i);
  const duration = durationMatch ? Number(durationMatch[1]) * (/hour|hr/i.test(durationMatch[0]) ? 60 : 1) : 0;
  return {
    id: uid(),
    name: titleCase(nameMatch ? nameMatch[1] : cleaned.slice(0, 34)),
    duration,
    temp: detectTemperatureNote(cleaned),
    notes: cleaned,
  };
}

function detectTemperatureNote(line) {
  const tempMatch = line.match(/(\d{2,3})\s*(?:degrees?\s*)?f\b/i);
  return tempMatch ? `${tempMatch[1]} F` : "";
}

function detectProductType(source, ingredients) {
  const text = source.toLowerCase();
  if (/sourdough/.test(text)) return "Commercial-starter sourdough bread";
  if (ingredients.some((item) => /milk|egg|butter|cream/.test(`${item.name} ${item.label}`.toLowerCase()))) {
    return "Enriched bread - review ingredients";
  }
  if (/roll|bun/.test(text)) return "Shelf-stable rolls";
  return "Shelf-stable bread";
}

function buildImportNote(source, totalDoughG, totalFormulaG) {
  const notes = ["Imported from pasted ChatGPT recipe text. Review parsed weights, process, cottage-food eligibility, and label before sale."];
  if (totalDoughG && totalFormulaG && Math.abs(totalDoughG - totalFormulaG) > 3) {
    notes.push(`Source total dough says ${round(totalDoughG)} g; parsed ingredient sum is ${round(totalFormulaG)} g.`);
  }
  if (/large\s+egg/i.test(source)) {
    notes.push("Large egg was estimated at 50 g unless the source gave a gram weight.");
  }
  return notes.join(" ");
}

function gramsToOunces(grams) {
  return Math.round((Number(grams || 0) / 28.3495) * 10) / 10;
}

function persistAndRender(message) {
  const recipe = getActiveRecipe();
  if (recipe) recipe.updatedAt = new Date().toISOString();
  saveState();
  render();
  if (message) showToast(message);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.recipes?.length) {
      return applyRecipeSeeds(normalizeAppState({
        activeRecipeId: saved.activeRecipeId || saved.recipes[0].id,
        recipes: saved.recipes.map(normalizeRecipe),
        activeLotId: saved.activeLotId,
        lots: saved.lots || [],
        orders: saved.orders || [],
        orderDraft: saved.orderDraft || {},
      }));
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  const recipe = makeDefaultRecipe();
  return applyRecipeSeeds(normalizeAppState({
    activeRecipeId: recipe.id,
    recipes: [recipe],
    activeLotId: "",
    lots: [],
    orders: [],
    orderDraft: {},
  }));
}

function normalizeAppState(rawState) {
  const recipes = (rawState.recipes || []).map(normalizeRecipe);
  const lots = (rawState.lots || []).map(normalizeLot);
  const orders = (rawState.orders || []).map(normalizeOrder);
  return {
    activeRecipeId: rawState.activeRecipeId || recipes[0]?.id || "",
    activeLotId: rawState.activeLotId || lots[0]?.id || "",
    recipes,
    lots,
    orders,
    orderDraft: normalizeOrderDraft(rawState.orderDraft || {}),
  };
}

function applyRecipeSeeds(nextState) {
  const seeds = [
    {
      key: "signature-fresh-milled-hot-dog-buns-v1",
      name: "Signature Fresh-Milled Hot Dog Buns",
      make: makeSignatureHotdogBunsRecipe,
    },
    {
      key: "faithful-true-artisan-hearth-loaf-v1",
      name: "Faithful & True Artisan Hearth Loaf",
      make: makeFaithfulTrueArtisanHearthLoafRecipe,
    },
    {
      key: "honey-vanilla-sandwich-bread-v2",
      name: "Honey Vanilla Sandwich Bread",
      make: makeVanillaHoneyBreadRecipe,
    },
    {
      key: "signature-strawberry-banana-bread-v1",
      name: "Faithful & True Signature Fresh-Milled Strawberry Banana Bread",
      make: makeSignatureStrawberryBananaBreadRecipe,
    },
  ];
  let ledger = {};
  try {
    ledger = JSON.parse(localStorage.getItem(RECIPE_SEED_KEY)) || {};
  } catch {
    ledger = {};
  }

  let changed = false;
  if (!ledger["update-honey-vanilla-sandwich-bread-v2"]) {
    const existingIndex = nextState.recipes.findIndex(
      (recipe) => recipe.seedKey === "vanilla-honey-bread-v1" || recipe.name === "Vanilla Honey Bread",
    );
    if (existingIndex >= 0) {
      const existing = nextState.recipes[existingIndex];
      const updated = makeVanillaHoneyBreadRecipe();
      updated.id = existing.id;
      updated.createdAt = existing.createdAt || updated.createdAt;
      updated.updatedAt = new Date().toISOString();
      nextState.recipes[existingIndex] = normalizeRecipe(updated);
      nextState.activeRecipeId = updated.id;
      changed = true;
    }
    ledger["update-honey-vanilla-sandwich-bread-v2"] = true;
    if (existingIndex >= 0) ledger["honey-vanilla-sandwich-bread-v2"] = true;
  }
  seeds.forEach((seed) => {
    const exists = nextState.recipes.some(
      (recipe) => recipe.seedKey === seed.key || recipe.name === seed.name,
    );
    if (exists) {
      if (!ledger[seed.key]) {
        ledger[seed.key] = true;
        changed = true;
      }
      return;
    }
    if (ledger[seed.key]) return;
    const recipe = seed.make();
    nextState.recipes.unshift(recipe);
    nextState.activeRecipeId = recipe.id;
    ledger[seed.key] = true;
    changed = true;
  });

  if (changed) {
    localStorage.setItem(RECIPE_SEED_KEY, JSON.stringify(ledger));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }
  return nextState;
}

function saveState(prefix = "Saved locally") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (window.BREAD_CLOUD) { window.breadCloud.save(state); return; }
  saveStatus.textContent = `${prefix} at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
}

function getActiveRecipe() {
  return state.recipes.find((recipe) => recipe.id === state.activeRecipeId) || state.recipes[0];
}

function makeBlankRecipe(name = "New Bread") {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  return normalizeRecipe({
    id: uid(),
    name,
    status: "Draft",
    productType: "Shelf-stable bread",
    yieldCount: 1,
    desiredLoafWeightG: 0,
    starterNote: "Fill in ingredient grams and roles first. Hydration updates when flour and liquid rows have weights.",
    environment: {
      targetDoughTempF: 78,
      roomTempF: 74,
      humidity: 55,
    },
    ingredients: [
      { id: uid(), name: "Fresh-milled flour", label: "fresh-milled wheat flour (wheat)", grams: 0, role: "flour", allergens: "wheat" },
      { id: uid(), name: "Liquid", label: "water", grams: 0, role: "water", allergens: "" },
      { id: uid(), name: "Salt", label: "salt", grams: 0, role: "salt", allergens: "" },
      { id: uid(), name: "Yeast or starter", label: "instant yeast", grams: 0, role: "yeast", allergens: "" },
      { id: uid(), name: "Sweetener", label: "honey", grams: 0, role: "sweetener", allergens: "" },
      { id: uid(), name: "Fat or add-in", label: "", grams: 0, role: "fat", allergens: "" },
    ],
    steps: [
      { id: uid(), name: "Mix", duration: 0, temp: "", notes: "" },
      { id: uid(), name: "Rest", duration: 0, temp: "", notes: "" },
      { id: uid(), name: "Knead or folds", duration: 0, temp: "", notes: "" },
      { id: uid(), name: "Bulk rise", duration: 0, temp: "", notes: "" },
      { id: uid(), name: "Shape", duration: 0, temp: "", notes: "" },
      { id: uid(), name: "Final proof", duration: 0, temp: "", notes: "" },
      { id: uid(), name: "Bake", duration: 0, temp: "", notes: "" },
      { id: uid(), name: "Cool", duration: 0, temp: "", notes: "" },
    ],
    batches: [],
    draftBatch: {
      ...makeDraftBatch(),
      kneadMinutes: 0,
      bulkMinutes: 0,
      proofMinutes: 0,
      bakeMinutes: 0,
      finishedWeightG: 0,
      notes: "",
    },
    label: {
      ...makeDefaultLabel(),
      businessName: "Laurens Home Bakery",
      productName: name,
      packageDate: today,
      storage: "Store in a cool, dry place. Freeze for longer storage.",
      allergenMode: "detected",
    },
    createdAt: now,
    updatedAt: now,
  });
}

function makeDefaultRecipe() {
  const today = new Date().toISOString().slice(0, 10);
  return normalizeRecipe({
    id: uid(),
    name: "Country Sourdough Bread",
    status: "Testing",
    productType: "Commercial-starter sourdough bread",
    yieldCount: 2,
    desiredLoafWeightG: 680,
    starterNote: "Commercial sourdough starter, maintained at 100% hydration.",
    environment: {
      targetDoughTempF: 78,
      roomTempF: 74,
      humidity: 55,
    },
    ingredients: [
      { id: uid(), name: "Bread flour", label: "bread flour (wheat)", grams: 500, role: "flour", allergens: "wheat" },
      { id: uid(), name: "Water", label: "water", grams: 360, role: "water", allergens: "" },
      { id: uid(), name: "Sourdough starter", label: "sourdough starter (wheat flour, water)", grams: 120, role: "starter", allergens: "wheat" },
      { id: uid(), name: "Fine sea salt", label: "sea salt", grams: 11, role: "salt", allergens: "" },
    ],
    steps: [
      { id: uid(), name: "Mix", duration: 10, temp: "74 F room", notes: "Combine until no dry flour remains." },
      { id: uid(), name: "Rest", duration: 30, temp: "Covered", notes: "Let flour hydrate." },
      { id: uid(), name: "Knead or folds", duration: 12, temp: "76-78 F dough", notes: "Develop moderate gluten." },
      { id: uid(), name: "Bulk rise", duration: 240, temp: "74 F room", notes: "Rise until airy and expanded." },
      { id: uid(), name: "Shape and proof", duration: 90, temp: "Room temp", notes: "Proof until dough springs back slowly." },
      { id: uid(), name: "Bake", duration: 38, temp: "450 F then 425 F", notes: "Cool fully before bagging." },
    ],
    batches: [],
    draftBatch: makeDraftBatch(),
    label: {
      businessName: "Laurens Home Bakery",
      productName: "Country Sourdough Bread",
      address: "",
      scdaId: "",
      useScdaId: false,
      netWeightG: 680,
      netWeightOz: 24,
      lotCode: "",
      packageDate: today,
      bestBy: "",
      contact: "",
      storage: "Store in a cool, dry place. Freeze for longer storage.",
      allergenMode: "detected",
      healthClaims: "",
      localReviewComplete: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function makeSignatureHotdogBunsRecipe() {
  const today = new Date().toISOString().slice(0, 10);
  const batchId = uid();
  return normalizeRecipe({
    id: uid(),
    seedKey: "signature-fresh-milled-hot-dog-buns-v1",
    name: "Signature Fresh-Milled Hot Dog Buns",
    status: "Testing",
    productType: "Enriched bread - review ingredients",
    yieldCount: 4,
    desiredLoafWeightG: 115,
    starterNote:
      "Version 1.0 tested. Fresh-milled blend: 75% hard white wheat and 25% soft white wheat. Reserve 12 g of the flour for the tangzhong.",
    environment: {
      targetDoughTempF: 78,
      roomTempF: 74,
      humidity: 55,
    },
    ingredients: [
      {
        id: uid(),
        name: "Hard white wheat flour",
        label: "fresh-milled wheat flour (hard white wheat, soft white wheat)",
        grams: 171,
        role: "flour",
        allergens: "wheat",
      },
      {
        id: uid(),
        name: "Soft white wheat flour",
        label: "fresh-milled wheat flour (hard white wheat, soft white wheat)",
        grams: 57,
        role: "flour",
        allergens: "wheat",
      },
      {
        id: uid(),
        name: "Milk for tangzhong",
        label: "milk",
        grams: 60,
        role: "water",
        allergens: "milk",
      },
      {
        id: uid(),
        name: "Additional milk",
        label: "milk",
        grams: 90,
        role: "water",
        allergens: "milk",
      },
      {
        id: uid(),
        name: "Large egg",
        label: "egg",
        grams: 50,
        role: "add-in",
        allergens: "egg",
      },
      {
        id: uid(),
        name: "Honey",
        label: "honey",
        grams: 18,
        role: "sweetener",
        allergens: "",
      },
      {
        id: uid(),
        name: "Butter",
        label: "butter (milk)",
        grams: 21,
        role: "fat",
        allergens: "milk",
      },
      {
        id: uid(),
        name: "Salt",
        label: "salt",
        grams: 4,
        role: "salt",
        allergens: "",
      },
      {
        id: uid(),
        name: "Instant yeast",
        label: "instant yeast",
        grams: 4,
        role: "yeast",
        allergens: "",
      },
    ],
    steps: [
      {
        id: uid(),
        name: "Tangzhong",
        duration: 6,
        temp: "Cook gently",
        notes: "Cook 12 g of the flour with 60 g milk until thickened, then cool.",
      },
      {
        id: uid(),
        name: "Mix",
        duration: 10,
        temp: "Room temp",
        notes: "Mix tangzhong, remaining flour, additional milk, egg, honey, salt, and yeast.",
      },
      {
        id: uid(),
        name: "Rest",
        duration: 20,
        temp: "Covered",
        notes: "Rest before adding butter.",
      },
      {
        id: uid(),
        name: "Add butter and knead",
        duration: 10,
        temp: "Soft butter",
        notes: "Add butter after rest and knead until smooth and elastic.",
      },
      {
        id: uid(),
        name: "Bulk rise",
        duration: 60,
        temp: "Warm room",
        notes: "Rise until puffy.",
      },
      {
        id: uid(),
        name: "Divide and shape",
        duration: 15,
        temp: "Bench",
        notes: "Divide into 4 hot dog buns, about 115 g each if using the reported 460 g dough yield.",
      },
      {
        id: uid(),
        name: "Final proof",
        duration: 45,
        temp: "Warm room",
        notes: "Proof until expanded and soft.",
      },
      {
        id: uid(),
        name: "Bake",
        duration: 18,
        temp: "350-375 F",
        notes: "Bake until golden and fully set; cool before packaging.",
      },
    ],
    batches: [
      {
        id: batchId,
        lotCode: "HDB-V1-001",
        bakeDate: today,
        roomTempF: 74,
        humidity: 55,
        doughTempF: 78,
        waterTempF: 0,
        kneadMinutes: 10,
        bulkMinutes: 60,
        proofMinutes: 45,
        bakeMinutes: 18,
        finishedWeightG: 460,
        rating: 8,
        notes: "Version 1.0 tested. Reported yield: 4 hot dog buns.",
        adjustment: "",
        savedAt: new Date().toISOString(),
      },
    ],
    draftBatch: {
      ...makeDraftBatch(),
      lotCode: "HDB-V1-002",
      finishedWeightG: 460,
      kneadMinutes: 10,
      bulkMinutes: 60,
      proofMinutes: 45,
      bakeMinutes: 18,
      rating: 8,
    },
    label: {
      businessName: "Laurens Home Bakery",
      productName: "Signature Fresh-Milled Hot Dog Buns",
      address: "",
      scdaId: "",
      useScdaId: false,
      netWeightG: 460,
      netWeightOz: 16.2,
      lotCode: "HDB-V1-001",
      packageDate: today,
      bestBy: "",
      contact: "",
      storage: "Store in a cool, dry place. Freeze for longer storage.",
      allergenMode: "detected",
      healthClaims: "",
      localReviewComplete: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function makeFaithfulTrueArtisanHearthLoafRecipe() {
  const today = new Date().toISOString().slice(0, 10);
  return normalizeRecipe({
    id: uid(),
    seedKey: "faithful-true-artisan-hearth-loaf-v1",
    name: "Faithful & True Artisan Hearth Loaf",
    status: "Draft",
    productType: "Shelf-stable bread",
    yieldCount: 1,
    desiredLoafWeightG: 918,
    starterNote:
      "Makes 1 large artisan loaf. Honey is optional but recommended; remove or zero that ingredient for a no-honey batch. Fresh-milled Hard White Wheat formula at 77% hydration before optional honey.",
    environment: {
      targetDoughTempF: 78,
      roomTempF: 74,
      humidity: 55,
    },
    ingredients: [
      {
        id: uid(),
        name: "Fresh-milled Hard White Wheat",
        label: "fresh-milled hard white wheat flour (wheat)",
        grams: 500,
        role: "flour",
        allergens: "wheat",
      },
      {
        id: uid(),
        name: "Warm water",
        label: "water",
        grams: 385,
        role: "water",
        allergens: "",
      },
      {
        id: uid(),
        name: "Salt",
        label: "salt",
        grams: 10,
        role: "salt",
        allergens: "",
      },
      {
        id: uid(),
        name: "Instant yeast",
        label: "instant yeast",
        grams: 8,
        role: "yeast",
        allergens: "",
      },
      {
        id: uid(),
        name: "Honey",
        label: "honey",
        grams: 15,
        role: "sweetener",
        allergens: "",
      },
    ],
    steps: [
      {
        id: uid(),
        name: "Mix flour and water",
        duration: 5,
        temp: "Warm water",
        notes: "Combine the flour and water until no dry flour remains.",
      },
      {
        id: uid(),
        name: "Hydration rest",
        duration: 20,
        temp: "Covered",
        notes: "Rest to hydrate the fresh-milled flour, soften bran, and improve gluten development.",
      },
      {
        id: uid(),
        name: "Add salt, yeast, honey",
        duration: 5,
        temp: "Room temp",
        notes: "Mix in salt, yeast, and honey if using until fully incorporated.",
      },
      {
        id: uid(),
        name: "Stretch and folds",
        duration: 120,
        temp: "Room temp",
        notes: "Perform 4 sets of stretch-and-folds, 30 minutes apart.",
      },
      {
        id: uid(),
        name: "Bulk ferment",
        duration: 105,
        temp: "Room temp",
        notes: "Rise until about 75% larger, roughly 1.5 to 2 hours depending on room temperature.",
      },
      {
        id: uid(),
        name: "Shape",
        duration: 10,
        temp: "Lightly floured bench",
        notes: "Turn out, create a tight round loaf, and place seam-side up in a floured banneton or towel-lined bowl.",
      },
      {
        id: uid(),
        name: "Final proof",
        duration: 60,
        temp: "Room temp or cold",
        notes: "Proof 45 to 60 minutes, or refrigerate overnight for deeper flavor.",
      },
      {
        id: uid(),
        name: "Preheat Dutch oven",
        duration: 30,
        temp: "475 F",
        notes: "Preheat Dutch oven to 475 F for at least 30 minutes.",
      },
      {
        id: uid(),
        name: "Bake covered",
        duration: 30,
        temp: "475 F",
        notes: "Transfer loaf onto parchment, score, place in hot Dutch oven, and bake covered.",
      },
      {
        id: uid(),
        name: "Bake uncovered",
        duration: 18,
        temp: "475 F",
        notes: "Bake uncovered 15 to 20 minutes, until deep golden and 205 to 210 F internal temperature.",
      },
      {
        id: uid(),
        name: "Cool",
        duration: 90,
        temp: "Rack",
        notes: "Cool fully before slicing or packaging.",
      },
    ],
    batches: [],
    draftBatch: {
      ...makeDraftBatch(),
      lotCode: "FTH-V1-001",
      kneadMinutes: 0,
      bulkMinutes: 105,
      proofMinutes: 60,
      bakeMinutes: 48,
      finishedWeightG: 918,
      rating: 7,
      notes: "Use 4 stretch-and-fold sets, 30 minutes apart. Confirm final baked weight after the first test batch.",
    },
    label: {
      businessName: "Laurens Home Bakery",
      productName: "Faithful & True Artisan Hearth Loaf",
      address: "",
      scdaId: "",
      useScdaId: false,
      netWeightG: 918,
      netWeightOz: 32.4,
      lotCode: "FTH-V1-001",
      packageDate: today,
      bestBy: "",
      contact: "",
      storage: "Store in a cool, dry place. Freeze for longer storage.",
      allergenMode: "detected",
      healthClaims: "",
      localReviewComplete: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function makeVanillaHoneyBreadRecipe() {
  const today = new Date().toISOString().slice(0, 10);
  return normalizeRecipe({
    id: uid(),
    seedKey: "honey-vanilla-sandwich-bread-v2",
    name: "Honey Vanilla Sandwich Bread",
    status: "Draft",
    productType: "Enriched bread - review ingredients",
    yieldCount: 2,
    desiredLoafWeightG: 943,
    starterNote:
      "Updated 2-loaf tangzhong enriched sandwich bread. Uses 900 g total fresh-milled flour: 700 g hard white wheat and 200 g soft white wheat. Tangzhong uses 45 g flour and 225 g milk from the totals. Eggs are estimated at 50 g each. Optional vanilla bean paste and almond extract are included as zero-gram rows.",
    environment: {
      targetDoughTempF: 78,
      roomTempF: 74,
      humidity: 55,
    },
    ingredients: [
      {
        id: uid(),
        name: "Hard White Wheat flour",
        label: "fresh-milled hard white wheat flour (wheat)",
        grams: 655,
        role: "flour",
        allergens: "wheat",
      },
      {
        id: uid(),
        name: "Soft White Wheat flour",
        label: "fresh-milled soft white wheat flour (wheat)",
        grams: 200,
        role: "flour",
        allergens: "wheat",
      },
      {
        id: uid(),
        name: "Tangzhong flour from Hard White Wheat",
        label: "fresh-milled hard white wheat flour (wheat)",
        grams: 45,
        role: "flour",
        allergens: "wheat",
      },
      {
        id: uid(),
        name: "Whole milk for tangzhong",
        label: "whole milk",
        grams: 225,
        role: "water",
        allergens: "milk",
      },
      {
        id: uid(),
        name: "Whole milk",
        label: "whole milk",
        grams: 375,
        role: "water",
        allergens: "milk",
      },
      {
        id: uid(),
        name: "Honey",
        label: "honey",
        grams: 90,
        role: "sweetener",
        allergens: "",
      },
      {
        id: uid(),
        name: "Sugar",
        label: "sugar",
        grams: 50,
        role: "sweetener",
        allergens: "",
      },
      {
        id: uid(),
        name: "Unsalted butter",
        label: "unsalted butter (milk)",
        grams: 100,
        role: "fat",
        allergens: "milk",
      },
      {
        id: uid(),
        name: "Salt",
        label: "salt",
        grams: 15,
        role: "salt",
        allergens: "",
      },
      {
        id: uid(),
        name: "Instant yeast",
        label: "instant yeast",
        grams: 15,
        role: "yeast",
        allergens: "",
      },
      {
        id: uid(),
        name: "Large eggs",
        label: "egg",
        grams: 100,
        role: "add-in",
        allergens: "egg",
      },
      {
        id: uid(),
        name: "Vanilla extract",
        label: "vanilla extract",
        grams: 15,
        role: "add-in",
        allergens: "",
      },
      {
        id: uid(),
        name: "Vanilla bean paste optional",
        label: "vanilla bean paste",
        grams: 0,
        role: "add-in",
        allergens: "",
      },
      {
        id: uid(),
        name: "Almond extract optional",
        label: "almond extract (tree nuts: almond)",
        grams: 0,
        role: "add-in",
        allergens: "tree nuts",
      },
    ],
    steps: [
      {
        id: uid(),
        name: "Mill flour",
        duration: 5,
        temp: "Fresh milled",
        notes: "Mill 700 g Hard White Wheat and 200 g Soft White Wheat. Reserve 45 g fresh-milled flour for the tangzhong and use 855 g flour in the dough.",
      },
      {
        id: uid(),
        name: "Mix and rest",
        duration: 25,
        temp: "Covered",
        notes: "Mix the 855 g remaining fresh-milled flour with 375 g warm whole milk until no dry spots remain. Cover and rest 20 to 30 minutes to hydrate the fresh-milled flour.",
      },
      {
        id: uid(),
        name: "Make tangzhong",
        duration: 8,
        temp: "150 F",
        notes: "Whisk 45 g reserved flour and 225 g whole milk in a small saucepan. Cook over medium-low heat, stirring constantly, until pudding-like and about 149 to 150 F. Lines should form when stirred.",
      },
      {
        id: uid(),
        name: "Cool tangzhong",
        duration: 15,
        temp: "Lukewarm",
        notes: "Remove tangzhong from heat and cool to lukewarm before adding it to the dough.",
      },
      {
        id: uid(),
        name: "Mix dough",
        duration: 10,
        temp: "Room temp",
        notes: "Add all tangzhong, honey, sugar, eggs, vanilla extract, yeast, softened butter, and salt to the rested dough. Add optional vanilla bean paste or a very small amount of almond extract only if using. Mix until fully combined.",
      },
      {
        id: uid(),
        name: "Knead",
        duration: 12,
        temp: "Room temp",
        notes: "Knead 10 to 12 minutes by hand, or 8 to 10 minutes in a mixer, until smooth, elastic, and slightly tacky but not sticky.",
      },
      {
        id: uid(),
        name: "First rise",
        duration: 75,
        temp: "Greased bowl",
        notes: "Place in a greased bowl, cover, and let rise 60 to 90 minutes until doubled.",
      },
      {
        id: uid(),
        name: "Divide and shape",
        duration: 15,
        temp: "Two 9x5 pans",
        notes: "Gently deflate, divide into two equal pieces, shape into tight loaves, and place seam-side down in greased 9x5 pans.",
      },
      {
        id: uid(),
        name: "Second rise",
        duration: 60,
        temp: "Covered",
        notes: "Cover and let rise until dough crowns about 1 inch above the pan rims, usually 45 to 75 minutes.",
      },
      {
        id: uid(),
        name: "Bake",
        duration: 33,
        temp: "350 F",
        notes: "Bake at 350 F for 30 to 35 minutes, until internal temperature reaches 195 to 200 F.",
      },
      {
        id: uid(),
        name: "Finish and cool",
        duration: 90,
        temp: "Rack",
        notes: "Remove loaves immediately from pans. Brush tops with melted butter for a soft crust, then cool completely before slicing.",
      },
    ],
    batches: [],
    draftBatch: {
      ...makeDraftBatch(),
      lotCode: "HVS-V2-001",
      kneadMinutes: 12,
      bulkMinutes: 75,
      proofMinutes: 60,
      bakeMinutes: 33,
      finishedWeightG: 1885,
      rating: 7,
      notes: "Confirm finished cooled loaf weights after first bake. Formula weight includes estimated 100 g total egg and optional flavor boost rows at 0 g.",
    },
    label: {
      businessName: "Laurens Home Bakery",
      productName: "Honey Vanilla Sandwich Bread",
      address: "",
      scdaId: "",
      useScdaId: false,
      netWeightG: 1885,
      netWeightOz: 66.5,
      lotCode: "HVS-V2-001",
      packageDate: today,
      bestBy: "",
      contact: "",
      storage: "Store in a cool, dry place. Freeze for longer storage.",
      allergenMode: "detected",
      healthClaims: "",
      localReviewComplete: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function makeSignatureStrawberryBananaBreadRecipe() {
  const today = new Date().toISOString().slice(0, 10);
  return normalizeRecipe({
    id: uid(),
    seedKey: "signature-strawberry-banana-bread-v1",
    name: "Faithful & True Signature Fresh-Milled Strawberry Banana Bread",
    status: "Draft",
    productType: "Enriched bread - review ingredients",
    yieldCount: 1,
    desiredLoafWeightG: 1284,
    starterNote:
      "Yield: 1 large 9x5 loaf, about 10 to 12 slices. Quick bread batter; hydration is not a dough target. Fruit moisture is tracked as add-ins. Optional premium glaze is included as zero-gram rows until used.",
    environment: {
      targetDoughTempF: 72,
      roomTempF: 74,
      humidity: 55,
    },
    ingredients: [
      {
        id: uid(),
        name: "Soft White Wheat flour",
        label: "fresh-milled soft white wheat flour (wheat)",
        grams: 240,
        role: "flour",
        allergens: "wheat",
      },
      {
        id: uid(),
        name: "Hard White Wheat flour",
        label: "fresh-milled hard white wheat flour (wheat)",
        grams: 60,
        role: "flour",
        allergens: "wheat",
      },
      {
        id: uid(),
        name: "Very ripe bananas",
        label: "bananas",
        grams: 340,
        role: "add-in",
        allergens: "",
      },
      {
        id: uid(),
        name: "Fresh strawberries",
        label: "fresh strawberries",
        grams: 200,
        role: "add-in",
        allergens: "",
      },
      {
        id: uid(),
        name: "Unsalted butter",
        label: "unsalted butter (milk)",
        grams: 115,
        role: "fat",
        allergens: "milk",
      },
      {
        id: uid(),
        name: "Large eggs",
        label: "eggs",
        grams: 100,
        role: "add-in",
        allergens: "egg",
      },
      {
        id: uid(),
        name: "Brown sugar",
        label: "brown sugar",
        grams: 100,
        role: "sweetener",
        allergens: "",
      },
      {
        id: uid(),
        name: "Honey",
        label: "honey",
        grams: 50,
        role: "sweetener",
        allergens: "",
      },
      {
        id: uid(),
        name: "Whole milk",
        label: "whole milk",
        grams: 50,
        role: "water",
        allergens: "milk",
      },
      {
        id: uid(),
        name: "Vanilla extract",
        label: "vanilla extract",
        grams: 5,
        role: "add-in",
        allergens: "",
      },
      {
        id: uid(),
        name: "Baking powder",
        label: "baking powder",
        grams: 8,
        role: "other",
        allergens: "",
      },
      {
        id: uid(),
        name: "Baking soda",
        label: "baking soda",
        grams: 4,
        role: "other",
        allergens: "",
      },
      {
        id: uid(),
        name: "Sea salt",
        label: "sea salt",
        grams: 6,
        role: "salt",
        allergens: "",
      },
      {
        id: uid(),
        name: "Cinnamon",
        label: "cinnamon",
        grams: 5.2,
        role: "other",
        allergens: "",
      },
      {
        id: uid(),
        name: "Nutmeg",
        label: "nutmeg",
        grams: 0.6,
        role: "other",
        allergens: "",
      },
      {
        id: uid(),
        name: "Powdered sugar glaze, optional",
        label: "powdered sugar",
        grams: 0,
        role: "topping",
        allergens: "",
      },
      {
        id: uid(),
        name: "Milk for glaze, optional",
        label: "milk",
        grams: 0,
        role: "topping",
        allergens: "milk",
      },
      {
        id: uid(),
        name: "Vanilla extract for glaze, optional",
        label: "vanilla extract",
        grams: 0,
        role: "topping",
        allergens: "",
      },
      {
        id: uid(),
        name: "Salt for glaze, optional",
        label: "salt",
        grams: 0,
        role: "topping",
        allergens: "",
      },
    ],
    steps: [
      {
        id: uid(),
        name: "Preheat oven",
        duration: 15,
        temp: "350 F",
        notes: "Preheat the oven to 350 F.",
      },
      {
        id: uid(),
        name: "Prepare pan",
        duration: 5,
        temp: "9x5 pan",
        notes: "Grease or line a 9x5 loaf pan.",
      },
      {
        id: uid(),
        name: "Mill and rest flour",
        duration: 15,
        temp: "Room temp",
        notes: "Mill the Soft White Wheat and Hard White Wheat berries on the finest setting, then let the flour rest 10 to 15 minutes.",
      },
      {
        id: uid(),
        name: "Mix wet ingredients",
        duration: 8,
        temp: "Room temp",
        notes: "Whisk together mashed bananas, melted cooled butter, eggs, brown sugar, honey, whole milk, and vanilla.",
      },
      {
        id: uid(),
        name: "Mix dry ingredients",
        duration: 5,
        temp: "Bowl",
        notes: "Combine flour, baking powder, baking soda, salt, cinnamon, and nutmeg in a separate bowl.",
      },
      {
        id: uid(),
        name: "Fold batter",
        duration: 5,
        temp: "Gentle fold",
        notes: "Fold dry ingredients into wet ingredients until just combined; do not overmix.",
      },
      {
        id: uid(),
        name: "Fold strawberries",
        duration: 3,
        temp: "Gentle fold",
        notes: "Toss diced strawberries with 1 tablespoon of the flour mixture, then gently fold them into the batter.",
      },
      {
        id: uid(),
        name: "Pan batter",
        duration: 5,
        temp: "9x5 pan",
        notes: "Pour batter into the prepared loaf pan and smooth the top.",
      },
      {
        id: uid(),
        name: "Bake",
        duration: 65,
        temp: "350 F",
        notes: "Bake 60 to 70 minutes, or until a toothpick comes out with just a few moist crumbs.",
      },
      {
        id: uid(),
        name: "Cool in pan",
        duration: 15,
        temp: "Pan",
        notes: "Cool in the pan for 15 minutes.",
      },
      {
        id: uid(),
        name: "Cool completely",
        duration: 90,
        temp: "Wire rack",
        notes: "Transfer to a wire rack and cool completely before slicing or packaging.",
      },
      {
        id: uid(),
        name: "Optional glaze",
        duration: 10,
        temp: "Room temp",
        notes: "For a premium loaf, drizzle with 120 g powdered sugar, 2 to 3 tbsp milk, 1/2 tsp vanilla extract, and a pinch of salt.",
      },
    ],
    batches: [],
    draftBatch: {
      ...makeDraftBatch(),
      lotCode: "SBB-V1-001",
      kneadMinutes: 0,
      bulkMinutes: 0,
      proofMinutes: 0,
      bakeMinutes: 65,
      finishedWeightG: 1284,
      rating: 7,
      notes: "Confirm cooled finished weight after first test bake. Optional glaze is not included in formula weight unless the zero-gram glaze rows are updated.",
    },
    label: {
      businessName: "Laurens Home Bakery",
      productName: "Faithful & True Signature Fresh-Milled Strawberry Banana Bread",
      address: "",
      scdaId: "",
      useScdaId: false,
      netWeightG: 1284,
      netWeightOz: 45.3,
      lotCode: "SBB-V1-001",
      packageDate: today,
      bestBy: "",
      contact: "",
      storage: "Store wrapped at room temperature for short-term freshness. Freeze for longer storage.",
      allergenMode: "detected",
      healthClaims: "",
      localReviewComplete: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function normalizeRecipe(recipe) {
  const legacyLabel = recipe.label || {};
  const normalized = {
    ...recipe,
    id: recipe.id || uid(),
    name: recipe.name || "Untitled recipe",
    status: recipe.status || "Draft",
    productType: recipe.productType || "Shelf-stable bread",
    productTypeLocked: Boolean(recipe.productTypeLocked),
    yieldCount: Number(recipe.yieldCount || 1),
    desiredLoafWeightG: Number(recipe.desiredLoafWeightG || 0),
    starterNote: recipe.starterNote || "",
    pricing: {
      sellingPrice: 0,
      targetMargin: 65,
      packageCost: 0,
      ...(recipe.pricing || {}),
    },
    environment: {
      targetDoughTempF: 78,
      roomTempF: 74,
      humidity: 55,
      ...(recipe.environment || {}),
    },
    ingredients: (recipe.ingredients || []).map(normalizeIngredient),
    steps: (recipe.steps || []).map((item) => ({
      id: item.id || uid(),
      name: item.name || "",
      duration: Number(item.duration || 0),
      temp: item.temp || "",
      notes: item.notes || "",
    })),
    batches: recipe.batches || [],
    draftBatch: { ...makeDraftBatch(), ...(recipe.draftBatch || {}) },
    label: {
      ...makeDefaultLabel(),
      ...(recipe.label || {}),
    },
    catalog: {
      ...makeDefaultCatalog(recipe),
      ...(recipe.catalog || {}),
      sku: recipe.catalog?.sku || legacyLabel.squareSku || "",
      variationName: recipe.catalog?.variationName || legacyLabel.squareVariationName || "Regular",
      description: recipe.catalog?.description || legacyLabel.squareDescription || "",
      price: Number(recipe.catalog?.price ?? recipe.pricing?.sellingPrice ?? 0),
    },
  };
  if (!normalized.catalog.sku) normalized.catalog.sku = makeSquareSku(normalized);
  if (!normalized.ingredients.length) normalized.ingredients = [newIngredient()];
  if (!recipe.label?.templateVersion) {
    if (!normalized.label.businessName || normalized.label.businessName === "Laurens Home Bakery") normalized.label.businessName = "Faithful & True Bread and Baked Goods";
    if (!normalized.label.scdaId && !normalized.label.address) {
      normalized.label.scdaId = "30-202-00478";
      normalized.label.useScdaId = true;
    }
  }
  return normalized;
}

function normalizeLot(lot) {
  const profile = lot.storageProfile || "Room temp";
  const profileDefaults = STORAGE_PROFILES[profile] || STORAGE_PROFILES["Room temp"];
  return {
    id: lot.id || uid(),
    name: lot.name || "Fresh-Milled Flour",
    grain: lot.grain || "",
    lotCode: lot.lotCode || "",
    milledDate: lot.milledDate || new Date().toISOString().slice(0, 10),
    milledTime: lot.milledTime || "",
    storageProfile: profile,
    shelfDays: Number(lot.shelfDays || profileDefaults.days),
    gramsMilled: Number(lot.gramsMilled || 0),
    reserveGrams: Number(lot.reserveGrams || 0),
    storageInstructions: lot.storageInstructions || profileDefaults.instruction,
    notes: lot.notes || "",
    uses: (lot.uses || []).map((use) => ({
      id: use.id || uid(),
      date: use.date || new Date().toISOString().slice(0, 10),
      grams: Number(use.grams || 0),
      note: use.note || "",
    })),
    draftUse: { ...makeDraftLotUse(), ...(lot.draftUse || {}) },
    createdAt: lot.createdAt || new Date().toISOString(),
    updatedAt: lot.updatedAt || new Date().toISOString(),
  };
}

function normalizeOrder(order) {
  const normalized = {
    id: order.id || uid(),
    orderNumber: order.orderNumber || `ORD-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-001`,
    customerName: order.customerName || "",
    contact: order.contact || "",
    recipeId: order.recipeId || "",
    productName: order.productName || "Bread",
    breadType: order.breadType || "regular",
    quantity: Number(order.quantity || 1),
    unitPrice: Number(order.unitPrice || 0),
    amountPaid: Number(order.amountPaid || 0),
    paymentStatus: order.paymentStatus || "Unpaid",
    paymentMethod: order.paymentMethod || "Cash",
    paymentLink: order.paymentLink || "",
    orderedAt: order.orderedAt || localDateTimeValue(),
    readyAt: order.readyAt || "",
    status: order.status || "Placed",
    notes: order.notes || "",
    createdAt: order.createdAt || new Date().toISOString(),
    updatedAt: order.updatedAt || new Date().toISOString(),
  };
  if (!normalized.readyAt) normalized.readyAt = getOrderReadyAt(normalized);
  if (normalized.paymentStatus === "Paid" && !normalized.amountPaid) {
    normalized.amountPaid = getOrderTotal(normalized);
  }
  return normalized;
}

function normalizeOrderDraft(draft) {
  return {
    customerName: draft.customerName || "",
    contact: draft.contact || "",
    recipeId: draft.recipeId || "",
    productName: draft.productName || "",
    breadType: draft.breadType || "regular",
    quantity: Number(draft.quantity || 1),
    unitPrice: Number(draft.unitPrice || 0),
    amountPaid: Number(draft.amountPaid || 0),
    paymentStatus: draft.paymentStatus || "Unpaid",
    paymentMethod: draft.paymentMethod || "Cash",
    paymentLink: draft.paymentLink || "",
    orderedAt: draft.orderedAt || localDateTimeValue(),
    notes: draft.notes || "",
  };
}

function makeDefaultOrderDraft() {
  return normalizeOrderDraft({
    quantity: 1,
    unitPrice: 0,
    amountPaid: 0,
    paymentStatus: "Unpaid",
    paymentMethod: "Cash",
    orderedAt: localDateTimeValue(),
    breadType: "regular",
  });
}

function makeDefaultLabel() {
  return {
    templateVersion: "FT-LBL-002",
    printStyle: "thermal",
    wholeGrainBadge: false,
    tagline: "Fresh-Milled - Made With Purpose",
    scripture: "Give us this day our daily bread.",
    scriptureReference: "Matthew 6:11 (KJV)",
    bakedOn: "",
    packageWeightLocked: false,
    businessName: "Faithful & True Bread and Baked Goods",
    productName: "",
    address: "",
    scdaId: "30-202-00478",
    useScdaId: true,
    squareSku: "",
    squareVariationName: "Regular",
    squareCategory: "",
    squareDescription: "",
    gtin: "",
    netWeightG: 0,
    netWeightOz: 0,
    lotCode: "",
    packageDate: "",
    bestBy: "",
    contact: "",
    storage: "",
    allergenMode: "detected",
    manualAllergens: [],
    healthClaims: "",
    localReviewComplete: false,
    allergenConfirmedNone: false,
  };
}

function makeDefaultCatalog(recipe = {}) {
  return {
    sku: "",
    variationName: "Regular",
    description: "",
    price: Number(recipe.pricing?.sellingPrice || 0),
  };
}

function makeSquareSku(recipe) {
  const source = `${recipe.id || ""}-${recipe.name || ""}`;
  let hash = 0;
  for (const character of source) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `FT-${hash.toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

function makeDefaultLot() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  const lot = normalizeLot({
    id: uid(),
    name: "Fresh-Milled Flour",
    grain: "Hard White Wheat",
    milledDate: date,
    milledTime: time,
    storageProfile: "Room temp",
    shelfDays: STORAGE_PROFILES["Room temp"].days,
    gramsMilled: 0,
    reserveGrams: 0,
    storageInstructions: STORAGE_PROFILES["Room temp"].instruction,
    uses: [],
    draftUse: makeDraftLotUse(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  lot.lotCode = buildLotCode(lot);
  return lot;
}

function makeDraftLotUse() {
  return {
    date: new Date().toISOString().slice(0, 10),
    grams: 0,
    note: "",
  };
}

function makeDraftBatch() {
  return {
    lotCode: `B-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}`,
    bakeDate: new Date().toISOString().slice(0, 10),
    roomTempF: 74,
    humidity: 55,
    doughTempF: 78,
    waterTempF: 80,
    kneadMinutes: 10,
    bulkMinutes: 240,
    proofMinutes: 90,
    bakeMinutes: 38,
    finishedWeightG: 680,
    rating: 7,
    notes: "",
    adjustment: "",
  };
}

function newIngredient() {
  return {
    id: uid(),
    name: "",
    label: "",
    grams: 0,
    sourceAmount: "0",
    sourceUnit: "g",
    conversionEstimated: false,
    conversionEstimateReason: "",
    conversionError: "",
    role: "other",
    unit: "g",
    costPerKg: 0,
    notes: "",
    allergens: "",
  };
}

function normalizeIngredient(item) {
  const legacyUnit = item.sourceUnit || item.unit || "g";
  const hasExplicitSource = item.sourceAmount !== undefined || item.amount !== undefined;
  const sourceUnit = hasExplicitSource ? legacyUnit : "g";
  const sourceAmount = hasExplicitSource ? String(item.sourceAmount ?? item.amount ?? "") : String(Number(item.grams || 0));
  const normalized = {
    id: item.id || uid(),
    name: item.name || "",
    label: item.label || item.name || "",
    grams: Number(item.grams || 0),
    sourceAmount,
    sourceUnit,
    conversionEstimated: Boolean(item.conversionEstimated ?? item.estimated),
    conversionEstimateReason: item.conversionEstimateReason || "",
    conversionError: "",
    role: item.role || "other",
    unit: "g",
    costPerKg: Number(item.costPerKg || 0),
    notes: item.notes || "",
    allergens: item.allergens || "",
  };
  if (hasExplicitSource) updateIngredientConversion(normalized);
  return normalized;
}

function formatSourceAmount(value) {
  return Number.isFinite(value) ? String(Number(value.toFixed(4))) : "";
}

function getSkuStatus(recipe) {
  if (!recipe.catalog?.sku) return "A SKU is required before export.";
  return isSkuUnique(recipe.catalog.sku, state.recipes, recipe.id)
    ? `SKU ${recipe.catalog.sku} is unique in this recipe library.`
    : `SKU ${recipe.catalog.sku} is already used by another recipe.`;
}

function newStep() {
  return {
    id: uid(),
    name: "",
    duration: 0,
    temp: "",
    notes: "",
  };
}

function uid() {
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function round(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 100) return Math.round(number).toString();
  return (Math.round(number * 10) / 10).toString();
}

function formatMinutes(minutes) {
  const total = Number(minutes || 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins} min`;
  return `${hours} hr ${mins} min`;
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
}

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function title(value) {
  return String(value || "")
    .split(/[\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value) {
  return String(value || "recipe")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "recipe";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}
