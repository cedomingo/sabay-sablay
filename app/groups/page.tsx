import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, Plus, Users, LogOut, ListChecks } from "lucide-react";
import { getMyGroups } from "@/lib/actions/group";
import NotificationBell from "@/components/NotificationBell";
import SubmitButton from "@/components/SubmitButton";
import { revalidatePath } from "next/cache";

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

export default async function GroupsPage() {
  const groups = await getMyGroups();

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
        <div className="mx-auto max-w-5xl relative z-10">
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

          <div className="mt-6 flex items-end justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#A9D8CA]">
                Collaboration
              </p>
              <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
                My groups
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/schedule"
                className="rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                My schedule
              </Link>
              <Link
                href="/tasks"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                <ListChecks size={13} />
                Tasks
              </Link>
              <Link
                href="/groups/create"
                className="inline-flex items-center gap-2 rounded-xl bg-[#F4A28C] px-4 py-2.5 text-sm font-semibold text-[#512E2B] transition-transform hover:-translate-y-0.5"
              >
                <Plus size={16} />
                New group
              </Link>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
        {groups.length === 0 ? (
          <div className="paper-grid rounded-[22px] border border-[#D0CEC4] p-12 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#C9B9E9] text-[#34264F]">
              <Users size={24} />
            </div>
            <h2 className="mt-6 font-display text-xl font-semibold text-[#214746]">
              No groups yet
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#717972]">
              Create a group to see a combined schedule view with your
              classmates, or join one using an invite code.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Link
                href="/groups/create"
                className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5"
              >
                <Plus size={16} />
                Create a group
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => {
              const memberCount = group.group_members?.length ?? 0;
              const isOwner = group.group_members?.some(
                (m) => m.role === "owner" && m.user_id === group.group_members?.[0]?.user_id
              );

              return (
                <Link
                  key={group.id}
                  href={`/groups/${group.id}`}
                  className="group rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5 transition-all hover:border-[#56B9AC] hover:shadow-card"
                >
                  <div className="flex items-start justify-between">
                    <h3 className="font-display text-lg font-semibold text-[#214746] group-hover:text-[#2B5855]">
                      {group.name}
                    </h3>
                    {isOwner && (
                      <span className="rounded-full bg-[#D9E7DE] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#286057]">
                        Owner
                      </span>
                    )}
                  </div>
                  {group.description && (
                    <p className="mt-2 line-clamp-2 text-sm text-[#717972]">
                      {group.description}
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-2 text-xs text-[#87908A]">
                    <Users size={14} />
                    <span>
                      {memberCount} {memberCount === 1 ? "member" : "members"}
                    </span>
                  </div>

                  {/* Member avatars */}
                  <div className="mt-3 flex -space-x-2">
                    {group.group_members?.slice(0, 5).map((m) => (
                      <div
                        key={m.user_id}
                        className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#F8F6F0] bg-[#8DDDD0] text-[10px] font-bold text-[#163D3A]"
                      >
                        {m.profiles?.full_name
                          ?.split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase() || "??"}
                      </div>
                    ))}
                    {memberCount > 5 && (
                      <div className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#F8F6F0] bg-[#F6D486] text-[10px] font-bold text-[#4C3911]">
                        +{memberCount - 5}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
