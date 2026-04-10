"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getChannelTheme, type ChannelTheme } from "@/lib/sac/channel-theme";

const ChannelThemeContext = createContext<ChannelTheme | null>(null);

export function useChannelTheme(): ChannelTheme {
  const ctx = useContext(ChannelThemeContext);
  if (!ctx) throw new Error("useChannelTheme must be used within ChannelThemeProvider");
  return ctx;
}

interface ChannelThemeProviderProps {
  channelType: string | null;
  children: ReactNode;
}

export function ChannelThemeProvider({ channelType, children }: ChannelThemeProviderProps) {
  const theme = useMemo(() => getChannelTheme(channelType), [channelType]);
  return (
    <ChannelThemeContext.Provider value={theme}>
      {children}
    </ChannelThemeContext.Provider>
  );
}
