"use client";

import dynamic from "next/dynamic";

// Lazy-load recharts — only downloaded when a chart is actually rendered
export const LazyBarChart = dynamic(
  () => import("recharts").then((mod) => mod.BarChart),
  { ssr: false }
);
export const LazyBar = dynamic(
  () => import("recharts").then((mod) => mod.Bar),
  { ssr: false }
);
export const LazyXAxis = dynamic(
  () => import("recharts").then((mod) => mod.XAxis),
  { ssr: false }
);
export const LazyYAxis = dynamic(
  () => import("recharts").then((mod) => mod.YAxis),
  { ssr: false }
);
export const LazyCartesianGrid = dynamic(
  () => import("recharts").then((mod) => mod.CartesianGrid),
  { ssr: false }
);
export const LazyTooltip = dynamic(
  () => import("recharts").then((mod) => mod.Tooltip),
  { ssr: false }
);
export const LazyLegend = dynamic(
  () => import("recharts").then((mod) => mod.Legend),
  { ssr: false }
);
export const LazyResponsiveContainer = dynamic(
  () => import("recharts").then((mod) => mod.ResponsiveContainer),
  { ssr: false }
);
export const LazyLineChart = dynamic(
  () => import("recharts").then((mod) => mod.LineChart),
  { ssr: false }
);
export const LazyLine = dynamic(
  () => import("recharts").then((mod) => mod.Line),
  { ssr: false }
);
export const LazyAreaChart = dynamic(
  () => import("recharts").then((mod) => mod.AreaChart),
  { ssr: false }
);
export const LazyArea = dynamic(
  () => import("recharts").then((mod) => mod.Area),
  { ssr: false }
);
export const LazyPieChart = dynamic(
  () => import("recharts").then((mod) => mod.PieChart),
  { ssr: false }
);
export const LazyPie = dynamic(
  () => import("recharts").then((mod) => mod.Pie),
  { ssr: false }
);
export const LazyCell = dynamic(
  () => import("recharts").then((mod) => mod.Cell),
  { ssr: false }
);
