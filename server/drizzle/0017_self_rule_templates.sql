CREATE TABLE "self_rule_templates" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
