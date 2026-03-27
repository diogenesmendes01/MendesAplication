import Link from "next/link";

interface ChannelBreadcrumbProps {
  channelType: string | null;
  ticketId: string;
}

const CHANNEL_INFO: Record<string, { label: string; href: string }> = {
  EMAIL: { label: "Email", href: "/sac/email" },
  WHATSAPP: { label: "WhatsApp", href: "/sac/whatsapp" },
  RECLAMEAQUI: { label: "Reclame Aqui", href: "/sac/reclameaqui" },
};

export function ChannelBreadcrumb({ channelType, ticketId }: ChannelBreadcrumbProps) {
  const info = channelType ? CHANNEL_INFO[channelType] : null;

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
      <Link href="/sac" className="hover:text-foreground transition-colors">
        SAC
      </Link>
      <span>›</span>
      {info ? (
        <Link href={info.href} className="hover:text-foreground transition-colors">
          {info.label}
        </Link>
      ) : (
        <Link href="/sac/tickets" className="hover:text-foreground transition-colors">
          Tickets
        </Link>
      )}
      <span>›</span>
      <span className="text-foreground font-medium">#{ticketId.slice(-8)}</span>
    </nav>
  );
}
