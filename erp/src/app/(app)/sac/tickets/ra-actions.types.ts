// Types extracted from ra-actions.ts to avoid "use server" export restriction

export interface RaActionResult {
  success: boolean;
  error?: string;
}

export interface RaReputationData {
  periods: {
    periodKey: string;
    periodAlias: string;
    responseIndex: number;
    solutionsPercentage: number;
    finalGrade: number;
    avgGrade: number;
    complaintsCount: number;
    reputationCode: string;
    reputationName: string;
  }[];
}

export interface RaReputationResult extends RaActionResult {
  data?: RaReputationData;
}

export interface RaAvailableAction {
  action: "SEND_PUBLIC" | "SEND_PRIVATE" | "REQUEST_EVALUATION" | "REQUEST_MODERATION" | "FINISH_PRIVATE" | "APPROVE_SUGGESTION";
  enabled: boolean;
  reason: string | null;
}

export interface RaTicketContext {
  ticketId: string;
  raExternalId: string | null;
  subject: string;
  description: string;
  erpStatus: string;
  raStatusId: number | null;
  raStatusName: string | null;
  raReason: string | null;
  raFeeling: string | null;
  raCategories: string[];
  raRating: string | null;
  raResolvedIssue: boolean | null;
  raBackDoingBusiness: boolean | null;
  raPublicTreatmentTime: number | null;
  raPrivateTreatmentTime: number | null;
  raRatingDate: string | null;
  raCommentsCount: number;
  raUnreadCount: number;
  raModerationStatus: string | null;
  raFrozen: boolean;
  raActive: boolean;
  raSlaDeadline: string | null;
  consumerConsideration: string | null;
  companyConsideration: string | null;
  whatsappEval: {
    sent: boolean | null;
    done: boolean | null;
  } | null;
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    cpfCnpj: string | null;
  };
  availableActions: RaAvailableAction[];
  recentMessages: {
    content: string;
    direction: string;
    createdAt: string;
    isInternal: boolean;
  }[];
  hasPublicResponse?: boolean;
  hasPrivateResponse?: boolean;
  isFinished?: boolean;
  isEvaluated?: boolean;
  isModerated?: boolean;
  lastSuggestion?: {
    id: string;
    content: string;
    confidence: number;
    reasoning: string | null;
    createdAt: string;
  } | null;
}
