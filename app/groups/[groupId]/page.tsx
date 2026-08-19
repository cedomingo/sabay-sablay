import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Users, Settings, BookOpen, UserRound, Cog } from "lucide-react";
import { getGroup } from "@/lib/actions/group";
import { getGroupSchedule } from "@/lib/actions/group-schedule";
import { getGroupCalendarTasks } from "@/lib/actions/tasks";
import { getCourseMates } from "@/lib/actions/course-mates";
import GroupScheduleGrid from "./schedule/GroupScheduleGrid";
import CalendarView from "@/app/calendar/CalendarView";
import GroupTabs from "./GroupTabs";
import CreatedGroupOverlay from "./CreatedGroupOverlay";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";

export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams?: { created?: string };
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

  // Fetch the current user's profile name for the invite tab
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();
  const userName = profile?.full_name || user.email?.split("@")[0] || "Someone";

  const [scheduleData, courseMates, calendarTasks] = await Promise.all([
    getGroupSchedule(groupId),
    getCourseMates(groupId),
    getGroupCalendarTasks(groupId).catch(() => []),
  ]);

  const justCreated = searchParams?.created === "1";

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {justCreated && (
        <CreatedGroupOverlay
          groupName={group.name}
          inviteCode={group.invite_code}
          groupId={groupId}
        />
      )}
      <AppHeader
        maxWidth="max-w-6xl"
        navItems={[
          { label: "Profile", href: "/profile", icon: <UserRound size={14} /> },
        ]}
        subtitle={
          <Link
            href="/groups"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#A9D8CA] hover:text-[#F4F1E9]"
          >
            <ArrowLeft size={14} />
            Back to groups
          </Link>
        }
        title={
          <div className="flex items-end justify-between">
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
              <Link
                href={`/groups/${groupId}/settings`}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#A9D8CA] hover:bg-[#2B5855]"
                title="Group settings"
              >
                <Cog size={16} />
              </Link>
              <div className="rounded-full border border-[#A9D8CA]/25 bg-[#2B5855] px-3 py-1.5">
                <span className="flex items-center gap-1.5 font-mono text-xs text-[#A9D8CA]">
                  <Users size={12} />
                  {group.group_members?.length ?? 0}{" "}
                  {(group.group_members?.length ?? 0) === 1 ? "member" : "members"}
                </span>
              </div>
            </div>
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
        <GroupTabs
          inviteCode={group.invite_code}
          groupName={group.name}
          userName={userName}
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
