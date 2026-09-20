CREATE TABLE `batch_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recipe_version_id` text NOT NULL,
	`product_id` text,
	`desired_unit_count` real NOT NULL,
	`target_unit_weight_g` real NOT NULL,
	`required_target_weight_g` real NOT NULL,
	`scale_factor` real NOT NULL,
	`calculated_ingredients_json` text NOT NULL,
	`actual_finished_weight_g` real,
	`actual_yield_units` real,
	`lot_code` text,
	`baked_on` text,
	`package_date` text,
	`best_by` text,
	`notes` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `business_workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recipe_version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_batch_runs_workspace_status` ON `batch_runs` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_batch_runs_recipe_version` ON `batch_runs` (`recipe_version_id`);--> statement-breakpoint
CREATE TABLE `business_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`business_name` text,
	`scda_id` text,
	`address` text,
	`contact` text,
	`label_template_version` text,
	`review_status` text DEFAULT 'requires_review' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `business_workspaces`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_business_profiles_workspace` ON `business_profiles` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `business_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversion_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`ingredient_definition_id` text NOT NULL,
	`source_unit` text NOT NULL,
	`grams_per_unit` real NOT NULL,
	`status` text DEFAULT 'unverified' NOT NULL,
	`evidence` text,
	`verified_at` text,
	`verified_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ingredient_definition_id`) REFERENCES `ingredient_definitions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversion_profiles_ingredient_unit` ON `conversion_profiles` (`ingredient_definition_id`,`source_unit`);--> statement-breakpoint
CREATE TABLE `ingredient_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`label_name` text,
	`allergens_json` text DEFAULT '[]' NOT NULL,
	`default_cost_per_kg` real,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `business_workspaces`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_ingredient_definitions_workspace_name` ON `ingredient_definitions` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `label_prints` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`batch_run_id` text,
	`recipe_version_id` text NOT NULL,
	`lot_code` text,
	`baked_on` text,
	`package_date` text,
	`best_by` text,
	`ingredient_statement` text NOT NULL,
	`allergen_statement` text,
	`business_snapshot_json` text NOT NULL,
	`label_snapshot_json` text NOT NULL,
	`printed_at` text NOT NULL,
	`printed_by` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `business_workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_run_id`) REFERENCES `batch_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recipe_version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_label_prints_product_printed_at` ON `label_prints` (`product_id`,`printed_at`);--> statement-breakpoint
CREATE INDEX `idx_label_prints_batch_run` ON `label_prints` (`batch_run_id`);--> statement-breakpoint
CREATE TABLE `migration_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`legacy_entity_type` text NOT NULL,
	`legacy_entity_id` text NOT NULL,
	`proposed_entity_type` text NOT NULL,
	`proposed_entity_id` text,
	`action` text DEFAULT 'preserve' NOT NULL,
	`validation_status` text DEFAULT 'pending' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `migration_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_migration_records_source_legacy` ON `migration_records` (`source_id`,`legacy_entity_type`,`legacy_entity_id`);--> statement-breakpoint
CREATE TABLE `migration_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`source_kind` text NOT NULL,
	`source_identity` text NOT NULL,
	`source_revision` integer,
	`source_checksum` text NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`imported_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `business_workspaces`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `product_square_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`item_name` text,
	`variation_name` text,
	`description` text,
	`price` real,
	`square_item_id` text,
	`square_variation_id` text,
	`additional_fields_json` text DEFAULT '{}' NOT NULL,
	`last_exported_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_square_settings_product` ON `product_square_settings` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recipe_version_id` text,
	`label_name` text NOT NULL,
	`package_unit_count` real,
	`net_weight_g` real,
	`net_weight_oz` real,
	`sku` text,
	`status` text DEFAULT 'candidate' NOT NULL,
	`package_cost` real,
	`selling_price` real,
	`target_margin` real,
	`label_settings_json` text DEFAULT '{}' NOT NULL,
	`legacy_source_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `business_workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recipe_version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`legacy_source_id`) REFERENCES `migration_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_products_workspace_status` ON `products` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_products_recipe_version` ON `products` (`recipe_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_workspace_sku` ON `products` (`workspace_id`,`sku`);--> statement-breakpoint
CREATE TABLE `recipe_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_version_id` text NOT NULL,
	`name` text NOT NULL,
	`duration_minutes` real,
	`temperature` text,
	`notes` text,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recipe_version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_recipe_steps_version_order` ON `recipe_steps` (`recipe_version_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `recipe_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_version_id` text NOT NULL,
	`legacy_batch_id` text,
	`bake_date` text,
	`lot_code` text,
	`finished_weight_g` real,
	`rating` real,
	`observations_json` text DEFAULT '{}' NOT NULL,
	`saved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recipe_version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_recipe_tests_version_date` ON `recipe_tests` (`recipe_version_id`,`bake_date`);--> statement-breakpoint
CREATE TABLE `recipe_version_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_version_id` text NOT NULL,
	`ingredient_definition_id` text,
	`display_name` text NOT NULL,
	`label_name` text,
	`role` text,
	`source_amount` text,
	`source_unit` text NOT NULL,
	`canonical_grams` real,
	`conversion_profile_id` text,
	`conversion_status` text DEFAULT 'unverified' NOT NULL,
	`notes` text,
	`allergens_json` text DEFAULT '[]' NOT NULL,
	`cost_per_kg` real,
	`sort_order` integer NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recipe_version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ingredient_definition_id`) REFERENCES `ingredient_definitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversion_profile_id`) REFERENCES `conversion_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_recipe_version_ingredients_version_order` ON `recipe_version_ingredients` (`recipe_version_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `recipe_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`base_yield_units` real NOT NULL,
	`target_unit_weight_g` real NOT NULL,
	`formula_notes` text,
	`environment_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`immutable_checksum` text,
	`mastered_at` text,
	`mastered_by` text,
	`legacy_source_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes_v2`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`legacy_source_id`) REFERENCES `migration_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recipe_versions_recipe_number` ON `recipe_versions` (`recipe_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `idx_recipe_versions_recipe_status` ON `recipe_versions` (`recipe_id`,`status`);--> statement-breakpoint
CREATE TABLE `recipes_v2` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`food_classification` text,
	`lifecycle_status` text DEFAULT 'Draft' NOT NULL,
	`active_mastered_version_id` text,
	`legacy_source_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `business_workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`legacy_source_id`) REFERENCES `migration_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_recipes_v2_workspace_status` ON `recipes_v2` (`workspace_id`,`lifecycle_status`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`authenticated_user_id` text NOT NULL,
	`email` text,
	`role` text DEFAULT 'viewer' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `business_workspaces`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_members_workspace_user` ON `workspace_members` (`workspace_id`,`authenticated_user_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_members_authenticated_user` ON `workspace_members` (`authenticated_user_id`);