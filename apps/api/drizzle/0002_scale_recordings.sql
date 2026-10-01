CREATE TABLE "scale_recordings" (
	"prepared_meal_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"recording" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scale_recordings" ADD CONSTRAINT "scale_recordings_prepared_meal_id_prepared_meals_id_fk" FOREIGN KEY ("prepared_meal_id") REFERENCES "public"."prepared_meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scale_recordings" ADD CONSTRAINT "scale_recordings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;