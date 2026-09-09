CREATE TABLE `bundle_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`bundle_id` bigint unsigned NOT NULL,
	`product_gid` varchar(255) NOT NULL,
	`variant_gid` varchar(255) NOT NULL,
	`inventory_item_gid` varchar(255),
	`sku` varchar(128),
	`product_title_cache` varchar(255),
	`variant_title_cache` varchar(255),
	`image_url_cache` varchar(1024),
	`unit_price_cents` int unsigned,
	`unit_cost_cents` int unsigned,
	`position` tinyint unsigned NOT NULL DEFAULT 0,
	`is_required` boolean NOT NULL DEFAULT true,
	`heat_level` tinyint unsigned,
	`flavor_profile` enum('smoky','fruity','citrus','umami','herbal','sweet-heat'),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `bundle_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bundle_items_bundle_variant` UNIQUE(`bundle_id`,`variant_gid`)
);
--> statement-breakpoint
CREATE TABLE `bundle_price_tiers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`bundle_id` bigint unsigned NOT NULL,
	`min_quantity` tinyint unsigned NOT NULL,
	`discount_bps` smallint unsigned NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `bundle_price_tiers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bundle_price_tiers_bundle_qty` UNIQUE(`bundle_id`,`min_quantity`)
);
--> statement-breakpoint
CREATE TABLE `bundle_rules` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`bundle_id` bigint unsigned NOT NULL,
	`rule_type` enum('max_per_heat_tier','min_distinct_flavors','require_heat_range','exclude_together','require_one_of') NOT NULL,
	`config` json NOT NULL,
	`is_blocking` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `bundle_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bundles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`public_id` char(26) NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`handle` varchar(120) NOT NULL,
	`title` varchar(160) NOT NULL,
	`subtitle` varchar(255),
	`status` enum('draft','publishing','active','paused','archived') NOT NULL DEFAULT 'draft',
	`min_items` tinyint unsigned NOT NULL DEFAULT 3,
	`max_items` tinyint unsigned NOT NULL DEFAULT 6,
	`pricing_mode` enum('tiered_percent','fixed_price','per_item_percent') NOT NULL DEFAULT 'tiered_percent',
	`fixed_price_cents` int unsigned,
	`storefront_collection_gid` varchar(255),
	`discount_gid` varchar(255),
	`starts_at` datetime(3),
	`ends_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `bundles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bundles_shop_handle` UNIQUE(`shop_id`,`handle`),
	CONSTRAINT `chk_bundles_min_items` CHECK(`bundles`.`min_items` >= 1),
	CONSTRAINT `chk_bundles_max_gte_min` CHECK(`bundles`.`max_items` >= `bundles`.`min_items`),
	CONSTRAINT `chk_bundles_fixed_price` CHECK(`bundles`.`fixed_price_cents` is not null or `bundles`.`pricing_mode` <> 'fixed_price')
);
--> statement-breakpoint
ALTER TABLE `bundle_items` ADD CONSTRAINT `bundle_items_bundle_id_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_price_tiers` ADD CONSTRAINT `bundle_price_tiers_bundle_id_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_rules` ADD CONSTRAINT `bundle_rules_bundle_id_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundles` ADD CONSTRAINT `bundles_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_bundle_items_variant` ON `bundle_items` (`variant_gid`);--> statement-breakpoint
CREATE INDEX `ix_bundles_shop_status` ON `bundles` (`shop_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `ix_bundles_shop_ends` ON `bundles` (`shop_id`,`ends_at`);