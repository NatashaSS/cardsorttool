CREATE TABLE `board` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`token` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`participant` text NOT NULL,
	`card_order` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`started_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`study_id`) REFERENCES `study`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_token_unique` ON `board` (`token`);--> statement-breakpoint
CREATE INDEX `board_study_idx` ON `board` (`study_id`,`status`);--> statement-breakpoint
CREATE TABLE `card` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`board_id` text,
	`label` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `study`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `board`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_study_idx` ON `card` (`study_id`);--> statement-breakpoint
CREATE INDEX `card_board_idx` ON `card` (`board_id`);--> statement-breakpoint
CREATE TABLE `study_group` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`board_id` text,
	`kind` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `study`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `board`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_study_idx` ON `study_group` (`study_id`);--> statement-breakpoint
CREATE INDEX `group_board_idx` ON `study_group` (`board_id`);--> statement-breakpoint
CREATE TABLE `placement` (
	`board_id` text NOT NULL,
	`card_id` text NOT NULL,
	`group_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`board_id`, `card_id`),
	FOREIGN KEY (`board_id`) REFERENCES `board`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `study_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `placement_group_idx` ON `placement` (`group_id`);--> statement-breakpoint
CREATE TABLE `study` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_type` text NOT NULL,
	`group_mode` text DEFAULT 'unbounded' NOT NULL,
	`fixed_group_count` integer,
	`max_participant_groups` integer,
	`settings` text NOT NULL,
	`participant_fields` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_slug_unique` ON `study` (`slug`);