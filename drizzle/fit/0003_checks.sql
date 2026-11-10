CREATE TABLE `fit_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`kind` text NOT NULL,
	`maker` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`watts` integer NOT NULL,
	`count` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `fit_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fit_equipment_case_idx` ON `fit_equipment` (`case_id`);--> statement-breakpoint
ALTER TABLE `fit_procedures` ADD `checks` text DEFAULT '{}' NOT NULL;