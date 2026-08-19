"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toggleEntryHidden } from "@/lib/actions/schedule";
import { useOptimisticToggle } from "@/lib/hooks/use-optimistic-action";

interface PrivacyToggleProps {
  entryId: string;
  initialHidden: boolean;
}

export default function PrivacyToggle({ entryId, initialHidden }: PrivacyToggleProps) {
  const [hidden, setHidden] = useState(initialHidden);
  const { toggle, pending } = useOptimisticToggle(
    hidden,
    setHidden,
    "Couldn't update visibility. Please try again."
  );

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    toggle(!hidden, () => toggleEntryHidden(entryId));
  }

  return (
    <button
      onClick={handleToggle}
      disabled={pending}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded transition-colors disabled:opacity-60 ${
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
