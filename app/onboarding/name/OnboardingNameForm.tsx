"use client";

import { useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { completeOnboarding } from "@/lib/actions/profile";

interface OnboardingNameFormProps {
  initialName: string;
  next?: string;
}

export default function OnboardingNameForm({
  initialName,
  next,
}: OnboardingNameFormProps) {
  const [name, setName] = useState(initialName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      setError("Please tell us what to call you");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await completeOnboarding(name, next);
      // completeOnboarding redirects on success — if we get here without
      // a redirect being thrown, there's nothing further to do.
    } catch (err) {
      // Next's redirect() surfaces as a thrown error with a special
      // digest — let that keep propagating so navigation still happens.
      if (
        err &&
        typeof err === "object" &&
        "digest" in err &&
        typeof (err as { digest?: unknown }).digest === "string" &&
        (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
      ) {
        throw err;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8">
      <label
        htmlFor="display-name"
        className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-[#A9D8CA]"
      >
        Your name
      </label>
      <input
        id="display-name"
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Sam Cruz"
        maxLength={80}
        className="w-full rounded-xl border border-[#3E6C68] bg-[#214746] px-4 py-3.5 text-sm text-[#F4F1E9] outline-none placeholder:text-[#7FA79E] focus:border-[#56B9AC]"
      />

      {error && (
        <div className="mt-4 rounded-xl border border-[#C77A68] bg-[#FCE9E3] px-4 py-3 text-xs text-[#A14D3F]">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#F4F1E9] px-5 py-3.5 text-sm font-semibold text-[#214746] transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#214746] border-t-transparent" />
        ) : (
          <Check size={16} />
        )}
        {loading ? "Saving…" : "Continue"}
      </button>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-[#A9D8CA]">
        Next up: uploading your timetable
        <ArrowRight size={12} />
      </p>
    </form>
  );
}
