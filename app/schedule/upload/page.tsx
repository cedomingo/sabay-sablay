import { Suspense } from "react";
import ScheduleUploadClient from "./ScheduleUploadClient";

export default function ScheduleUploadPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto p-6 flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <ScheduleUploadClient />
    </Suspense>
  );
}
