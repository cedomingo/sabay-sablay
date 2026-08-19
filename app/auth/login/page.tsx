"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { LayoutGrid } from "lucide-react";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string; error?: string };
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);

    // Carry along where the user was headed (e.g. a group invite link)
    // so the callback can send them back there once they're signed in.
    const next =
      searchParams?.next && searchParams.next.startsWith("/")
        ? searchParams.next
        : undefined;
    const redirectTo = next
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : `${window.location.origin}/auth/callback`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <main className="grain relative min-h-[100dvh] overflow-hidden bg-[#214746] text-[#F4F1E9]">
      {/* Decorative elements */}
      <div className="absolute -bottom-24 -right-8 h-64 w-64 rounded-full border-[24px] border-[#F6D486]/20" />
      <div className="absolute -right-20 top-5 h-36 w-36 rotate-45 border border-[#F4A28C]/40" />

      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-6">
        <div className="w-full max-w-md">
          {/* Logo + Branding */}
          <div className="mb-10 flex items-center justify-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
              <LayoutGrid size={20} />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">
              Schedule Planner
            </span>
          </div>

          {/* Card */}
          <div className="grain relative overflow-hidden rounded-[28px] bg-[#2B5855] p-8 shadow-elevated md:p-10">
            <div className="relative z-10">
              <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#A9D8CA]">
                Welcome
              </p>
              <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                Your week, simplified.
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-[#D3E5DC]">
                Sign in with your school Google account to upload your schedule
                and see your week at a glance.
              </p>

              {/* Google Sign-In Button */}
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl bg-[#F4F1E9] px-5 py-3.5 text-sm font-semibold text-[#214746] transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
              >
                {loading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#214746] border-t-transparent" />
                ) : (
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                )}
                {loading ? "Signing in…" : "Continue with Google"}
              </button>

              {error && (
                <div className="mt-4 rounded-xl border border-[#C77A68] bg-[#FCE9E3] px-4 py-3 text-xs text-[#A14D3F]">
                  {error}
                </div>
              )}

              <p className="mt-6 text-center text-xs leading-relaxed text-[#A9D8CA]">
                We use your Google account to identify you and never post
                anything without your action.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
