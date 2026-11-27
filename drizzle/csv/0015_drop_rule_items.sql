-- 全体ルール・顧客ルールを1つの文章にする（2/2）。デプロイのあとに当てる。
-- 0014 からデプロイまでの間に前の版が項目に書いた分は、今の版でまだ保存も追記もしていない文章（rules_version が 0）だけ移し直してから、項目の表を消す
UPDATE `csv_settings` SET `rules` = COALESCE((SELECT group_concat(line, char(10)) FROM (SELECT '- ' || `text` AS line FROM `csv_rule_items` WHERE `scope` = 'global' AND `customer_id` IS NULL ORDER BY `position`, `created_at`, `id`)), '') WHERE `id` = 'global' AND `rules_version` = 0;--> statement-breakpoint
UPDATE `csv_customers` SET `rules` = COALESCE((SELECT group_concat(line, char(10)) FROM (SELECT '- ' || i.`text` AS line FROM `csv_rule_items` i WHERE i.`scope` = 'customer' AND i.`customer_id` = `csv_customers`.`id` ORDER BY i.`position`, i.`created_at`, i.`id`)), '') WHERE `rules_version` = 0;--> statement-breakpoint
DROP TABLE `csv_rule_items`;
