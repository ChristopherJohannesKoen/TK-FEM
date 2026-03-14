import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useEffect, useRef } from "react";
import type { Analysis } from "@shared/schema";
import type {
  SolverConvergencePoint,
  SolverNodeResult,
  SolverResults,
  SolverStressResult,
} from "@shared/solver";
import { BarChart3, TrendingUp, Download, ChevronLeft } from "lucide-react";

interface ChartPoint {
  x: number;
  y: number;
  series: string;
  color: string;
}

// Simple canvas chart
function LineChart({ data, title, xLabel, yLabel }: {
  data: ChartPoint[];
  title: string; xLabel: string; yLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const cw = canvas.width, ch = canvas.height;
    const pad = { l: 56, r: 24, t: 32, b: 48 };
    const pw = cw - pad.l - pad.r, ph = ch - pad.t - pad.b;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "hsl(217,33%,14%)";
    ctx.fillRect(0, 0, cw, ch);

    if (!data.length) return;

    const allX = data.map(d => d.x), allY = data.map(d => d.y);
    const xMin = Math.min(...allX), xMax = Math.max(...allX);
    const yMin = 0, yMax = Math.max(...allY) * 1.05;

    const toCanvas = (x: number, y: number) => ({
      cx: pad.l + ((x - xMin) / (xMax - xMin || 1)) * pw,
      cy: pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * ph,
    });

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (i / 4) * ph;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const x = pad.l + (i / 4) * pw;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.lineTo(pad.l + pw, pad.t + ph); ctx.stroke();

    // Draw series
    const seriesColors = new Map<string, string>();
    data.forEach(d => seriesColors.set(d.series, d.color));

    for (const [series, color] of Array.from(seriesColors.entries())) {
      const pts = data.filter(d => d.series === series).sort((a, b) => a.x - b.x);
      if (pts.length < 2) continue;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const { cx, cy } = toCanvas(p.x, p.y);
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.stroke();

      // Dots
      ctx.fillStyle = color;
      for (const p of pts) {
        const { cx, cy } = toCanvas(p.x, p.y);
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill();
      }
    }

    // Labels
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, pad.l + pw / 2, ch - 8);
    ctx.save(); ctx.translate(12, pad.t + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0); ctx.restore();

    // Title
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(title, pad.l + pw / 2, 16);

    // Axis tick labels
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
      const x = xMin + (i / 4) * (xMax - xMin);
      const { cx } = toCanvas(x, yMin);
      ctx.fillText(String(Math.round(x)), cx, pad.t + ph + 12);
    }
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const y = yMin + (i / 4) * (yMax - yMin);
      const { cy } = toCanvas(xMin, y);
      ctx.fillText(y.toFixed(1), pad.l - 6, cy + 3);
    }

    // Legend
    let legendX = pad.l + 10;
    for (const [series, color] of Array.from(seriesColors.entries())) {
      ctx.fillStyle = color;
      ctx.fillRect(legendX, pad.t + 4, 12, 4);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(series, legendX + 16, pad.t + 10);
      legendX += 120;
    }
  }, [data, title, xLabel, yLabel]);

  return <canvas ref={canvasRef} width={560} height={280} className="w-full rounded-md border border-border" />;
}

// Kirsch stress distribution chart
function KirschChart({ loadMag, holeRadius }: { loadMag: number; holeRadius: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const cw = canvas.width, ch = canvas.height;
    const pad = { l: 56, r: 24, t: 32, b: 48 };
    const pw = cw - pad.l - pad.r, ph = ch - pad.t - pad.b;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "hsl(217,33%,14%)";
    ctx.fillRect(0, 0, cw, ch);

    const sigma = loadMag;

    // Generate Kirsch analytical curve
    const nPts = 100;
    const analytical: { theta: number; stt: number }[] = [];
    for (let i = 0; i <= nPts; i++) {
      const theta = (i / nPts) * Math.PI;
      const cos2 = Math.cos(2 * theta);
      const stt = sigma * (1 - 2 * cos2); // Kirsch at r=a: σ_θθ = σ∞(1 - 2cos2θ)
      analytical.push({ theta: theta * 180 / Math.PI, stt });
    }

    const allY = analytical.map(p => p.stt);
    const yMin = Math.min(...allY) - 20, yMax = Math.max(...allY) + 20;
    const xMin = 0, xMax = 180;

    const toCanvas = (x: number, y: number) => ({
      cx: pad.l + ((x - xMin) / (xMax - xMin)) * pw,
      cy: pad.t + (1 - (y - yMin) / (yMax - yMin)) * ph,
    });

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (i / 5) * ph;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
    }

    // Zero line
    const { cy: cy0 } = toCanvas(0, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, cy0); ctx.lineTo(pad.l + pw, cy0); ctx.stroke();
    ctx.setLineDash([]);

    // Axes
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.lineTo(pad.l + pw, pad.t + ph); ctx.stroke();

    // Kirsch analytical curve
    ctx.strokeStyle = "hsl(38,92%,55%)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    analytical.forEach((p, i) => {
      const { cx, cy } = toCanvas(p.theta, p.stt);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.stroke();

    // Max SCF annotation
    const { cx: scfX, cy: scfY } = toCanvas(90, sigma * 3);
    ctx.fillStyle = "hsl(38,92%,55%)";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    ctx.fillText("K_t = 3.0", scfX + 6, scfY);

    // Labels
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("θ (degrees)", pad.l + pw / 2, ch - 8);
    ctx.save(); ctx.translate(12, pad.t + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("σ_θθ (MPa)", 0, 0); ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Kirsch Solution: σ_θθ at r = a (hole boundary)", pad.l + pw / 2, 16);

    // Tick labels
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    for (const x of [0, 30, 60, 90, 120, 150, 180]) {
      const { cx } = toCanvas(x, yMin);
      ctx.fillText(String(x) + "°", cx, pad.t + ph + 12);
    }
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const y = yMin + (i / 4) * (yMax - yMin);
      const { cy } = toCanvas(xMin, y);
      ctx.fillText(y.toFixed(0), pad.l - 6, cy + 3);
    }

  }, [loadMag, holeRadius]);

  return <canvas ref={canvasRef} width={560} height={280} className="w-full rounded-md border border-border" />;
}

