export interface ChannelTheme {
  id: string;
  label: string;
  primary: string;
  headerBg: string;
  headerBorder: string;
  titleColor: string;
  miniCardBg: string;
  miniCardBorder: string;
  tabActive: string;
  btnPrimaryBg: string;
  btnPrimaryHover: string;
  btnOutlineBorder: string;
  btnOutlineColor: string;
  composerSendBg: string;
  timelineClientBg: string;
  timelineClientBorder: string;
}

const THEMES: Record<string, ChannelTheme> = {
  RECLAMEAQUI: {
    id: "RECLAMEAQUI",
    label: "Reclame Aqui",
    primary: "#7C3AED",
    headerBg: "linear-gradient(135deg, #F5F0FF, #EDE5FF)",
    headerBorder: "#E8DAFF",
    titleColor: "#4C1D95",
    miniCardBg: "#FDFAFF",
    miniCardBorder: "#E8DAFF",
    tabActive: "#7C3AED",
    btnPrimaryBg: "#7C3AED",
    btnPrimaryHover: "#6D28D9",
    btnOutlineBorder: "#DDD6FE",
    btnOutlineColor: "#7C3AED",
    composerSendBg: "#059669",
    timelineClientBg: "#F5F0FF",
    timelineClientBorder: "#E8DAFF",
  },
  EMAIL: {
    id: "EMAIL",
    label: "Email",
    primary: "#2563EB",
    headerBg: "linear-gradient(135deg, #F0F7FF, #E0EDFF)",
    headerBorder: "#BFDBFE",
    titleColor: "#1E3A5F",
    miniCardBg: "#F8FBFF",
    miniCardBorder: "#BFDBFE",
    tabActive: "#2563EB",
    btnPrimaryBg: "#2563EB",
    btnPrimaryHover: "#1D4ED8",
    btnOutlineBorder: "#BFDBFE",
    btnOutlineColor: "#2563EB",
    composerSendBg: "#2563EB",
    timelineClientBg: "#F0F7FF",
    timelineClientBorder: "#BFDBFE",
  },
  WHATSAPP: {
    id: "WHATSAPP",
    label: "WhatsApp",
    primary: "#059669",
    headerBg: "linear-gradient(135deg, #ECFDF5, #D1FAE5)",
    headerBorder: "#A7F3D0",
    titleColor: "#064E3B",
    miniCardBg: "#F8FDFB",
    miniCardBorder: "#A7F3D0",
    tabActive: "#059669",
    btnPrimaryBg: "#059669",
    btnPrimaryHover: "#047857",
    btnOutlineBorder: "#A7F3D0",
    btnOutlineColor: "#059669",
    composerSendBg: "#059669",
    timelineClientBg: "#ECFDF5",
    timelineClientBorder: "#A7F3D0",
  },
};

const DEFAULT_THEME = THEMES.EMAIL;

export function getChannelTheme(channelType: string | null | undefined): ChannelTheme {
  if (!channelType) return DEFAULT_THEME;
  return THEMES[channelType] ?? DEFAULT_THEME;
}
