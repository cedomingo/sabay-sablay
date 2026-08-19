import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LayoutGrid, ArrowLeft, Users, LogOut, Settings, BookOpen, UserRound } from "lucide-react";
import { getGroup } from "@/lib/actions/group";
import { getGroupSchedule } from "@/lib/actions/group-schedule";
import { getGroupCalendarTasks } from "@/lib/actions/tasks";
import { getCourseMates } from "@/lib/actions/course-mates";
import NotificationBell from "@/components/NotificationBell";
import SubmitButton from "@/components/SubmitButton";
import GroupScheduleGrid from "./schedule/GroupScheduleGrid";
import CalendarView from "@/app/calendar/CalendarView";
import GroupTabs from "./GroupTabs";
import Link from "next/link";

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

export default async function GroupDetailPage({
  params,
}: {
  params: { groupId: string };
}) {
  const { groupId } = params;

  let group;
  try {
    group = await getGroup(groupId);
  } catch {
    redirect("/groups");
  }

  if (!group) {
    notFound();
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const isOwner = group.owner_id === user.id;

  const [scheduleData, courseMates, calendarTasks] = await Promise.all([
    getGroupSchedule(groupId),
    getCourseMates(groupId),
    getGroupCalendarTasks(groupId).catch(() => []),
  ]);

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
                Sabay Sablay
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <Link
                href="/profile"
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                <UserRound size={14} />
                Profile
              </Link>
              <Link
                href={`/groups/${groupId}/settings`}
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                <Settings size={14} />
                Settings
              </Link>
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
              href="/groups"
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#A9D8CA] hover:text-[#F4F1E9]"
            >
              <ArrowLeft size={14} />
              Back to groups
            </Link>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                  {group.name}
                </h1>
                {group.description && (
                  <p className="mt-1 text-sm text-[#D3E5DC]">{group.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isOwner && (
                  <span className="rounded-full bg-[#F6D486] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#4C3911]">
                    Owner
                  </span>
                )}
                <div className="rounded-full border border-[#A9D8CA]/25 bg-[#2B5855] px-3 py-1.5">
                  <span className="flex items-center gap-1.5 font-mono text-xs text-[#A9D8CA]">
                    <Users size={12} />
                    {group.group_members?.length ?? 0}{" "}
                    {(group.group_members?.length ?? 0) === 1 ? "member" : "members"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
        <GroupTabs
          scheduleTab={
            <div className="space-y-6">
              {scheduleData && scheduleData.entries.length === 0 && scheduleData.members.length === 0 ? (
                <div className="paper-grid rounded-[22px] border border-[#D0CEC4] p-12 text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#F6D486] text-[#765514]">
                    <Users size={24} />
                  </div>
                  <h2 className="mt-6 font-display text-xl font-semibold text-[#214746]">
                    No schedules uploaded yet
                  </h2>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#717972]">
                    Group members need to upload their schedules first. Once they
                    do, the combined timeline will show here.
                  </p>
                </div>
              ) : (
                <GroupScheduleGrid
                  entries={scheduleData?.entries ?? []}
                  members={scheduleData?.members ?? []}
                />
              )}

              {courseMates.length > 0 && (
                <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5">
                  <div className="flex items-center gap-2">
                    <BookOpen size={14} className="text-[#A991D1]" />
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                      Course-mates
                    </p>
                    <span className="rounded-full bg-[#E8E0F5] px-2 py-0.5 text-[10px] font-bold text-[#34264F]">
                      {courseMates.length}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {courseMates.map((cm) => (
                      <div
                        key={`${cm.subject}-${cm.number}-${cm.section}`}
                        className="rounded-xl border border-[#E1DFD7] bg-white p-3"
                      >
                        <p className="text-sm font-semibold text-[#214746]">
                          {cm.subject} {cm.number}
                          <span className="ml-1 text-xs font-normal text-[#87908A]">
                            {cm.section}
                          </span>
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {cm.members.map((m) => (
                            <span
                              key={m.user_id}
                              className="inline-flex items-center gap-1 rounded-full bg-[#D9E7DE] px-2 py-0.5 text-[10px] font-semibold text-[#286057]"
                            >
                              <span className="grid h-4 w-4 place-items-center rounded-full bg-[#8DDDD0] text-[7px] font-bold text-[#163D3A]">
                                {m.full_name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .slice(0, 1)
                                  .toUpperCase()}
                              </span>
                              {m.full_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          }
          calendarTab={
            <div>
              <p className="mb-4 text-xs text-[#717972]">
                Tasks and events added here are visible to everyone in{" "}
                {group.name}, and also show up on each member&apos;s personal
                calendar.
              </p>
              <CalendarView initialTasks={calendarTasks} groupId={groupId} />
            </div>
          }
        />
      </div>
    </main>
  );
}
