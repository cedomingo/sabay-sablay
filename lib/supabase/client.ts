import { createBrowserClient } from "@supabase/ssr";

// Client-side Supabase client. Only ever uses the public anon key — never
// import the service role key into anything that ships to the browser.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
      },
    }
  );
}
