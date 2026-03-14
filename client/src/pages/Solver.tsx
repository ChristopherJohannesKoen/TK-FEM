import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Play, RefreshCw, AlertCircle, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type { Analysis } from "@shared/schema";
import { useEffect, useRef, useState } from "react";

// Stress color map: blue → cyan → green → yellow → orange → red
function stressColor(value: number, min: number, max: number): string {
  const t = max > min ? (value - min) / (max - min) : 0;
  const colors = [
    [26, 26, 110],   // deep blue
    [0, 102, 204],   // blue
    [0, 191, 255],   // cyan
    [0, 255, 128],   // green
    [255, 255, 0],   // yellow
    [255, 128, 0],   // orange
    [255, 0, 0],     // red
    [139, 0, 0],     // dark red
  ];
  const seg = t * (colors.length - 1);
  const idx = Math.min(Math.floor(seg), colors.length - 2);
  const frac = seg - idx;
  const c0 = colors[idx], c1 = colors[idx + 1];
  const r = Math.round(c0[0] + frac * (c1[0] - c0[0]));
  const g = Math.round(c0[1] + frac * (c1[1] - c0[1]));
  const b = Math.round(c0[2] + frac * (c1[2] - c0[2]));
  return `rgb(${r},${g},${b})`;
}

function StressContourCanvas({ results, field }: { results: any; field: "vonMises" | "sxx" | "syy" | "sxy" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!results?.stresses || !results?.nodes) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const stresses = results.stresses;
    const nodes = results.nodes;

    if (!stresses.length) return;

    const allX = nodes.map((n: any) => n.x);
    const allY = nodes.map((n: any) => n.y);
    const xMin = Math.min(...allX), xMax = Math.max(...allX);
    const yMin = Math.min(...allY), yMax = Math.max(...allY);

    const pad = 24;
    const scX = (cw - pad * 2) / (xMax - xMin || 1);
    const scY = (ch - pad * 2) / (yMax - yMin || 1);
    const sc = Math.min(scX, scY);

    const toCanvas = (x: number, y: number) => ({
      cx: pad + (x - xMin) * sc,
      cy: ch - pad - (y - yMin) * sc,
    });

    const values = stresses.map((s: any) => s[field] as number);
    const vMin = Math.min(...values), vMax = Math.max(...values);

    // Draw elements as filled quads
    // Build a node map for displacement
    const nodeMap = new Map<number, any>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // Draw each element
    ctx.save();
    for (const stress of stresses) {
      const { cx, cy } = toCanvas(stress.cx, stress.cy);
      const val = stress[field] as number;
      const color = stressColor(val, vMin, vMax);

      // Draw a rect for each element centroid area
      const wx = sc * (xMax - xMin) / (results.nodes.length ** 0.5 || 4);
      const wy = sc * (yMax - yMin) / (results.nodes.length ** 0.5 || 4);
      const hw = wx / 2, hh = wy / 2;

      ctx.fillStyle = color;
      ctx.fillRect(cx - hw, cy - hh, wx, wy);
    }

    // Draw mesh lines
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 0.5;
    for (const n of nodes) {
      const { cx, cy } = toCanvas(n.x, n.y);
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fill();
    }
    ctx.restore();

    // Color scale bar
    const barX = cw - 18, barH = ch - pad * 2;
    const grad = ctx.createLinearGradient(0, pad, 0, pad + barH);
    grad.addColorStop(0, "rgb(139,0,0)");
    grad.addColorStop(0.25, "rgb(255,128,0)");
    grad.addColorStop(0.5, "rgb(255,255,0)");
    grad.addColorStop(0.75, "rgb(0,191,255)");
    grad.addColorStop(1, "rgb(26,26,110)");
    ctx.fillStyle = grad;
    ctx.fillRect(barX, pad, 10, barH);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.strokeRect(barX, pad, 10, barH);

    // Labels
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(vMax.toFixed(1), barX + 13, pad + 8);
    ctx.fillText(((vMax + vMin) / 2).toFixed(1), barX + 13, pad + barH / 2);
    ctx.fillText(vMin.toFixed(1), barX + 13, pad + barH);

  }, [results, field]);

  return <canvas ref={canvasRef} width={480} height={360} className="rounded-md border border-border w-full" />;
}

