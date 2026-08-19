import { redirect } from "next/navigation";

// The personal Calendar now lives on /schedule as a tab, alongside
// the weekly grid. This route is kept so old links/bookmarks still
// land somewhere sensible.
export default function CalendarPage() {
  redirect("/schedule?tab=calendar");
}
