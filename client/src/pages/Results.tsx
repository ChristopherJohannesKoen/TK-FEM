import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  DeflectionContourCanvas,
  DeformedShapeCanvas,
  StressContourCanvas,
  getDeflectionFieldLabel,
  getStressFieldLabel,
} from "@/components/results/field-canvases";
import { MagnusAnalysisPanel } from "@/components/results/magnus-panel";
import type { Analysis } from "@shared/schema";
import type {
  DeflectionField,
  SolverBoundaryFrameResult,
  SolverConvergencePoint,
  SolverNodeResult,
  SolverResults,
  SolverStressResult,
  StressField,
} from "@shared/solver";
import { BarChart3, ChevronLeft, Download, Sigma, Waves } from "lucide-react";

interface SeriesInfo {
  key: string;
  label: string;
  color: string;
}

interface ChartRow {
  x: number;
  [key: string]: number | string | undefined;
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

function getSeriesColor(method: string) {
  if (method.includes("This Run")) {
    return "#f97316";
  }
  if (method.includes("Standard")) {
    return "#38bdf8";
  }
  return "#f59e0b";
}

function buildPivotedChartData(
  points: SolverConvergencePoint[],
  selectValue: (point: SolverConvergencePoint) => number,
) {
  const rowsByX = new Map<number, ChartRow>();
  const keyByMethod = new Map<string, string>();
  const series: SeriesInfo[] = [];

  points.forEach((point, index) => {
    const existingKey = keyByMethod.get(point.method);
    const key = existingKey ?? `series_${index}`;

    if (!existingKey) {
      keyByMethod.set(point.method, key);
      series.push({
        key,
        label: point.method,
        color: getSeriesColor(point.method),
      });
    }

    const row = rowsByX.get(point.nElem) ?? { x: point.nElem };
    row[key] = selectValue(point);
    rowsByX.set(point.nElem, row);
  });

  return {
    data: Array.from(rowsByX.values()).sort((left, right) => left.x - right.x),
    series,
  };
}

function buildKirschBoundaryData(results: SolverResults, loadMagnitude: number) {
  const computedByTheta = new Map<number, number>();
  for (const sample of results.holeBoundarySamples) {
    computedByTheta.set(Math.round(sample.thetaDeg), sample.sigmaThetaTheta);
  }

  return Array.from({ length: 181 }, (_, theta) => {
    const radians = (theta * Math.PI) / 180;
    return {
      theta,
      analytical: loadMagnitude * (1 - 2 * Math.cos(2 * radians)),
      computed: computedByTheta.get(theta),
    };
  });
}

function buildStressProfile(results: SolverResults, analysis: Analysis, field: StressField) {
  if (!results.stresses.length) {
    return [];
  }

  const targetY = analysis.domainHeight / 2;
  const closestY = results.stresses.reduce((best, stress) => {
    return Math.abs(stress.cy - targetY) < Math.abs(best - targetY) ? stress.cy : best;
  }, results.stresses[0].cy);

  return results.stresses
    .filter((stress) => Math.abs(stress.cy - closestY) < 1e-9)
    .sort((left, right) => left.cx - right.cx)
    .map((stress) => ({
      x: stress.cx,
      value: stress[field],
    }));
}

function buildDeflectionProfile(results: SolverResults, field: DeflectionField) {
  if (!results.nodes.length) {
    return [];
  }

  const edgeX = Math.max(...results.nodes.map((node) => node.x));
  return results.nodes
    .filter((node) => Math.abs(node.x - edgeX) < 1e-9)
    .sort((left, right) => left.y - right.y)
    .map((node) => ({
      x: node.y,
      value: node[field],
    }));
}

function buildBoundaryResponseData(results: SolverResults) {
  return results.boundaryFrames
    .slice()
    .sort((left, right) => left.normalizedArcLength - right.normalizedArcLength)
    .map((frame) => ({
      x: Number((frame.normalizedArcLength * 100).toFixed(3)),
      ux: frame.ux,
      uy: frame.uy,
      uMagnitude: frame.uMagnitude,
      tractionNormal: frame.tractionNormal,
      tractionTangential: frame.tractionTangential,
    }));
}

function ChartCard({
  title,
  data,
  series,
  xLabel,
  yLabel,
  referenceLine,
  footer,
}: {
  title: string;
  data: ChartRow[];
  series: SeriesInfo[];
  xLabel: string;
  yLabel: string;
  referenceLine?: { y: number; label: string };
  footer?: string;
}) {
  const chartConfig = Object.fromEntries(
    series.map((entry) => [
      entry.key,
      {
        label: entry.label,
        color: entry.color,
      },
    ]),
  );

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <ReLineChart data={data} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="x"
              tickLine={false}
              axisLine={false}
              label={{ value: xLabel, position: "insideBottom", offset: -4 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={80}
              label={{ value: yLabel, angle: -90, position: "insideLeft" }}
            />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <ChartLegend content={<ChartLegendContent />} />
            {referenceLine ? (
              <ReferenceLine
                y={referenceLine.y}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
                label={{ value: referenceLine.label, fill: "#94a3b8", fontSize: 12 }}
              />
            ) : null}
            {series.map((entry) => (
              <Line
                key={entry.key}
                type="monotone"
                dataKey={entry.key}
                name={entry.label}
                stroke={`var(--color-${entry.key})`}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </ReLineChart>
        </ChartContainer>
        {footer ? <p className="mt-3 text-xs text-muted-foreground">{footer}</p> : null}
      </CardContent>
    </Card>
  );
}

function SingleSeriesChart({
  title,
  data,
  xLabel,
  yLabel,
  color,
  seriesLabel,
  footer,
}: {
  title: string;
  data: Array<{ x: number; value: number }>;
  xLabel: string;
  yLabel: string;
  color: string;
  seriesLabel: string;
  footer?: string;
}) {
  const chartConfig = {
    value: {
      label: seriesLabel,
      color,
    },
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <ReLineChart data={data} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="x"
              tickLine={false}
              axisLine={false}
              label={{ value: xLabel, position: "insideBottom", offset: -4 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={80}
              label={{ value: yLabel, angle: -90, position: "insideLeft" }}
            />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <Line
              type="monotone"
              dataKey="value"
              name={seriesLabel}
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </ReLineChart>
        </ChartContainer>
        {footer ? <p className="mt-3 text-xs text-muted-foreground">{footer}</p> : null}
      </CardContent>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>
      </CardContent>
    </Card>
  );
}

function SectionFieldButtons<T extends string>({
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
          variant={value === option.value ? "default" : "outline"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function NodeTable({ nodes }: { nodes: SolverNodeResult[] }) {
  const preview = nodes.slice(0, 40);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4">Node</th>
            <th className="py-2 pr-4">x</th>
            <th className="py-2 pr-4">y</th>
            <th className="py-2 pr-4">u_x</th>
            <th className="py-2 pr-4">u_y</th>
            <th className="py-2 pr-4">|u|</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((node) => (
            <tr key={node.id} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-4 font-mono text-muted-foreground">{node.id}</td>
              <td className="py-2 pr-4 font-mono">{node.x.toFixed(4)}</td>
              <td className="py-2 pr-4 font-mono">{node.y.toFixed(4)}</td>
              <td className="py-2 pr-4 font-mono">{node.ux.toExponential(3)}</td>
              <td className="py-2 pr-4 font-mono">{node.uy.toExponential(3)}</td>
              <td className="py-2 pr-4 font-mono">{node.uMagnitude.toExponential(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {nodes.length > preview.length ? (
        <div className="pt-3 text-xs text-muted-foreground">
          Showing {preview.length} of {nodes.length} nodal values.
        </div>
      ) : null}
    </div>
  );
}

function ElementTable({ stresses }: { stresses: SolverStressResult[] }) {
  const preview = stresses.slice(0, 40);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4">Element</th>
            <th className="py-2 pr-4">c_x</th>
            <th className="py-2 pr-4">c_y</th>
            <th className="py-2 pr-4">sigma_xx</th>
            <th className="py-2 pr-4">sigma_yy</th>
            <th className="py-2 pr-4">tau_xy</th>
            <th className="py-2 pr-4">von Mises</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((stress) => (
            <tr key={stress.elementId} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-4 font-mono text-muted-foreground">{stress.elementId}</td>
              <td className="py-2 pr-4 font-mono">{stress.cx.toFixed(4)}</td>
              <td className="py-2 pr-4 font-mono">{stress.cy.toFixed(4)}</td>
              <td className="py-2 pr-4 font-mono">{stress.sxx.toFixed(3)}</td>
              <td className="py-2 pr-4 font-mono">{stress.syy.toFixed(3)}</td>
              <td className="py-2 pr-4 font-mono">{stress.sxy.toFixed(3)}</td>
              <td className="py-2 pr-4 font-mono">{stress.vonMises.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {stresses.length > preview.length ? (
        <div className="pt-3 text-xs text-muted-foreground">
          Showing {preview.length} of {stresses.length} element stress states.
        </div>
      ) : null}
    </div>
  );
}

function BoundaryFrameTable({ boundaryFrames }: { boundaryFrames: SolverBoundaryFrameResult[] }) {
  const preview = boundaryFrames.slice(0, 60);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4">Frame</th>
            <th className="py-2 pr-4">Boundary</th>
            <th className="py-2 pr-4">s/L</th>
            <th className="py-2 pr-4">x</th>
            <th className="py-2 pr-4">y</th>
            <th className="py-2 pr-4">u_x</th>
            <th className="py-2 pr-4">u_y</th>
            <th className="py-2 pr-4">t_n</th>
            <th className="py-2 pr-4">t_t</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((frame) => (
            <tr key={frame.id} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-4 font-mono text-muted-foreground">{frame.id}</td>
              <td className="py-2 pr-4">{frame.boundaryType}</td>
              <td className="py-2 pr-4 font-mono">{frame.normalizedArcLength.toFixed(4)}</td>
              <td className="py-2 pr-4 font-mono">{frame.x.toFixed(4)}</td>
              <td className="py-2 pr-4 font-mono">{frame.y.toFixed(4)}</td>
              <td className="py-2 pr-4 font-mono">{frame.ux.toExponential(3)}</td>
              <td className="py-2 pr-4 font-mono">{frame.uy.toExponential(3)}</td>
              <td className="py-2 pr-4 font-mono">{frame.tractionNormal.toFixed(3)}</td>
              <td className="py-2 pr-4 font-mono">{frame.tractionTangential.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {boundaryFrames.length > preview.length ? (
        <div className="pt-3 text-xs text-muted-foreground">
          Showing {preview.length} of {boundaryFrames.length} boundary frames.
        </div>
      ) : null}
    </div>
  );
}

export default function Results() {
  const { id } = useParams<{ id: string }>();
  const { data: analyses = [] } = useQuery<Analysis[]>({ queryKey: ["/api/analyses"] });
  const [stressField, setStressField] = useState<StressField>("vonMises");
  const [deflectionField, setDeflectionField] = useState<DeflectionField>("uMagnitude");

  const selectedId = id ? Number.parseInt(id, 10) : analyses.find((analysis) => analysis.status === "complete")?.id;
  const { data: analysis } = useQuery<Analysis>({
    queryKey: ["/api/analyses", selectedId],
    enabled: !!selectedId,
  });

  const results = (analysis?.results as SolverResults | null) ?? null;

  const exportElementCsv = () => {
    if (!results) {
      return;
    }

    const rows =
      results.analysisMode === "functionized"
        ? [
            ["x", "y", "ux", "uy", "uMagnitude", "sxx", "syy", "sxy", "vonMises"],
            ...results.fieldSamples.map((sample) => [
              sample.x,
              sample.y,
              sample.ux,
              sample.uy,
              sample.uMagnitude,
              sample.sxx,
              sample.syy,
              sample.sxy,
              sample.vonMises,
            ]),
          ]
        : [
            ["elementId", "cx", "cy", "sxx", "syy", "sxy", "vonMises"],
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
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `tkfem-results-${selectedId}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!analysis || !results) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <BarChart3 size={32} className="mx-auto mb-3 opacity-30" />
          <div className="font-medium">No results are available.</div>
          <div className="mt-1 text-sm">Run an analysis first, then return here for post-processing.</div>
          <Link href="/solver">
            <Button variant="outline" size="sm" className="mt-4">
              Open Solver
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const convergence = buildPivotedChartData(results.convergenceData, (point) => point.error);
  const scfConvergence = buildPivotedChartData(results.convergenceData, (point) => point.scf);
  const kirschBoundaryData = buildKirschBoundaryData(results, analysis.loadMagnitude);
  const stressProfile = buildStressProfile(results, analysis, stressField);
  const deflectionProfile = buildDeflectionProfile(results, deflectionField);
  const boundaryResponseData = buildBoundaryResponseData(results);
  const magnusAnalysis = results.magnusAnalysis;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Link href={`/solver/${selectedId}`}>
              <Button variant="ghost" size="sm" className="px-2">
                <ChevronLeft size={14} />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">{analysis.name}</h1>
            <Badge variant="outline" className="status-complete">
              Complete
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {results.analysisMode === "functionized"
              ? `${results.nElements} computational element, ${results.nNodes} boundary frames, ${results.nDOF} boundary DOFs, effective Magnus order m = ${results.magnusOrder}`
              : `${results.nElements} elements, ${results.nDOF} DOFs, effective Magnus order m = ${results.magnusOrder}`}
            {results.executionTimeMs ? `, solved in ${results.executionTimeMs} ms` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportElementCsv}>
          <Download size={14} className="mr-2" />
          Export Element CSV
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Peak von Mises"
          value={`${formatValue(results.maxVonMises)} MPa`}
          sublabel={results.analysisMode === "functionized" ? "Interior sample envelope" : "Element stress envelope"}
        />
        <MetricCard
          label="Peak displacement"
          value={`${formatValue(results.maxDisp)} mm`}
          sublabel={results.analysisMode === "functionized" ? "Boundary and interior response" : "Maximum nodal magnitude"}
        />
        <MetricCard
          label="Kirsch SCF"
          value={typeof results.kirschSCF === "number" ? formatValue(results.kirschSCF) : "n/a"}
          sublabel={typeof results.kirschError === "number" ? `Error ${results.kirschError.toFixed(2)}% vs exact 3.0` : "Not applicable"}
        />
        <MetricCard
          label="Magnus strategy"
          value={
            magnusAnalysis?.strategy === "finite_closure"
              ? "Finite closure"
              : magnusAnalysis?.strategy === "manual_truncation"
                ? "Manual truncation"
                : "Truncated Magnus"
          }
          sublabel={magnusAnalysis?.backend ? `Backend: ${magnusAnalysis.backend}` : "No Magnus metadata"}
        />
      </div>

      <Tabs defaultValue="plots">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="plots">Plots</TabsTrigger>
          {results.analysisMode === "functionized" ? <TabsTrigger value="functionized">Functionized</TabsTrigger> : null}
          <TabsTrigger value="magnus">Magnus</TabsTrigger>
          <TabsTrigger value="convergence">Convergence</TabsTrigger>
          <TabsTrigger value="kirsch">Kirsch</TabsTrigger>
          <TabsTrigger value="nodes">Nodes</TabsTrigger>
          <TabsTrigger value="elements">Elements</TabsTrigger>
        </TabsList>

        <TabsContent value="plots" className="mt-4 space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Sigma size={14} />
                    Stress contours
                  </CardTitle>
                  <SectionFieldButtons
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
                    ? "Stress contours are drawn from interior samples generated by the functionized single-domain boundary solve."
                    : "Stress contours are drawn from transport-evaluated interior field samples and overlaid on the active mesh."}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Waves size={14} />
                    Deflection contours
                  </CardTitle>
                  <SectionFieldButtons
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
                  {results.analysisMode === "functionized"
                    ? "Deflection contours are drawn from the one-domain functionized solve and overlaid on the exact boundary outline."
                    : "Deflection contours are drawn from transport-evaluated field samples rather than element-centroid averaging."}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Deformed shape</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DeformedShapeCanvas results={results} field={deflectionField} />
                <p className="text-xs text-muted-foreground">
                  {results.analysisMode === "functionized"
                    ? "The undeformed and deformed exact boundary outlines are shown with amplified displacement for interpretation."
                    : "The undeformed mesh is shown in the background; the foreground mesh is amplified for visual interpretation."}
                </p>
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <SingleSeriesChart
                title={`Centerline stress profile: ${getStressFieldLabel(stressField)}`}
                data={stressProfile}
                xLabel="x position [mm]"
                yLabel={`${getStressFieldLabel(stressField)} [MPa]`}
                color="#f59e0b"
                seriesLabel={getStressFieldLabel(stressField)}
                footer="Profile extracted from the element row closest to the horizontal midline."
              />
              <SingleSeriesChart
                title={`Loaded-edge deflection profile: ${getDeflectionFieldLabel(deflectionField)}`}
                data={deflectionProfile}
                xLabel="y position [mm]"
                yLabel={`${getDeflectionFieldLabel(deflectionField)} [mm]`}
                color="#38bdf8"
                seriesLabel={getDeflectionFieldLabel(deflectionField)}
                footer="Profile extracted along the right-hand loaded boundary of the quarter model."
              />
            </div>
          </div>
        </TabsContent>

        {results.analysisMode === "functionized" ? (
          <TabsContent value="functionized" className="mt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <MetricCard
                label="Boundary frames"
                value={`${results.functionizedDiagnostics?.boundaryFrameCount ?? results.boundaryFrames.length}`}
                sublabel="Primary unknown stations on the exact boundary"
              />
              <MetricCard
                label="Boundary quadrature"
                value={`${results.functionizedDiagnostics?.boundaryQuadratureOrder ?? "n/a"}`}
                sublabel="Oversampled enforcement order"
              />
              <MetricCard
                label="Boundary residual"
                value={results.functionizedDiagnostics ? formatValue(results.functionizedDiagnostics.maxBoundaryResidual) : "n/a"}
                sublabel={results.functionizedDiagnostics ? `RMS ${formatValue(results.functionizedDiagnostics.rmsBoundaryResidual)}` : "No diagnostics"}
              />
            </div>

            <ChartCard
              title="Boundary displacement response"
              data={boundaryResponseData}
              series={[
                { key: "ux", label: "u_x", color: "#38bdf8" },
                { key: "uy", label: "u_y", color: "#f59e0b" },
                { key: "uMagnitude", label: "|u|", color: "#22c55e" },
              ]}
              xLabel="Normalized boundary arc length [%]"
              yLabel="Displacement [mm]"
              footer="Response sampled directly on the exact functionized boundary."
            />

            <ChartCard
              title="Boundary traction response"
              data={boundaryResponseData}
              series={[
                { key: "tractionNormal", label: "Normal traction", color: "#f59e0b" },
                { key: "tractionTangential", label: "Tangential traction", color: "#38bdf8" },
              ]}
              xLabel="Normalized boundary arc length [%]"
              yLabel="Traction [MPa]"
              footer="Natural and symmetry boundary conditions are enforced on the exact geometry without interior elements."
            />
          </TabsContent>
        ) : null}

        <TabsContent value="magnus" className="mt-4">
          {magnusAnalysis ? (
            <MagnusAnalysisPanel analysis={magnusAnalysis} />
          ) : (
            <Card className="border-border bg-card">
              <CardContent className="pt-6 text-sm text-muted-foreground">
                This result set does not include Magnus diagnostics.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="convergence" className="mt-4 space-y-4">
          <ChartCard
            title={results.analysisMode === "functionized" ? "Error versus boundary frame count" : "Error versus element count"}
            data={convergence.data}
            series={convergence.series}
            xLabel={results.analysisMode === "functionized" ? "Boundary frame count" : "Element count"}
            yLabel="Error [%]"
            footer={
              results.analysisMode === "functionized"
                ? "Convergence points are generated from actual functionized single-domain solves at increasing boundary resolution."
                : "Convergence points are generated from actual benchmark solves on successively refined meshes for both TK-FEM and standard Q4 FEM."
            }
          />
          <ChartCard
            title={results.analysisMode === "functionized" ? "Stress concentration convergence" : "Stress concentration factor convergence"}
            data={scfConvergence.data}
            series={scfConvergence.series}
            xLabel={results.analysisMode === "functionized" ? "Boundary frame count" : "Element count"}
            yLabel="SCF"
            referenceLine={{ y: 3, label: "Kirsch exact" }}
            footer="SCF convergence is reported against the exact Kirsch value of 3.0 for a circular hole in an infinite plate."
          />
        </TabsContent>

        <TabsContent value="kirsch" className="mt-4 space-y-4">
          <ChartCard
            title="Kirsch boundary stress at r = a"
            data={kirschBoundaryData.map((point) => ({
              x: point.theta,
              analytical: point.analytical,
              computed: point.computed,
            }))}
            series={[
              { key: "analytical", label: "Analytical sigma_theta_theta", color: "#f59e0b" },
              { key: "computed", label: "Computed top-point sample", color: "#38bdf8" },
            ]}
            xLabel="Theta [deg]"
            yLabel="Boundary stress [MPa]"
            footer="The analytical curve uses sigma_theta_theta(a, theta) = sigma_inf * (1 - 2 cos 2 theta). The computed curve is sampled directly on the hole boundary."
          />

          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm">Kirsch comparison</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md border border-border bg-secondary/20 p-3">
                <div className="text-xs text-muted-foreground">Exact stress concentration</div>
                <div className="mt-1 text-lg font-semibold">3.0000</div>
              </div>
              <div className="rounded-md border border-border bg-secondary/20 p-3">
                <div className="text-xs text-muted-foreground">Computed SCF</div>
                <div className="mt-1 text-lg font-semibold">
                  {typeof results.kirschSCF === "number" ? results.kirschSCF.toFixed(4) : "n/a"}
                </div>
              </div>
              <div className="rounded-md border border-border bg-secondary/20 p-3">
                <div className="text-xs text-muted-foreground">Relative error</div>
                <div className="mt-1 text-lg font-semibold">
                  {typeof results.kirschError === "number" ? `${results.kirschError.toFixed(2)}%` : "n/a"}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nodes" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm">{results.analysisMode === "functionized" ? "Boundary frame table" : "Nodal displacement table"}</CardTitle>
            </CardHeader>
            <CardContent>
              {results.analysisMode === "functionized" ? <BoundaryFrameTable boundaryFrames={results.boundaryFrames} /> : <NodeTable nodes={results.nodes} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="elements" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm">{results.analysisMode === "functionized" ? "Interior sample table" : "Element stress table"}</CardTitle>
            </CardHeader>
            <CardContent>
              <ElementTable stresses={results.stresses} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
