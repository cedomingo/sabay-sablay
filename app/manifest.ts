import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Schedule Planner",
    short_name: "SchedPlanner",
    description:
      "Group schedule visualizer and planner for students. Upload your timetable, see combined schedules, track tasks, and collaborate.",
    start_url: "/schedule",
    display: "standalone",
    background_color: "#F4F1E9",
    theme_color: "#214746",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
    ],
    categories: ["education", "productivity"],
  };
}
