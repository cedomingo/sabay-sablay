import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, UserRound, Plus, CalendarRange } from "lucide-react";
import { getMyGroups } from "@/lib/actions/group";
import AppHeader from "@/components/AppHeader";
import CreateGroupModal from "./CreateGroupModal";

export default async function GroupsPage() {
  const groups = await getMyGroups();

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      <AppHeader
        maxWidth="max-w-5xl"
        navItems={[
          { label: "My schedule", href: "/schedule", icon: <CalendarRange size={14} /> },
          { label: "Profile", href: "/profile", icon: <UserRound size={14} /> },
        ]}
        subtitle={
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#A9D8CA]">
              Collaboration
            </p>
            <div className="mt-1 flex items-center gap-3">
              <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                My groups
              </h1>
              <CreateGroupModal variant="icon" />
            </div>
          </div>
        }
        headerActions={
          <div className="flex items-center gap-3">
            <Link
              href="/schedule"
              className="rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
            >
              My schedule
            </Link>
            <CreateGroupModal variant="button" />
          </div>
        }
      />

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
              <CreateGroupModal variant="empty-state" />
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
