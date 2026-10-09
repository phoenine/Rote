CREATE TABLE "persona_memory_suppressions" (
	"owner_id" uuid NOT NULL,
	"persona_id" varchar(30) NOT NULL,
	"key" varchar(120) NOT NULL,
	"forgotten_before" timestamp with time zone NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "persona_memory_suppressions_owner_id_persona_id_key_pk" PRIMARY KEY("owner_id","persona_id","key")
);
--> statement-breakpoint
ALTER TABLE "persona_memory_suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "persona_memory_suppressions" ADD CONSTRAINT "persona_memory_suppressions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;