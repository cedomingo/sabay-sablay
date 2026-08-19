"use client";

import { useState } from "react";
import { Plus, X, Check, Users } from "lucide-react";
import { createGroup } from "@/lib/actions/group";

interface CreateGroupModalProps {
  /** "button" renders the compact header pill; "empty-state" renders the larger CTA used on the empty /groups screen. */
  variant?: "button" | "empty-state";
}

function isRedirectError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export default function CreateGroupModal({ variant = "button" }: CreateGroupModalProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      setError("Group name is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      // createGroup redirects on success (thrown NEXT_REDIRECT, rethrown
      // below) — nothing else to do if we somehow get here.
    } catch (err) {
      if (isRedirectError(err)) throw err;
      setError(err instanceof Error ? err.message : "Failed to create group");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === "button"
            ? "inline-flex items-center gap-2 rounded-xl bg-[#F4A28C] px-4 py-2.5 text-sm font-semibold text-[#512E2B] transition-transform hover:-translate-y-0.5"
            : "inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5"
        }
      >
        <Plus size={16} />
        {variant === "button" ? "New group" : "Create a group"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
          onClick={() => {
            if (loading) return;
            setOpen(false);
            reset();
          }}
        >
          <div
            className="w-full max-w-lg rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 shadow-elevated md:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#C9B9E9] text-[#34264F]">
                  <Users size={20} />
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold text-[#214746]">
                    Create a group
                  </h2>
                  <p className="mt-1 text-sm text-[#717972]">
                    Give your group a name so members know which schedule
                    view they&apos;re looking at.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (loading) return;
                  setOpen(false);
                  reset();
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-6">
              <div className="space-y-5">
                <div>
                  <label
                    htmlFor="modal-group-name"
                    className="mb-1.5 block text-xs font-semibold text-[#52605C]"
                  >
                    Group name <span className="text-[#F4A28C]">*</span>
                  </label>
                  <input
                    id="modal-group-name"
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. BS CS 2-A Block"
                    className="w-full rounded-xl border border-[#C8C6BD] bg-[#F4F1E9] px-4 py-3 text-sm outline-none placeholder:text-[#9AA19B] focus:border-[#56B9AC]"
                    maxLength={100}
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="modal-group-description"
                    className="mb-1.5 block text-xs font-semibold text-[#52605C]"
                  >
                    Description <span className="text-[#87908A]">(optional)</span>
                  </label>
                  <textarea
                    id="modal-group-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What's this group for?"
                    rows={3}
                    className="w-full rounded-xl border border-[#C8C6BD] bg-[#F4F1E9] px-4 py-3 text-sm outline-none placeholder:text-[#9AA19B] focus:border-[#56B9AC] resize-none"
                    maxLength={300}
                  />
                </div>
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-[#C77A68] bg-[#FCE9E3] px-4 py-3 text-xs text-[#A14D3F]">
                  {error}
                </div>
              )}

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                  className="rounded-xl border border-[#B9BDB4] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5] disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-6 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                >
                  {loading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#F4F1E9] border-t-transparent" />
                  ) : (
                    <Check size={16} />
                  )}
                  Create group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
