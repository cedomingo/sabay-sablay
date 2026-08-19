import { LayoutGrid, LogOut, Users, CalendarDays, UserRound, Settings } from "lucide-react";
import { handleSignOut } from "@/lib/actions/auth";
import NotificationBell from "./NotificationBell";
import SubmitButton from "./SubmitButton";
import Link from "next/link";

interface NavItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}

interface AppHeaderProps {
  /** Maximum width container class (e.g., "max-w-5xl") */
  maxWidth?: string;
  /** Navigation items to show in the header */
  navItems?: NavItem[];
  /** Whether to show the notification bell */
  showNotificationBell?: boolean;
  /** Whether to show the sign out button */
  showSignOut?: boolean;
  /** Optional subtitle/label shown under the nav */
  subtitle?: React.ReactNode;
  /** Optional title shown under the subtitle */
  title?: React.ReactNode;
  /** Optional actions shown on the right side of the subtitle row */
  headerActions?: React.ReactNode;
}

export default function AppHeader({
  maxWidth = "max-w-6xl",
  navItems = [],
  showNotificationBell = true,
  showSignOut = true,
  subtitle,
  title,
  headerActions,
}: AppHeaderProps) {
  return (
    <div className="grain relative bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
      <div className={`mx-auto ${maxWidth} relative z-10`}>
        {/* Top row: Branding + Nav */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
              <LayoutGrid size={18} />
            </div>
            <span className="font-display text-sm font-bold tracking-tight">
              Sabay Sablay
            </span>
          </div>

          <div className="flex items-center gap-2">
            {navItems.map((item, idx) => (
              item.href ? (
                <Link
                  key={idx}
                  href={item.href}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
                >
                  {item.icon}
                  {item.label}
                </Link>
              ) : (
                <span key={idx}>{item.icon}<span className="hidden md:inline">{item.label}</span></span>
              )
            ))}
            {showNotificationBell && <NotificationBell />}
            {showSignOut && (
              <form action={handleSignOut}>
                <SubmitButton
                  icon={<LogOut size={14} />}
                  pendingChildren="Signing out..."
                  className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855] disabled:opacity-60"
                >
                  Sign out
                </SubmitButton>
              </form>
            )}
          </div>
        </div>

        {/* Optional subtitle row */}
        {(subtitle || title || headerActions) && (
          <div className="mt-6">
            {subtitle}
            {title && (
              <div className="mt-3 flex items-end justify-between">
                <div>{title}</div>
                {headerActions && <div>{headerActions}</div>}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Decorative circle — wrapped in overflow-hidden so it doesn't clip the notification dropdown */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>
    </div>
  );
}
