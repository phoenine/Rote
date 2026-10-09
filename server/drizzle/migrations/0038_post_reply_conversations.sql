CREATE TABLE "post_reply_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"user_content" text NOT NULL,
	"reply_content" text DEFAULT '' NOT NULL,
	"status" varchar(20) NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_reply_turns_status_check" CHECK ("post_reply_turns"."status" IN ('running', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "post_reply_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_ai_comments" ADD COLUMN "persona_id" varchar(30);--> statement-breakpoint
ALTER TABLE "post_ai_comments" ADD COLUMN "is_conversation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "post_ai_comments" ADD COLUMN "automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "post_reply_turns" ADD CONSTRAINT "post_reply_turns_thread_id_post_ai_comments_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."post_ai_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_reply_turns_request_idx" ON "post_reply_turns" USING btree ("thread_id","request_id");--> statement-breakpoint
CREATE INDEX "post_reply_turns_thread_idx" ON "post_reply_turns" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_reply_turns_running_idx" ON "post_reply_turns" USING btree ("thread_id") WHERE "post_reply_turns"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "post_replies_automatic_rote_idx" ON "post_ai_comments" USING btree ("rote_id") WHERE "post_ai_comments"."automatic" = true AND "post_ai_comments"."rote_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "post_replies_automatic_article_idx" ON "post_ai_comments" USING btree ("article_id") WHERE "post_ai_comments"."automatic" = true AND "post_ai_comments"."article_id" IS NOT NULL;