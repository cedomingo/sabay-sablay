"use client";

export type ToastVariant = "error" | "success" | "info";

export interface ToastDetail {
  message: string;
  variant: ToastVariant;
}

const EVENT_NAME = "app:toast";

function emit(message: string, variant: ToastVariant) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(EVENT_NAME, { detail: { message, variant } })
  );
}

export const toast = {
  error: (message: string) => emit(message, "error"),
  success: (message: string) => emit(message, "success"),
  info: (message: string) => emit(message, "info"),
};

export const TOAST_EVENT_NAME = EVENT_NAME;
