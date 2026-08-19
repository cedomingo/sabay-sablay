import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LayoutGrid, LogOut, Bell, CheckCheck, Trash2, ArrowLeft } from "lucide-react";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  clearReadNotifications,
} from "@/lib/actions/notifications";
import Link from "next/link";

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

async function handleMarkAllRead() {
  "use server";
  await markAllAsRead();
  revalidatePath("/notifications");
}

async function handleClearRead() {
  "use server";
  await clearReadNotifications();
  revalidatePath("/notifications");
}

async function handleMarkSingleRead(id: string) {
  "use server";
  await markAsRead(id);
  revalidatePath("/notifications");
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

export default async function NotificationsPage() {
  const notifications = await getNotifications();
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
        <div className="mx-auto max-w-3xl relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
                <LayoutGrid size={18} />
              </div>
              <span className="font-display text-sm font-bold tracking-tight">
                Schedule Planner
              </span>
            </div>
            <form action={handleSignOut}>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </form>
          </div>

          <div className="mt-6">
            <Link
              href="/schedule"
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#A9D8CA] hover:text-[#F4F1E9]"
            >
              <ArrowLeft size={14} />
              Back to schedule
            </Link>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                  Notifications
                </h1>
                {unreadCount > 0 && (
                  <p className="mt-1 text-sm text-[#D3E5DC]">
                    {unreadCount} unread
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <form action={handleMarkAllRead}>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
                    >
                      <CheckCheck size={13} />
                      Mark all read
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
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
                  className={`flex items-start gap-3 px-5 py-4 ${
                    !notification.read ? "bg-[#F4F1E9]/60" : ""
                  }`}
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
                        notification.read
                          ? "text-[#87908A]"
                          : "text-[#214746]"
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
                      <form action={async () => { "use server"; await handleMarkSingleRead(notification.id); }}>
                        <button
                          type="submit"
                          className="grid h-7 w-7 place-items-center rounded-lg text-[#56B9AC] hover:bg-[#E7EBE5]"
                          title="Mark as read"
                        >
                          <CheckCheck size={13} />
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            {notifications.some((n) => n.read) && (
              <div className="border-t border-[#D8D6CD] px-5 py-3">
                <form action={handleClearRead}>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#87908A] hover:text-[#A14D3F]"
                  >
                    <Trash2 size={12} />
                    Clear read notifications
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
