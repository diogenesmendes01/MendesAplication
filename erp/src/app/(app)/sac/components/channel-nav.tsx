"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Mail, MessageSquare, Globe, BarChart3, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const channels = [
  { href: "/sac", label: "Overview", icon: LayoutDashboard },
  { href: "/sac/email", label: "Email", icon: Mail },
  { href: "/sac/whatsapp", label: "WhatsApp", icon: MessageSquare },
  { href: "/sac/reclameaqui", label: "Reclame Aqui", icon: Globe },
  { href: "/sac/feedback", label: "Feedback IA", icon: BarChart3 },
  { href: "/sac/analytics", label: "Observabilidade", icon: Activity },
] as const;

export function ChannelNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 border-b pb-2 overflow-x-auto scrollbar-hide flex-nowrap">
      {channels.map(({ href, label, icon: Icon }) => {
        const isActive =
          href === "/sac"
            ? pathname === "/sac"
            : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted min-w-max",
              isActive
                ? "border-b-2 border-primary font-bold text-primary"
                : "text-muted-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
