import { getNotifications } from "@/lib/actions/notifications";
import AppHeader from "@/components/AppHeader";
import NotificationsList from "./NotificationsList";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function NotificationsPage() {
  const notifications = await getNotifications();

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      <AppHeader
        maxWidth="max-w-3xl"
        showNotificationBell={false}
        subtitle={
          <Link
            href="/schedule"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#A9D8CA] hover:text-[#F4F1E9]"
          >
            <ArrowLeft size={14} />
            Back to schedule
          </Link>
        }
        title={
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            Notifications
          </h1>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
        <NotificationsList initialNotifications={notifications} />
      </div>
    </main>
  );
}
