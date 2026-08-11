CREATE TYPE "public"."cost_rule_kind" AS ENUM('ref_fee', 'training');--> statement-breakpoint
CREATE TYPE "public"."credit_kind" AS ENUM('credit', 'fundraiser', 'sponsor');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('ical', 'manual');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('game', 'practice', 'tournament', 'other');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('training', 'ref_fees', 'tournaments', 'jerseys', 'misc');--> statement-breakpoint
CREATE TYPE "public"."expense_source" AS ENUM('manual', 'derived');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('venmo', 'cash', 'zelle', 'check', 'other');--> statement-breakpoint
CREATE TYPE "public"."rate_unit" AS ENUM('per_session', 'flat');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."season_term" AS ENUM('fall', 'spring', 'summer', 'winter');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cost_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"kind" "cost_rule_kind" NOT NULL,
	"label" text NOT NULL,
	"event_type" "event_type" NOT NULL,
	"trainer_id" integer,
	"amount_cents" integer NOT NULL,
	"unit" "rate_unit" DEFAULT 'per_session' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"kind" "credit_kind" NOT NULL,
	"label" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"received_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"rule_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"overridden" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"feed_id" integer,
	"source" "event_source" DEFAULT 'manual' NOT NULL,
	"external_uid" text,
	"title" text NOT NULL,
	"location" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"type" "event_type" DEFAULT 'other' NOT NULL,
	"type_confirmed" boolean DEFAULT false NOT NULL,
	"trainer_id" integer,
	"cancelled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"category" "expense_category" NOT NULL,
	"label" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"source" "expense_source" DEFAULT 'manual' NOT NULL,
	"rule_id" integer,
	"incurred_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ical_feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"last_synced_at" timestamp with time zone,
	"last_etag" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"paid_at" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "payment_method" DEFAULT 'venmo' NOT NULL,
	"note" text,
	"receipt_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" text NOT NULL,
	"parent_name" text,
	"parent_email" text,
	"parent_phone" text,
	"venmo_handle" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"jersey_number" text,
	"size" text,
	"dues_override_cents" integer,
	"carried_balance_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"term" "season_term" NOT NULL,
	"year" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" "season_status" DEFAULT 'active' NOT NULL,
	"first_payment_cents" integer,
	"first_payment_due" date,
	"final_payment_due" date,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"club" text,
	"age_group" text,
	"sport" text DEFAULT 'soccer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trainers" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" text NOT NULL,
	"initials" text,
	"default_rate_cents" integer DEFAULT 0 NOT NULL,
	"rate_unit" "rate_unit" DEFAULT 'per_session' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_rules" ADD CONSTRAINT "cost_rules_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_rules" ADD CONSTRAINT "cost_rules_trainer_id_trainers_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_charges" ADD CONSTRAINT "event_charges_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_charges" ADD CONSTRAINT "event_charges_rule_id_cost_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."cost_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_feed_id_ical_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."ical_feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_trainer_id_trainers_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rule_id_cost_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."cost_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ical_feeds" ADD CONSTRAINT "ical_feeds_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_players" ADD CONSTRAINT "season_players_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_players" ADD CONSTRAINT "season_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_charges_event_rule_idx" ON "event_charges" USING btree ("event_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_season_uid_idx" ON "events" USING btree ("season_id","external_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "season_players_season_player_idx" ON "season_players" USING btree ("season_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_team_term_year_idx" ON "seasons" USING btree ("team_id","term","year");