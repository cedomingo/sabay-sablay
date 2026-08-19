"use client";

import { useState } from "react";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  markAsRead,
  markAllAsRead,
  clearReadNotifications,
  type Notification,
} from "@/lib/actions/notifications";
import { useOptimisticAction } from "@/lib/hooks/use-optimistic-action";

interface NotificationsListProps {
  initialNotifications: Notification[];
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NotificationsList({
  initialNotifications,
}: NotificationsListProps) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const { run, pendingIds } = useOptimisticAction<Notification[]>(setNotifications);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const hasRead = notifications.some((n) => n.read);

  async function handleMarkRead(id: string) {
    await run({
      id,
      apply: (prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      action: () => markAsRead(id),
      errorMessage: "Couldn't mark that as read.",
    });
  }

  async function handleMarkAllRead() {
    await run({
      apply: (prev) => prev.map((n) => ({ ...n, read: true })),
      action: () => markAllAsRead(),
      errorMessage: "Couldn't mark all as read.",
    });
  }

  async function handleClearRead() {
    await run({
      apply: (prev) => prev.filter((n) => !n.read),
      action: () => clearReadNotifications(),
      errorMessage: "Couldn't clear read notifications.",
    });
  }

  return (
    <>
      {unreadCount > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-[#717972]">
            {unreadCount} unread
          </p>
          <button
            onClick={handleMarkAllRead}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#C8C6BD] px-3 py-2 text-xs font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
          >
            <CheckCheck size={13} />
            Mark all read
          </button>
        </div>
      )}

      {notifications.length === 0 ? (
        <div className="paper-grid rounded-[22px] border border-[#D0CEC4] p-12 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#D9E7DE] text-[#286057]">
            <Bell size={24} />
          </div>
          <h2 className="mt-6 font-display text-xl font-semibold text-[#214746]">
            No notifications
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#717972]">
            When tasks approach their due dates, you&apos;ll see reminders here.
          </p>
        </div>
      ) : (
        <div className="rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
          <div className="divide-y divide-[#E1DFD7]">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`flex items-start gap-3 px-5 py-4 transition-opacity ${
                  !notification.read ? "bg-[#F4F1E9]/60" : ""
                } ${pendingIds.has(notification.id) ? "opacity-60" : ""}`}
              >
                {/* Unread dot */}
                <div className="mt-1 shrink-0">
                  {!notification.read ? (
                    <span className="block h-2.5 w-2.5 rounded-full bg-[#F4A28C]" />
                  ) : (
                    <span className="block h-2.5 w-2.5" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm leading-relaxed ${
                      notification.read ? "text-[#87908A]" : "text-[#214746]"
                    }`}
                  >
                    {notification.message}
                  </p>
                  <div className="mt-1.5 flex items-center gap-3">
                    <p className="font-mono text-[10px] text-[#B9BDB4]">
                      {formatTime(notification.created_at)}
                    </p>
                    {notification.link && (
                      <Link
                        href={notification.link}
                        className="text-[10px] font-semibold text-[#56B9AC] hover:text-[#214746]"
                      >
                        View →
                      </Link>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="shrink-0 flex items-center gap-1">
                  {!notification.read && (
                    <button
                      onClick={() => handleMarkRead(notification.id)}
                      className="grid h-7 w-7 place-items-center rounded-lg text-[#56B9AC] hover:bg-[#E7EBE5]"
                      title="Mark as read"
                    >
                      <CheckCheck size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          {hasRead && (
            <div className="border-t border-[#D8D6CD] px-5 py-3">
              <button
                onClick={handleClearRead}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#87908A] hover:text-[#A14D3F]"
              >
                <Trash2 size={12} />
                Clear read notifications
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
