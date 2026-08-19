"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  CheckCircle2,
  Circle,
  Trash2,
  Calendar,
  Pencil,
  X,
  Check,
  Flame,
} from "lucide-react";
import {
  createPersonalTask,
  toggleTaskStatus,
  deleteTask,
  updateTask,
  type Task,
} from "@/lib/actions/tasks";
import { useOptimisticAction } from "@/lib/hooks/use-optimistic-action";

interface TaskBoardProps {
  initialTasks: Task[];
  streak?: {
    currentStreak: number;
    longestStreak: number;
    completedToday: number;
  };
}

export default function TaskBoard({ initialTasks, streak }: TaskBoardProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const { run, pendingIds } = useOptimisticAction<Task[]>(setTasks);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Keep local state in sync when the server component re-renders with fresh data
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  // Create form state
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDueAt, setNewDueAt] = useState("");

  // Edit form state
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueAt, setEditDueAt] = useState("");

  const openTasks = tasks.filter((t) => t.status === "open");
  const doneTasks = tasks.filter((t) => t.status === "done");

  function resetCreateForm() {
    setNewTitle("");
    setNewDescription("");
    setNewDueAt("");
    setShowCreate(false);
  }

  function startEditing(task: Task) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDescription(task.description || "");
    setEditDueAt(task.due_at ? new Date(task.due_at).toISOString().slice(0, 16) : "");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditTitle("");
    setEditDescription("");
    setEditDueAt("");
  }

  async function handleCreate() {
    const title = newTitle.trim();
    if (!title) return;

    const description = newDescription.trim() || null;
    const dueAt = newDueAt ? new Date(newDueAt).toISOString() : null;
    const tempId = `temp-${Date.now()}`;
    resetCreateForm();

    await run({
      apply: (prev) => [
        {
          id: tempId,
          owner_id: "",
          group_id: null,
          title,
          description,
          due_at: dueAt,
          status: "open",
          assignee_id: null,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ],
      revert: (prev) => prev.filter((t) => t.id !== tempId),
      action: () =>
        createPersonalTask({
          title,
          description: description || undefined,
          dueAt: dueAt || undefined,
        }),
      errorMessage: "Couldn't create that task.",
      onSuccess: () => router.refresh(),
    });
  }

  async function handleToggle(taskId: string) {
    await run({
      id: taskId,
      apply: (prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: t.status === "open" ? "done" : "open" } : t
        ),
      action: () => toggleTaskStatus(taskId),
      errorMessage: "Couldn't update that task.",
    });
  }

  async function handleDelete(taskId: string) {
    await run({
      id: taskId,
      apply: (prev) => prev.filter((t) => t.id !== taskId),
      action: () => deleteTask(taskId),
      errorMessage: "Couldn't delete that task.",
    });
  }

  async function handleUpdate(taskId: string) {
    const title = editTitle.trim();
    if (!title) return;

    const description = editDescription.trim() || null;
    const dueAt = editDueAt ? new Date(editDueAt).toISOString() : null;
    cancelEditing();

    await run({
      id: taskId,
      apply: (prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, title, description, due_at: dueAt } : t
        ),
      action: () => updateTask(taskId, { title, description, dueAt }),
      errorMessage: "Couldn't save your changes.",
    });
  }

  function formatDueDate(dueAt: string | null): string {
    if (!dueAt) return "";
    const date = new Date(dueAt);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return "Overdue";
    if (diffDays === 0) return "Due today";
    if (diffDays === 1) return "Due tomorrow";
    if (diffDays <= 7) return `Due in ${diffDays} days`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  function getDueDateColor(dueAt: string | null): string {
    if (!dueAt) return "";
    const date = new Date(dueAt);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return "text-[#A14D3F]"; // overdue
    if (diffDays <= 2) return "text-[#A45D42]"; // soon
    if (diffDays <= 7) return "text-[#DDB35A]"; // this week
    return "text-[#87908A]"; // far away
  }

  return (
    <div className="space-y-6">
      {/* Create Button */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#87908A]">
            Personal
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
            My tasks
          </h1>
        </div>
        {/* Streak */}
        {streak && streak.currentStreak > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-[#F6D486]/40 bg-[#FDF6E3] px-4 py-2.5">
            <Flame size={18} className="text-[#DDB35A]" />
            <div>
              <p className="font-display text-lg font-bold text-[#4C3911]">
                {streak.currentStreak}
              </p>
              <p className="font-mono text-[9px] uppercase tracking-wider text-[#87908A]">
                day streak
              </p>
            </div>
          </div>
        )}
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#F4A28C] px-4 py-2.5 text-sm font-semibold text-[#512E2B] transition-transform hover:-translate-y-0.5"
        >
          <Plus size={16} />
          New task
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="rounded-[22px] border border-[#56B9AC] bg-[#F8F6F0] p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-sm font-semibold text-[#214746]">
              New task
            </h3>
            <button
              onClick={resetCreateForm}
              className="grid h-7 w-7 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
            >
              <X size={14} />
            </button>
          </div>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Task title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <textarea
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20 resize-none"
            />
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  Due date
                </label>
                <input
                  type="datetime-local"
                  value={newDueAt}
                  onChange={(e) => setNewDueAt(e.target.value)}
                  className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim()}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-2.5 text-sm font-semibold text-[#F4F1E9] transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:translate-y-0"
              >
                <Check size={14} />
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Open Tasks */}
      <div className="rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
        <div className="flex items-center justify-between border-b border-[#D8D6CD] px-5 py-4">
          <div className="flex items-center gap-2">
            <Circle size={14} className="text-[#56B9AC]" />
            <h2 className="font-display text-sm font-semibold text-[#214746]">
              Open
            </h2>
            <span className="rounded-full bg-[#D9E7DE] px-2 py-0.5 text-[10px] font-bold text-[#286057]">
              {openTasks.length}
            </span>
          </div>
        </div>

        {openTasks.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-[#87908A]">
              No open tasks. Create one to get started!
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E1DFD7]">
            {openTasks.map((task) => (
              <div
                key={task.id}
                className={`px-5 py-4 transition-opacity ${
                  pendingIds.has(task.id) ? "opacity-60" : ""
                }`}
              >
                {editingId === task.id ? (
                  /* Edit Mode */
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                      autoFocus
                    />
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={2}
                      placeholder="Description (optional)"
                      className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20 resize-none"
                    />
                    <div className="flex items-center gap-3">
                      <input
                        type="datetime-local"
                        value={editDueAt}
                        onChange={(e) => setEditDueAt(e.target.value)}
                        className="flex-1 rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                      />
                      <button
                        onClick={() => handleUpdate(task.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#214746] px-4 py-2 text-xs font-semibold text-[#F4F1E9]"
                      >
                        <Check size={12} />
                        Save
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#C8C6BD] px-4 py-2 text-xs font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View Mode */
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => handleToggle(task.id)}
                      className="mt-0.5 shrink-0"
                    >
                      <Circle
                        size={20}
                        className="text-[#B9BDB4] transition-colors hover:text-[#56B9AC]"
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-sm font-semibold text-[#214746]">
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="mt-1 text-xs leading-relaxed text-[#717972]">
                          {task.description}
                        </p>
                      )}
                      {task.due_at && (
                        <p
                          className={`mt-1.5 flex items-center gap-1.5 font-mono text-[10px] font-semibold ${getDueDateColor(
                            task.due_at
                          )}`}
                        >
                          <Calendar size={10} />
                          {formatDueDate(task.due_at)}
                          <span className="text-[#B9BDB4]">
                            &middot;{" "}
                            {new Date(task.due_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEditing(task)}
                        className="grid h-7 w-7 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="grid h-7 w-7 place-items-center rounded-lg text-[#C77A68] hover:bg-[#FCE9E3]"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Completed Tasks */}
      {doneTasks.length > 0 && (
        <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0]">
          <div className="flex items-center justify-between border-b border-[#E1DFD7] px-5 py-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-[#87908A]" />
              <h2 className="font-display text-sm font-semibold text-[#87908A]">
                Done
              </h2>
              <span className="rounded-full bg-[#E7EBE5] px-2 py-0.5 text-[10px] font-bold text-[#87908A]">
                {doneTasks.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-[#E1DFD7]">
            {doneTasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-center gap-3 px-5 py-3.5 transition-opacity ${
                  pendingIds.has(task.id) ? "opacity-60" : ""
                }`}
              >
                <button onClick={() => handleToggle(task.id)} className="shrink-0">
                  <CheckCircle2 size={20} className="text-[#56B9AC]" />
                </button>
                <p className="flex-1 text-sm text-[#87908A] line-through">
                  {task.title}
                </p>
                <button
                  onClick={() => handleDelete(task.id)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-[#C77A68] hover:bg-[#FCE9E3]"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
