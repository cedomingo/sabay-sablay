import { redirect } from "next/navigation";

// Group creation now happens inline as an overlay on /groups instead of
// a separate page — kept as a redirect so old links/bookmarks still
// land somewhere sensible.
export default function CreateGroupPage() {
  redirect("/groups");
}
