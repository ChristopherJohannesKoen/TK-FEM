import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MagnusAnalysis } from "@shared/solver";

function formatNumber(value: number) {
  const absolute = Math.abs(value);
  if (absolute === 0) {
    return "0";
  }
  if (absolute >= 1e4 || absolute < 1e-3) {
    return value.toExponential(3);
  }
  if (absolute >= 100) {
    return value.toFixed(1);
  }
  if (absolute >= 1) {
    return value.toFixed(4);
  }
  return value.toFixed(6);
}

function StatusBadge({
  children,
  active,
}: {
  children: string;
  active: boolean;
}) {
  return (
    <Badge
      variant="outline"
      className={active ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-300"}
    >
      {children}
    </Badge>
  );
}

export function MagnusAnalysisPanel({ analysis }: { analysis: MagnusAnalysis }) {
  const cards = [
    {
      label: "Strategy",
      value: analysis.strategy === "finite_closure" ? "Finite closure" : analysis.strategy === "manual_truncation" ? "Manual truncation" : "Truncated Magnus",
      sub: analysis.summary,
    },
    {
      label: "Series closure",
      value: analysis.finiteSeriesExact ? "Exact finite series" : "Infinite series",
      sub: analysis.closureOrder ? `Lower-central series closes at level ${analysis.closureOrder}` : "No finite closure detected",
    },
    {
      label: "Magnus order",
      value: `m = ${analysis.appliedMagnusOrder}`,
      sub: `requested ${analysis.requestedMagnusOrder}, recommended ${analysis.recommendedMagnusOrder}`,
    },
    {
      label: "Convergence bound",
      value: analysis.convergenceGuaranteed ? "Sufficient bound satisfied" : "Bound not guaranteed",
      sub: `${formatNumber(analysis.convergenceMetric)} <= ${formatNumber(analysis.convergenceThreshold)}`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{analysis.mode === "auto" ? "Auto mode" : "Manual mode"}</Badge>
        <Badge variant="outline">Backend: {analysis.backend}</Badge>
        <StatusBadge active={analysis.finiteSeriesExact}>
          {analysis.finiteSeriesExact ? "Finite closure detected" : "Truncation required"}
        </StatusBadge>
        <StatusBadge active={analysis.convergenceGuaranteed}>
          {analysis.convergenceGuaranteed ? "Sufficient convergence bound" : "No sufficient convergence bound"}
        </StatusBadge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} className="border-border bg-card">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{card.label}</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{card.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{card.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Decision Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-secondary/30 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Orders</div>
              <div className="mt-2 space-y-1 font-mono text-xs text-foreground">
                <div>Requested: m = {analysis.requestedMagnusOrder}</div>
                <div>Recommended: m = {analysis.recommendedMagnusOrder}</div>
                <div>Applied: m = {analysis.appliedMagnusOrder}</div>
                <div>Closure order: {analysis.closureOrder ?? "not finite"}</div>
              </div>
            </div>
            <div className="rounded-md border border-border bg-secondary/30 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Interpretation</div>
              <p className="mt-2 text-sm text-foreground">{analysis.summary}</p>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
            <div className="space-y-2">
              {analysis.notes.map((note) => (
                <div key={note} className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm">
                  {note}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Lower-Central Series</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4">Level</th>
                  <th className="py-2 pr-4">Basis size</th>
                  <th className="py-2 pr-4">Max commutator norm</th>
                </tr>
              </thead>
              <tbody>
                {analysis.lowerCentralSeries.map((level) => (
                  <tr key={level.level} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4 font-mono text-foreground">L{level.level}</td>
                    <td className="py-2 pr-4 font-mono text-foreground">{level.matrixCount}</td>
                    <td className="py-2 pr-4 font-mono text-foreground">{formatNumber(level.maxNorm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
