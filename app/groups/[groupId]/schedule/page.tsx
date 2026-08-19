import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LayoutGrid, ArrowLeft, Users, LogOut } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import { getGroupSchedule } from "@/lib/actions/group-schedule";
import { getGroup } from "@/lib/actions/group";
import { getGroupTasks } from "@/lib/actions/tasks";
import ScheduleLineChart from "./ScheduleLineChart";
import InviteButton from "@/components/InviteButton";
import Link from "next/link";

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

export default async function GroupSchedulePage({
  params,
}: {
  params: { groupId: string };
}) {
  const { groupId } = params;

  const data = await getGroupSchedule(groupId);

  if (!data) {
    redirect("/groups");
  }

  let inviteCode: string | null = null;
  try {
    const group = await getGroup(groupId);
    inviteCode = group?.invite_code ?? null;
  } catch {
    inviteCode = null;
  }

  // Group tasks/deadlines/events for the "Show Tasks" overlay on the
  // combined timeline (Batch F). Only open ones are worth plotting on
  // a forward-looking schedule; tolerate failure so a tasks hiccup
  // never breaks the schedule view itself.
  let tasks: Awaited<ReturnType<typeof getGroupTasks>> = [];
  try {
    tasks = (await getGroupTasks(groupId)).filter((t) => t.status === "open" && t.due_at);
  } catch {
    tasks = [];
  }

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
        <div className="mx-auto max-w-6xl relative z-10">
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
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </form>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href={`/groups/${groupId}`}
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#A9D8CA] hover:text-[#F4F1E9]"
            >
              <ArrowLeft size={14} />
              Back to {data.groupName}
            </Link>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#A9D8CA]">
                  {data.groupName}
                </p>
                <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
                  Combined schedule
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-[#A9D8CA]/25 bg-[#2B5855] px-3 py-1.5">
                  <span className="flex items-center gap-1.5 font-mono text-xs text-[#A9D8CA]">
                    <Users size={12} />
                    {data.memberCount} {data.memberCount === 1 ? "member" : "members"}
                  </span>
                </div>
                {inviteCode && (
                  <InviteButton
                    inviteCode={inviteCode}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Schedule timeline */}
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
        {data.entries.length === 0 ? (
          <div className="paper-grid rounded-[22px] border border-[#D0CEC4] p-12 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#F6D486] text-[#765514]">
              <Users size={24} />
            </div>
            <h2 className="mt-6 font-display text-xl font-semibold text-[#214746]">
              No schedules uploaded yet
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#717972]">
              Group members need to upload their schedules first. Once they do,
              the combined timeline will show here.
            </p>
            <Link
              href={`/groups/${groupId}`}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-3 text-sm font-semibold text-[#F4F1E9]"
            >
              Back to group
            </Link>
          </div>
        ) : (
          <ScheduleLineChart
            entries={data.entries}
            members={data.members}
            memberCount={data.memberCount}
            tasks={tasks}
          />
        )}
      </div>
    </main>
  );
}
