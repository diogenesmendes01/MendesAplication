export default function DashboardLoading() {
  return (
    <div className="space-y-5">
      {/* Header skeleton */}
      <div className="flex justify-between items-start">
        <div>
          <div className="h-7 w-32 rounded bg-border-subtle animate-pulse" />
          <div className="h-4 w-48 rounded bg-border-subtle animate-pulse mt-2" />
        </div>
        <div className="h-9 w-[140px] rounded bg-border-subtle animate-pulse" />
      </div>

      {/* KPI skeletons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[14px]">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-5 animate-pulse">
            <div className="h-10 w-10 rounded-[10px] bg-border-subtle mb-4" />
            <div className="h-7 w-28 rounded bg-border-subtle mb-2" />
            <div className="h-3 w-20 rounded bg-border-subtle mb-3" />
            <div className="h-5 w-24 rounded-full bg-border-subtle" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[14px]">
        <div className="lg:col-span-2 rounded-xl border border-border bg-surface p-5 animate-pulse">
          <div className="h-5 w-40 rounded bg-border-subtle mb-2" />
          <div className="h-3 w-24 rounded bg-border-subtle mb-6" />
          <div className="h-[200px] bg-border-subtle rounded" />
        </div>
        <div className="rounded-xl border border-border bg-surface p-5 animate-pulse">
          <div className="h-5 w-40 rounded bg-border-subtle mb-2" />
          <div className="h-3 w-24 rounded bg-border-subtle mb-6" />
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-border-subtle" />
                <div className="flex-1 h-4 rounded bg-border-subtle" />
                <div className="h-4 w-16 rounded bg-border-subtle" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom grid skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px]">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-5 animate-pulse">
            <div className="h-5 w-36 rounded bg-border-subtle mb-2" />
            <div className="h-3 w-24 rounded bg-border-subtle mb-6" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-10 rounded bg-border-subtle" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
