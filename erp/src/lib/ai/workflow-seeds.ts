import type { WorkflowTrigger, WorkflowStep } from "./workflow-types";

// ─── Seed Workflow 1: Remoção/Baixa de Cadastro ─────────────────────────────

export const WORKFLOW_REMOCAO_CADASTRO = {
  name: "Remoção de Cadastro",
  description: "Processa pedidos de remoção de cadastro e baixa de boletos pendentes.",
  trigger: { type: "intent", value: "remocao_cadastro" } as WorkflowTrigger,
  channels: ["WHATSAPP", "EMAIL", "RECLAMEAQUI"],
  priority: 10,
  steps: [
    { id: "coletar_cnpj", nome: "Coletar CNPJ", tipo: "COLLECT_INFO", config: { campo: "cnpj", obrigatorio: true, validacao: "cnpj", promptPorCanal: { WHATSAPP: "Para localizar seu cadastro, pode me informar o CNPJ?", EMAIL: "Por gentileza, informe o CNPJ para localizarmos seu cadastro.", RECLAMEAQUI: "Informe o CNPJ via mensagem privada." } } },
    { id: "buscar_cliente", nome: "Buscar cliente", tipo: "SEARCH", config: { entidade: "cliente", filtro: { cnpj: "${cnpj}" }, limiteResultados: 1 } },
    { id: "verificar_cliente", nome: "Verificar cliente", tipo: "CONDITION", config: { se: { campo: "buscar_cliente.total", operador: "maior", valor: 0 }, entao: "buscar_boletos", senao: "cliente_nao_encontrado" } },
    { id: "buscar_boletos", nome: "Buscar boletos pendentes", tipo: "SEARCH", config: { entidade: "boleto", filtro: { cnpj: "${cnpj}", status: "PENDING" }, ordenacao: "dueDate:asc", limiteResultados: 50 } },
    { id: "dar_baixa_boletos", nome: "Cancelar boletos", tipo: "UPDATE", config: { entidade: "boleto", filtro: { cnpj: "${cnpj}", status: "PENDING" }, campos: { status: "CANCELLED" }, auditLog: true } },
    { id: "responder_sucesso", nome: "Confirmar remoção", tipo: "RESPOND", config: { templatePorCanal: { WHATSAPP: "Pronto! ✅ Cadastro inativado e boletos cancelados.", EMAIL: "Seu cadastro foi inativado e os boletos pendentes cancelados.", RECLAMEAQUI: { publico: "Já realizamos a remoção do cadastro e cancelamento das cobranças.", privado: "Olá! Cadastro (CNPJ ${cnpj}) inativado e boletos cancelados." } } } },
    { id: "marcar_ticket", nome: "Marcar ticket", tipo: "SET_TAG", config: { alvo: "ticket", acao: "adicionar_tag", valor: "remocao_cadastro_executada" }, proximoStep: "__END__" },
    { id: "cliente_nao_encontrado", nome: "Cliente não encontrado", tipo: "RESPOND", config: { templatePorCanal: { WHATSAPP: "Não encontrei cadastro com esse CNPJ. Pode verificar?", EMAIL: "Não localizamos cadastro vinculado ao CNPJ informado.", RECLAMEAQUI: { publico: "Estamos verificando a situação.", privado: "Não encontramos cadastro para o CNPJ informado." } } } },
  ] as WorkflowStep[],
};

// ─── Seed Workflow 2: Reembolso (com pausa humano) ──────────────────────────

