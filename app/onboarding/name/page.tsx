import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { getMyProfile } from "@/lib/actions/profile";
import OnboardingNameForm from "./OnboardingNameForm";

function safeNext(next: string | undefined, fallback: string): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return fallback;
}

export default async function OnboardingNamePage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/login?next=${encodeURIComponent("/onboarding/name")}`);
  }

  const profile = await getMyProfile();

  // Already onboarded — nothing to do here, send them on their way.
  if (profile?.onboarding_completed) {
    redirect(safeNext(searchParams?.next, "/schedule"));
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
              Sabay Sablay
            </span>
          </div>

          {/* Card */}
          <div className="grain relative overflow-hidden rounded-[28px] bg-[#2B5855] p-8 shadow-elevated md:p-10">
            <div className="relative z-10">
              <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#A9D8CA]">
                Welcome aboard
              </p>
              <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                What should we call you?
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-[#D3E5DC]">
                This is the name your classmates and group-mates will see
                around the app.
              </p>

              <OnboardingNameForm
                initialName={profile?.full_name ?? ""}
                next={searchParams?.next}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
