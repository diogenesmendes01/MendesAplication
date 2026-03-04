"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getUserCompanies, type UserCompany } from "@/lib/company-actions";

const STORAGE_KEY = "mendes-erp-selected-company";

interface CompanyContextValue {
  companies: UserCompany[];
  selectedCompany: UserCompany | null;
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string) => void;
  loading: boolean;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<UserCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load companies — cached in sessionStorage to avoid refetching on every navigation
  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Try sessionStorage cache first
      const CACHE_KEY = "mendes-erp-companies-cache";
      const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_TTL && Array.isArray(data) && data.length > 0) {
            if (cancelled) return;
            setCompanies(data);
            const stored = localStorage.getItem(STORAGE_KEY);
            const validStored = stored && data.some((c: UserCompany) => c.id === stored);
            setSelectedCompanyIdState(validStored ? stored : data[0]?.id ?? null);
            setLoading(false);
            return;
          }
        }
      } catch {
        // ignore cache read errors
      }

      try {
        const data = await getUserCompanies();
        if (cancelled) return;
        setCompanies(data);

        // Cache result
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
        } catch {
          // ignore cache write errors
        }

        const stored = localStorage.getItem(STORAGE_KEY);
        const validStored = stored && data.some((c) => c.id === stored);
        setSelectedCompanyIdState(validStored ? stored : data[0]?.id ?? null);
      } catch {
        // user not authenticated or error — leave empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const setSelectedCompanyId = useCallback(
    (id: string) => {
      setSelectedCompanyIdState(id);
      localStorage.setItem(STORAGE_KEY, id);
    },
    []
  );

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? null;

  return (
    <CompanyContext.Provider
      value={{ companies, selectedCompany, selectedCompanyId, setSelectedCompanyId, loading }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error("useCompany must be used within a CompanyProvider");
  }
  return ctx;
}
