import { createClient } from "@/lib/supabase/server";
import { parseScheduleImage } from "@/lib/ocr-service";
import { NextResponse } from "next/server";

// POST /api/schedule/parse
// Accepts a multipart form with a schedule image file.
// Uploads to Supabase Storage, calls the OCR service, returns parsed entries.
export async function POST(request: Request) {
  const supabase = createClient();

  // Verify the user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "File must be an image" },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File must be under 10MB" },
        { status: 400 }
      );
    }

    // Upload to Supabase Storage and call the OCR service in parallel —
    // they're independent (OCR reads the file directly, not from Storage),
    // so there's no reason to wait for the upload to finish before starting
    // the parse. This roughly halves the wall-clock cost of this route
    // when both legs take similar time.
    const fileName = `${user.id}/${Date.now()}-${file.name}`;
    const [uploadResult, parsed] = await Promise.all([
      supabase.storage.from("schedule-images").upload(fileName, file),
      parseScheduleImage(file),
    ]);

    if (uploadResult.error) {
      console.error("Storage upload error:", uploadResult.error);
      return NextResponse.json(
        { error: "Failed to upload image" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...parsed,
      image_path: fileName,
    });
  } catch (error) {
    console.error("Parse error:", error);
    return NextResponse.json(
      { error: "Failed to parse schedule" },
      { status: 500 }
    );
  }
}
