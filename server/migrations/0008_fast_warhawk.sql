CREATE TABLE `ref_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`rule_id` integer NOT NULL,
	`paid_on` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text DEFAULT 'venmo' NOT NULL,
	`note` text,
	`bank_transaction_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `cost_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_transaction_id`) REFERENCES `bank_transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `treasurer_advances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`label` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_on` text NOT NULL,
	`reimbursed_on` text,
	`bank_transaction_id` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_transaction_id`) REFERENCES `bank_transactions`(`id`) ON UPDATE no action ON DELETE set null
);
