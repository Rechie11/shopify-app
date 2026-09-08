CREATE TABLE `activity_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`actor_type` enum('staff','system','webhook') NOT NULL,
	`actor_id` bigint unsigned,
	`actor_label` varchar(255) NOT NULL,
	`entity_type` enum('bundle','bundle_item','alert','shop') NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`action` varchar(64) NOT NULL,
	`before` json,
	`after` json,
	`metadata` json,
	`request_id` char(26),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `activity_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`type` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`dedupe_key` varchar(255),
	`status` enum('pending','running','done','failed','dead') NOT NULL DEFAULT 'pending',
	`attempts` tinyint unsigned NOT NULL DEFAULT 0,
	`max_attempts` tinyint unsigned NOT NULL DEFAULT 5,
	`run_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`locked_at` datetime(3),
	`locked_by` varchar(64),
	`last_error` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`pending_key` varchar(320) GENERATED ALWAYS AS ((if(`status` = 'pending', concat(`shop_id`, ':', `type`, ':', ifnull(`dedupe_key`, '')), NULL))) STORED,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_jobs_pending` UNIQUE(`pending_key`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned,
	`webhook_id` varchar(64) NOT NULL,
	`topic` varchar(128) NOT NULL,
	`api_version` varchar(16) NOT NULL,
	`payload_hash` varbinary(32),
	`status` enum('received','processed','failed') NOT NULL DEFAULT 'received',
	`attempts` smallint unsigned NOT NULL DEFAULT 0,
	`last_error` text,
	`received_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`processed_at` datetime(3),
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `webhook_events_webhook_id_unique` UNIQUE(`webhook_id`)
);
--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `webhook_events` ADD CONSTRAINT `webhook_events_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_activity_shop_created` ON `activity_log` (`shop_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_activity_entity` ON `activity_log` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_jobs_status_run_at` ON `jobs` (`status`,`run_at`);