export const WORKFLOW_REEMBOLSO = {
  name: "Reembolso",
  description: "Processa pedidos de reembolso com coleta de dados e aprovação humana.",
  trigger: { type: "intent", value: "reembolso" } as WorkflowTrigger,
  channels: ["WHATSAPP", "EMAIL", "RECLAMEAQUI"],
  priority: 10,
  steps: [
    { id: "coletar_cnpj", nome: "Coletar CNPJ", tipo: "COLLECT_INFO", config: { campo: "cnpj", obrigatorio: true, validacao: "cnpj", promptPorCanal: { WHATSAPP: "Para localizar sua empresa, informe o CNPJ.", EMAIL: "Por gentileza, informe o CNPJ.", RECLAMEAQUI: "Informe o CNPJ via mensagem privada." } } },
    { id: "coletar_motivo", nome: "Coletar motivo", tipo: "COLLECT_INFO", config: { campo: "motivo", obrigatorio: true, promptPorCanal: { WHATSAPP: "Qual o motivo do reembolso?", EMAIL: "Descreva o motivo do pedido de reembolso.", RECLAMEAQUI: "Descreva o motivo do reembolso." } } },
    { id: "buscar_cliente", nome: "Buscar cliente", tipo: "SEARCH", config: { entidade: "cliente", filtro: { cnpj: "${cnpj}" }, limiteResultados: 1 } },
    { id: "responder_recebido", nome: "Confirmar recebimento", tipo: "RESPOND", config: { templatePorCanal: { WHATSAPP: "Recebi seu pedido de reembolso. ✅ Vou encaminhar para aprovação.", EMAIL: "Recebemos sua solicitação de reembolso. Retornaremos em breve.", RECLAMEAQUI: { publico: "Recebemos a solicitação e encaminhamos ao setor responsável.", privado: "Seu pedido de reembolso foi registrado e encaminhado." } } } },
    { id: "escalar", nome: "Escalar para aprovação", tipo: "ESCALATE", config: { motivo: "Reembolso — motivo: ${motivo}", prioridade: "HIGH", incluirContexto: true } },
    { id: "aguardar", nome: "Aguardar aprovação", tipo: "WAIT", config: { quem: "humano", condicao: "Aprovação ou rejeição do reembolso", timeoutHoras: 48, acaoTimeout: "notificar" } },
    { id: "responder_aprovado", nome: "Notificar aprovação", tipo: "RESPOND", config: { templatePorCanal: { WHATSAPP: "Seu reembolso foi aprovado! ✅ Será processado em até 5 dias úteis.", EMAIL: "Seu reembolso foi aprovado e será processado em até 5 dias úteis.", RECLAMEAQUI: { publico: "A solicitação foi analisada e aprovada.", privado: "Seu reembolso foi aprovado — processamento em até 5 dias úteis." } } } },
    { id: "marcar", nome: "Marcar resolvido", tipo: "SET_TAG", config: { alvo: "ticket", acao: "adicionar_tag", valor: "reembolso_aprovado" } },
  ] as WorkflowStep[],
};

// ─── Seed Workflow 3: Segunda Via de Boleto ─────────────────────────────────

export const WORKFLOW_SEGUNDA_VIA_BOLETO = {
  name: "Segunda Via de Boleto",
  description: "Localiza e envia segunda via de boletos pendentes.",
  trigger: { type: "intent", value: "segunda_via_boleto" } as WorkflowTrigger,
  channels: ["WHATSAPP", "EMAIL", "RECLAMEAQUI"],
  priority: 10,
  steps: [
    { id: "coletar_cnpj", nome: "Coletar CNPJ", tipo: "COLLECT_INFO", config: { campo: "cnpj", obrigatorio: true, validacao: "cnpj", promptPorCanal: { WHATSAPP: "Para localizar seu boleto, informe o CNPJ.", EMAIL: "Informe o CNPJ para localizar o boleto.", RECLAMEAQUI: "Informe o CNPJ via mensagem privada." } } },
    { id: "buscar_boleto", nome: "Buscar boleto", tipo: "SEARCH", config: { entidade: "boleto", filtro: { cnpj: "${cnpj}", status: "PENDING" }, ordenacao: "dueDate:asc", limiteResultados: 5 } },
    { id: "verificar", nome: "Verificar resultado", tipo: "CONDITION", config: { se: { campo: "buscar_boleto.total", operador: "maior", valor: 0 }, entao: "enviar_boleto", senao: "sem_boleto" } },
    { id: "enviar_boleto", nome: "Enviar boleto", tipo: "SEND_ATTACHMENT", config: { source: "busca", referenciaStep: "buscar_boleto", porCanal: { WHATSAPP: true, EMAIL: true, RECLAMEAQUI: false }, fallbackTexto: "Segue as informações do boleto." } },
    { id: "responder_sucesso", nome: "Confirmar envio", tipo: "RESPOND", config: { templatePorCanal: { WHATSAPP: "Pronto! Enviei o boleto atualizado. ✅", EMAIL: "Segue em anexo o boleto atualizado.", RECLAMEAQUI: { publico: "Já encaminhamos a segunda via ao reclamante.", privado: "Enviamos a segunda via do boleto." } } } },
    { id: "marcar", nome: "Marcar ticket", tipo: "SET_TAG", config: { alvo: "ticket", acao: "adicionar_tag", valor: "segunda_via_enviada" } },
    { id: "sem_boleto", nome: "Sem boleto", tipo: "RESPOND", config: { templatePorCanal: { WHATSAPP: "Não encontrei boletos pendentes para esse CNPJ.", EMAIL: "Não localizamos boletos pendentes para esse CNPJ.", RECLAMEAQUI: { publico: "Estamos verificando a situação.", privado: "Não encontramos boletos pendentes para o CNPJ informado." } } } },
  ] as WorkflowStep[],
};

export const ALL_SEED_WORKFLOWS = [
  WORKFLOW_REMOCAO_CADASTRO,
  WORKFLOW_REEMBOLSO,
  WORKFLOW_SEGUNDA_VIA_BOLETO,
];
