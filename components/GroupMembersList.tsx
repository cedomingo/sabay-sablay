"use client";

import { useState } from "react";
import { UserMinus } from "lucide-react";
import { removeMember, type GroupMember } from "@/lib/actions/group";
import { useOptimisticAction } from "@/lib/hooks/use-optimistic-action";

interface PresenceInfo {
  inClass: boolean;
  subject: string | null;
}

interface GroupMembersListProps {
  groupId: string;
  initialMembers: GroupMember[];
  currentUserId: string;
  isOwner: boolean;
  presence: Record<string, PresenceInfo>;
}

export default function GroupMembersList({
  groupId,
  initialMembers,
  currentUserId,
  isOwner,
  presence,
}: GroupMembersListProps) {
  const [members, setMembers] = useState(initialMembers);
  const { run, pendingIds } = useOptimisticAction<GroupMember[]>(setMembers);

  async function handleRemove(userId: string) {
    await run({
      id: userId,
      apply: (prev) => prev.filter((m) => m.user_id !== userId),
      action: () => removeMember(groupId, userId),
      errorMessage: "Couldn't remove that member.",
    });
  }

  return (
    <div className="divide-y divide-[#E1DFD7]">
      {members.map((member) => {
        const fullName = member.profiles?.full_name || "Unknown";
        const initials = fullName
          .split(" ")
          .map((n) => n[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
        const isSelf = member.user_id === currentUserId;
        const isMemberOwner = member.role === "owner";
        const memberPresence = presence[member.user_id];

        return (
          <div
            key={member.user_id}
            className={`flex items-center justify-between px-5 py-3.5 transition-opacity ${
              pendingIds.has(member.user_id) ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <div
                  className={`grid h-9 w-9 place-items-center rounded-full text-xs font-bold ${
                    memberPresence?.inClass
                      ? "bg-[#F4A28C] text-[#512E2B]"
                      : "bg-[#8DDDD0] text-[#163D3A]"
                  }`}
                >
                  {initials}
                </div>
                {/* Presence indicator dot */}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#F8F6F0] ${
                    memberPresence?.inClass ? "bg-[#DC7C66]" : "bg-[#56B9AC]"
                  }`}
                  title={
                    memberPresence?.inClass
                      ? `In class: ${memberPresence?.subject}`
                      : "Free now"
                  }
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#214746]">
                  {fullName}
                  {isSelf && (
                    <span className="ml-1.5 text-xs font-normal text-[#87908A]">
                      (you)
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-1.5">
                  {memberPresence?.inClass ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#A45D42]">
                      In class: {memberPresence?.subject}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#286057]">
                      Free now
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isMemberOwner && (
                <span className="rounded-full bg-[#D9E7DE] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#286057]">
                  Owner
                </span>
              )}

              {/* Owner can remove other members */}
              {isOwner && !isSelf && !isMemberOwner && (
                <button
                  onClick={() => handleRemove(member.user_id)}
                  disabled={pendingIds.has(member.user_id)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-[#C77A68] hover:bg-[#FCE9E3] disabled:opacity-60"
                  title="Remove member"
                >
                  <UserMinus size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
