import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { Users, ArrowLeft, ListChecks } from "lucide-react";
import { getGroupTasks, getGroupMembers } from "@/lib/actions/tasks";
import GroupTaskBoard from "./GroupTaskBoard";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";

export default async function GroupTasksPage({
  params,
}: {
  params: { groupId: string };
}) {
  const { groupId } = params;

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Verify group membership
  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    redirect("/groups");
  }

  // Get group info
  const { data: group } = await supabase
    .from("groups")
    .select("name, description")
    .eq("id", groupId)
    .single();

  if (!group) notFound();

  const [tasks, members] = await Promise.all([
    getGroupTasks(groupId),
    getGroupMembers(groupId),
  ]);

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      <AppHeader
        maxWidth="max-w-4xl"
        navItems={[]}
        subtitle={
          <Link
            href={`/groups/${groupId}`}
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#A9D8CA] hover:text-[#F4F1E9]"
          >
            <ArrowLeft size={14} />
            Back to {group.name}
          </Link>
        }
        title={
          <div className="flex items-end justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#A9D8CA]">
                {group.name}
              </p>
              <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
                Tasks
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-[#A9D8CA]/25 bg-[#2B5855] px-3 py-1.5">
                <span className="flex items-center gap-1.5 font-mono text-xs text-[#A9D8CA]">
                  <Users size={12} />
                  {members.length} {members.length === 1 ? "member" : "members"}
                </span>
              </div>
            </div>
          </div>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        {tasks.length === 0 ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#87908A]">
                  Group tasks
                </p>
                <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
                  Shared tasks
                </h1>
              </div>
            </div>
            <div className="paper-grid rounded-[22px] border border-[#D0CEC4] p-12 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#C9B9E9] text-[#34264F]">
                <ListChecks size={24} />
              </div>
              <h2 className="mt-6 font-display text-xl font-semibold text-[#214746]">
                No tasks yet
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#717972]">
                Create a shared task to track group deadlines, assignments,
                or study sessions.
              </p>
            </div>
          </div>
        ) : (
          <GroupTaskBoard
            groupId={groupId}
            initialTasks={tasks}
            members={members}
            currentUserId={user.id}
          />
        )}
      </div>
    </main>
  );
}
