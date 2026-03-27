import { Mail, MessageSquare, Globe } from "lucide-react";

interface ChannelBadgeProps {
  channelType: string | null;
}

type ChannelConfig = {
  Icon: typeof Mail;
  label: string;
  className: string;
};

const CHANNEL_CONFIG: Record<string, ChannelConfig> = {
  EMAIL: { Icon: Mail, label: "Email", className: "bg-blue-100 text-blue-800" },
  WHATSAPP: { Icon: MessageSquare, label: "WhatsApp", className: "bg-green-100 text-green-800" },
  RECLAMEAQUI: { Icon: Globe, label: "Reclame Aqui", className: "bg-purple-100 text-purple-800" },
};

export function ChannelBadge({ channelType }: ChannelBadgeProps) {
  if (!channelType) return null;
  const cfg = CHANNEL_CONFIG[channelType];
  if (!cfg) return null;
  const { Icon, label, className } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
