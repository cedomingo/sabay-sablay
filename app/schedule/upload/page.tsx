"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Upload, Check, Loader2, PlayCircle, X } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { parseScheduleImage } from "@/lib/client-ocr/parseSchedule";

// First-time visitors get a looping tutorial overlay; the flag is set once
// they dismiss it, and the Tips card keeps a permanent way to replay it.
const TUTORIAL_SEEN_FLAG = "crsTutorialSeen";

export default function UploadPage() {
  return (
    <Suspense fallback={null}>
      <UploadPageInner />
    </Suspense>
  );
}

function UploadPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = searchParams.get("groupId");
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // Checked in an effect (not during render) so SSR markup stays stable.
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(TUTORIAL_SEEN_FLAG)) {
        setShowTutorial(true);
      }
    } catch {
      // Storage unavailable (private mode etc.) — default to showing it.
      setShowTutorial(true);
    }
  }, []);

  const dismissTutorial = useCallback(() => {
    setShowTutorial(false);
    try {
      window.localStorage.setItem(TUTORIAL_SEEN_FLAG, "1");
    } catch {
      // Ignore — worst case the tutorial shows again next visit.
    }
  }, []);

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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  async function handleUpload() {
    if (!file) return;

    setUploading(true);
    setError(null);
    setProgress("Initializing OCR...");

    try {
      // 1. Client-side OCR (No more Render timeouts!)
      const parsed = await parseScheduleImage(file, (msg) => setProgress(msg));

      // 2. Upload to Supabase Storage directly from client
      setProgress("Uploading image to storage...");
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
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      <AppHeader
        maxWidth="max-w-3xl"
        showNotificationBell={false}
        showSignOut={false}
        title={
          <>
            <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Upload your timetable
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#D3E5DC]">
              Take a screenshot of your class schedule from the registration
              portal and we&apos;ll turn it into a map you can actually read.
            </p>
          </>
        }
      />

      {/* Upload Area */}
      <div className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        {!file ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`paper-grid cursor-pointer rounded-[22px] border-2 border-dashed p-12 text-center transition-all md:p-16 ${
              dragActive
                ? "border-[#56B9AC] bg-[#DFF1EA]/50"
                : "border-[#C8C6BD] hover:border-[#56B9AC] hover:bg-[#E7EBE5]"
            }`}
          >
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#F6D486] text-[#765514]">
              <Upload size={24} />
            </div>
            <h2 className="mt-6 font-display text-xl font-semibold text-[#214746]">
              Drop your schedule screenshot here
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-[#717972]">
              or click to browse – PNG, JPG up to 10MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        ) : (
          <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 md:p-8">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  Selected file
                </p>
                <p className="mt-1 text-sm font-semibold text-[#214746]">
                  {file.name}
                </p>
                <p className="text-xs text-[#87908A]">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <button
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setError(null);
                  setProgress("");
                }}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
                disabled={uploading}
              >
                ×
              </button>
            </div>

            {preview && (
              <div className="mt-4 overflow-hidden rounded-xl border border-[#D0CEC4]">
                <img
                  src={preview}
                  alt="Schedule preview"
                  className="w-full object-contain"
                  style={{ maxHeight: "400px" }}
                />
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-[#C77A68] bg-[#FCE9E3] px-4 py-3 text-xs text-[#A14D3F]">
                {error}
              </div>
            )}

            {progress && !error && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#56B9AC] bg-[#DFF1EA]/30 px-4 py-3 text-xs font-medium text-[#214746]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress}
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#F4F1E9] border-t-transparent" />
                    Parsing…
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    Parse schedule
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setError(null);
                  setProgress("");
                }}
                disabled={uploading}
                className="rounded-xl border border-[#B9BDB4] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5] disabled:opacity-60"
              >
                Choose different file
              </button>
            </div>
          </div>
        )}

        {/* Tips */}
        <div className="mt-8 rounded-[18px] border border-[#D0CEC4] bg-[#F8F6F0] p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
              Tips for best results
            </p>
            <button
              onClick={() => setShowTutorial(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#C8C6BD] px-2.5 py-1.5 text-xs font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
            >
              <PlayCircle size={14} />
              Watch tutorial
            </button>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-[#52605C]">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F4A28C]" />
              Use a full screenshot of the schedule grid from the registration portal
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#8DDDD0]" />
              Make sure all days and time slots are visible
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C9B9E9]" />
              You&apos;ll be able to review and correct any misread entries before saving
            </li>
          </ul>
        </div>
      </div>

      {/* First-time tutorial overlay — looping video, dismissed once. */}
      {showTutorial && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={dismissTutorial}
        >
          <div
            className="w-full max-w-2xl rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] p-4 shadow-card md:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-1 pb-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  CRS tutorial
                </p>
                <h3 className="mt-0.5 font-display text-lg font-semibold text-[#214746]">
                  How to grab your schedule
                </h3>
              </div>
              <button
                onClick={dismissTutorial}
                aria-label="Close tutorial"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
              >
                <X size={16} />
              </button>
            </div>

            <video
              src="/crs_tutorial_15s.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="w-full overflow-hidden rounded-xl border border-[#D0CEC4] bg-black"
            />

            <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3">
              <p className="text-xs text-[#87908A]">
                Loops automatically · replay anytime from &ldquo;Watch
                tutorial&rdquo;
              </p>
              <button
                onClick={dismissTutorial}
                className="rounded-xl bg-[#214746] px-5 py-2.5 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5"
              >
                Got it, start uploading
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}