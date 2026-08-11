CREATE TYPE "public"."installment" AS ENUM('first', 'final', 'other');--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "bank_transaction_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "installment" "installment" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "bank_transaction_id" integer;