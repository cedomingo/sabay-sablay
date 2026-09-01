import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

function safeTarget(raw: string | null, fallback: string): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return fallback;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({
            name,
            value,
            ...options,
            maxAge: 60 * 60 * 24 * 30, // 30 days
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({
            name,
            value: "",
            ...options,
            maxAge: 0,
          });
        },
      },
    }
  );

  // Refresh the session — important for SSR
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/auth");
  const isApiRoute = pathname.startsWith("/api");
  const isOnboardingRoute = pathname.startsWith("/onboarding");
  // Invite links must stay reachable without a session: link-preview
  // crawlers (Messenger, iMessage, Slack, etc.) never carry auth cookies,
  // so gating this route here would always bounce them to /auth/login
  // and strip out the per-invite OG title/description generated on the
  // join page. The page itself renders a public invite preview and only
  // asks for sign-in when the user actually tries to join.
  const isJoinRoute = pathname.startsWith("/join/");

  // Redirect unauthenticated users away from protected routes, preserving
  // where they were headed (e.g. a group invite link) as `next` so we can
  // send them back there once they've signed in.
  if (!user && !isAuthRoute && !isApiRoute && !isJoinRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = "";
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (user) {
    // Redirect authenticated users away from the login page.
    if (isAuthRoute && pathname === "/auth/login") {
      const requestedNext = request.nextUrl.searchParams.get("next");
      const target = safeTarget(requestedNext, "/schedule");
      return NextResponse.redirect(new URL(target, request.url));
    }

    // First-time users must pick a display name before doing anything
    // else in the app. This is a safety net alongside the check already
    // done in /auth/callback — it catches direct navigation, refreshes,
    // or resumed sessions mid-onboarding.
    if (!isAuthRoute && !isApiRoute && !isOnboardingRoute) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .single();

      if (profile && profile.onboarding_completed === false) {
        const url = request.nextUrl.clone();
        url.pathname = "/onboarding/name";
        url.search = "";
        url.searchParams.set("next", pathname + search);
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};