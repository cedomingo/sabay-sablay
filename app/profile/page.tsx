import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LayoutGrid, ArrowLeft, LogOut, Mail, Users } from "lucide-react";
import Link from "next/link";
import { getMyProfile, getMyScheduleSummary } from "@/lib/actions/profile";
import { getMyGroups } from "@/lib/actions/group";
import NotificationBell from "@/components/NotificationBell";
import SubmitButton from "@/components/SubmitButton";
import EditableName from "./EditableName";
import ManageSchedule from "./ManageSchedule";

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const [profile, schedule, groups] = await Promise.all([
    getMyProfile(),
    getMyScheduleSummary(),
    getMyGroups().catch(() => []),
  ]);

  const initials =
    profile?.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
        <div className="mx-auto max-w-3xl relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
                <LayoutGrid size={18} />
              </div>
              <span className="font-display text-sm font-bold tracking-tight">
                Schedule Planner
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <form action={handleSignOut}>
                <SubmitButton
                  icon={<LogOut size={14} />}
                  pendingChildren="Signing out..."
                  className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855] disabled:opacity-60"
                >
                  Sign out
                </SubmitButton>
              </form>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/schedule"
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#A9D8CA] hover:text-[#F4F1E9]"
            >
              <ArrowLeft size={14} />
              Back to schedule
            </Link>
            <div className="mt-3">
              <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                Profile
              </h1>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-6 py-8 md:px-10 space-y-6">
        {/* Identity card */}
        <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#8DDDD0] text-lg font-bold text-[#163D3A]">
              {initials}
            </div>
            <div className="flex-1">
              <EditableName initialName={profile?.full_name ?? ""} />
              {profile?.school_email && (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[#717972]">
                  <Mail size={13} />
                  {profile.school_email}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Schedule management */}
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
            Your schedule
          </p>
          <ManageSchedule schedule={schedule} />
        </div>

        {/* Groups summary */}
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
            Groups
          </p>
          <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 md:p-8">
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#C9B9E9] text-[#34264F]">
                <Users size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm text-[#52605C]">
                  You&apos;re in{" "}
                  <span className="font-semibold text-[#214746]">
                    {groups.length}
                  </span>{" "}
                  {groups.length === 1 ? "group" : "groups"}.
                </p>
              </div>
              <Link
                href="/groups"
                className="inline-flex items-center gap-2 rounded-xl border border-[#C8C6BD] px-4 py-2.5 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
              >
                Manage groups
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
