ALTER TABLE `cost_rules` ADD `expected_fall_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cost_rules` ADD `expected_spring_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `segment` text;--> statement-breakpoint
ALTER TABLE `seasons` ADD `spring_starts_on` text;