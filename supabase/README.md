# Supabase setup (Phase 0)

1. Create a new Supabase project.
2. Auth → Providers → enable **Google**. Add your OAuth client ID/secret
   from Google Cloud Console. Optionally restrict sign-in to your school's
   Google Workspace domain using the `hd` parameter when Phase 2 wires up
   the sign-in call.
3. Auth → URL Configuration — **required for production, not just local dev**:
   - Set **Site URL** to your deployed app's URL (e.g.
     `https://schedule-plan.vercel.app`), not `http://localhost:3000`.
   - Add `https://schedule-plan.vercel.app/auth/callback` (and
     `http://localhost:3000/auth/callback` for local dev) to **Redirect
     URLs**.
   - If this list doesn't include your deployed URL, Supabase silently
     falls back to the Site URL after login — this is why signing in on
     a deployed app can land on `http://localhost:3000/?code=...` instead
     of your real domain, even though the app itself passes the correct
     `redirectTo`.
   - In Google Cloud Console → Credentials → your OAuth Client, confirm
     **Authorized redirect URIs** includes
     `https://<your-project-ref>.supabase.co/auth/v1/callback` (this is
     fixed by Supabase and doesn't change based on where your app is
     hosted).
3. Storage → create a new bucket named `schedule-images`, set to
   **private** (not public).
4. Run the migration in `migrations/00000000000000_init.sql` (via the SQL
   editor, or `supabase db push` if using the CLI) just to confirm the
   connection — it doesn't create any feature tables yet.
5. Copy the project URL and anon key into the Next.js app's
   `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
6. Copy the service role key into `SUPABASE_SERVICE_ROLE_KEY` — **server-only**,
   set it in Vercel's project env vars, never commit it or prefix it with
   `NEXT_PUBLIC_`.

Feature tables (`profiles`, `schedules`, `schedule_entries`, `groups`, etc.,
per Appendix A of the build plan) are added starting in Phase 2, each with
RLS policies in the same migration that creates the table.
