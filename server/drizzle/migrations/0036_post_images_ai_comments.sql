CREATE TABLE "article_attachments" (
	"article_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	CONSTRAINT "article_attachments_article_id_attachment_id_pk" PRIMARY KEY("article_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "post_ai_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"rote_id" uuid,
	"article_id" uuid,
	"request_id" uuid NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"status" varchar(20) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_ai_comments_target_check" CHECK (num_nonnulls("post_ai_comments"."rote_id", "post_ai_comments"."article_id") = 1),
	CONSTRAINT "post_ai_comments_status_check" CHECK ("post_ai_comments"."status" IN ('running', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "article_attachments" ADD CONSTRAINT "article_attachments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_attachments" ADD CONSTRAINT "article_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_ai_comments" ADD CONSTRAINT "post_ai_comments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_ai_comments" ADD CONSTRAINT "post_ai_comments_rote_id_rotes_id_fk" FOREIGN KEY ("rote_id") REFERENCES "public"."rotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_ai_comments" ADD CONSTRAINT "post_ai_comments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_attachments_attachment_idx" ON "article_attachments" USING btree ("attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_ai_comments_request_idx" ON "post_ai_comments" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "post_ai_comments_rote_idx" ON "post_ai_comments" USING btree ("rote_id");--> statement-breakpoint
CREATE INDEX "post_ai_comments_article_idx" ON "post_ai_comments" USING btree ("article_id");
--> statement-breakpoint
-- Retain URL mentions conservatively: inline images, reference definitions and
-- pasted owned URLs all protect the attachment. Never inspect object storage.
INSERT INTO article_attachments (article_id, attachment_id)
SELECT article.id, attachment.id
FROM articles article
JOIN attachments attachment ON attachment.userid = article."authorId"
WHERE (attachment.url <> '' AND strpos(article.content, attachment.url) > 0)
   OR (attachment."compressUrl" <> '' AND strpos(article.content, attachment."compressUrl") > 0)
ON CONFLICT DO NOTHING;
