"use client";

import { useState } from "react";
import { Check, Pencil } from "lucide-react";
import { updateGroup } from "@/lib/actions/group";

interface GroupInfoFormProps {
  groupId: string;
  initialName: string;
  initialDescription: string | null;
  isOwner: boolean;
}

export default function GroupInfoForm({
  groupId,
  initialName,
  initialDescription,
  isOwner,
}: GroupInfoFormProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription || "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError("Group name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateGroup(groupId, {
        name: name.trim(),
        description: description.trim() || null,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  if (!isOwner) {
    return (
      <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
          Group info
        </p>
        <p className="mt-2 text-sm font-semibold text-[#214746]">{initialName}</p>
        {initialDescription && (
          <p className="mt-1 text-sm text-[#717972]">{initialDescription}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
          Group info
        </p>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
          >
            <Pencil size={12} />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[#52605C]">
              Group name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-[#C8C6BD] bg-[#F4F1E9] px-4 py-2.5 text-sm text-[#214746] outline-none placeholder:text-[#9AA19B] focus:border-[#56B9AC]"
              maxLength={100}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[#52605C]">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this group for?"
              rows={3}
              className="w-full rounded-xl border border-[#C8C6BD] bg-[#F4F1E9] px-4 py-2.5 text-sm text-[#214746] outline-none placeholder:text-[#9AA19B] focus:border-[#56B9AC] resize-none"
              maxLength={300}
            />
          </div>
          {error && (
            <div className="rounded-xl border border-[#C77A68] bg-[#FCE9E3] px-3 py-2 text-xs text-[#A14D3F]">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditing(false);
                setName(initialName);
                setDescription(initialDescription || "");
                setError(null);
              }}
              disabled={saving}
              className="rounded-xl border border-[#B9BDB4] px-4 py-2 text-xs font-semibold text-[#52605C] hover:bg-[#E7EBE5] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#214746] px-4 py-2 text-xs font-semibold text-[#F4F1E9] transition-colors hover:bg-[#2B5855] disabled:opacity-60"
            >
              {saving ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#F4F1E9] border-t-transparent" />
              ) : (
                <Check size={12} />
              )}
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-sm font-semibold text-[#214746]">{initialName}</p>
          {initialDescription && (
            <p className="mt-1 text-sm text-[#717972]">{initialDescription}</p>
          )}
        </div>
      )}
    </div>
  );
}
