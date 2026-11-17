CREATE INDEX "magic_links_expires_idx" ON "magic_links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pending_changes_due_idx" ON "pending_changes" USING btree ("status","key_type","effective_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");