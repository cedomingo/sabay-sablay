"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { updateDisplayName } from "@/lib/actions/profile";
import { toast } from "@/lib/toast";

export default function EditableName({ initialName }: { initialName: string }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError("Name can't be empty");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { full_name } = await updateDisplayName(name);
      setSavedName(full_name);
      setName(full_name);
      setEditing(false);
      toast.success("Name updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update name");
    } finally {
      setLoading(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#214746] md:text-3xl">
          {savedName || "Your name"}
        </h1>
        <button
          onClick={() => {
            setName(savedName);
            setError(null);
            setEditing(true);
          }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
          title="Edit name"
        >
          <Pencil size={14} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") {
              setName(savedName);
              setError(null);
              setEditing(false);
            }
          }}
          maxLength={80}
          className="w-full max-w-xs rounded-xl border border-[#C8C6BD] bg-white px-3 py-2 text-lg font-semibold text-[#214746] outline-none focus:border-[#56B9AC]"
        />
        <button
          onClick={handleSave}
          disabled={loading}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#214746] text-[#F4F1E9] hover:bg-[#2B5855] disabled:opacity-60"
          title="Save"
        >
          {loading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#F4F1E9] border-t-transparent" />
          ) : (
            <Check size={14} />
          )}
        </button>
        <button
          onClick={() => {
            setName(savedName);
            setError(null);
            setEditing(false);
          }}
          disabled={loading}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#B9BDB4] text-[#52605C] hover:bg-[#E7EBE5] disabled:opacity-60"
          title="Cancel"
        >
          <X size={14} />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[#A14D3F]">{error}</p>}
    </div>
  );
}
