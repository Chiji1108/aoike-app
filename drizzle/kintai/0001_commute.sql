ALTER TABLE `attendance_records` ADD `commute_fare` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `commute_type` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `commute_route` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `commute_one_way_fare` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `commute_pass_monthly` integer DEFAULT 0 NOT NULL;