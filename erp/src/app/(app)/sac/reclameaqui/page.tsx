"use client";

import { Globe } from "lucide-react";
import { TicketListPage } from "../shared/ticket-list-page";

export default function ReclameAquiPage() {
  return (
    <TicketListPage
      channelType="RECLAMEAQUI"
      channelLabel="Reclame Aqui"
      channelIcon={Globe}
    />
  );
}
