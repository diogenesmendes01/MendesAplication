"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Bot,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  listTimelineEvents,
  toggleTicketAi,
  type TimelineEvent,
} from "../actions";
import { useEventStream } from "@/hooks/use-event-stream";
import type { AiSuggestionData } from "./components/ai-suggestion-card";
import { getSuggestions } from "./suggestion-actions";
import type { SuggestionRecord } from "./suggestion-actions";
import { EmailComposer } from "./components/email-composer";
import { NoteComposer } from "./components/note-composer";
import { WhatsAppComposer } from "./components/whatsapp-composer";
import { TimelineEventList } from "./components/timeline-event-list";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface TicketTimelineProps {
  ticketId: string;
  companyId: string;
  ticketSubject: string;
  aiEnabled: boolean;
  aiConfigEnabled: boolean;
  channelType?: string | null;
}

export default function TicketTimeline({
  ticketId,
  companyId,
  ticketSubject,
  aiEnabled: initialAiEnabled,
  aiConfigEnabled,
  channelType,
}: TicketTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AiSuggestionData[]>([]);
  const [aiEnabled, setAiEnabled] = useState(initialAiEnabled);
  const [togglingAi, setTogglingAi] = useState(false);
  // Track latest event timestamp for incremental polling
  const lastEventTimeRef = useRef<string | null>(null);

  // Active tab — controlled for lazy-loading recipients
  const [activeTab, setActiveTab] = useState("todos");

  const loadSuggestions = useCallback(async () => {
    if (!ticketId || !companyId) return;
    try {
      const data: SuggestionRecord[] = await getSuggestions(ticketId, companyId);
      setSuggestions(data.map((s): AiSuggestionData => ({
        id: s.id,
        ticketId: s.ticketId,
        companyId: s.companyId,
        channel: s.channel,
        analysis: (s.analysis || {}) as AiSuggestionData["analysis"],
        suggestedResponse: s.suggestedResponse,
        suggestedSubject: s.suggestedSubject ?? null,
        suggestedActions: (s.suggestedActions || []) as AiSuggestionData["suggestedActions"],
        raPrivateMessage: s.raPrivateMessage ?? null,
        raPublicMessage: s.raPublicMessage ?? null,
        raDetectedType: s.raDetectedType ?? null,
        raSuggestModeration: s.raSuggestModeration ?? false,
        status: s.status as AiSuggestionData["status"],
        reviewedBy: s.reviewedBy ?? null,
        reviewedAt: s.reviewedAt ?? null,
        editedResponse: s.editedResponse ?? null,
        editedSubject: s.editedSubject ?? null,
        rejectionReason: s.rejectionReason ?? null,
        confidence: s.confidence,
        createdAt: s.createdAt,
        reviewer: s.reviewer ?? null,
      })));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("SAC: failed to load AI suggestions", err);
    }
  }, [ticketId, companyId]);

  const loadEvents = useCallback(async () => {
    if (!ticketId || !companyId) return;
    setLoading(true);
    try {
      const data = await listTimelineEvents(ticketId, companyId, undefined, 50);
      setEvents(data);
      // Record latest event timestamp for incremental polling
      if (data.length > 0) {
        const latest = data.reduce(
          (max, e) => (e.createdAt > max ? e.createdAt : max),
          data[0].createdAt
        );
        lastEventTimeRef.current = latest;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("SAC: failed to load timeline events", err);
    } finally {
      setLoading(false);
    }
  }, [ticketId, companyId]);

  useEffect(() => {
    loadEvents();
    loadSuggestions();
  }, [loadEvents, loadSuggestions]);

  // Incremental poll — only fetch events newer than the last known timestamp
  const pollNewEvents = useCallback(async () => {
    if (!ticketId || !companyId || !lastEventTimeRef.current) return;
    try {
      const newEvents = await listTimelineEvents(
        ticketId,
        companyId,
        lastEventTimeRef.current
      );
      if (newEvents.length > 0) {
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const unique = newEvents.filter((e) => !existingIds.has(e.id));
          if (unique.length === 0) return prev;
          const merged = [...prev, ...unique].sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
          return merged;
        });
        const latest = newEvents.reduce(
          (max, e) => (e.createdAt > max ? e.createdAt : max),
          newEvents[0].createdAt
        );
        lastEventTimeRef.current = latest;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("SAC: failed to poll new timeline events", err);
    }
  }, [ticketId, companyId]);

  // SSE-driven timeline updates — instant push for all channels
  useEventStream(companyId, ["sac"], {
    "sac:timeline-update": (data: unknown) => {
      const event = data as { ticketId: string; timestamp: number };
      if (event.ticketId === ticketId) {
        pollNewEvents();
      }
    },
  });

  // Fallback polling — 60s safety net in case SSE connection drops
  useEffect(() => {
    if (!ticketId || !companyId) return;
    if (channelType !== "WHATSAPP") return;

    const interval = setInterval(() => {
      pollNewEvents();
    }, 60_000);

    return () => clearInterval(interval);
  }, [ticketId, companyId, channelType, pollNewEvents]);

  // Manual refresh — exposed via button in the UI
  const [refreshing, setRefreshing] = useState(false);
  async function handleManualRefresh() {
    setRefreshing(true);
    await Promise.all([loadEvents(), loadSuggestions()]);
    setRefreshing(false);
  }

  // ---------------------------------------------------
  // Toggle AI
  // ---------------------------------------------------

  async function handleToggleAi(checked: boolean) {
    setTogglingAi(true);
    try {
      await toggleTicketAi(ticketId, companyId, checked);
      setAiEnabled(checked);
      toast.success(checked ? "IA ativada para este ticket" : "IA desativada para este ticket");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar IA");
    } finally {
      setTogglingAi(false);
    }
  }

  // ---------------------------------------------------
  // Callback for suggestion/event actions
  // ---------------------------------------------------
  const handleSuggestionAction = useCallback(() => {
    loadEvents();
    loadSuggestions();
  }, [loadEvents, loadSuggestions]);

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">Timeline</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleManualRefresh}
            disabled={refreshing}
            title="Atualizar timeline"
            className="h-7 w-7"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {aiConfigEnabled && (
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="ai-toggle" className="text-sm text-muted-foreground cursor-pointer">
              IA
            </Label>
            <Switch
              id="ai-toggle"
              checked={aiEnabled}
              onCheckedChange={handleToggleAi}
              disabled={togglingAi}
            />
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="whatsapp">
              WhatsApp
            </TabsTrigger>
          </TabsList>

          {/* ============================================================ */}
          {/* Todos Tab */}
          {/* ============================================================ */}
          <TabsContent value="todos" className="mt-4">
            <TimelineEventList
              events={events}
              suggestions={suggestions}
              loading={loading}
              ticketId={ticketId}
              companyId={companyId}
              channelType={channelType}
              onSuggestionAction={handleSuggestionAction}
            />

            {/* Reply / internal note form */}
            <NoteComposer
              ticketId={ticketId}
              companyId={companyId}
              onNoteSent={loadEvents}
            />
          </TabsContent>

          {/* ============================================================ */}
          {/* Email Tab */}
          {/* ============================================================ */}
          <TabsContent value="email" className="mt-4">
            <EmailComposer
              ticketId={ticketId}
              companyId={companyId}
              ticketSubject={ticketSubject}
              events={events}
              loading={loading}
              onMessageSent={loadEvents}
            />
          </TabsContent>

          {/* ============================================================ */}
          {/* WhatsApp Tab */}
          {/* ============================================================ */}
          <TabsContent value="whatsapp" className="mt-4">
            <WhatsAppComposer
              ticketId={ticketId}
              companyId={companyId}
              events={events}
              loading={loading}
              onMessageSent={loadEvents}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
