"use client";

import { useState, useEffect, useRef } from "react";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  clearReadNotifications,
  type Notification,
} from "@/lib/actions/notifications";
import { toast } from "@/lib/toast";

interface NotificationBellProps {
  initialCount?: number;
}

export default function NotificationBell({ initialCount = 0 }: NotificationBellProps) {
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  // Fetch notifications when opened
  useEffect(() => {
    if (open && notifications.length === 0) {
      setLoading(true);
      getNotifications()
        .then((data) => setNotifications(data))
        .catch(() => toast.error("Couldn't load notifications."))
        .finally(() => setLoading(false));
    }
  }, [open]);

  // Refresh count periodically
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const newCount = await getUnreadCount();
        setCount(newCount);
      } catch {
        // silent — periodic refresh, not user-initiated
      }
    }, 30000); // every 30 seconds
    return () => clearInterval(interval);
  }, []);

  function handleToggle() {
    // Flip instantly; the panel renders right away regardless of network.
    setOpen((prev) => !prev);
  }

  async function handleMarkRead(id: string) {
    const previousNotifications = notifications;
    const previousCount = count;

    // Instant optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setCount((prev) => Math.max(0, prev - 1));

    try {
      await markAsRead(id);
    } catch (err) {
      console.error(err);
      setNotifications(previousNotifications);
      setCount(previousCount);
      toast.error("Couldn't mark that as read.");
    }
  }

  async function handleMarkAllRead() {
    const previousNotifications = notifications;
    const previousCount = count;

    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setCount(0);

    try {
      await markAllAsRead();
    } catch (err) {
      console.error(err);
      setNotifications(previousNotifications);
      setCount(previousCount);
      toast.error("Couldn't mark all as read.");
    }
  }

  async function handleClearRead() {
    const previousNotifications = notifications;
    setNotifications((prev) => prev.filter((n) => !n.read));

    try {
      await clearReadNotifications();
    } catch (err) {
      console.error(err);
      setNotifications(previousNotifications);
      toast.error("Couldn't clear read notifications.");
    }
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
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const readCount = notifications.filter((n) => n.read).length;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="relative grid h-9 w-9 place-items-center rounded-xl border border-[#A9D8CA]/30 text-[#A9D8CA] hover:bg-[#2B5855] transition-colors"
        title="Notifications"
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-[#F4A28C] px-1 text-[9px] font-bold text-[#512E2B]">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 w-[380px] max-h-[480px] overflow-hidden rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] shadow-elevated"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#D8D6CD] px-5 py-4">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-[#214746]" />
              <h3 className="font-display text-sm font-semibold text-[#214746]">
                Notifications
              </h3>
              {count > 0 && (
                <span className="rounded-full bg-[#F4A28C] px-2 py-0.5 text-[10px] font-bold text-[#512E2B]">
                  {count} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {count > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-[#56B9AC] hover:bg-[#E7EBE5]"
                >
                  <CheckCheck size={11} />
                  Read all
                </button>
              )}
              {readCount > 0 && (
                <button
                  onClick={handleClearRead}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-[#87908A] hover:bg-[#E7EBE5]"
                >
                  <Trash2 size={10} />
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[380px]">
            {loading ? (
              <div className="px-5 py-8 text-center">
                <p className="text-xs text-[#87908A]">Loading...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-[#87908A]">No notifications</p>
                <p className="mt-1 text-xs text-[#B9BDB4]">
                  You&apos;ll see task reminders here
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#E1DFD7]">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`flex items-start gap-3 px-5 py-3.5 transition-colors ${
                      notification.read ? "opacity-60" : "bg-[#F4F1E9]/60"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {!notification.read ? (
                        <span className="block h-2 w-2 rounded-full bg-[#F4A28C]" />
                      ) : (
                        <span className="block h-2 w-2" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-relaxed text-[#214746]">
                        {notification.message}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-[#B9BDB4]">
                        {formatTime(notification.created_at)}
                      </p>
                    </div>
                    {!notification.read && (
                      <button
                        onClick={() => handleMarkRead(notification.id)}
                        className="shrink-0 grid h-6 w-6 place-items-center rounded-lg text-[#56B9AC] hover:bg-[#E7EBE5]"
                        title="Mark as read"
                      >
                        <Check size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-[#D8D6CD] px-5 py-3">
              <a
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-center text-xs font-semibold text-[#56B9AC] hover:text-[#214746]"
              >
                View all notifications
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
