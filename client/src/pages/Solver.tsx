import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  DeflectionContourCanvas,
  StressContourCanvas,
} from "@/components/results/field-canvases";
import type { Analysis } from "@shared/schema";
import type { DeflectionField, SolverResults, StressField } from "@shared/solver";
import { Clock, ExternalLink, Play, RefreshCw } from "lucide-react";

function estimateBoundaryFrameCount(analysis: Analysis) {
  const base = analysis.meshNx * 2 + analysis.meshNy * 2;
  return analysis.domainType === "circle_hole" ? base + Math.max(4, Math.round((analysis.meshNx + analysis.meshNy) / 2)) : base;
}

function formatValue(value: number) {
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

function FieldButtons<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? "default" : "outline"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function SolverLog({
  analysis,
  isRunning,
}: {
  analysis: Analysis;
  isRunning: boolean;
}) {
  const results = (analysis.results as SolverResults | null) ?? null;
  const magnus = results?.magnusAnalysis;
  const nodeCount = analysis.analysisMode === "functionized" ? estimateBoundaryFrameCount(analysis) : (analysis.meshNx + 1) * (analysis.meshNy + 1);
  const lines = [
    `[ANALYSIS] ${analysis.name}`,
    `[MODE] ${analysis.analysisMode === "functionized" ? "functionized single-domain" : "meshed TK-FEM"}`,
    `[DOMAIN] ${analysis.domainType === "circle_hole" ? "quarter plate with circular hole" : "rectangle"}; W=${analysis.domainWidth} mm, H=${analysis.domainHeight} mm, a=${analysis.holeRadius} mm`,
    analysis.analysisMode === "functionized"
      ? `[BOUNDARY] resolution=${analysis.meshNx} x ${analysis.meshNy}, ${nodeCount} boundary frames, ${nodeCount * 2} boundary DOFs, q=${analysis.boundaryQuadratureOrder}`
      : `[MESH] ${analysis.meshNx} x ${analysis.meshNy} elements, ${nodeCount} nodes, ${nodeCount * 2} DOFs`,
    `[MATERIAL] E=${analysis.youngModulus.toLocaleString()} MPa, nu=${analysis.poissonRatio}, ${analysis.planeType}`,
    `[LOAD] ${analysis.loadType}, magnitude=${analysis.loadMagnitude} MPa`,
    `[MAGNUS] mode=${analysis.magnusMode}, requested m=${analysis.magnusTruncation}`,
    results
      ? `[MAGNUS] backend=${magnus?.backend ?? "n/a"}, strategy=${magnus?.strategy ?? "n/a"}, applied m=${results.magnusOrder}`
      : "[MAGNUS] closure analysis runs before stiffness assembly",
    results
      ? `[MAGNUS] finite closure=${magnus?.finiteSeriesExact ? "yes" : "no"}, closure order=${magnus?.closureOrder ?? "not finite"}`
      : "[MAGNUS] evaluating Lie-algebra closure and sufficient convergence bounds",
    results
      ? `[POST] peak displacement=${formatValue(results.maxDisp)} mm, peak von Mises=${formatValue(results.maxVonMises)} MPa`
      : "[POST] waiting for solver output",
    results?.analysisMode === "functionized" && results.functionizedDiagnostics
      ? `[POST] boundary residual max=${formatValue(results.functionizedDiagnostics.maxBoundaryResidual)}, rms=${formatValue(results.functionizedDiagnostics.rmsBoundaryResidual)}`
      : "[POST] boundary residual diagnostics are not active for meshed runs",
    typeof results?.kirschSCF === "number"
      ? `[POST] Kirsch SCF=${results.kirschSCF.toFixed(4)}, error=${results.kirschError?.toFixed(2) ?? "n/a"}%`
      : "[POST] Kirsch benchmark not available for this case",
  ];

  if (analysis.status === "error") {
    lines.push(`[ERROR] ${analysis.errorMessage ?? "Unknown solver error"}`);
  } else if (analysis.status === "complete" && results) {
    lines.push(`[DONE] solution completed in ${results.executionTimeMs} ms`);
  } else if (isRunning) {
    lines.push("[RUN] solver is executing");
  }

  return (
    <div className="h-80 space-y-1 overflow-y-auto rounded-md border border-border bg-secondary/40 p-3 font-mono text-xs">
      {lines.map((line) => (
        <div
          key={line}
          className={
            line.startsWith("[ERROR]")
              ? "text-destructive"
              : line.startsWith("[DONE]")
                ? "text-emerald-400"
                : line.startsWith("[MAGNUS]")
                  ? "text-amber-300"
                  : line.startsWith("[POST]")
                    ? "text-sky-300"
                    : "text-muted-foreground"
          }
        >
          {line}
        </div>
      ))}
      {isRunning ? <div className="animate-pulse text-amber-300">processing...</div> : null}
    </div>
  );
}

function ParameterCard({
  title,
  items,
}: {
  title: string;
  items: Array<[string, string]>;
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 text-sm last:border-0 last:pb-0">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-mono text-foreground">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Solver() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [stressField, setStressField] = useState<StressField>("vonMises");
  const [deflectionField, setDeflectionField] = useState<DeflectionField>("uMagnitude");

  const { data: analyses = [] } = useQuery<Analysis[]>({ queryKey: ["/api/analyses"] });

  const selectedId = id ? Number.parseInt(id, 10) : analyses[0]?.id;
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
      setIsRunning(false);
      toast({ title: "Analysis complete" });
    },
    onError: () => {
      setIsRunning(false);
      toast({ title: "Solver error", variant: "destructive" });
    },
  });

  const results = (analysis?.results as SolverResults | null) ?? null;
  const magnus = results?.magnusAnalysis;

  if (!analysis) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Card className="border-border bg-card">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Clock size={32} className="mx-auto mb-3 opacity-30" />
            <div>No analysis is selected.</div>
            <Link href="/new-analysis">
              <Button variant="outline" size="sm" className="mt-4">
                Create Analysis
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{analysis.name}</h1>
          <p className="text-sm text-muted-foreground">
            {analysis.analysisMode === "functionized"
              ? `single-domain functionized solve, boundary resolution ${analysis.meshNx} x ${analysis.meshNy}, q = ${analysis.boundaryQuadratureOrder}, ${analysis.planeType}`
              : `${analysis.meshNx} x ${analysis.meshNy} mesh, ${analysis.planeType}, ${analysis.magnusMode} Magnus mode, requested m = ${analysis.magnusTruncation}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={`status-${analysis.status}`}>
            {analysis.status === "running" || isRunning ? "running" : analysis.status}
          </Badge>
          <Button
            onClick={() => runMutation.mutate(analysis.id)}
            disabled={isRunning || runMutation.isPending}
          >
            {isRunning ? <RefreshCw size={14} className="mr-2 animate-spin" /> : <Play size={14} className="mr-2" />}
            {isRunning ? "Solving" : "Run TK-FEM"}
          </Button>
          {results ? (
            <Link href={`/results/${analysis.id}`}>
              <Button variant="outline" size="sm">
                <ExternalLink size={14} className="mr-2" />
                Open Results
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      {!id && analyses.length > 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="pt-4">
            <div className="mb-3 text-xs text-muted-foreground">Available analyses</div>
            <div className="flex flex-wrap gap-2">
              {analyses.map((item) => (
                <Button key={item.id} variant={item.id === analysis.id ? "default" : "outline"} size="sm" onClick={() => navigate(`/solver/${item.id}`)}>
                  {item.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isRunning ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-amber-300">
            <RefreshCw size={14} className="animate-spin" />
            {analysis.analysisMode === "functionized"
              ? "Running Magnus analysis, exact-boundary collocation, and single-domain solve stages."
              : "Running Magnus analysis, stiffness assembly, and solve stages."}
          </div>
          <Progress value={65} className="h-1.5" />
        </div>
      ) : null}

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">Log</TabsTrigger>
          <TabsTrigger value="preview" disabled={!results}>
            Preview
          </TabsTrigger>
          <TabsTrigger value="params">Parameters</TabsTrigger>
        </TabsList>

        <TabsContent value="log" className="mt-4 space-y-4">
          <SolverLog analysis={analysis} isRunning={isRunning} />

          {results ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card className="border-border bg-card">
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">Peak displacement</div>
                  <div className="mt-1 text-lg font-semibold">{formatValue(results.maxDisp)} mm</div>
                </CardContent>
              </Card>
              <Card className="border-border bg-card">
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">Peak von Mises</div>
                  <div className="mt-1 text-lg font-semibold">{formatValue(results.maxVonMises)} MPa</div>
                </CardContent>
              </Card>
              <Card className="border-border bg-card">
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">Magnus strategy</div>
                  <div className="mt-1 text-lg font-semibold">
                    {magnus?.strategy === "finite_closure"
                      ? "Finite closure"
                      : magnus?.strategy === "manual_truncation"
                        ? "Manual truncation"
                        : "Truncated Magnus"}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border bg-card">
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">Effective Magnus order</div>
                  <div className="mt-1 text-lg font-semibold">m = {results.magnusOrder}</div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="preview" className="mt-4 space-y-4">
          {results ? (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="border-border bg-card">
                  <CardHeader className="pb-2 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="text-sm">Stress preview</CardTitle>
                      <FieldButtons
                        value={stressField}
                        onChange={setStressField}
                        options={[
                          { value: "vonMises", label: "von Mises" },
                          { value: "sxx", label: "sigma_xx" },
                          { value: "syy", label: "sigma_yy" },
                          { value: "sxy", label: "tau_xy" },
                        ]}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <StressContourCanvas results={results} field={stressField} />
                    <p className="text-xs text-muted-foreground">
                      {results.analysisMode === "functionized"
                        ? "Open the Results page for full boundary diagnostics, convergence plots, and exact-geometry post-processing."
                        : "Open the Results page for full post-processing, convergence plots, and exports."}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-card">
                  <CardHeader className="pb-2 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="text-sm">Deflection preview</CardTitle>
                      <FieldButtons
                        value={deflectionField}
                        onChange={setDeflectionField}
                        options={[
                          { value: "uMagnitude", label: "|u|" },
                          { value: "ux", label: "u_x" },
                          { value: "uy", label: "u_y" },
                        ]}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <DeflectionContourCanvas results={results} field={deflectionField} />
                    <p className="text-xs text-muted-foreground">
                      Magnus diagnostics: {magnus?.summary ?? "no Magnus summary is available for this run."}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="params" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ParameterCard
              title="Mode"
              items={[
                ["Analysis mode", analysis.analysisMode],
                ["Boundary quadrature", `${analysis.boundaryQuadratureOrder}`],
              ]}
            />
            <ParameterCard
              title="Domain"
              items={[
                ["Type", analysis.domainType],
                ["Width", `${analysis.domainWidth} mm`],
                ["Height", `${analysis.domainHeight} mm`],
                ["Hole radius", `${analysis.holeRadius} mm`],
                ["Plane model", analysis.planeType],
              ]}
            />
            <ParameterCard
              title={analysis.analysisMode === "functionized" ? "Resolution" : "Mesh"}
              items={[
                ["Nx x Ny", `${analysis.meshNx} x ${analysis.meshNy}`],
                [analysis.analysisMode === "functionized" ? "Comp. elements" : "Elements", `${analysis.analysisMode === "functionized" ? 1 : analysis.meshNx * analysis.meshNy}`],
                [analysis.analysisMode === "functionized" ? "Boundary frames" : "Nodes", `${analysis.analysisMode === "functionized" ? estimateBoundaryFrameCount(analysis) : (analysis.meshNx + 1) * (analysis.meshNy + 1)}`],
                [analysis.analysisMode === "functionized" ? "Boundary DOFs" : "DOFs", `${analysis.analysisMode === "functionized" ? estimateBoundaryFrameCount(analysis) * 2 : (analysis.meshNx + 1) * (analysis.meshNy + 1) * 2}`],
              ]}
            />
            <ParameterCard
              title="Material"
              items={[
                ["Young's modulus", `${analysis.youngModulus.toLocaleString()} MPa`],
                ["Poisson ratio", `${analysis.poissonRatio}`],
              ]}
            />
            <ParameterCard
              title="Load"
              items={[
                ["Type", analysis.loadType],
                ["Magnitude", `${analysis.loadMagnitude} MPa`],
              ]}
            />
            <ParameterCard
              title="Magnus setup"
              items={[
                ["Mode", analysis.magnusMode],
                ["Requested order", `m = ${analysis.magnusTruncation}`],
                ["Backend", magnus?.backend ?? "pending"],
                ["Strategy", magnus?.strategy ?? "pending"],
              ]}
            />
            <ParameterCard
              title="Magnus result"
              items={[
                ["Applied order", results ? `m = ${results.magnusOrder}` : "pending"],
                ["Finite closure", magnus ? (magnus.finiteSeriesExact ? "yes" : "no") : "pending"],
                ["Closure order", magnus?.closureOrder ? `${magnus.closureOrder}` : magnus ? "not finite" : "pending"],
                ["Convergence bound", magnus ? (magnus.convergenceGuaranteed ? "satisfied" : "not guaranteed") : "pending"],
              ]}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
