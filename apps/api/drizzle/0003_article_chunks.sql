CREATE TABLE "article_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_suggestions" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"input_hash" text NOT NULL,
	"suggestion" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_chunks" ADD CONSTRAINT "article_chunks_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_suggestions" ADD CONSTRAINT "ticket_suggestions_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_chunks_article_hash_key" ON "article_chunks" USING btree ("article_id","content_hash");--> statement-breakpoint
CREATE INDEX "article_chunks_embedding_idx" ON "article_chunks" USING hnsw ("embedding" vector_cosine_ops);