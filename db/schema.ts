import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Legacy production storage. This table is intentionally unchanged so the
// normalized migration remains additive and rollback stays possible.
export const workspaces = sqliteTable('workspaces', {
  owner: text('owner').primaryKey(),
  state: text('state').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});

export const businessWorkspaces = sqliteTable('business_workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('planning'),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const workspaceMembers = sqliteTable('workspace_members', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => businessWorkspaces.id, { onDelete: 'restrict' }),
  authenticatedUserId: text('authenticated_user_id').notNull(),
  email: text('email'),
  role: text('role').notNull().default('viewer'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_workspace_members_workspace_user').on(table.workspaceId, table.authenticatedUserId),
  index('idx_workspace_members_authenticated_user').on(table.authenticatedUserId),
]);

export const businessProfiles = sqliteTable('business_profiles', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => businessWorkspaces.id, { onDelete: 'restrict' }),
  businessName: text('business_name'),
  scdaId: text('scda_id'),
  address: text('address'),
  contact: text('contact'),
  labelTemplateVersion: text('label_template_version'),
  reviewStatus: text('review_status').notNull().default('requires_review'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_business_profiles_workspace').on(table.workspaceId),
]);

export const migrationSources = sqliteTable('migration_sources', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => businessWorkspaces.id, { onDelete: 'restrict' }),
  sourceKind: text('source_kind').notNull(),
  sourceIdentity: text('source_identity').notNull(),
  sourceRevision: integer('source_revision'),
  sourceChecksum: text('source_checksum').notNull(),
  reviewStatus: text('review_status').notNull().default('pending'),
  importedAt: text('imported_at'),
  createdAt: text('created_at').notNull(),
});

export const migrationRecords = sqliteTable('migration_records', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => migrationSources.id, { onDelete: 'restrict' }),
  legacyEntityType: text('legacy_entity_type').notNull(),
  legacyEntityId: text('legacy_entity_id').notNull(),
  proposedEntityType: text('proposed_entity_type').notNull(),
  proposedEntityId: text('proposed_entity_id'),
  action: text('action').notNull().default('preserve'),
  validationStatus: text('validation_status').notNull().default('pending'),
  warningsJson: text('warnings_json').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_migration_records_source_legacy').on(table.sourceId, table.legacyEntityType, table.legacyEntityId),
]);

export const recipes = sqliteTable('recipes_v2', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => businessWorkspaces.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  foodClassification: text('food_classification'),
  lifecycleStatus: text('lifecycle_status').notNull().default('Draft'),
  activeMasteredVersionId: text('active_mastered_version_id'),
  legacySourceId: text('legacy_source_id').references(() => migrationSources.id, { onDelete: 'restrict' }),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_recipes_v2_workspace_status').on(table.workspaceId, table.lifecycleStatus),
]);

export const recipeVersions = sqliteTable('recipe_versions', {
  id: text('id').primaryKey(),
  recipeId: text('recipe_id').notNull().references(() => recipes.id, { onDelete: 'restrict' }),
  versionNumber: integer('version_number').notNull(),
  baseYieldUnits: real('base_yield_units').notNull(),
  targetUnitWeightG: real('target_unit_weight_g').notNull(),
  formulaNotes: text('formula_notes'),
  environmentJson: text('environment_json').notNull().default('{}'),
  status: text('status').notNull().default('Draft'),
  immutableChecksum: text('immutable_checksum'),
  masteredAt: text('mastered_at'),
  masteredBy: text('mastered_by'),
  legacySourceId: text('legacy_source_id').references(() => migrationSources.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_recipe_versions_recipe_number').on(table.recipeId, table.versionNumber),
  index('idx_recipe_versions_recipe_status').on(table.recipeId, table.status),
]);

export const ingredientDefinitions = sqliteTable('ingredient_definitions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => businessWorkspaces.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  labelName: text('label_name'),
  allergensJson: text('allergens_json').notNull().default('[]'),
  defaultCostPerKg: real('default_cost_per_kg'),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_ingredient_definitions_workspace_name').on(table.workspaceId, table.name),
]);

export const conversionProfiles = sqliteTable('conversion_profiles', {
  id: text('id').primaryKey(),
  ingredientDefinitionId: text('ingredient_definition_id').notNull().references(() => ingredientDefinitions.id, { onDelete: 'restrict' }),
  sourceUnit: text('source_unit').notNull(),
  gramsPerUnit: real('grams_per_unit').notNull(),
  status: text('status').notNull().default('unverified'),
  evidence: text('evidence'),
  verifiedAt: text('verified_at'),
  verifiedBy: text('verified_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_conversion_profiles_ingredient_unit').on(table.ingredientDefinitionId, table.sourceUnit),
]);

