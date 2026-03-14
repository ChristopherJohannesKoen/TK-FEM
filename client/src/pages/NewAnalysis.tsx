import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Cpu, Info } from "lucide-react";
import type { Analysis, Project } from "@shared/schema";

const schema = z
  .object({
    projectId: z.coerce.number().min(1, "Select a project"),
    name: z.string().min(1, "Required"),
    analysisMode: z.enum(["meshed", "functionized"]),
    domainType: z.enum(["rectangle", "circle_hole"]),
    domainWidth: z.coerce.number().min(1).max(1000),
    domainHeight: z.coerce.number().min(1).max(1000),
    holeRadius: z.coerce.number().min(0).max(50),
    meshNx: z.coerce.number().int().min(1).max(20),
    meshNy: z.coerce.number().int().min(1).max(20),
    youngModulus: z.coerce.number().min(1),
    poissonRatio: z.coerce.number().min(0).max(0.499),
    planeType: z.enum(["plane_stress", "plane_strain"]),
    loadType: z.enum(["uniform_tension", "point_load", "shear"]),
    loadMagnitude: z.coerce.number().min(0),
    magnusMode: z.enum(["auto", "manual"]),
    magnusTruncation: z.coerce.number().int().min(1).max(5),
    boundaryQuadratureOrder: z.coerce.number().int().min(2).max(24),
  })
  .superRefine((value, ctx) => {
    if (value.domainType === "circle_hole") {
      if (value.holeRadius <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Hole radius must be greater than zero",
          path: ["holeRadius"],
        });
      }

      if (value.holeRadius >= Math.min(value.domainWidth, value.domainHeight)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Hole radius must be smaller than the plate dimensions",
          path: ["holeRadius"],
        });
      }
    }

    if (value.analysisMode === "functionized" && value.loadType === "point_load") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Functionized mode supports smooth boundary tractions only",
        path: ["loadType"],
      });
    }

    if (value.analysisMode === "functionized" && value.domainType === "circle_hole" && value.loadType !== "uniform_tension") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Functionized circle-hole mode is implemented for the Kirsch uniform-tension benchmark",
        path: ["loadType"],
      });
    }
  });

type FormData = z.infer<typeof schema>;
type AnalysisModeValue = FormData["analysisMode"];
type DomainType = FormData["domainType"];
type PlaneType = FormData["planeType"];
type LoadType = FormData["loadType"];
type MagnusModeValue = FormData["magnusMode"];

function getHashSearchParam(name: string) {
  const hash = window.location.hash;
  const queryStart = hash.indexOf("?");
  if (queryStart === -1) {
    return null;
  }

  return new URLSearchParams(hash.slice(queryStart + 1)).get(name);
}

function estimateBoundaryFrameCount(domainType: DomainType, nx: number, ny: number) {
  const base = nx * 2 + ny * 2;
  return domainType === "circle_hole" ? base + Math.max(4, Math.round((nx + ny) / 2)) : base;
}

