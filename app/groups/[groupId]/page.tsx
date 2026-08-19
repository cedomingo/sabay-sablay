import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  LayoutGrid,
  ArrowLeft,
  Users,
  Copy,
  LogOut,
  Trash2,
  Calendar,
  ListChecks,
  BookOpen,
} from "lucide-react";
import { getCourseMates } from "@/lib/actions/course-mates";
import { getGroup, leaveGroup, deleteGroup } from "@/lib/actions/group";
import NotificationBell from "@/components/NotificationBell";
import GroupMembersList from "@/components/GroupMembersList";
import SubmitButton from "@/components/SubmitButton";
import InviteButton from "@/components/InviteButton";
import Link from "next/link";

/**
 * Compute presence for each group member based on their schedule.
 * Returns a Map of userId -> { inClass: boolean, currentSubject: string | null }
 */
async function getMemberPresence(memberIds: string[]) {
  const supabase = createClient();
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dayIndex = now.getDay(); // 0=Sun, 1=Mon, ...
  const currentDay = DAYS[dayIndex === 0 ? 6 : dayIndex - 1];

  const presenceMap = new Map<string, { inClass: boolean; subject: string | null }>();

  if (memberIds.length === 0) return presenceMap;

  // Fetch schedules for all members
  const { data: schedules } = await supabase
    .from("schedules")
    .select("id, user_id")
    .in("user_id", memberIds);

  if (!schedules || schedules.length === 0) {
    memberIds.forEach((id) => presenceMap.set(id, { inClass: false, subject: null }));
    return presenceMap;
  }

  const scheduleIds = schedules.map((s) => s.id);
  const scheduleOwnerMap = new Map(schedules.map((s) => [s.id, s.user_id]));

  // Fetch visible entries for today (exclude hidden)
  const { data: entries } = await supabase
    .from("schedule_entries")
    .select("schedule_id, day, start_minutes, end_minutes, subject")
    .in("schedule_id", scheduleIds)
    .eq("day", currentDay)
    .eq("hidden", false);

  // Determine presence for each member
  memberIds.forEach((id) => presenceMap.set(id, { inClass: false, subject: null }));

  for (const entry of entries || []) {
    const userId = scheduleOwnerMap.get(entry.schedule_id);
    if (!userId) continue;

    if (currentMinutes >= entry.start_minutes && currentMinutes < entry.end_minutes) {
      presenceMap.set(userId, {
        inClass: true,
        subject: entry.subject,
      });
    }
  }

  return presenceMap;
}

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

  // Compute presence for all members
  const memberIds = group.group_members?.map((m) => m.user_id) || [];
  const [presenceMap, courseMates] = await Promise.all([
    getMemberPresence(memberIds),
    getCourseMates(groupId),
  ]);
  const presenceObj = Object.fromEntries(
    Array.from(presenceMap.entries()).map(([id, p]) => [id, { inClass: p.inClass, subject: p.subject }])
  );

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
        <div className="mx-auto max-w-4xl relative z-10">
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
                  <p className="mt-1 text-sm text-[#D3E5DC]">
                    {group.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isOwner && (
                  <span className="rounded-full bg-[#F6D486] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#4C3911]">
                    Owner
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Members */}
          <div className="rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
            <div className="flex items-center justify-between border-b border-[#D8D6CD] px-5 py-4">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-[#A45D42]" />
                <h2 className="font-display text-sm font-semibold text-[#214746]">
                  Members
                </h2>
                <span className="rounded-full bg-[#D9E7DE] px-2 py-0.5 text-[10px] font-bold text-[#286057]">
                  {group.group_members?.length ?? 0}
                </span>
              </div>
            </div>

            <GroupMembersList
              groupId={groupId}
              initialMembers={group.group_members ?? []}
              currentUserId={user.id}
              isOwner={isOwner}
              presence={presenceObj}
            />
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Invite Link */}
            <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                Invite link
              </p>
              <p className="mt-2 text-xs text-[#717972]">
                Share this code or link to invite classmates.
              </p>

              {/* Invite Code */}
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-3 py-2 font-mono text-sm font-bold text-[#214746]">
                  {group.invite_code}
                </code>
              </div>

              {/* Full link */}
              <div className="mt-2 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-3 py-2">
                <p className="truncate text-xs text-[#87908A]">
                  /join/{group.invite_code}
                </p>
              </div>

              <InviteButton inviteCode={group.invite_code} />
            </div>

            {/* Combined Schedule */}
            <Link
              href={`/groups/${groupId}/schedule`}
              className="flex items-center gap-3 rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5 transition-all hover:border-[#56B9AC] hover:shadow-card"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#214746] text-[#F4F1E9]">
                <Calendar size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#214746]">
                  Combined schedule
                </p>
                <p className="text-xs text-[#87908A]">
                  See when the group is free vs busy
                </p>
              </div>
            </Link>

            {/* Group Tasks */}
            <Link
              href={`/groups/${groupId}/tasks`}
              className="flex items-center gap-3 rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5 transition-all hover:border-[#C9B9E9] hover:shadow-card"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#C9B9E9] text-[#34264F]">
                <ListChecks size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#214746]">
                  Group tasks
                </p>
                <p className="text-xs text-[#87908A]">
                  Track shared deadlines & assignments
                </p>
              </div>
            </Link>

            {/* Course-mates */}
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
                <div className="mt-3 space-y-3">
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

            {/* Actions */}
            <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                Actions
              </p>
              <div className="mt-3 space-y-2">
                {!isOwner && (
                  <form
                    action={async () => {
                      "use server";
                      await leaveGroup(groupId);
                    }}
                  >
                    <SubmitButton
                      icon={<LogOut size={14} />}
                      pendingChildren="Leaving..."
                      className="flex w-full items-center gap-2 rounded-xl border border-[#C77A68]/30 px-4 py-2.5 text-xs font-semibold text-[#A14D3F] hover:bg-[#FCE9E3] disabled:opacity-60"
                    >
                      Leave group
                    </SubmitButton>
                  </form>
                )}

                {isOwner && (
                  <form
                    action={async () => {
                      "use server";
                      await deleteGroup(groupId);
                    }}
                  >
                    <SubmitButton
                      icon={<Trash2 size={14} />}
                      pendingChildren="Deleting..."
                      className="flex w-full items-center gap-2 rounded-xl border border-[#C77A68]/30 px-4 py-2.5 text-xs font-semibold text-[#A14D3F] hover:bg-[#FCE9E3] disabled:opacity-60"
                    >
                      Delete group
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
