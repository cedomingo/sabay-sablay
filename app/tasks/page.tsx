import { getPersonalTasks, getTaskStreak } from "@/lib/actions/tasks";
import AppHeader from "@/components/AppHeader";
import TaskBoard from "./TaskBoard";
import Link from "next/link";
import { Users, ListChecks, CalendarDays } from "lucide-react";

export default async function TasksPage() {
  const [tasks, streak] = await Promise.all([
    getPersonalTasks(),
    getTaskStreak(),
  ]);

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      <AppHeader
        maxWidth="max-w-4xl"
        navItems={[
          { label: "My schedule", href: "/schedule" },
          { label: "Calendar", href: "/schedule?tab=calendar", icon: <CalendarDays size={14} /> },
          { label: "My groups", href: "/groups", icon: <Users size={14} /> },
        ]}
      />

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
