"use client";

import { Mail } from "lucide-react";
import { TicketListPage } from "../shared/ticket-list-page";

export default function EmailPage() {
  return (
    <TicketListPage
      channelType="EMAIL"
      channelLabel="Email"
      channelIcon={Mail}
    />
  );
}