function SolverLog({ analysis, isRunning }: { analysis: Analysis; isRunning: boolean }) {
  const results = analysis.results as any;
  const lines: string[] = [
    `[TK-FEM] Analysis: "${analysis.name}"`,
    `[MESH]   Domain: ${analysis.domainWidth}×${analysis.domainHeight}mm, ${analysis.domainType === "circle_hole" ? `hole r=${analysis.holeRadius}mm` : "rect"}`,
    `[MESH]   Elements: ${analysis.meshNx}×${analysis.meshNy} = ${analysis.meshNx * analysis.meshNy}, Nodes: ${(analysis.meshNx + 1) * (analysis.meshNy + 1)}, DOFs: ${(analysis.meshNx + 1) * (analysis.meshNy + 1) * 2}`,
    `[MAT]    E=${analysis.youngModulus.toLocaleString()} MPa, ν=${analysis.poissonRatio}, ${analysis.planeType}`,
    `[LOAD]   Type: ${analysis.loadType}, Magnitude: ${analysis.loadMagnitude} MPa`,
    `[TK]     Magnus truncation: m=${analysis.magnusTruncation}`,
    `[TK]     Building transport operators Ax, Ay ∈ R^{6×6}...`,
    `[TK]     Koenian transport lift: ∂w/∂x = Ax·w, ∂w/∂y = Ay·w`,
    `[TK]     State: w = [u_x, u_y, ∂_x·u_x, ∂_x·u_y, ∂_y·u_x, ∂_y·u_y]ᵀ ∈ R^6`,
    `[MAGNUS] Computing Ω₁ = ∫₀¹ G(s) ds...`,
    `[MAGNUS] Computing Ω₂ = ½[Ω₁, G_avg]... (commutator)`,
    analysis.magnusTruncation >= 3 ? `[MAGNUS] Computing Ω₃ = ⅙[[Ω₁,Ω₂],Ω₁]...` : `[MAGNUS] Truncated at m=${analysis.magnusTruncation}`,
    `[ASSEM]  Building element stiffness via boundary integrals: Ke = ∫∂Ωe Nᵀ H N ds`,
    `[ASSEM]  Applying Magnus correction (Koenian closure check)...`,
    `[ASSEM]  Assembling global stiffness K (${(analysis.meshNx + 1) * (analysis.meshNy + 1) * 2}×${(analysis.meshNx + 1) * (analysis.meshNy + 1) * 2})...`,
    `[BC]     Applying Dirichlet BCs (symmetry: u_x=0 on Γ_L, u_y=0 on Γ_B)`,
    `[SOLVE]  Gauss elimination with partial pivoting...`,
  ];

  if (analysis.status === "complete" && results) {
    lines.push(`[POST]   Recovering stresses from transport state w(x,y) = exp(Ω)·w₀...`);
    lines.push(`[POST]   Max displacement: ${results.maxDisp?.toExponential(3)} mm`);
    lines.push(`[POST]   Max von Mises: ${results.maxVonMises?.toFixed(2)} MPa`);
    if (results.kirschSCF !== undefined) {
      lines.push(`[POST]   SCF K_t = σ_max/σ∞ = ${results.kirschSCF?.toFixed(4)}`);
      lines.push(`[POST]   Kirsch exact = 3.0000, Error = ${results.kirschError?.toFixed(2)}%`);
    }
    lines.push(`[TK-FEM] Solution complete in ${results.executionTimeMs}ms ✓`);
  } else if (analysis.status === "error") {
    lines.push(`[ERROR]  ${analysis.errorMessage}`);
  } else if (isRunning) {
    lines.push(`[SOLVE]  Running...`);
  }

  return (
    <div className="font-mono text-xs bg-secondary/60 border border-border rounded-md p-3 h-72 overflow-y-auto space-y-0.5">
      {lines.map((line, i) => (
        <div key={i} className={
          line.startsWith("[ERROR]") ? "text-destructive" :
          line.startsWith("[TK-FEM]") ? "text-primary" :
          line.startsWith("[POST]") ? "text-green-400" :
          line.startsWith("[MAGNUS]") ? "text-accent" :
          "text-muted-foreground"
        }>{line}</div>
      ))}
      {isRunning && <div className="text-yellow-400 animate-pulse">▌</div>}
    </div>
  );
}