export const recipeVersionIngredients = sqliteTable('recipe_version_ingredients', {
  id: text('id').primaryKey(),
  recipeVersionId: text('recipe_version_id').notNull().references(() => recipeVersions.id, { onDelete: 'restrict' }),
  ingredientDefinitionId: text('ingredient_definition_id').references(() => ingredientDefinitions.id, { onDelete: 'restrict' }),
  displayName: text('display_name').notNull(),
  labelName: text('label_name'),
  role: text('role'),
  sourceAmount: text('source_amount'),
  sourceUnit: text('source_unit').notNull(),
  canonicalGrams: real('canonical_grams'),
  conversionProfileId: text('conversion_profile_id').references(() => conversionProfiles.id, { onDelete: 'restrict' }),
  conversionStatus: text('conversion_status').notNull().default('unverified'),
  notes: text('notes'),
  allergensJson: text('allergens_json').notNull().default('[]'),
  costPerKg: real('cost_per_kg'),
  sortOrder: integer('sort_order').notNull(),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_recipe_version_ingredients_version_order').on(table.recipeVersionId, table.sortOrder),
]);

export const recipeSteps = sqliteTable('recipe_steps', {
  id: text('id').primaryKey(),
  recipeVersionId: text('recipe_version_id').notNull().references(() => recipeVersions.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  durationMinutes: real('duration_minutes'),
  temperature: text('temperature'),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_recipe_steps_version_order').on(table.recipeVersionId, table.sortOrder),
]);

export const recipeTests = sqliteTable('recipe_tests', {
  id: text('id').primaryKey(),
  recipeVersionId: text('recipe_version_id').notNull().references(() => recipeVersions.id, { onDelete: 'restrict' }),
  legacyBatchId: text('legacy_batch_id'),
  bakeDate: text('bake_date'),
  lotCode: text('lot_code'),
  finishedWeightG: real('finished_weight_g'),
  rating: real('rating'),
  observationsJson: text('observations_json').notNull().default('{}'),
  savedAt: text('saved_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_recipe_tests_version_date').on(table.recipeVersionId, table.bakeDate),
]);

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => businessWorkspaces.id, { onDelete: 'restrict' }),
  recipeVersionId: text('recipe_version_id').references(() => recipeVersions.id, { onDelete: 'restrict' }),
  labelName: text('label_name').notNull(),
  packageUnitCount: real('package_unit_count'),
  netWeightG: real('net_weight_g'),
  netWeightOz: real('net_weight_oz'),
  sku: text('sku'),
  status: text('status').notNull().default('candidate'),
  packageCost: real('package_cost'),
  sellingPrice: real('selling_price'),
  targetMargin: real('target_margin'),
  labelSettingsJson: text('label_settings_json').notNull().default('{}'),
  legacySourceId: text('legacy_source_id').references(() => migrationSources.id, { onDelete: 'restrict' }),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_products_workspace_status').on(table.workspaceId, table.status),
  index('idx_products_recipe_version').on(table.recipeVersionId),
  uniqueIndex('idx_products_workspace_sku').on(table.workspaceId, table.sku),
]);

export const productSquareSettings = sqliteTable('product_square_settings', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  itemName: text('item_name'),
  variationName: text('variation_name'),
  description: text('description'),
  price: real('price'),
  squareItemId: text('square_item_id'),
  squareVariationId: text('square_variation_id'),
  additionalFieldsJson: text('additional_fields_json').notNull().default('{}'),
  lastExportedAt: text('last_exported_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_product_square_settings_product').on(table.productId),
]);

export const batchRuns = sqliteTable('batch_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => businessWorkspaces.id, { onDelete: 'restrict' }),
  recipeVersionId: text('recipe_version_id').notNull().references(() => recipeVersions.id, { onDelete: 'restrict' }),
  productId: text('product_id').references(() => products.id, { onDelete: 'restrict' }),
  desiredUnitCount: real('desired_unit_count').notNull(),
  targetUnitWeightG: real('target_unit_weight_g').notNull(),
  requiredTargetWeightG: real('required_target_weight_g').notNull(),
  scaleFactor: real('scale_factor').notNull(),
  calculatedIngredientsJson: text('calculated_ingredients_json').notNull(),
  actualFinishedWeightG: real('actual_finished_weight_g'),
  actualYieldUnits: real('actual_yield_units'),
  lotCode: text('lot_code'),
  bakedOn: text('baked_on'),
  packageDate: text('package_date'),
  bestBy: text('best_by'),
  notes: text('notes'),
  status: text('status').notNull().default('planned'),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_batch_runs_workspace_status').on(table.workspaceId, table.status),
  index('idx_batch_runs_recipe_version').on(table.recipeVersionId),
]);

export const labelPrints = sqliteTable('label_prints', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => businessWorkspaces.id, { onDelete: 'restrict' }),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  batchRunId: text('batch_run_id').references(() => batchRuns.id, { onDelete: 'restrict' }),
  recipeVersionId: text('recipe_version_id').notNull().references(() => recipeVersions.id, { onDelete: 'restrict' }),
  lotCode: text('lot_code'),
  bakedOn: text('baked_on'),
  packageDate: text('package_date'),
  bestBy: text('best_by'),
  ingredientStatement: text('ingredient_statement').notNull(),
  allergenStatement: text('allergen_statement'),
  businessSnapshotJson: text('business_snapshot_json').notNull(),
  labelSnapshotJson: text('label_snapshot_json').notNull(),
  printedAt: text('printed_at').notNull(),
  printedBy: text('printed_by'),
}, (table) => [
  index('idx_label_prints_product_printed_at').on(table.productId, table.printedAt),
  index('idx_label_prints_batch_run').on(table.batchRunId),
]);
