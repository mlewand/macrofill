CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"props" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"app_version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;