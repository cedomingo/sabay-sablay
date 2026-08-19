"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toggleEntryHidden } from "@/lib/actions/schedule";

interface PrivacyToggleProps {
  entryId: string;
  initialHidden: boolean;
}

export default function PrivacyToggle({ entryId, initialHidden }: PrivacyToggleProps) {
  const [hidden, setHidden] = useState(initialHidden);
  const [loading, setLoading] = useState(false);

  async function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (loading) return;

    setLoading(true);
    try {
      const result = await toggleEntryHidden(entryId);
      setHidden(result.hidden);
    } catch (err) {
      console.error("Toggle error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded transition-colors ${
        hidden
          ? "text-[#C77A68] hover:bg-[#FCE9E3]"
          : "text-[#87908A] hover:bg-[#E7EBE5] opacity-0 group-hover:opacity-100"
      }`}
      title={hidden ? "Show in group views" : "Hide from group views"}
    >
      {hidden ? <EyeOff size={10} /> : <Eye size={10} />}
    </button>
  );
}
