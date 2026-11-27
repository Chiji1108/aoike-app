-- 全体ルール・顧客ルールを項目ごと（csv_rule_items）から1つの文章（csv_settings.rules・csv_customers.rules）にする。
-- 文章は項目を並びの順に「- 」の箇条書きにしたもの（前に AI に渡していた文章と同じ）。由来と項目ごとの版は捨てる。
-- デプロイの直後に当てる（前の版は csv_rule_items を読み書きし、今の版は rules を読み書きする）
ALTER TABLE `csv_customers` ADD `rules` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `csv_customers` ADD `rules_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `csv_settings` ADD `rules` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `csv_settings` ADD `rules_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `csv_settings` SET `rules` = COALESCE((SELECT group_concat('- ' || `text`, char(10) ORDER BY `position`, `created_at`, `id`) FROM `csv_rule_items` WHERE `scope` = 'global' AND `customer_id` IS NULL), '') WHERE `id` = 'global';--> statement-breakpoint
UPDATE `csv_customers` SET `rules` = COALESCE((SELECT group_concat('- ' || i.`text`, char(10) ORDER BY i.`position`, i.`created_at`, i.`id`) FROM `csv_rule_items` i WHERE i.`scope` = 'customer' AND i.`customer_id` = `csv_customers`.`id`), '');--> statement-breakpoint
DROP TABLE `csv_rule_items`;
