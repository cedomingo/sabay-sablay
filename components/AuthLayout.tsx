import { LayoutGrid } from "lucide-react";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="grain relative min-h-[100dvh] overflow-hidden bg-[#214746] text-[#F4F1E9]">
      {/* Decorative elements */}
      <div className="absolute -bottom-24 -right-8 h-64 w-64 rounded-full border-[24px] border-[#F6D486]/20" />
      <div className="absolute -right-20 top-5 h-36 w-36 rotate-45 border border-[#F4A28C]/40" />

      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-6">
        <div className="w-full max-w-md">
          {/* Logo + Branding */}
          <div className="mb-10 flex items-center justify-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
              <LayoutGrid size={20} />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">
              Sabay Sablay
            </span>
          </div>

          {/* Card */}
          <div className="grain relative overflow-hidden rounded-[28px] bg-[#2B5855] p-8 shadow-elevated md:p-10">
            <div className="relative z-10">
              {children}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
