CREATE TABLE `fit_file_downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `fit_files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fit_file_downloads_file_idx` ON `fit_file_downloads` (`file_id`);--> statement-breakpoint
CREATE TABLE `fit_files` (
	`id` text PRIMARY KEY NOT NULL,
	`procedure_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`purged_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`procedure_id`) REFERENCES `fit_procedures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fit_files_version_uq` ON `fit_files` (`procedure_id`,`doc_type`,`version`);