CREATE TABLE `card_image` (
	`card_id` text PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`data` blob NOT NULL,
	`byte_size` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade
);
