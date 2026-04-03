// v2 exports — 4-tab structure
export { TabGeral } from "./tab-geral";
export { TabPersona } from "./tab-persona";
export { TabCanais } from "./tab-canais";
export { TabGestao } from "./tab-gestao";

// Shared types + constants
export { PROVIDERS, DEFAULT_CONFIG } from "./types";
export type { AiConfigData } from "./types";

// Internal components — kept as files but NOT exported here.
// They are imported directly inside the tabs that use them:
//   TabCanais uses: tab-simulador logic (inlined)
//   TabGestao uses: tab-rate-limiting, tab-consumo, tab-health, tab-suggestion-mode logic (inlined)
//
// Files kept: tab-whatsapp, tab-email, tab-reclameaqui, tab-suggestion-mode,
//             tab-rate-limiting, tab-consumo, tab-simulador, tab-health, tab-ferramentas
