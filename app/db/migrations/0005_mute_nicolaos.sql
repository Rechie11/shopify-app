CREATE TABLE `shop_order_counts_daily` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`day` date NOT NULL,
	`order_count` int unsigned NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `shop_order_counts_daily_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_shop_order_counts_shop_day` UNIQUE(`shop_id`,`day`)
);
--> statement-breakpoint
ALTER TABLE `shop_order_counts_daily` ADD CONSTRAINT `shop_order_counts_daily_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;