import { redirect } from "next/navigation";

// The combined schedule now lives on the group's main page (Schedule
// tab), alongside the new Calendar tab. This route is kept so old
// links/bookmarks still land somewhere sensible.
export default function GroupSchedulePage({
  params,
}: {
  params: { groupId: string };
}) {
  redirect(`/groups/${params.groupId}`);
}
