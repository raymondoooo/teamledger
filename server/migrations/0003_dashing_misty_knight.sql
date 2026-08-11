CREATE TYPE "public"."bank_txn_kind" AS ENUM('player_transfer', 'trainer_payment', 'expense_payment', 'deposit', 'withdrawal', 'fee', 'adjustment');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" text DEFAULT 'Team account' NOT NULL,
	"starting_balance_cents" integer DEFAULT 0 NOT NULL,
	"starting_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"season_id" integer,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" "bank_txn_kind" DEFAULT 'adjustment' NOT NULL,
	"reconciled" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trainer_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"trainer_id" integer NOT NULL,
	"paid_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "payment_method" DEFAULT 'venmo' NOT NULL,
	"note" text,
	"bank_transaction_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "transferred_on" date;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_payments" ADD CONSTRAINT "trainer_payments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_payments" ADD CONSTRAINT "trainer_payments_trainer_id_trainers_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_payments" ADD CONSTRAINT "trainer_payments_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE set null ON UPDATE no action;