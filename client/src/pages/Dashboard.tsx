import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Cpu, FolderOpen, FlaskConical, TrendingUp, Zap, CheckCircle2, Clock } from "lucide-react";
import type { Project, Analysis } from "@shared/schema";

function StatCard({ icon: Icon, label, value, sub, color }: any) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground mb-1">{label}</div>
            <div className="text-2xl font-bold font-mono" style={{ color: `hsl(var(--${color || "primary"}))` }}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
          </div>
          <div className="p-3 rounded-lg" style={{ background: `hsl(var(--${color || "primary"}) / 0.12)` }}>
            <Icon size={20} style={{ color: `hsl(var(--${color || "primary"}))` }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MeshPreviewSVG({ nx = 4, ny = 4, hasHole = false }: { nx?: number; ny?: number; hasHole?: boolean }) {
  const W = 100, H = 100;
  const lines: JSX.Element[] = [];
  for (let i = 0; i <= nx; i++) {
    const x = (i / nx) * W;
    lines.push(<line key={`v${i}`} x1={x} y1="0" x2={x} y2={H} stroke="hsl(217,33%,35%)" strokeWidth="0.8" />);
  }
  for (let j = 0; j <= ny; j++) {
    const y = (j / ny) * H;
    lines.push(<line key={`h${j}`} x1="0" y1={y} x2={W} y2={y} stroke="hsl(217,33%,35%)" strokeWidth="0.8" />);
  }
  return (
    <svg viewBox="-5 -5 110 110" className="w-full h-28">
      <rect x="0" y="0" width={W} height={H} fill="hsl(217,33%,14%)" />
      {lines}
      {hasHole && (
        <>
          <circle cx="50" cy="50" r="12" fill="hsl(217,33%,11%)" stroke="hsl(38,92%,55%)" strokeWidth="1.2" />
          <text x="55" y="33" fill="hsl(38,92%,55%)" fontSize="5" fontFamily="monospace">σ∞</text>
          <path d="M95,50 L85,50" stroke="hsl(38,92%,55%)" strokeWidth="1.2" markerEnd="url(#arr)" />
        </>
      )}
      <defs>
        <marker id="arr" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 Z" fill="hsl(38,92%,55%)" />
        </marker>
      </defs>
    </svg>
  );
}

export default function Dashboard() {
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects"] });
  const { data: analyses = [] } = useQuery<Analysis[]>({ queryKey: ["/api/analyses"] });

  const complete = analyses.filter(a => a.status === "complete").length;
  const pending = analyses.filter(a => a.status === "pending").length;
  const running = analyses.filter(a => a.status === "running").length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Hero */}
      <div className="rounded-xl border border-border bg-card p-6 flex items-start gap-6">
        <div className="flex-1">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Trefftz-Koen Hybrid FEM</div>
          <h1 className="text-2xl font-bold mb-2">
            <span className="brand-gradient">TK-FEM Solver</span>
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-xl">
            A novel hybrid finite element formulation combining the classical Trefftz philosophy of exact intra-element field satisfaction with Lie-series transport closure via Magnus expansion — generating T-complete fields on-the-fly without hand-built analytic bases.
          </p>
          <div className="flex gap-2 mt-4 flex-wrap">
            <Link href="/new-analysis">
              <Button size="sm" data-testid="button-new-analysis">
                <FlaskConical size={14} className="mr-2" />
                New Analysis
              </Button>
            </Link>
            <Link href="/theory">
              <Button variant="outline" size="sm" data-testid="button-view-theory">
                View Theory
              </Button>
            </Link>
          </div>
        </div>
        <div className="hidden md:block w-52 shrink-0">
          <MeshPreviewSVG nx={5} ny={5} hasHole={true} />
          <div className="text-center text-xs text-muted-foreground mt-1 font-mono">Kirsch benchmark — K_t = 3.0</div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={FolderOpen} label="Projects" value={projects.length} sub="active analyses" color="primary" />
        <StatCard icon={Activity} label="Total Runs" value={analyses.length} sub="FEM analyses" color="accent" />
        <StatCard icon={CheckCircle2} label="Complete" value={complete} sub="solved" color="chart-3" />
        <StatCard icon={Clock} label="Pending" value={pending + running} sub="queued/running" />
      </div>

      {/* Method Summary */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap size={14} style={{ color: "hsl(var(--primary))" }} />
              Koenian Transport Lift
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p>Recasts 2D elasticity PDE as first-order transport system:</p>
            <div className="font-mono bg-secondary px-2 py-1.5 rounded text-xs border-l-2 border-primary mt-2">
              ∂w/∂x = Ax·w,  ∂w/∂y = Ay·w
            </div>
            <p className="mt-1">State: w = [u, ∂ₓu, ∂ᵧu]ᵀ ∈ ℝ⁶</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp size={14} style={{ color: "hsl(var(--accent))" }} />
              Magnus Expansion
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p>Exact intra-element field via path-ordered exponential:</p>
            <div className="font-mono bg-secondary px-2 py-1.5 rounded text-xs border-l-2 border-accent mt-2">
              u(x,y) = Π·exp(Ω(x,y))·w₀
            </div>
            <p className="mt-1">Ω = Σ Ωₖ truncates at nilpotent class m</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu size={14} style={{ color: "hsl(var(--chart-3))" }} />
              Hybrid Assembly
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p>Element stiffness via boundary-only integrals:</p>
            <div className="font-mono bg-secondary px-2 py-1.5 rounded text-xs border-l-2 border-chart-3 mt-2">
              Ke = ∫∂Ωe Nᵀ H N ds
            </div>
            <p className="mt-1">H = DtN kernel from Koenian transport</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent analyses */}
      {analyses.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">Recent Analyses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {analyses.slice(0, 5).map(a => (
                <div key={a.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {a.meshNx}×{a.meshNy} mesh · E={a.youngModulus.toLocaleString()} · ν={a.poissonRatio} · m={a.magnusTruncation}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-xs status-${a.status}`}
                    >
                      {a.status}
                    </Badge>
                    <Link href={`/solver/${a.id}`}>
                      <Button variant="ghost" size="sm" className="text-xs" data-testid={`button-open-analysis-${a.id}`}>
                        Open
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Formula overview */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Key Equations</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3 text-xs">
          {[
            { label: "Governing PDE (plane stress)", eq: "∇·σ(u) = 0  in Ω" },
            { label: "Transport lift (Magnus solution)", eq: "w(x,y) = exp(Σ Ωₖ(x,y)) · w₀" },
            { label: "Koenian closure condition", eq: "Ω_{m+1} = Ω_{m+2} = ... = 0  (nilpotent class m)" },
            { label: "Hybrid functional stationarity", eq: "∫∂Ωe δû · [t(uₕ) − t(û)] ds = 0" },
            { label: "Stress concentration factor (Kirsch)", eq: "K_t = σ_max / σ∞ = 3.0" },
            { label: "Flatness criterion", eq: "R = dA − A ∧ A = 0" },
          ].map(({ label, eq }) => (
            <div key={label} className="p-3 rounded-md border border-border bg-secondary/40">
              <div className="text-muted-foreground mb-1">{label}</div>
              <div className="font-mono text-foreground/90">{eq}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
