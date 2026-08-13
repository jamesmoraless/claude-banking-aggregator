/**
 * The shape a finance tool returns.
 *
 * Kept in its own module, free of any Deno or Supabase import, so that the
 * block builder can consume it without dragging the executor's runtime
 * dependencies along. That is what lets `blocks.ts` — the code that decides
 * what figures the user actually sees — be unit tested in the ordinary
 * `pnpm test` run.
 */
export type ToolResult = {
  toolName: string;
  ok: boolean;
  data: unknown;
  /** Present when the tool failed; safe to show the user. */
  error?: string;
};
