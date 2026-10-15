ALTER TABLE "persona_memories" ADD COLUMN "index_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_ai_comments" ADD COLUMN "public_safe" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "post_reply_turns" ADD COLUMN "public_safe" boolean DEFAULT false NOT NULL;