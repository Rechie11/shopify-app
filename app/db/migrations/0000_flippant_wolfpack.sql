CREATE TABLE `shops` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_domain` varchar(255) NOT NULL,
	`shopify_shop_gid` varchar(255),
	`access_token_ciphertext` varbinary(512),
	`access_token_iv` varbinary(12),
	`access_token_tag` varbinary(16),
	`key_version` smallint unsigned NOT NULL DEFAULT 1,
	`scopes` varchar(512),
	`currency` char(3),
	`iana_timezone` varchar(64),
	`margin_floor_bps` smallint unsigned NOT NULL DEFAULT 3000,
	`margin_target_bps` smallint unsigned NOT NULL DEFAULT 5500,
	`installed_at` datetime(3),
	`uninstalled_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `shops_id` PRIMARY KEY(`id`),
	CONSTRAINT `shops_shop_domain_unique` UNIQUE(`shop_domain`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`session_id` varchar(255) NOT NULL,
	`is_online` boolean NOT NULL DEFAULT false,
	`staff_user_id` bigint unsigned,
	`staff_email_hash` varbinary(32),
	`expires_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_session_id_unique` UNIQUE(`session_id`)
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_sessions_shop_expires` ON `sessions` (`shop_id`,`expires_at`);