-- 全体ルール・顧客ルールを項目ごと（csv_rule_items）から1つの文章（csv_settings.rules・csv_customers.rules）にする（1/2）。
-- 列を足し、項目を並びの順に「- 」の箇条書きにして移す（前に AI に渡していた文章と同じ）。由来と項目ごとの版は捨てる。
-- デプロイの前に当てる（前の版は新しい列を読まない）。項目の表は 0015 がデプロイのあとに消す
ALTER TABLE `csv_customers` ADD `rules` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `csv_customers` ADD `rules_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `csv_settings` ADD `rules` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `csv_settings` ADD `rules_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `csv_settings` SET `rules` = COALESCE((SELECT group_concat(line, char(10)) FROM (SELECT '- ' || `text` AS line FROM `csv_rule_items` WHERE `scope` = 'global' AND `customer_id` IS NULL ORDER BY `position`, `created_at`, `id`)), '') WHERE `id` = 'global';--> statement-breakpoint
UPDATE `csv_customers` SET `rules` = COALESCE((SELECT group_concat(line, char(10)) FROM (SELECT '- ' || i.`text` AS line FROM `csv_rule_items` i WHERE i.`scope` = 'customer' AND i.`customer_id` = `csv_customers`.`id` ORDER BY i.`position`, i.`created_at`, i.`id`)), '');
