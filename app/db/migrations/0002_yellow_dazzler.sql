ALTER TABLE `shops` MODIFY COLUMN `access_token_ciphertext` varchar(700);--> statement-breakpoint
ALTER TABLE `shops` MODIFY COLUMN `access_token_iv` varchar(24);--> statement-breakpoint
ALTER TABLE `shops` MODIFY COLUMN `access_token_tag` varchar(32);--> statement-breakpoint
ALTER TABLE `sessions` MODIFY COLUMN `staff_email_hash` varchar(64);--> statement-breakpoint
ALTER TABLE `webhook_events` MODIFY COLUMN `payload_hash` varchar(64);