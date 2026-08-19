import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { joinGroup } from "@/lib/actions/group";
import Link from "next/link";
import SubmitButton from "@/components/SubmitButton";
import AppHeader from "@/components/AppHeader";
import type { Metadata } from "next";

async function handleJoin(code: string) {
  "use server";
  await joinGroup(code);
}

/**
 * Dynamic link-preview metadata for a shared invite link. Looks up the
 * group (and its owner's/inviter's display name) by invite code, so a
 * crawler/unauthenticated fetch of `/join/[code]` gets a real per-invite
 * preview ("<Inviter> has invited you to join <Group>") instead of the
 * app-wide defaults. Falls back gracefully if the code doesn't resolve.
 */
export async function generateMetadata({
  params,
}: {
  params: { code: string };
}): Promise<Metadata> {
  const { code } = params;

  // Link-preview crawlers hit this route unauthenticated, so the
  // session-bound client (and the `authenticated`-only invite RPC) can't
  // be used here. This is read-only, public-facing invite info (group
  // name + inviter's display name) — the same trust boundary as the
  // rendered page below — so the service-role admin client is the right
  // tool, bypassing RLS deliberately rather than duplicating a second
  // "public" RPC just for metadata.
  const admin = createAdminClient();

  const { data: group } = await admin
    .from("groups")
    .select("name, description, owner_id")
    .eq("invite_code", code)
    .single();

  if (!group) {
    return {
      title: "Invite | Sabay Sablay",
      description: "Join a group on Sabay Sablay to track schedules together.",
    };
  }

  const { data: ownerProfile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", group.owner_id)
    .single();

  const inviterName = ownerProfile?.full_name || "Someone";
  const title = `${inviterName} has invited you to join ${group.name}`;
  const description = "Let's track our schedules together!";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
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
        <AppHeader maxWidth="max-w-3xl" showNotificationBell={false} />

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
      <AppHeader maxWidth="max-w-3xl" showNotificationBell={false} />

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
