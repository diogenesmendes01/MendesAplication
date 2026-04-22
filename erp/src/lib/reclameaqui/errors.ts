/**
 * Complete HugMe/Reclame Aqui API error code mapping.
 *
 * Single source of truth — imported by client.ts and ra-actions.ts.
 * Codes sourced from official HugMe API documentation.
 */
export const RA_ERROR_MESSAGES: Record<number, string> = {
  // ── HTTP-level ──────────────────────────────────────────────────────
  4000: "Requisição inválida",
  4010: "Token inválido ou expirado",
  4030: "Acesso negado — verifique permissões",
  4040: "Recurso não encontrado",
  4050: "Método não permitido",

  // ── Ticket / Avaliação ──────────────────────────────────────────────
  4090: "Ticket inativo",
  4091: "Ticket não é do Reclame Aqui — avaliação indisponível",
  4092: "Ticket com moderação pendente — avaliação bloqueada",
  4093: "Ticket não foi respondido — responda antes de solicitar avaliação",
  4094: "Ticket sem resposta pública da empresa",
  4095: "Ticket já foi avaliado",
  4096: "Reclamação não elegível para avaliação no Reclame Aqui",
  4097: "Erro ao criar histórico de ação",
  4098: "Limite de anexos excedido (máx 6 arquivos)",
  4099: "Limite diário de moderações excedido",

  // ── Validação / Rate-limit ──────────────────────────────────────────
  4220: "Dados inválidos — verifique os campos",
  4290: "Limite de requisições excedido — aguarde 1 minuto",

  // ── Server ──────────────────────────────────────────────────────────
  5000: "Erro interno do servidor Reclame Aqui",
  5030: "Serviço temporariamente indisponível",

  // ── Moderação (409xx) ───────────────────────────────────────────────
  40910: "Limite de moderações por reclamação excedido",
  40912: "Moderação por duplicidade impossível — última resposta é da empresa",
  40913: "Moderação requer resposta pública + avaliação do consumidor",
  40914: "Motivo de moderação não permitido",
  40915: "Ticket não é do Reclame Aqui",
  40916: "Ticket já tem moderação pendente",
  40917: "Moderação já foi solicitada para este ticket",
  40918: "Erro inesperado na moderação",

  // ── Mensagens / Interações (409xx) ──────────────────────────────────
  40919: "Fonte do ticket não suporta mensagens privadas",
  40920: "Ticket fechado com última resposta da empresa — mensagem pública bloqueada",
  40921: "Erro ao criar interação no ticket",
  40922: "Tipo de anexo não suportado (aceitos: png, jpg, gif, pdf, doc, xls, csv, mp3, wma, ogg, aac)",
  40925: "Mensagem privada já encerrada ou não iniciada",
  40930: "Mensagem duplicada — já enviada recentemente",
};
