import { getMyGroups } from "@/lib/actions/group";
import GroupsClient from "./GroupsClient";

export default async function GroupsPage() {
  const groups = await getMyGroups();
  return <GroupsClient initialGroups={groups} />;
}