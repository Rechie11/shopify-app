CREATE TABLE `inventory_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`variant_gid` varchar(255) NOT NULL,
	`inventory_item_gid` varchar(255) NOT NULL,
	`location_gid` varchar(255) NOT NULL,
	`available` int NOT NULL,
	`captured_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `inventory_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `variant_metrics_daily` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`variant_gid` varchar(255) NOT NULL,
	`day` date NOT NULL,
	`units_sold` int unsigned NOT NULL DEFAULT 0,
	`orders` int unsigned NOT NULL DEFAULT 0,
	`gross_cents` bigint NOT NULL DEFAULT 0,
	`refunded_units` int unsigned NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `variant_metrics_daily_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_variant_metrics_shop_variant_day` UNIQUE(`shop_id`,`variant_gid`,`day`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`bundle_id` bigint unsigned,
	`alert_type` enum('stockout_risk','margin_breach','component_deleted','traction_drop','bundle_expiring') NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` varchar(1024),
	`recommended_action` json,
	`status` enum('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
	`dedupe_key` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`acknowledged_at` datetime(3),
	`resolved_at` datetime(3),
	`open_key` varchar(320) GENERATED ALWAYS AS ((if(`status` = 'open', concat(`shop_id`, ':', `dedupe_key`), NULL))) STORED,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_alerts_open` UNIQUE(`open_key`)
);
--> statement-breakpoint
CREATE TABLE `bundle_orders` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`bundle_id` bigint unsigned NOT NULL,
	`order_gid` varchar(255) NOT NULL,
	`order_number` varchar(64),
	`flight_token` char(26) NOT NULL,
	`item_count` tinyint unsigned NOT NULL,
	`subtotal_cents` bigint NOT NULL,
	`discount_cents` bigint NOT NULL DEFAULT 0,
	`currency` char(3) NOT NULL,
	`customer_hash` varchar(64),
	`placed_at` datetime(3) NOT NULL,
	`cancelled_at` datetime(3),
	CONSTRAINT `bundle_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bundle_orders_shop_order_bundle` UNIQUE(`shop_id`,`order_gid`,`bundle_id`)
);
--> statement-breakpoint
CREATE TABLE `bundle_scores` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`bundle_id` bigint unsigned NOT NULL,
	`score` decimal(5,2) NOT NULL,
	`band` enum('healthy','watch','at_risk') NOT NULL,
	`inventory_score` decimal(5,2),
	`margin_score` decimal(5,2),
	`traction_score` decimal(5,2),
	`balance_score` decimal(5,2),
	`min_days_cover` decimal(6,2),
	`limiting_variant_gid` varchar(255),
	`effective_margin_bps` smallint,
	`attach_rate_bps` smallint unsigned,
	`primary_reason` varchar(255),
	`recommended_action` json,
	`breakdown` json,
	`computed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `bundle_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bundles` ADD `current_score_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `inventory_snapshots` ADD CONSTRAINT `inventory_snapshots_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_metrics_daily` ADD CONSTRAINT `variant_metrics_daily_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_bundle_id_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_orders` ADD CONSTRAINT `bundle_orders_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_orders` ADD CONSTRAINT `bundle_orders_bundle_id_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_scores` ADD CONSTRAINT `bundle_scores_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bundle_scores` ADD CONSTRAINT `bundle_scores_bundle_id_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_inventory_snapshots_variant_captured` ON `inventory_snapshots` (`shop_id`,`variant_gid`,`captured_at`);--> statement-breakpoint
CREATE INDEX `ix_inventory_snapshots_captured` ON `inventory_snapshots` (`captured_at`);--> statement-breakpoint
CREATE INDEX `ix_variant_metrics_shop_day` ON `variant_metrics_daily` (`shop_id`,`day`);--> statement-breakpoint
CREATE INDEX `ix_alerts_shop_status` ON `alerts` (`shop_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_bundle_orders_bundle_placed` ON `bundle_orders` (`shop_id`,`bundle_id`,`placed_at`);--> statement-breakpoint
CREATE INDEX `ix_bundle_scores_bundle_computed` ON `bundle_scores` (`bundle_id`,`computed_at`);--> statement-breakpoint
ALTER TABLE `bundles` ADD CONSTRAINT `bundles_current_score_id_bundle_scores_id_fk` FOREIGN KEY (`current_score_id`) REFERENCES `bundle_scores`(`id`) ON DELETE no action ON UPDATE no action;