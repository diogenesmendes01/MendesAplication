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

  // Load companies on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getUserCompanies();
        if (cancelled) return;
        setCompanies(data);

        // Restore from localStorage or pick the first
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
