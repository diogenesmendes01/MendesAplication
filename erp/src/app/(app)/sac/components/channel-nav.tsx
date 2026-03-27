"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Mail, MessageSquare, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const channels = [
  { href: "/sac", label: "Overview", icon: LayoutDashboard },
  { href: "/sac/email", label: "Email", icon: Mail },
  { href: "/sac/whatsapp", label: "WhatsApp", icon: MessageSquare },
  { href: "/sac/reclameaqui", label: "Reclame Aqui", icon: Globe },
] as const;

export function ChannelNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 border-b pb-2">
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
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
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
