"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { TOAST_EVENT_NAME, type ToastDetail } from "@/lib/toast";

interface ActiveToast extends ToastDetail {
  id: number;
}

let nextId = 1;

export default function Toast() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);

  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      const id = nextId++;
      setToasts((prev) => [...prev, { ...detail, id }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    }
    window.addEventListener(TOAST_EVENT_NAME, handle);
    return () => window.removeEventListener(TOAST_EVENT_NAME, handle);
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-4 py-3 shadow-elevated ${
            t.variant === "error"
              ? "border-[#E3B4A8] bg-[#FCE9E3] text-[#7A2E20]"
              : t.variant === "success"
              ? "border-[#9FD3C2] bg-[#E4F3EC] text-[#1D4B3B]"
              : "border-[#C8C6BD] bg-[#F8F6F0] text-[#214746]"
          }`}
        >
          {t.variant === "error" ? (
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
          ) : t.variant === "success" ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={16} className="mt-0.5 shrink-0" />
          )}
          <p className="flex-1 text-sm leading-snug">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded-lg p-0.5 opacity-60 hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
