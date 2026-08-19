import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LayoutGrid, Users, ArrowLeft, LogOut } from "lucide-react";
import { joinGroup } from "@/lib/actions/group";
import Link from "next/link";
import SubmitButton from "@/components/SubmitButton";

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

async function handleJoin(code: string) {
  "use server";
  await joinGroup(code);
}

export default async function JoinGroupPage({
  params,
}: {
  params: { code: string };
}) {
  const { code } = params;
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/login?next=/join/${code}`);
  }

  // Look up the group by invite code via the security-definer RPC —
  // groups is only directly selectable by existing members/owner now,
  // so a non-member resolving an invite link has to go through this.
  const { data: groupRows, error } = await supabase.rpc(
    "get_group_by_invite_code",
    { p_invite_code: code }
  );
  const group = groupRows?.[0];

  if (error || !group) {
    return (
      <main className="min-h-[100dvh] bg-[#F4F1E9]">
        <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
          <div className="mx-auto max-w-3xl relative z-10">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
                <LayoutGrid size={18} />
              </div>
              <span className="font-display text-sm font-bold tracking-tight">
                Sabay Sablay
              </span>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#FCE9E3] text-[#A14D3F]">
            <Users size={24} />
          </div>
          <h1 className="mt-6 font-display text-2xl font-semibold text-[#214746]">
            Invalid invite code
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#717972]">
            This invite link doesn&apos;t match any group. Check the code and
            try again.
          </p>
          <Link
            href="/groups"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-3 text-sm font-semibold text-[#F4F1E9]"
          >
            Go to my groups
          </Link>
        </div>
      </main>
    );
  }

  // Check if already a member
  const { data: existingMember } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", group.id)
    .eq("user_id", user.id)
    .single();

  const isAlreadyMember = !!existingMember;

  // Get member count
  const { count: memberCount } = await supabase
    .from("group_members")
    .select("group_id", { count: "exact", head: true })
    .eq("group_id", group.id);

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
                Sabay Sablay
              </span>
            </div>
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
      </div>

      {/* Join Card */}
      <div className="mx-auto max-w-3xl px-6 py-16 md:px-10">
        <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-8 text-center shadow-card md:p-12">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#C9B9E9] text-[#34264F]">
            <Users size={24} />
          </div>

          <h1 className="mt-6 font-display text-2xl font-semibold text-[#214746]">
            {isAlreadyMember ? "You're already in" : "You've been invited to"}
          </h1>
          <h2 className="mt-1 font-display text-3xl font-bold text-[#214746]">
            {group.name}
          </h2>

          {group.description && (
            <p className="mx-auto mt-3 max-w-md text-sm text-[#717972]">
              {group.description}
            </p>
          )}

          <div className="mx-auto mt-5 flex items-center justify-center gap-2 text-xs text-[#87908A]">
            <Users size={14} />
            <span>
              {memberCount ?? 0} {(memberCount ?? 0) === 1 ? "member" : "members"} so far
            </span>
          </div>

          {isAlreadyMember ? (
            <div className="mt-8 space-y-3">
              <Link
                href={`/groups/${group.id}`}
                className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-6 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5"
              >
                Go to group
              </Link>
              <div>
                <Link
                  href="/groups"
                  className="text-xs font-semibold text-[#87908A] hover:text-[#214746]"
                >
                  Back to my groups
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              <form action={async () => { "use server"; await handleJoin(code); }}>
                <SubmitButton
                  icon={<Users size={16} />}
                  pendingChildren="Joining..."
                  className="inline-flex items-center gap-2 rounded-xl bg-[#F4A28C] px-6 py-3 text-sm font-semibold text-[#512E2B] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:translate-y-0"
                >
                  Join {group.name}
                </SubmitButton>
              </form>
              <div>
                <Link
                  href="/groups"
                  className="text-xs font-semibold text-[#87908A] hover:text-[#214746]"
                >
                  Maybe later
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
