DROP INDEX "post_replies_automatic_rote_idx";--> statement-breakpoint
DROP INDEX "post_replies_automatic_article_idx";--> statement-breakpoint
ALTER TABLE "post_ai_comments" ADD COLUMN "automatic_slot" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "post_replies_automatic_rote_idx" ON "post_ai_comments" USING btree ("rote_id","automatic_slot") WHERE "post_ai_comments"."automatic" = true AND "post_ai_comments"."rote_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "post_replies_automatic_article_idx" ON "post_ai_comments" USING btree ("article_id","automatic_slot") WHERE "post_ai_comments"."automatic" = true AND "post_ai_comments"."article_id" IS NOT NULL;