export default function Solver() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [stressField, setStressField] = useState<"vonMises" | "sxx" | "syy" | "sxy">("vonMises");
  const [isRunning, setIsRunning] = useState(false);

  const { data: analyses = [] } = useQuery<Analysis[]>({ queryKey: ["/api/analyses"] });

  const selectedId = id ? parseInt(id) : analyses[0]?.id;
  const { data: analysis, refetch } = useQuery<Analysis>({
    queryKey: ["/api/analyses", selectedId],
    enabled: !!selectedId,
    refetchInterval: isRunning ? 1000 : false,
  });

  useEffect(() => {
    if (analysis?.status === "complete" || analysis?.status === "error") {
      setIsRunning(false);
    }
  }, [analysis?.status]);

  const runMutation = useMutation({
    mutationFn: (analysisId: number) => apiRequest("POST", `/api/analyses/${analysisId}/run`, {}),
    onMutate: () => setIsRunning(true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/analyses", selectedId] });
      await refetch();
      toast({ title: "Analysis complete" });
      setIsRunning(false);
    },
    onError: (err: any) => {
      toast({ title: "Solver error", variant: "destructive" });
      setIsRunning(false);
    },
  });

  const results = analysis?.results as any;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{analysis?.name || "Solver"}</h1>
          <p className="text-sm text-muted-foreground font-mono">
            {analysis && `${analysis.meshNx}×${analysis.meshNy} mesh · E=${analysis.youngModulus.toLocaleString()} · ν=${analysis.poissonRatio} · m=${analysis.magnusTruncation}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {analysis?.status && (
            <Badge variant="outline" className={`status-${analysis.status}`}>
              {analysis.status === "running" || isRunning ? "Running..." : analysis.status}
            </Badge>
          )}
          {analysis && (
            <Button
              onClick={() => runMutation.mutate(analysis.id)}
              disabled={isRunning || runMutation.isPending}
              data-testid="button-run-solver"
            >
              {isRunning ? <RefreshCw size={14} className="mr-2 animate-spin" /> : <Play size={14} className="mr-2" />}
              {isRunning ? "Solving..." : "Run TK-FEM"}
            </Button>
          )}
          {results && (
            <Link href={`/results/${selectedId}`}>
              <Button variant="outline" size="sm" data-testid="button-view-results">
                <ExternalLink size={13} className="mr-1.5" />
                Results
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Analysis selector */}
      {!id && analyses.length > 0 && (
        <Card className="border-border bg-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-2">Select analysis:</div>
            <div className="flex flex-wrap gap-2">
              {analyses.map(a => (
                <button
                  key={a.id}
                  onClick={() => navigate(`/solver/${a.id}`)}
                  className="text-xs px-3 py-1.5 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors"
                  data-testid={`button-select-analysis-${a.id}`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      {isRunning && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-yellow-400">
            <RefreshCw size={14} className="animate-spin" />
            Solving TK-FEM system...
          </div>
          <Progress value={65} className="h-1.5" />
        </div>
      )}

      {analysis ? (
        <Tabs defaultValue="log">
          <TabsList>
            <TabsTrigger value="log">Solver Log</TabsTrigger>
            <TabsTrigger value="contour" disabled={!results}>Stress Contours</TabsTrigger>
            <TabsTrigger value="params">Parameters</TabsTrigger>
          </TabsList>

          <TabsContent value="log" className="mt-4">
            <SolverLog analysis={analysis} isRunning={isRunning} />
            {analysis.status === "complete" && results && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                {[
                  { label: "Elements", value: `${results.nElements}`, unit: "" },
                  { label: "DOFs", value: `${results.nDOF}`, unit: "" },
                  { label: "Max Displacement", value: results.maxDisp?.toExponential(3), unit: "mm" },
                  { label: "Max von Mises", value: results.maxVonMises?.toFixed(2), unit: "MPa" },
                  ...(results.kirschSCF !== undefined ? [
                    { label: "SCF K_t", value: results.kirschSCF?.toFixed(4), unit: "" },
                    { label: "Kirsch Error", value: results.kirschError?.toFixed(2) + "%", unit: "" },
                    { label: "Magnus Order m", value: String(results.magnusOrder), unit: "" },
                    { label: "Solve Time", value: `${results.executionTimeMs}`, unit: "ms" },
                  ] : []),
                ].map(({ label, value, unit }) => (
                  <div key={label} className="bg-card border border-border rounded-md p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-mono font-bold text-sm text-primary">{value} <span className="text-xs text-muted-foreground">{unit}</span></div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="contour" className="mt-4">
            {results && (
              <div className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                  {(["vonMises", "sxx", "syy", "sxy"] as const).map(f => (
                    <Button
                      key={f}
                      variant={stressField === f ? "default" : "outline"}
                      size="sm"
                      onClick={() => setStressField(f)}
                      data-testid={`button-field-${f}`}
                    >
                      {f === "vonMises" ? "von Mises" : f === "sxx" ? "σ_xx" : f === "syy" ? "σ_yy" : "τ_xy"}
                    </Button>
                  ))}
                </div>
                <StressContourCanvas results={results} field={stressField} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="params" className="mt-4">
            {analysis && (
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  { section: "Domain", items: [
                    ["Type", analysis.domainType],
                    ["Width", `${analysis.domainWidth} mm`],
                    ["Height", `${analysis.domainHeight} mm`],
                    ["Hole Radius", `${analysis.holeRadius} mm`],
                    ["Plane Type", analysis.planeType],
                  ]},
                  { section: "Mesh", items: [
                    ["Nx × Ny", `${analysis.meshNx} × ${analysis.meshNy}`],
                    ["Elements", `${analysis.meshNx * analysis.meshNy}`],
                    ["Nodes", `${(analysis.meshNx+1)*(analysis.meshNy+1)}`],
                    ["DOFs", `${(analysis.meshNx+1)*(analysis.meshNy+1)*2}`],
                  ]},
                  { section: "Material", items: [
                    ["E", `${analysis.youngModulus.toLocaleString()} MPa`],
                    ["ν", `${analysis.poissonRatio}`],
                  ]},
                  { section: "TK-FEM", items: [
                    ["Magnus Truncation m", `${analysis.magnusTruncation}`],
                    ["Load Type", analysis.loadType],
                    ["Load Magnitude", `${analysis.loadMagnitude} MPa`],
                  ]},
                ].map(({ section, items }) => (
                  <Card key={section} className="border-border bg-card">
                    <CardHeader className="pb-1 pt-3"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">{section}</CardTitle></CardHeader>
                    <CardContent className="pb-3">
                      {items.map(([k, v]) => (
                        <div key={k} className="flex justify-between text-sm py-1 border-b border-border/50 last:border-0">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-mono">{v}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      ) : (
        <Card className="border-border bg-card">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Clock size={32} className="mx-auto mb-3 opacity-30" />
            <div>No analysis selected.</div>
            <Link href="/new-analysis">
              <Button variant="outline" size="sm" className="mt-4">Create New Analysis</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
