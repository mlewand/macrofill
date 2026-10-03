-- Products become one store shared by all users (#63). Step 1: the new columns. Step 2
-- (0005) drops owner_id, once the user products' owners have moved to created_by.
ALTER TABLE "products" DROP CONSTRAINT "products_source_values";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_barcode_unique" UNIQUE("barcode");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_barcode_form" CHECK ("products"."barcode" ~ '^[0-9]{13}$');--> statement-breakpoint
-- A user product (none exist yet, nothing creates them) stays, as a manual product by its owner.
UPDATE "products" SET "created_by" = "owner_id", "source" = 'manual' WHERE "source" = 'user';--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_values" CHECK ("products"."source" in ('seed', 'manual'));
