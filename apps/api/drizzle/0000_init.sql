CREATE TABLE "consumption_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"prepared_meal_id" uuid NOT NULL,
	"eaten_at" timestamp with time zone NOT NULL,
	"portion" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_targets" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"protein" double precision,
	"fat" double precision,
	"carbs" double precision,
	"fibre" double precision,
	"kcal" double precision
);
--> statement-breakpoint
CREATE TABLE "ingredient_classes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prepared_meal_items" (
	"owner_id" uuid NOT NULL,
	"prepared_meal_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"step_id" uuid,
	"skipped" boolean NOT NULL,
	"product_id" uuid,
	"grams" double precision,
	"weight_source" text,
	CONSTRAINT "prepared_meal_items_prepared_meal_id_position_pk" PRIMARY KEY("prepared_meal_id","position"),
	CONSTRAINT "prepared_meal_items_skipped_shape" CHECK (("prepared_meal_items"."skipped" and "prepared_meal_items"."product_id" is null and "prepared_meal_items"."grams" is null and "prepared_meal_items"."weight_source" is null)
        or (not "prepared_meal_items"."skipped" and "prepared_meal_items"."product_id" is not null and "prepared_meal_items"."grams" >= 0 and "prepared_meal_items"."weight_source" is not null))
);
--> statement-breakpoint
CREATE TABLE "prepared_meals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"recipe_id" uuid,
	"input_method" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"ingredient_class_id" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"source" text NOT NULL,
	"kcal" double precision,
	"fat" double precision,
	"saturates" double precision,
	"carbs" double precision,
	"sugars" double precision,
	"protein" double precision,
	"salt" double precision,
	"fibre" double precision,
	CONSTRAINT "products_owner_matches_source" CHECK (("products"."source" = 'seed') = ("products"."owner_id" is null))
);
--> statement-breakpoint
CREATE TABLE "recipe_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"ingredient_class_id" text NOT NULL,
	"default_product_id" uuid,
	CONSTRAINT "recipe_steps_recipeId_position_unique" UNIQUE("recipe_id","position")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text,
	"timezone" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "consumption_entries" ADD CONSTRAINT "consumption_entries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_entries" ADD CONSTRAINT "consumption_entries_prepared_meal_id_prepared_meals_id_fk" FOREIGN KEY ("prepared_meal_id") REFERENCES "public"."prepared_meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_targets" ADD CONSTRAINT "daily_targets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meal_items" ADD CONSTRAINT "prepared_meal_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meal_items" ADD CONSTRAINT "prepared_meal_items_prepared_meal_id_prepared_meals_id_fk" FOREIGN KEY ("prepared_meal_id") REFERENCES "public"."prepared_meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meal_items" ADD CONSTRAINT "prepared_meal_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meals" ADD CONSTRAINT "prepared_meals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meals" ADD CONSTRAINT "prepared_meals_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_ingredient_class_id_ingredient_classes_id_fk" FOREIGN KEY ("ingredient_class_id") REFERENCES "public"."ingredient_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_ingredient_class_id_ingredient_classes_id_fk" FOREIGN KEY ("ingredient_class_id") REFERENCES "public"."ingredient_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_default_product_id_products_id_fk" FOREIGN KEY ("default_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;