CREATE TABLE "persona_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"persona_id" varchar(30) DEFAULT 'shared' NOT NULL,
	"key" varchar(120) NOT NULL,
	"content" text NOT NULL,
	"evidence" text NOT NULL,
	"rote_id" uuid,
	"article_id" uuid,
	"thread_id" uuid,
	"turn_id" uuid,
	"source_hash" varchar(64) NOT NULL,
	"public_source" boolean NOT NULL,
	"embedding" jsonb,
	"generation_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_memories_target_check" CHECK (num_nonnulls("persona_memories"."rote_id", "persona_memories"."article_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "persona_memories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "persona_memory_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"persona_id" varchar(30) DEFAULT 'shared' NOT NULL,
	"rote_id" uuid,
	"article_id" uuid,
	"thread_id" uuid,
	"turn_id" uuid,
	"source_hash" varchar(64) NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"lease_token" uuid,
	"started_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_memory_jobs_target_check" CHECK (num_nonnulls("persona_memory_jobs"."rote_id", "persona_memory_jobs"."article_id") = 1),
	CONSTRAINT "persona_memory_jobs_status_check" CHECK ("persona_memory_jobs"."status" IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "persona_memory_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "persona_memories" ADD CONSTRAINT "persona_memories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memories" ADD CONSTRAINT "persona_memories_rote_id_rotes_id_fk" FOREIGN KEY ("rote_id") REFERENCES "public"."rotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memories" ADD CONSTRAINT "persona_memories_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memories" ADD CONSTRAINT "persona_memories_thread_id_post_ai_comments_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."post_ai_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memories" ADD CONSTRAINT "persona_memories_turn_id_post_reply_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."post_reply_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memory_jobs" ADD CONSTRAINT "persona_memory_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memory_jobs" ADD CONSTRAINT "persona_memory_jobs_rote_id_rotes_id_fk" FOREIGN KEY ("rote_id") REFERENCES "public"."rotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memory_jobs" ADD CONSTRAINT "persona_memory_jobs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memory_jobs" ADD CONSTRAINT "persona_memory_jobs_thread_id_post_ai_comments_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."post_ai_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memory_jobs" ADD CONSTRAINT "persona_memory_jobs_turn_id_post_reply_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."post_reply_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "persona_memories_key_idx" ON "persona_memories" USING btree ("owner_id","persona_id","key");--> statement-breakpoint
CREATE INDEX "persona_memories_owner_idx" ON "persona_memories" USING btree ("owner_id","persona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_memory_jobs_dedupe_idx" ON "persona_memory_jobs" USING btree ("owner_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "persona_memory_jobs_pending_idx" ON "persona_memory_jobs" USING btree ("status","created_at");