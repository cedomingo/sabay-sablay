import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LayoutGrid, LogOut, Users, ListChecks, CalendarDays } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import { getPersonalTasks } from "@/lib/actions/tasks";
import CalendarView from "./CalendarView";
import Link from "next/link";

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

export default async function CalendarPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const tasks = await getPersonalTasks();

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
        <div className="mx-auto max-w-6xl relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
                <LayoutGrid size={18} />
              </div>
              <span className="font-display text-sm font-bold tracking-tight">
                Schedule Planner
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/schedule"
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                My schedule
              </Link>
              <Link
                href="/tasks"
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                <ListChecks size={14} />
                Tasks
              </Link>
              <Link
                href="/groups"
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                <Users size={14} />
                My groups
              </Link>
              <NotificationBell />
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
          </div>

          <div className="mt-6">
            <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#A9D8CA]">
              Personal
            </p>
            <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold tracking-tight md:text-3xl">
              <CalendarDays size={24} />
              Calendar
            </h1>
          </div>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
        <CalendarView initialTasks={tasks} />
      </div>
    </main>
  );
}
