CREATE TABLE `season_player_skips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_player_id` integer NOT NULL,
	`installment_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`season_player_id`) REFERENCES `season_players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installment_id`) REFERENCES `season_installments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `season_player_skips_player_installment_idx` ON `season_player_skips` (`season_player_id`,`installment_id`);