import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/actions/profile";
import OnboardingNameForm from "./OnboardingNameForm";
import AuthLayout from "@/components/AuthLayout";

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
    <AuthLayout>
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
    </AuthLayout>
  );
}
