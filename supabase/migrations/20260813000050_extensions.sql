-- ---------------------------------------------------------------------------
-- Cash Atlas — required PostgreSQL extensions
--
-- Installed into the `extensions` schema per Supabase convention so that the
-- public schema holds only application objects.
-- ---------------------------------------------------------------------------

-- Trigram indexing for case-insensitive merchant/description search.
create extension if not exists pg_trgm with schema extensions;

-- pg_cron / pg_net are required for scheduled synchronisation. They are enabled
-- through the Supabase dashboard or `alter database` on hosted projects and are
-- intentionally NOT created here — see MANUAL_SETUP.md, "Scheduled sync".
