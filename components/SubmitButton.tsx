"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

interface SubmitButtonProps {
  children: ReactNode;
  pendingChildren?: ReactNode;
  className?: string;
  icon?: ReactNode;
}

/**
 * Drop-in replacement for <button type="submit"> inside a native
 * <form action={serverAction}>. Shows an instant pending state
 * (spinner + disabled) the moment the form is submitted, before the
 * network round trip completes — no client component wiring needed
 * around the form itself.
 */
export default function SubmitButton({
  children,
  pendingChildren,
  className,
  icon,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          {pendingChildren ?? children}
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}
