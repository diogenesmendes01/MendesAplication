"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualTableProps<T> {
  data: T[];
  /** Number of columns — used for spacer row colSpan */
  colCount: number;
  estimateSize?: number;
  overscan?: number;
  /** Should return <td> / <TableCell> elements (no <tr> wrapper) */
  renderRow: (item: T, index: number) => React.ReactNode;
  /** Should return a <tr> with <th> / <TableHead> elements */
  renderHeader: () => React.ReactNode;
  containerHeight?: string;
  emptyState?: React.ReactNode;
  /** Extra props applied to each <tr> (className, onClick, etc.) */
  getRowProps?: (
    item: T,
    index: number
  ) => React.HTMLAttributes<HTMLTableRowElement>;
}

/**
 * Generic virtualised table using @tanstack/react-virtual.
 *
 * Uses a single <table> element so that column widths stay in sync
 * between the sticky <thead> and the virtualised <tbody>.
 * Padding rows above/below the visible window create the correct
 * scroll height without absolute positioning.
 */
export function VirtualTable<T>({
  data,
  colCount,
  estimateSize = 52,
  overscan = 10,
  renderRow,
  renderHeader,
  containerHeight = "calc(100vh - 320px)",
  emptyState,
  getRowProps,
}: VirtualTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  if (data.length === 0 && emptyState) return <>{emptyState}</>;

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop =
    virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() -
        (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0;

  return (
    <div
      ref={parentRef}
      className="rounded-md border"
      style={{ height: containerHeight, overflowY: "auto" }}
    >
      <table className="w-full caption-bottom text-sm">
        <thead className="sticky top-0 z-10 bg-background [&_tr]:border-b">
          {renderHeader()}
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden>
              <td
                colSpan={colCount}
                style={{ height: `${paddingTop}px`, padding: 0, border: 0 }}
              />
            </tr>
          )}
          {virtualItems.map((virtualRow) => {
            const item = data[virtualRow.index];
            const rowProps = getRowProps
              ? getRowProps(item, virtualRow.index)
              : {};
            const { className: rowClassName, ...restRowProps } = rowProps;
            return (
              <tr
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={`border-b transition-colors ${rowClassName ?? ""}`}
                {...restRowProps}
              >
                {renderRow(item, virtualRow.index)}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden>
              <td
                colSpan={colCount}
                style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }}
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
