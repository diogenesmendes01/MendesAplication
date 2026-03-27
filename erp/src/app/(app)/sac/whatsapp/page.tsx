"use client";

import { MessageSquare } from "lucide-react";
import { TicketListPage } from "../shared/ticket-list-page";

export default function WhatsAppPage() {
  return (
    <TicketListPage
      channelType="WHATSAPP"
      channelLabel="WhatsApp"
      channelIcon={MessageSquare}
    />
  );
}
