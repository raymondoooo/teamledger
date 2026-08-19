CREATE TABLE `season_installments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`label` text,
	`amount_cents` integer,
	`due_date` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `season_installments_season_seq_idx` ON `season_installments` (`season_id`,`seq`);--> statement-breakpoint
ALTER TABLE `payments` ADD `installment_id` integer REFERENCES season_installments(id);--> statement-breakpoint
-- Carry the old two-column payment plan into the new table. A season with no
-- plan at all gets no rows, which the app reads as "the whole amount, in one
-- go" — the same thing it meant before.
INSERT INTO `season_installments` (`season_id`, `seq`, `amount_cents`, `due_date`)
SELECT `id`, 1, `first_payment_cents`, `first_payment_due` FROM `seasons`
WHERE `first_payment_cents` IS NOT NULL OR `first_payment_due` IS NOT NULL OR `final_payment_due` IS NOT NULL;
--> statement-breakpoint
-- The old "final" instalment was always the remainder, so amount_cents is null.
INSERT INTO `season_installments` (`season_id`, `seq`, `amount_cents`, `due_date`)
SELECT `id`, 2, NULL, `final_payment_due` FROM `seasons`
WHERE `first_payment_cents` IS NOT NULL OR `first_payment_due` IS NOT NULL OR `final_payment_due` IS NOT NULL;
--> statement-breakpoint
-- Point existing payments at the row that now represents what they settled, so
-- ticks recorded before the upgrade still show as paid.
UPDATE `payments` SET `installment_id` =
  (SELECT `si`.`id` FROM `season_installments` `si`
   WHERE `si`.`season_id` = `payments`.`season_id` AND `si`.`seq` = 1)
WHERE `installment` = 'first';
--> statement-breakpoint
UPDATE `payments` SET `installment_id` =
  (SELECT `si`.`id` FROM `season_installments` `si`
   WHERE `si`.`season_id` = `payments`.`season_id` AND `si`.`seq` = 2)
WHERE `installment` = 'final';
