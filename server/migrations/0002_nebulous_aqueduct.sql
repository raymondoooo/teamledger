CREATE TABLE "tournaments" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"registration_cents" integer DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_rules" ADD COLUMN "expected_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trainers" ADD COLUMN "expected_sessions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;