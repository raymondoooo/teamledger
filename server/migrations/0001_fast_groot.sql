CREATE TABLE "player_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"kind" "credit_kind" DEFAULT 'fundraiser' NOT NULL,
	"label" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"received_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_charges" ALTER COLUMN "rule_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_charges" ADD COLUMN "trainer_id" integer;--> statement-breakpoint
ALTER TABLE "trainers" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "player_credits" ADD CONSTRAINT "player_credits_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_credits" ADD CONSTRAINT "player_credits_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_charges" ADD CONSTRAINT "event_charges_trainer_id_trainers_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_charges_event_trainer_idx" ON "event_charges" USING btree ("event_id","trainer_id");