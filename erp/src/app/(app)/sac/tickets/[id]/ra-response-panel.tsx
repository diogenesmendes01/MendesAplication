"use client";

import { useEffect, useState } from "react";
import { Globe, Lock, Loader2, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RaFileUpload } from "../../components/ra-file-upload";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RaResponsePanelProps {
  ticketId: string;
  companyId: string;
  /** Pré-popula a aba de resposta pública (ex: sugestão da IA) */
  initialPublicMessage?: string;
  onSendPublic: (message: string) => Promise<void>;
  onSendPrivate: (message: string, files: File[]) => Promise<void>;
  sendingPublic: boolean;
  sendingPrivate: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RaResponsePanel({
  initialPublicMessage,
  onSendPublic,
  onSendPrivate,
  sendingPublic,
  sendingPrivate,
}: RaResponsePanelProps) {
  const [publicMessage, setPublicMessage] = useState(initialPublicMessage ?? "");
  const [privateMessage, setPrivateMessage] = useState("");
  const [privateFiles, setPrivateFiles] = useState<File[]>([]);

  // Keep in sync if parent updates initialPublicMessage (IA suggestion)
  useEffect(() => {
    if (initialPublicMessage !== undefined) {
      setPublicMessage(initialPublicMessage);
    }
  }, [initialPublicMessage]);

  async function handleSendPublic() {
    if (!publicMessage.trim()) return;
    await onSendPublic(publicMessage.trim());
    setPublicMessage("");
  }

  async function handleSendPrivate() {
    if (!privateMessage.trim()) return;
    await onSendPrivate(privateMessage.trim(), privateFiles);
    setPrivateMessage("");
    setPrivateFiles([]);
  }

  return (
    <Tabs defaultValue="public" className="w-full">
      <TabsList className="w-full grid grid-cols-2 mb-1">
        <TabsTrigger value="public" className="gap-1.5">
          <Globe className="h-3.5 w-3.5" />
          Resposta Pública
        </TabsTrigger>
        <TabsTrigger value="private" className="gap-1.5">
          <Lock className="h-3.5 w-3.5" />
          Mensagem Privada
        </TabsTrigger>
      </TabsList>

      {/* ─── Aba: Resposta Pública ─────────────────────────────────────── */}
      <TabsContent value="public" className="space-y-3 mt-0">
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          <Globe className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Esta mensagem será <strong>visível publicamente</strong> no Reclame Aqui.
          </span>
        </div>

        <Textarea
          placeholder="Escreva a resposta pública para o consumidor..."
          value={publicMessage}
          onChange={(e) => setPublicMessage(e.target.value)}
          rows={5}
          disabled={sendingPublic}
          className="resize-none"
        />

        <Button
          className="w-full bg-green-600 hover:bg-green-700 text-white"
          onClick={handleSendPublic}
          disabled={sendingPublic || !publicMessage.trim()}
        >
          {sendingPublic ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          {sendingPublic ? "Publicando..." : "Publicar Resposta"}
        </Button>
      </TabsContent>

      {/* ─── Aba: Mensagem Privada ─────────────────────────────────────── */}
      <TabsContent value="private" className="space-y-3 mt-0">
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <Lock className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <strong>Somente o consumidor</strong> verá esta mensagem. Não é pública.
          </span>
        </div>

        <Textarea
          placeholder="Escreva uma mensagem privada para o consumidor..."
          value={privateMessage}
          onChange={(e) => setPrivateMessage(e.target.value)}
          rows={4}
          disabled={sendingPrivate}
          className="resize-none"
        />

        <RaFileUpload onChange={setPrivateFiles} disabled={sendingPrivate} />

        <Button
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          onClick={handleSendPrivate}
          disabled={sendingPrivate || !privateMessage.trim()}
        >
          {sendingPrivate ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : privateFiles.length > 0 ? (
            <Paperclip className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          {sendingPrivate
            ? "Enviando..."
            : privateFiles.length > 0
              ? `Enviar com ${privateFiles.length} anexo(s)`
              : "Enviar Mensagem Privada"}
        </Button>
      </TabsContent>
    </Tabs>
  );
}
