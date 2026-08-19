import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function safeNext(next: string | null): string | null {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return null;
}

// GET /auth/callback — handles the OAuth redirect from Supabase Auth.
// Exchanges the auth code for a session and redirects to the app.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = safeNext(searchParams.get("next"));
  const next = requestedNext ?? "/schedule";

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // First-time signups get asked what to call them before landing
      // anywhere else in the app.
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", data.user.id)
        .single();

      if (!profile || profile.onboarding_completed === false) {
        // If they arrived via an invite link, keep that as the eventual
        // destination; otherwise send new users straight into the
        // upload flow once they've picked a name.
        const onboardingNext = requestedNext ?? "/schedule/upload";
        return NextResponse.redirect(
          `${origin}/onboarding/name?next=${encodeURIComponent(onboardingNext)}`
        );
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_error`);
}