function NodeTable({ results }: { results: SolverResults }) {
  const nodes = results.nodes.slice(0, 20);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {["Node", "x", "y", "u_x", "u_y", "|u|"].map(h => (
              <th key={h} className="text-left py-2 px-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nodes.map((node: SolverNodeResult) => (
            <tr key={node.id} className="border-b border-border/40 hover:bg-secondary/30">
              <td className="py-1.5 px-2 text-muted-foreground">{node.id}</td>
              <td className="py-1.5 px-2">{node.x.toFixed(3)}</td>
              <td className="py-1.5 px-2">{node.y.toFixed(3)}</td>
              <td className="py-1.5 px-2 text-primary">{node.ux.toExponential(3)}</td>
              <td className="py-1.5 px-2 text-primary">{node.uy.toExponential(3)}</td>
              <td className="py-1.5 px-2 text-accent">{Math.sqrt(node.ux ** 2 + node.uy ** 2).toExponential(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {results.nodes.length > 20 && (
        <div className="text-xs text-muted-foreground p-2">... {results.nodes.length - 20} more nodes</div>
      )}
    </div>
  );
}

function ElementTable({ results }: { results: SolverResults }) {
  const elems = results.stresses.slice(0, 20);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {["Elem", "cx", "cy", "σ_xx", "σ_yy", "τ_xy", "von Mises"].map(h => (
              <th key={h} className="text-left py-2 px-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {elems.map((stress: SolverStressResult) => (
            <tr key={stress.elementId} className="border-b border-border/40 hover:bg-secondary/30">
              <td className="py-1.5 px-2 text-muted-foreground">{stress.elementId}</td>
              <td className="py-1.5 px-2">{stress.cx.toFixed(3)}</td>
              <td className="py-1.5 px-2">{stress.cy.toFixed(3)}</td>
              <td className="py-1.5 px-2">{stress.sxx.toFixed(2)}</td>
              <td className="py-1.5 px-2">{stress.syy.toFixed(2)}</td>
              <td className="py-1.5 px-2">{stress.sxy.toFixed(2)}</td>
              <td className="py-1.5 px-2 font-bold text-primary">{stress.vonMises.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {results.stresses.length > 20 && (
        <div className="text-xs text-muted-foreground p-2">... {results.stresses.length - 20} more elements</div>
      )}
    </div>
  );
}

export default function Results() {
  const { id } = useParams<{ id: string }>();
  const { data: analyses = [] } = useQuery<Analysis[]>({ queryKey: ["/api/analyses"] });

  const selectedId = id ? parseInt(id) : analyses.find(a => a.status === "complete")?.id;
  const { data: analysis } = useQuery<Analysis>({
    queryKey: ["/api/analyses", selectedId],
    enabled: !!selectedId,
  });

  const results = (analysis?.results as SolverResults | null) ?? null;

  const exportCSV = () => {
    if (!results?.stresses) return;
    const rows = [
      ["Element", "cx", "cy", "sxx", "syy", "sxy", "vonMises"],
      ...results.stresses.map((stress) => [
        stress.elementId,
        stress.cx,
        stress.cy,
        stress.sxx,
        stress.syy,
        stress.sxy,
        stress.vonMises,
      ]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tkfem_results_${selectedId}.csv`;
    a.click();
  };

  if (!analysis || !results) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
          <BarChart3 size={32} className="mx-auto mb-3 opacity-30" />
          <div className="font-medium">No results to display</div>
          <div className="text-sm mt-1">Run an analysis first to see results here</div>
          <Link href="/solver">
            <Button variant="outline" size="sm" className="mt-4">Go to Solver</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Build convergence chart data
  const convergenceData = results.convergenceData.flatMap((point: SolverConvergencePoint) => {
    const color = point.method.includes("TK") ? "hsl(38,92%,55%)" : "hsl(199,89%,48%)";
    const seriesKey = point.method.includes("TK") ? "TK-FEM" : "Standard FEM";
    return [{ x: point.nElem, y: point.error, series: seriesKey, color }];
  });

  // SCF convergence
  const scfData = results.convergenceData.flatMap((point: SolverConvergencePoint) => {
    const color = point.method.includes("TK") ? "hsl(38,92%,55%)" : "hsl(199,89%,48%)";
    const seriesKey = point.method.includes("TK") ? "TK-FEM" : "Standard FEM";
    return [{ x: point.nElem, y: point.scf, series: seriesKey, color }];
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/solver/${selectedId}`}>
              <Button variant="ghost" size="sm" className="text-muted-foreground p-1">
                <ChevronLeft size={14} />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Results: {analysis.name}</h1>
            <Badge variant="outline" className="status-complete text-xs">Complete</Badge>
          </div>
          <p className="text-sm text-muted-foreground font-mono">
            {results.nElements} elements · {results.nDOF} DOFs · Magnus m={results.magnusOrder}
            {results.executionTimeMs && ` · ${results.executionTimeMs}ms`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV} data-testid="button-export-csv">
          <Download size={13} className="mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* Key metrics */}
      {results.kirschSCF !== undefined && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "SCF K_t (TK-FEM)", value: results.kirschSCF?.toFixed(4), sub: "Kirsch exact = 3.0000", color: "primary" },
            {
              label: "Error vs Kirsch",
              value: `${(results.kirschError ?? 0).toFixed(2)}%`,
              sub: "Relative",
              color: (results.kirschError ?? Number.POSITIVE_INFINITY) < 5 ? "chart-3" : "chart-5",
            },
            { label: "Max von Mises", value: results.maxVonMises?.toFixed(2), sub: "MPa", color: "accent" },
            { label: "Max |u|", value: results.maxDisp?.toExponential(3), sub: "mm", color: "foreground" },
          ].map(({ label, value, sub, color }) => (
            <Card key={label} className="border-border bg-card">
              <CardContent className="pt-4 pb-4">
                <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                <div className="text-xl font-bold font-mono" style={{ color: `hsl(var(--${color}))` }}>{value}</div>
                <div className="text-xs text-muted-foreground">{sub}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="convergence">
        <TabsList>
          <TabsTrigger value="convergence">Convergence</TabsTrigger>
          <TabsTrigger value="kirsch">Kirsch Validation</TabsTrigger>
          <TabsTrigger value="nodes">Node Displacements</TabsTrigger>
          <TabsTrigger value="elements">Element Stresses</TabsTrigger>
        </TabsList>

        <TabsContent value="convergence" className="mt-4 space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp size={13} style={{ color: "hsl(var(--primary))" }} />
                Error vs. Number of Elements — TK-FEM vs Standard FEM
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LineChart
                data={convergenceData}
                title=""
                xLabel="Number of Elements"
                yLabel="Error (%)"
              />
              <p className="text-xs text-muted-foreground mt-3">
                TK-FEM achieves lower error per element due to exact intra-element field satisfaction via Koenian transport. Standard FEM requires more elements for equivalent accuracy due to polynomial interpolation error.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm">SCF Convergence to K_t = 3.0</CardTitle>
            </CardHeader>
            <CardContent>
              <LineChart
                data={scfData}
                title=""
                xLabel="Number of Elements"
                yLabel="SCF K_t"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kirsch" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm">Kirsch Analytical Solution — σ_θθ at Hole Boundary (r = a)</CardTitle>
            </CardHeader>
            <CardContent>
              <KirschChart loadMag={analysis.loadMagnitude} holeRadius={analysis.holeRadius} />
              <div className="mt-4 bg-secondary/40 rounded-md p-3 text-xs font-mono space-y-1">
                <div className="text-muted-foreground">Kirsch (1898) analytical solution — plate with circular hole, uniaxial tension σ∞:</div>
                <div className="text-foreground mt-2">σ_θθ(a, θ) = σ∞ · (1 − 2cos2θ)</div>
                <div className="text-foreground">σ_max = σ∞ · 3  at  θ = ±90°  →  K_t = 3.0</div>
                <div className="text-primary mt-2">TK-FEM K_t = {results.kirschSCF?.toFixed(4) ?? "—"} (error = {results.kirschError?.toFixed(2) ?? "—"}%)</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nodes" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm">Nodal Displacements</CardTitle></CardHeader>
            <CardContent>
              <NodeTable results={results} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="elements" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm">Element Stresses (MPa)</CardTitle></CardHeader>
            <CardContent>
              <ElementTable results={results} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
