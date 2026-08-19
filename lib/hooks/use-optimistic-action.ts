"use client";

import { useCallback, useState } from "react";
import { toast } from "@/lib/toast";

/**
 * Shared pattern for optimistic updates across the app:
 *
 *   const { run, pendingIds } = useOptimisticAction(setLocalState);
 *
 *   run({
 *     apply: (prev) => prev.map(...),      // instant local update
 *     revert: (prev) => prev,              // (optional) rollback state; defaults to snapshot before apply
 *     action: () => someServerAction(...), // the actual network call
 *     id: task.id,                         // (optional) tracked in pendingIds for per-row spinners
 *     errorMessage: "Couldn't save that.", // shown via toast on failure
 *   });
 *
 * The local state updates immediately on click. If the server action
 * throws, the state is rolled back and an error toast is shown.
 */
export function useOptimisticAction<T>(setState: React.Dispatch<React.SetStateAction<T>>) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const run = useCallback(
    async <R,>(opts: {
      apply: (prev: T) => T;
      action: () => Promise<R>;
      revert?: (prev: T) => T;
      id?: string;
      errorMessage?: string;
      onSuccess?: (result: R) => void;
    }) => {
      let snapshot: T | undefined;

      setState((prev) => {
        snapshot = prev;
        return opts.apply(prev);
      });

      if (opts.id) {
        setPendingIds((prev) => new Set(prev).add(opts.id!));
      }

      try {
        const result = await opts.action();
        opts.onSuccess?.(result);
        return result;
      } catch (err) {
        console.error(err);
        setState((prev) => (opts.revert ? opts.revert(prev) : snapshot ?? prev));
        toast.error(opts.errorMessage || "Something went wrong. Please try again.");
        return undefined;
      } finally {
        if (opts.id) {
          setPendingIds((prev) => {
            const next = new Set(prev);
            next.delete(opts.id!);
            return next;
          });
        }
      }
    },
    [setState]
  );

  return { run, pendingIds };
}

/**
 * Simplified helper for a single boolean/enum toggle with instant flip
 * and rollback on failure — e.g. privacy toggles, read/unread flags.
 */
export function useOptimisticToggle<T>(
  value: T,
  setValue: (v: T) => void,
  errorMessage?: string
) {
  const [pending, setPending] = useState(false);

  const toggle = useCallback(
    async (nextValue: T, action: () => Promise<unknown>) => {
      const previous = value;
      setValue(nextValue);
      setPending(true);
      try {
        await action();
      } catch (err) {
        console.error(err);
        setValue(previous);
        toast.error(errorMessage || "Couldn't save that change.");
      } finally {
        setPending(false);
      }
    },
    [value, setValue, errorMessage]
  );

  return { toggle, pending };
}
