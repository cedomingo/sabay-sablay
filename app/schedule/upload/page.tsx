"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, LayoutGrid, X, Check } from "lucide-react";

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/schedule/parse", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to parse schedule");
      }

      const parsed = await res.json();

      // Store parsed data in sessionStorage for the correction page
      sessionStorage.setItem(
        "parsedSchedule",
        JSON.stringify({
          total_units: parsed.total_units,
          schedule: parsed.schedule,
          image_path: parsed.image_path,
        })
      );

      router.push("/schedule/correction");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-8 text-[#F4F1E9] md:px-10 md:py-10">
        <div className="mx-auto max-w-3xl relative z-10">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
              <LayoutGrid size={18} />
            </div>
            <span className="font-display text-sm font-bold tracking-tight">
              Schedule Planner
            </span>
          </div>
          <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Upload your timetable
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#D3E5DC]">
            Take a screenshot of your class schedule from the registration
            portal and we&apos;ll turn it into a map you can actually read.
          </p>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

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
              or click to browse — PNG, JPG up to 10MB
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
                }}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
              >
                <X size={16} />
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
                }}
                className="rounded-xl border border-[#B9BDB4] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
              >
                Choose different file
              </button>
            </div>
          </div>
        )}

        {/* Tips */}
        <div className="mt-8 rounded-[18px] border border-[#D0CEC4] bg-[#F8F6F0] p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
            Tips for best results
          </p>
          <ul className="mt-3 space-y-2 text-sm text-[#52605C]">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F4A28C]" />
              Use a full screenshot of the schedule grid from the registration
              portal
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#8DDDD0]" />
              Make sure all days and time slots are visible
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C9B9E9]" />
              You&apos;ll be able to review and correct any misread entries
              before saving
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
