import type { DREData, DREConsolidatedReport } from "./actions";

// Heavy libs loaded dynamically — only when user triggers export
async function getJsPDF() {
  const { default: jsPDF } = await import("jspdf");
  return jsPDF;
}

async function getAutoTable() {
  const { default: autoTable } = await import("jspdf-autotable");
  return autoTable;
}

async function getXLSX() {
  return await import("xlsx");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function buildDRERows(data: DREData): string[][] {
  const rows: string[][] = [
    ["(+) Receita Bruta de Serviços", formatCurrency(data.grossRevenue)],
    ["(-) Deduções sobre Receita", formatCurrency(data.deductions)],
    ["(=) Receita Líquida", formatCurrency(data.netRevenue)],
    [
      "(-) Custos dos Serviços Prestados",
      formatCurrency(data.costOfServices),
    ],
    ["(=) Lucro Bruto", formatCurrency(data.grossProfit)],
    ["(-) Despesas Operacionais", formatCurrency(data.operatingExpenses)],
  ];

  for (const cat of data.expensesByCategory) {
    rows.push([`    ${cat.category}`, formatCurrency(cat.value)]);
  }

  rows.push(["(=) Resultado Operacional", formatCurrency(data.operatingResult)]);

  return rows;
}

function getFileName(
  companyName: string | null,
  periodLabel: string,
  ext: string
): string {
  const prefix = companyName ?? "Consolidado";
  const safe = `DRE_${prefix}_${periodLabel}`
    .replace(/[^a-zA-Z0-9À-ÿ_\- ]/g, "")
    .replace(/\s+/g, "_");
  return `${safe}.${ext}`;
}

// ---------------------------------------------------------------------------
// PDF Export
// ---------------------------------------------------------------------------

export async function exportDREtoPDF(
  data: DREData,
  consolidated?: DREConsolidatedReport
) {
  const JsPDF = await getJsPDF();
  const autoTable = await getAutoTable();
  const doc = new JsPDF();
  const title = data.companyName
    ? `DRE — ${data.companyName}`
    : "DRE — Consolidado (Grupo)";

  // Title
  doc.setFontSize(16);
  doc.text(title, 14, 20);

  // Period
  doc.setFontSize(10);
  doc.text(`Período: ${data.periodLabel}`, 14, 28);

  // DRE Table
  const rows = buildDRERows(data);

  autoTable(doc, {
    startY: 34,
    head: [["Descrição", "Valor (R$)"]],
    body: rows,
    theme: "grid",
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 50, halign: "right" },
    },
    didParseCell(hookData) {
      const text = String(hookData.cell.raw ?? "");
      // Bold summary rows
      if (
        text.startsWith("(=)") &&
        hookData.section === "body"
      ) {
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.fillColor = [240, 240, 240];
      }
      // Indent category detail rows
      if (text.startsWith("    ") && hookData.section === "body") {
        hookData.cell.styles.fontSize = 9;
        hookData.cell.styles.textColor = [120, 120, 120];
      }
    },
  });

  // Per-company table (consolidated view)
  if (consolidated && consolidated.perCompany.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = (doc as any).lastAutoTable?.finalY ?? 150;

    doc.setFontSize(12);
    doc.text(`Comparativo por Empresa — ${consolidated.periodLabel}`, 14, finalY + 12);

    const companyRows = consolidated.perCompany.map((c) => [
      c.companyName,
      formatCurrency(c.grossRevenue),
      formatCurrency(c.netRevenue),
      formatCurrency(c.grossProfit),
      formatCurrency(c.operatingExpenses),
      formatCurrency(c.operatingResult),
    ]);

    autoTable(doc, {
      startY: finalY + 18,
      head: [
        [
          "Empresa",
          "Receita Bruta",
          "Receita Líquida",
          "Lucro Bruto",
          "Despesas",
          "Resultado",
        ],
      ],
      body: companyRows,
      theme: "grid",
      headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Gerado em ${new Date().toLocaleString("pt-BR")} — Página ${i} de ${pageCount}`,
      14,
      doc.internal.pageSize.height - 10
    );
  }

  const fileName = getFileName(data.companyName, data.periodLabel, "pdf");
  doc.save(fileName);
}

// ---------------------------------------------------------------------------
// Excel Export
// ---------------------------------------------------------------------------

export async function exportDREtoExcel(
  data: DREData,
  consolidated?: DREConsolidatedReport
) {
  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new();

  // DRE Sheet
  const dreRows = [
    [data.companyName ? `DRE — ${data.companyName}` : "DRE — Consolidado (Grupo)"],
    [`Período: ${data.periodLabel}`],
    [],
    ["Descrição", "Valor (R$)"],
    ["(+) Receita Bruta de Serviços", data.grossRevenue],
    ["(-) Deduções sobre Receita", data.deductions],
    ["(=) Receita Líquida", data.netRevenue],
    ["(-) Custos dos Serviços Prestados", data.costOfServices],
    ["(=) Lucro Bruto", data.grossProfit],
    ["(-) Despesas Operacionais", data.operatingExpenses],
  ];

  for (const cat of data.expensesByCategory) {
    dreRows.push([`    ${cat.category}`, cat.value]);
  }

  dreRows.push(["(=) Resultado Operacional", data.operatingResult]);

  const ws = XLSX.utils.aoa_to_sheet(dreRows);

  // Set column widths
  ws["!cols"] = [{ wch: 40 }, { wch: 20 }];

  XLSX.utils.book_append_sheet(wb, ws, "DRE");

  // Per-company comparison sheet (consolidated view)
  if (consolidated && consolidated.perCompany.length > 0) {
    const companyRows: (string | number)[][] = [
      [`Comparativo por Empresa — ${consolidated.periodLabel}`],
      [],
      [
        "Empresa",
        "Receita Bruta",
        "Receita Líquida",
        "Lucro Bruto",
        "Despesas",
        "Resultado",
      ],
    ];

    for (const c of consolidated.perCompany) {
      companyRows.push([
        c.companyName,
        c.grossRevenue,
        c.netRevenue,
        c.grossProfit,
        c.operatingExpenses,
        c.operatingResult,
      ]);
    }

    const ws2 = XLSX.utils.aoa_to_sheet(companyRows);
    ws2["!cols"] = [
      { wch: 30 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
    ];

    XLSX.utils.book_append_sheet(wb, ws2, "Por Empresa");
  }

  const fileName = getFileName(data.companyName, data.periodLabel, "xlsx");
  XLSX.writeFile(wb, fileName);
}
