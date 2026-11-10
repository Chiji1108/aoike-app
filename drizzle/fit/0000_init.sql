CREATE TABLE `fit_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`common_id` text,
	`name` text NOT NULL,
	`kana` text DEFAULT '' NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`site_postal_code` text DEFAULT '' NOT NULL,
	`site_address` text DEFAULT '' NOT NULL,
	`site_kana` text DEFAULT '' NOT NULL,
	`site_address_kind` text,
	`builder` text DEFAULT '' NOT NULL,
	`output_kw` real,
	`has_battery` integer DEFAULT false NOT NULL,
	`shared_ownership` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fit_cases_common_id_uq` ON `fit_cases` (`common_id`);--> statement-breakpoint
CREATE TABLE `fit_defects` (
	`id` text PRIMARY KEY NOT NULL,
	`procedure_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`received_on` text,
	`due_on` text,
	`requested_to` text,
	`resolved_on` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`procedure_id`) REFERENCES `fit_procedures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fit_defects_procedure_idx` ON `fit_defects` (`procedure_id`);--> statement-breakpoint
CREATE TABLE `fit_procedures` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`book_year` integer NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`received_on` text NOT NULL,
	`poa_received_on` text,
	`notice_on` text,
	`answered_on` text,
	`seal_cert_issued_on` text,
	`fee` integer,
	`special` integer DEFAULT false NOT NULL,
	`special_amount` integer,
	`special_payer` text,
	`special_notified_on` text,
	`special_answered_on` text,
	`on_hold` integer DEFAULT false NOT NULL,
	`hold_reason` text DEFAULT '' NOT NULL,
	`applied_on` text,
	`application_id` text DEFAULT '' NOT NULL,
	`approved_on` text,
	`facility_id` text DEFAULT '' NOT NULL,
	`business_id` text DEFAULT '' NOT NULL,
	`notice_saved` integer DEFAULT false NOT NULL,
	`completed_on` text,
	`invoiced_on` text,
	`invoice_number` text DEFAULT '' NOT NULL,
	`paid_on` text,
	`close_reason` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `fit_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fit_procedures_number_uq` ON `fit_procedures` (`book_year`,`seq`);--> statement-breakpoint
CREATE INDEX `fit_procedures_case_idx` ON `fit_procedures` (`case_id`);--> statement-breakpoint
CREATE TABLE `fit_weekly_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`rows` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
