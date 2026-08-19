"use client";

import { useState, useEffect } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

interface CreatedGroupOverlayProps {
  groupName: string;
  inviteCode: string;
  groupId: string;
}

export default function CreatedGroupOverlay({
  groupName,
  inviteCode,
  groupId,
}: CreatedGroupOverlayProps) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  // Trigger the entrance animation after mount
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 50);
    return () => clearTimeout(t);
  }, []);

  async function handleCopyInvite() {
    const url = `${window.location.origin}/join/${inviteCode}`;
    const text = `Let's track our schedules together!\n\nSomeone has invited you to join ${groupName}\n\n${url}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDismiss() {
    setShow(false);
    // Clean the query param from the URL without reload
    window.history.replaceState({}, "", `/groups/${groupId}`);
  }

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 transition-opacity"
      onClick={handleDismiss}
    >
      <div
        className="w-full max-w-md rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-8 text-center shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#8DDDD0] text-[#163D3A]">
          <Check size={28} />
        </div>
        <h2 className="mt-4 font-display text-2xl font-semibold text-[#214746]">
          Created Group {groupName}!
        </h2>
        <p className="mt-2 text-sm text-[#717972]">
          Copy the link to invite your friends below:
        </p>

        {/* Invite Link */}
        <div className="mt-6 rounded-xl border border-[#C8C6BD] bg-[#F4F1E9] p-4">
          <div className="flex items-center gap-2 text-xs text-[#87908A]">
            <Copy size={12} />
            <span>Invite link</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-[#D0CEC4] bg-white px-3 py-2.5 font-mono text-sm font-bold text-[#214746]">
              {window.location.origin}/join/{inviteCode}
            </code>
            <button
              onClick={handleCopyInvite}
              className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-4 py-2.5 text-sm font-semibold text-[#F4F1E9] transition-colors hover:bg-[#2B5855]"
            >
              {copied ? (
                <>
                  <Check size={14} />
                  Copied!
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#F4A28C] px-6 py-3 text-sm font-semibold text-[#512E2B] transition-transform hover:-translate-y-0.5"
        >
          <ExternalLink size={14} />
          Continue to group
        </button>
      </div>
    </div>
  );
}
