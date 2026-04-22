"use client";
import { usePathname } from "next/navigation";
import { ChannelNav } from "./components/channel-nav";

export default function SacLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Hide channel nav on ticket detail pages (/sac/tickets/[id])
  const isTicketDetail = /\/sac\/tickets\/[^/]+$/.test(pathname ?? "");

  return (
    <div className="space-y-4">
      {!isTicketDetail && <ChannelNav />}
      {children}
    </div>
  );
}
