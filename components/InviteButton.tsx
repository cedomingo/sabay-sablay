"use client";

import { useState } from "react";
import { UserPlus, Check } from "lucide-react";
import { toast } from "@/lib/toast";

interface InviteButtonProps {
  inviteCode: string;
  className?: string;
}

/**
 * Copies a shareable join link to the clipboard. Never navigates —
 * gives instant feedback (label flips to "Copied!" + a success toast,
 * matching the pattern used elsewhere in the app for optimistic
 * client-side feedback).
 */
export default function InviteButton({
  inviteCode,
  className,
}: InviteButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const joinUrl = `${window.location.origin}/join/${inviteCode}`;

    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch {
      toast.error("Couldn't copy the invite link. Please try again.");
      return;
    }

    setCopied(true);
    toast.success("Invite link copied!");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ??
        "mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#B9BDB4] px-4 py-2.5 text-xs font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
      }
    >
      {copied ? <Check size={14} /> : <UserPlus size={14} />}
      {copied ? "Copied!" : "Invite people"}
    </button>
  );
}
