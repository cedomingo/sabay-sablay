import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LayoutGrid, LogOut, Users, ListChecks, CalendarDays } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import { getPersonalTasks, getTaskStreak } from "@/lib/actions/tasks";
import TaskBoard from "./TaskBoard";
import Link from "next/link";

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

export default async function TasksPage() {
  const [tasks, streak] = await Promise.all([
    getPersonalTasks(),
    getTaskStreak(),
  ]);

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
        <div className="mx-auto max-w-4xl relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
                <LayoutGrid size={18} />
              </div>
              <span className="font-display text-sm font-bold tracking-tight">
                Sabay Sablay
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
                href="/schedule?tab=calendar"
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                <CalendarDays size={14} />
                Calendar
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
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        {tasks.length === 0 ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#87908A]">
                  Personal
                </p>
                <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
                  My tasks
                </h1>
              </div>
            </div>
            <div className="paper-grid rounded-[22px] border border-[#D0CEC4] p-12 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#C9B9E9] text-[#34264F]">
                <ListChecks size={24} />
              </div>
              <h2 className="mt-6 font-display text-xl font-semibold text-[#214746]">
                No tasks yet
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#717972]">
                Create personal tasks to track your schoolwork, or check your
                group task boards for collaborative deadlines.
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <Link
                  href="/groups"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#C8C6BD] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
                >
                  <Users size={16} />
                  View groups
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <TaskBoard initialTasks={tasks} streak={streak} />
        )}
      </div>
    </main>
  );
}