function DomainPreviewCanvas({
  analysisMode,
  domainType,
  nx,
  ny,
  W,
  H,
  holeRadius,
}: {
  analysisMode: AnalysisModeValue;
  domainType: DomainType;
  nx: number;
  ny: number;
  W: number;
  H: number;
  holeRadius: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const padding = 16;
    const scale = Math.min((width - padding * 2) / W, (height - padding * 2) / H);
    const plotWidth = W * scale;
    const plotHeight = H * scale;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(padding, padding);
    ctx.fillStyle = "hsl(217,33%,14%)";
    ctx.fillRect(0, 0, plotWidth, plotHeight);

    if (analysisMode === "meshed") {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x0 = (i / nx) * plotWidth;
          const y0 = (j / ny) * plotHeight;
          const x1 = ((i + 1) / nx) * plotWidth;
          const y1 = ((j + 1) / ny) * plotHeight;
          const t = (i + j) / Math.max(nx + ny, 1);
          ctx.fillStyle = `hsl(${220 - t * 28},${32 + t * 16}%,${15 + t * 10}%)`;
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      }

      ctx.strokeStyle = "hsl(217,33%,40%)";
      ctx.lineWidth = 0.8;
      for (let i = 0; i <= nx; i++) {
        const x = (i / nx) * plotWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, plotHeight);
        ctx.stroke();
      }
      for (let j = 0; j <= ny; j++) {
        const y = (j / ny) * plotHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotWidth, y);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "hsl(217,33%,58%)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (domainType === "circle_hole" && holeRadius > 0) {
        const radius = holeRadius * scale;
        ctx.moveTo(radius, plotHeight);
        ctx.lineTo(plotWidth, plotHeight);
        ctx.lineTo(plotWidth, 0);
        ctx.lineTo(0, 0);
        ctx.lineTo(0, plotHeight - radius);
        ctx.arc(0, plotHeight, radius, -Math.PI / 2, 0);
      } else {
        ctx.rect(0, 0, plotWidth, plotHeight);
      }
      ctx.closePath();
      ctx.stroke();

      const pointCount = Math.min(estimateBoundaryFrameCount(domainType, nx, ny), 64);
      ctx.fillStyle = "hsl(38,92%,55%)";
      for (let i = 0; i < pointCount; i++) {
        const t = i / Math.max(pointCount - 1, 1);
        let x = 0;
        let y = 0;

        if (domainType === "circle_hole" && holeRadius > 0) {
          if (t < 0.2) {
            const local = t / 0.2;
            x = holeRadius + (W - holeRadius) * local;
            y = 0;
          } else if (t < 0.45) {
            const local = (t - 0.2) / 0.25;
            x = W;
            y = H * local;
          } else if (t < 0.7) {
            const local = (t - 0.45) / 0.25;
            x = W * (1 - local);
            y = H;
          } else if (t < 0.9) {
            const local = (t - 0.7) / 0.2;
            x = 0;
            y = H - (H - holeRadius) * local;
          } else {
            const local = (t - 0.9) / 0.1;
            const theta = (Math.PI / 2) * (1 - local);
            x = holeRadius * Math.cos(theta);
            y = holeRadius * Math.sin(theta);
          }
        } else {
          const perimeter = 2 * (W + H);
          const s = t * perimeter;
          if (s <= W) {
            x = s;
            y = 0;
          } else if (s <= W + H) {
            x = W;
            y = s - W;
          } else if (s <= 2 * W + H) {
            x = W - (s - W - H);
            y = H;
          } else {
            x = 0;
            y = H - (s - 2 * W - H);
          }
        }

        ctx.beginPath();
        ctx.arc(x * scale, plotHeight - y * scale, 2.2, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    if (domainType === "circle_hole" && holeRadius > 0) {
      const radius = holeRadius * scale;
      ctx.beginPath();
      ctx.moveTo(0, plotHeight);
      ctx.lineTo(radius, plotHeight);
      ctx.arc(0, plotHeight, radius, 0, -Math.PI / 2, true);
      ctx.lineTo(0, plotHeight);
      ctx.fillStyle = "hsl(217,33%,11%)";
      ctx.fill();
      ctx.strokeStyle = "hsl(38,92%,55%)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.strokeStyle = "hsl(38,92%,55%)";
    ctx.fillStyle = "hsl(38,92%,55%)";
    ctx.lineWidth = 1.2;
    for (let j = 0; j <= 3; j++) {
      const y = (j / 3) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotWidth + 8, y);
      ctx.lineTo(plotWidth + 18, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(plotWidth + 8, y);
      ctx.lineTo(plotWidth + 5, y - 3);
      ctx.lineTo(plotWidth + 5, y + 3);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }, [analysisMode, domainType, nx, ny, W, H, holeRadius]);

  return <canvas ref={canvasRef} width={280} height={200} className="w-full rounded-md border border-border" />;
}

export default function NewAnalysis() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      projectId: 0,
      name: "Kirsch Plate Analysis",
      analysisMode: "meshed",
      domainType: "circle_hole",
      domainWidth: 10,
      domainHeight: 10,
      holeRadius: 1,
      meshNx: 4,
      meshNy: 4,
      youngModulus: 200000,
      poissonRatio: 0.3,
      planeType: "plane_stress",
      loadType: "uniform_tension",
      loadMagnitude: 100,
      magnusMode: "auto",
      magnusTruncation: 3,
      boundaryQuadratureOrder: 8,
    },
  });

  const watchValues = form.watch();
  const boundaryFrames = estimateBoundaryFrameCount(watchValues.domainType, watchValues.meshNx, watchValues.meshNy);

  useEffect(() => {
    if (form.getValues("projectId")) {
      return;
    }

    const projectIdFromHash = Number(getHashSearchParam("projectId"));
    const fallbackProjectId =
      Number.isInteger(projectIdFromHash) && projectIdFromHash > 0
        ? projectIdFromHash
        : projects.length === 1
          ? projects[0].id
          : undefined;

    if (!fallbackProjectId || !projects.some((project) => project.id === fallbackProjectId)) {
      return;
    }

    form.setValue("projectId", fallbackProjectId, { shouldValidate: true });
  }, [form, projects]);

  useEffect(() => {
    if (watchValues.analysisMode === "functionized" && watchValues.loadType === "point_load") {
      form.setValue("loadType", "uniform_tension", { shouldValidate: true });
    }
    if (watchValues.analysisMode === "functionized" && watchValues.domainType === "circle_hole" && watchValues.loadType !== "uniform_tension") {
      form.setValue("loadType", "uniform_tension", { shouldValidate: true });
    }
  }, [form, watchValues.analysisMode, watchValues.domainType, watchValues.loadType]);

  const createAnalysis = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/analyses", data),
    onSuccess: async (res: Response) => {
      const analysis = (await res.json()) as Analysis;
      queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
      toast({ title: "Analysis created", description: "Opening in solver..." });
      navigate(`/solver/${analysis.id}`);
    },
    onError: () => toast({ title: "Error creating analysis", variant: "destructive" }),
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold">New TK-FEM Analysis</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configure meshed or functionized single-domain TK-FEM analysis settings.</p>
      </div>

      <form onSubmit={form.handleSubmit((data) => createAnalysis.mutate(data))}>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-5 md:col-span-2">
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Project</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Project</Label>
                  <Select
                    value={String(watchValues.projectId ?? "")}
                    onValueChange={(value) => form.setValue("projectId", Number.parseInt(value, 10))}
                  >
                    <SelectTrigger data-testid="select-project">
                      <SelectValue placeholder="Select project..." />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.projectId ? (
                    <p className="mt-1 text-xs text-destructive">{form.formState.errors.projectId.message}</p>
                  ) : null}
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Analysis Name</Label>
                  <Input {...form.register("name")} data-testid="input-analysis-name" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Domain and Mode</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">Analysis Mode</Label>
                    <Select
                      value={watchValues.analysisMode}
                      onValueChange={(value) => form.setValue("analysisMode", value as AnalysisModeValue)}
                    >
                      <SelectTrigger data-testid="select-analysis-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="meshed">Meshed TK-FEM</SelectItem>
                        <SelectItem value="functionized">Functionized Single-Domain TK-FEM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">Domain Type</Label>
                    <Select
                      value={watchValues.domainType}
                      onValueChange={(value) => form.setValue("domainType", value as DomainType)}
                    >
                      <SelectTrigger data-testid="select-domain-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rectangle">Rectangle</SelectItem>
                        <SelectItem value="circle_hole">Quarter Plate with Circular Hole</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">Plane Type</Label>
                    <Select
                      value={watchValues.planeType}
                      onValueChange={(value) => form.setValue("planeType", value as PlaneType)}
                    >
                      <SelectTrigger data-testid="select-plane-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="plane_stress">Plane Stress</SelectItem>
                        <SelectItem value="plane_strain">Plane Strain</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                    {watchValues.analysisMode === "functionized"
                      ? "One exact geometry domain, boundary-only unknowns, no interior element subdivision."
                      : "Structured body-fitted TK-FEM mesh with transport-based boundary assembly."}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">Width W (mm)</Label>
                    <Input type="number" {...form.register("domainWidth")} data-testid="input-domain-width" />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">Height H (mm)</Label>
                    <Input type="number" {...form.register("domainHeight")} data-testid="input-domain-height" />
                  </div>
                  {watchValues.domainType === "circle_hole" ? (
                    <div>
                      <Label className="mb-1.5 block text-xs text-muted-foreground">Hole Radius a (mm)</Label>
                      <Input type="number" step="0.1" {...form.register("holeRadius")} data-testid="input-hole-radius" />
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">{watchValues.analysisMode === "functionized" ? "Boundary Resolution" : "Mesh Parameters"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-2 flex justify-between">
                    <Label className="text-xs text-muted-foreground">
                      {watchValues.analysisMode === "functionized"
                        ? `Boundary stations in x-like directions (${watchValues.meshNx})`
                        : `Elements X (Nx = ${watchValues.meshNx})`}
                    </Label>
                    <span className="text-xs font-mono text-primary">{watchValues.meshNx}</span>
                  </div>
                  <Slider
                    min={1}
                    max={20}
                    step={1}
                    value={[watchValues.meshNx]}
                    onValueChange={([value]) => form.setValue("meshNx", value)}
                    data-testid="slider-mesh-nx"
                  />
                </div>

                <div>
                  <div className="mb-2 flex justify-between">
                    <Label className="text-xs text-muted-foreground">
                      {watchValues.analysisMode === "functionized"
                        ? `Boundary stations in y-like directions (${watchValues.meshNy})`
                        : `Elements Y (Ny = ${watchValues.meshNy})`}
                    </Label>
                    <span className="text-xs font-mono text-primary">{watchValues.meshNy}</span>
                  </div>
                  <Slider
                    min={1}
                    max={20}
                    step={1}
                    value={[watchValues.meshNy]}
                    onValueChange={([value]) => form.setValue("meshNy", value)}
                    data-testid="slider-mesh-ny"
                  />
                </div>

                <div className="rounded bg-secondary/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                  {watchValues.analysisMode === "functionized"
                    ? `${boundaryFrames} boundary frames · 1 computational element · ${boundaryFrames * 2} boundary DOFs`
                    : `${watchValues.meshNx * watchValues.meshNy} elements · ${(watchValues.meshNx + 1) * (watchValues.meshNy + 1)} nodes · ${(watchValues.meshNx + 1) * (watchValues.meshNy + 1) * 2} DOFs`}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Material Properties</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">Young&apos;s Modulus E (MPa)</Label>
                    <Input type="number" {...form.register("youngModulus")} data-testid="input-young-modulus" />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">Poisson Ratio</Label>
                    <Input type="number" step="0.01" min="0" max="0.499" {...form.register("poissonRatio")} data-testid="input-poisson" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Loading</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">Load Type</Label>
                    <Select value={watchValues.loadType} onValueChange={(value) => form.setValue("loadType", value as LoadType)}>
                      <SelectTrigger data-testid="select-load-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="uniform_tension">Uniform Tension</SelectItem>
                        {watchValues.analysisMode === "functionized" && watchValues.domainType === "circle_hole" ? null : <SelectItem value="shear">Uniform Shear</SelectItem>}
                        {watchValues.analysisMode === "meshed" ? <SelectItem value="point_load">Point Load</SelectItem> : null}
                      </SelectContent>
                    </Select>
                    {watchValues.analysisMode === "functionized" ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {watchValues.domainType === "circle_hole"
                          ? "Functionized circle-hole mode uses the single-domain boundary solver and is currently validated against the Kirsch uniform-tension benchmark."
                          : "Functionized mode is restricted to smooth boundary tractions."}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">Magnitude (MPa)</Label>
                    <Input type="number" {...form.register("loadMagnitude")} data-testid="input-load-magnitude" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Cpu size={13} style={{ color: "hsl(var(--primary))" }} />
                  TK-FEM Solver Parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Magnus Mode</Label>
                  <Select
                    value={watchValues.magnusMode}
                    onValueChange={(value) => form.setValue("magnusMode", value as MagnusModeValue)}
                  >
                    <SelectTrigger data-testid="select-magnus-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto Detect with SymPy</SelectItem>
                      <SelectItem value="manual">Manual Truncation</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="mt-2 rounded bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                    {watchValues.magnusMode === "auto"
                      ? "Automatic mode checks Lie-algebra closure and adjusts the effective Magnus order when finite closure is detected."
                      : "Manual mode keeps the user-selected truncation order while still reporting the closure assessment."}
                  </div>
                </div>

                {watchValues.analysisMode === "functionized" ? (
                  <div>
                    <div className="mb-1 flex justify-between">
                      <Label className="text-xs text-muted-foreground">Boundary Quadrature / Oversampling = {watchValues.boundaryQuadratureOrder}</Label>
                      <span className="text-xs font-mono text-primary">{watchValues.boundaryQuadratureOrder}</span>
                    </div>
                    <Slider
                      min={2}
                      max={24}
                      step={1}
                      value={[watchValues.boundaryQuadratureOrder]}
                      onValueChange={([value]) => form.setValue("boundaryQuadratureOrder", value)}
                      data-testid="slider-boundary-quadrature"
                    />
                    <div className="mt-2 rounded bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                      This increases boundary enforcement density in the functionized single-domain solve without creating interior elements.
                    </div>
                  </div>
                ) : null}

                <div>
                  <div className="mb-1 flex justify-between">
                    <Label className="text-xs text-muted-foreground">Magnus Truncation Order m = {watchValues.magnusTruncation}</Label>
                    <span className="text-xs font-mono text-primary">{watchValues.magnusTruncation}</span>
                  </div>
                  <Slider
                    min={1}
                    max={5}
                    step={1}
                    value={[watchValues.magnusTruncation]}
                    onValueChange={([value]) => form.setValue("magnusTruncation", value)}
                    data-testid="slider-magnus"
                  />
                  <div className="mt-2 flex items-start gap-2 rounded bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                    <Info size={12} className="mt-0.5 shrink-0 text-primary" />
                    <div>
                      <strong className="text-foreground">m=1:</strong> linear closure case.
                      {" "}
                      <strong className="text-foreground">m=3:</strong> recommended general setting.
                      {" "}
                      <strong className="text-foreground">m=5:</strong> high-order fallback.
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card className="sticky top-6 border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">{watchValues.analysisMode === "functionized" ? "Functionized Preview" : "Mesh Preview"}</CardTitle>
              </CardHeader>
              <CardContent>
                <DomainPreviewCanvas
                  analysisMode={watchValues.analysisMode}
                  domainType={watchValues.domainType}
                  nx={watchValues.meshNx}
                  ny={watchValues.meshNy}
                  W={watchValues.domainWidth}
                  H={watchValues.domainHeight}
                  holeRadius={watchValues.holeRadius}
                />
                <div className="mt-3 space-y-1.5 font-mono text-xs text-muted-foreground">
                  <div className="flex justify-between"><span>Mode:</span><span>{watchValues.analysisMode}</span></div>
                  <div className="flex justify-between"><span>Domain:</span><span>{watchValues.domainWidth} x {watchValues.domainHeight} mm</span></div>
                  {watchValues.domainType === "circle_hole" ? (
                    <div className="flex justify-between"><span>W/a ratio:</span><span>{(watchValues.domainWidth / watchValues.holeRadius).toFixed(1)}</span></div>
                  ) : null}
                  <div className="flex justify-between">
                    <span>{watchValues.analysisMode === "functionized" ? "Comp. elements:" : "Elements:"}</span>
                    <span>{watchValues.analysisMode === "functionized" ? "1" : watchValues.meshNx * watchValues.meshNy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{watchValues.analysisMode === "functionized" ? "Boundary frames:" : "DOFs:"}</span>
                    <span>{watchValues.analysisMode === "functionized" ? boundaryFrames : (watchValues.meshNx + 1) * (watchValues.meshNy + 1) * 2}</span>
                  </div>
                  {watchValues.analysisMode === "functionized" ? (
                    <div className="flex justify-between"><span>Boundary q:</span><span>{watchValues.boundaryQuadratureOrder}</span></div>
                  ) : null}
                  <div className="flex justify-between"><span>E:</span><span>{watchValues.youngModulus.toLocaleString()} MPa</span></div>
                  <div className="flex justify-between"><span>nu:</span><span>{watchValues.poissonRatio}</span></div>
                  <div className="flex justify-between"><span>Magnus mode:</span><span>{watchValues.magnusMode}</span></div>
                  <div className="flex justify-between"><span>Magnus m:</span><span className="text-primary">{watchValues.magnusTruncation}</span></div>
                  <div className="flex justify-between"><span>Load:</span><span>{watchValues.loadMagnitude} MPa</span></div>
                </div>
                <Button
                  type="submit"
                  className="mt-4 w-full"
                  disabled={createAnalysis.isPending}
                  data-testid="button-create-analysis"
                >
                  {createAnalysis.isPending ? "Creating..." : "Create and Open Solver"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
