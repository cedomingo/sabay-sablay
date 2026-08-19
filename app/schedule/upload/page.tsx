"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Upload, X, Loader2 } from "lucide-react";
import { parseScheduleImage } from "@/lib/client-ocr/parseSchedule";

export default function ScheduleUploadPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = searchParams.get("groupId");

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      setError("Please upload an image file (PNG, JPG, etc.)");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("File must be under 10MB");
      return;
    }
    setFile(f);
    setError(null);
    setProgress("");

    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  async function handleUpload() {
    if (!file) return;

    setUploading(true);
    setError(null);
    setProgress("Loading image...");

    try {
      // 1. Client-side OCR
      const parsed = await parseScheduleImage(file, (msg) => setProgress(msg));

      // 2. Upload to Supabase Storage directly from client
      setProgress("Uploading image to storage...");
      
      // Use createBrowserClient for client components
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error("Not authenticated. Please log in.");
      }

      const fileName = `${user.id}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
      const { error: uploadError } = await supabase.storage
        .from("schedule-images")
        .upload(fileName, file);

      if (uploadError) {
        throw new Error(`Failed to upload image: ${uploadError.message}`);
      }

      // 3. Store and redirect
      setProgress("Finishing...");
      sessionStorage.setItem(
        "parsedSchedule",
        JSON.stringify({
          total_units: parsed.total_units,
          schedule: parsed.schedule,
          image_path: fileName,
          groupId: groupId || undefined,
        })
      );

      router.push("/schedule/correction");
    } catch (err) {
      console.error("Upload/OCR error:", err);
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress("");
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Upload Schedule</h1>
      <p className="text-muted-foreground">
        Upload a screenshot of your schedule grid. The image will be processed 
        directly in your browser for privacy and speed.
      </p>

      {!file ? (
        <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted transition-colors">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <Upload className="w-10 h-10 mb-3 text-muted-foreground" />
            <p className="mb-2 text-sm text-muted-foreground">
              <span className="font-semibold">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-muted-foreground">PNG, JPG (max 10MB)</p>
          </div>
          <input
            type="file"
            className="hidden"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="relative rounded-lg overflow-hidden border bg-muted/30">
            <img src={preview!} alt="Preview" className="w-full h-auto max-h-96 object-contain" />
            <button
              onClick={() => {
                setFile(null);
                setPreview(null);
                setError(null);
                setProgress("");
              }}
              className="absolute top-2 right-2 p-1 bg-background/80 rounded-full hover:bg-background shadow-sm"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">
              {error}
            </div>
          )}

          {uploading && (
            <div className="flex items-center gap-3 p-3 bg-primary/5 text-primary text-sm rounded-md">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{progress || "Processing..."}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                setFile(null);
                setPreview(null);
                setError(null);
                setProgress("");
              }}
              disabled={uploading}
              className="flex-1 px-4 py-2 border rounded-md hover:bg-muted disabled:opacity-50"
            >
              Change Image
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing
                </>
              ) : (
                "Parse Schedule"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}