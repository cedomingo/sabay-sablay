import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LayoutGrid, LogOut, ArrowLeft } from "lucide-react";
import { getNotifications } from "@/lib/actions/notifications";
import Link from "next/link";
import SubmitButton from "@/components/SubmitButton";
import NotificationsList from "./NotificationsList";

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

export default async function NotificationsPage() {
  const notifications = await getNotifications();

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
              <SubmitButton
                icon={<LogOut size={14} />}
                pendingChildren="Signing out..."
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855] disabled:opacity-60"
              >
                Sign out
              </SubmitButton>
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
            <div className="mt-3">
              <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                Notifications
              </h1>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
        <NotificationsList initialNotifications={notifications} />
      </div>
    </main>
  );
}
