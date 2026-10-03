ALTER TABLE "products" DROP CONSTRAINT "products_owner_matches_source";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "owner_id";