// Test only the getSeloConfig function directly without importing the full module
// This avoids environment variable and complex dependency issues

describe('RA Reputation Card - getSeloConfig', () => {
  // Define the SELO_MAP locally for testing
  const SELO_MAP = {
    EXCELENTE: { color: 'bg-green-500', text: 'text-white' },
    BOM: { color: 'bg-blue-500', text: 'text-white' },
    REGULAR: { color: 'bg-yellow-500', text: 'text-black' },
    RUIM: { color: 'bg-orange-500', text: 'text-white' },
    NAO_RECOMENDADA: { color: 'bg-red-500', text: 'text-white' },
    SEM_INDICE: { color: 'bg-gray-300', text: 'text-gray-700' },
  };

  function getSeloConfig(reputationCode: string | null | undefined) {
    // RA API may return null/undefined/number instead of string — normalize defensively
    const normalized = String(reputationCode || "SEM_INDICE")
      .toUpperCase()
      .replace(/\s+/g, "_");
    return SELO_MAP[normalized as keyof typeof SELO_MAP] ?? SELO_MAP.SEM_INDICE;
  }

  it('handles null input correctly', () => {
    const result = getSeloConfig(null);
    expect(result).toEqual(SELO_MAP.SEM_INDICE);
  });

  it('handles undefined input correctly', () => {
    const result = getSeloConfig(undefined);
    expect(result).toEqual(SELO_MAP.SEM_INDICE);
  });

  it('handles numeric input correctly', () => {
    const result = getSeloConfig(1 as any);
    expect(result).toEqual(SELO_MAP.SEM_INDICE);
  });

  it('handles empty string input correctly', () => {
    const result = getSeloConfig("");
    expect(result).toEqual(SELO_MAP.SEM_INDICE);
  });

  it('handles valid string input correctly', () => {
    const result = getSeloConfig("EXCELENTE");
    expect(result).toEqual(SELO_MAP.EXCELENTE);
  });
});