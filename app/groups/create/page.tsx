"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, ArrowLeft, Check, Users } from "lucide-react";
import { createGroup } from "@/lib/actions/group";

export default function CreateGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
        <div className="mx-auto max-w-3xl relative z-10">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
              <LayoutGrid size={18} />
            </div>
            <span className="font-display text-sm font-bold tracking-tight">
              Schedule Planner
            </span>
          </div>
          <div className="mt-6">
            <button
              onClick={() => router.push("/groups")}
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#A9D8CA] hover:text-[#F4F1E9]"
            >
              <ArrowLeft size={14} />
              Back to groups
            </button>
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight md:text-3xl">
              Create a group
            </h1>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        <form onSubmit={handleSubmit}>
          <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#C9B9E9] text-[#34264F]">
                <Users size={20} />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold text-[#214746]">
                  Group details
                </h2>
                <p className="mt-1 text-sm text-[#717972]">
                  Give your group a name so members know which schedule view
                  they&apos;re looking at.
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-5">
              {/* Group Name */}
              <div>
                <label
                  htmlFor="name"
                  className="mb-1.5 block text-xs font-semibold text-[#52605C]"
                >
                  Group name <span className="text-[#F4A28C]">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. BS CS 2-A Block"
                  className="w-full rounded-xl border border-[#C8C6BD] bg-[#F4F1E9] px-4 py-3 text-sm outline-none placeholder:text-[#9AA19B] focus:border-[#56B9AC]"
                  maxLength={100}
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="description"
                  className="mb-1.5 block text-xs font-semibold text-[#52605C]"
                >
                  Description{" "}
                  <span className="text-[#87908A]">(optional)</span>
                </label>
                <textarea
                  id="description"
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
                onClick={() => router.push("/groups")}
                className="rounded-xl border border-[#B9BDB4] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
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
          </div>
        </form>
      </div>
    </main>
  );
}
