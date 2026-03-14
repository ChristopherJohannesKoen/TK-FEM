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
import { Info, Cpu } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import type { Project } from "@shared/schema";

const schema = z.object({
  projectId: z.coerce.number().min(1, "Select a project"),
  name: z.string().min(1, "Required"),
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
  magnusTruncation: z.coerce.number().int().min(1).max(5),
});

type FormData = z.infer<typeof schema>;

// Live mesh preview canvas
function MeshPreviewCanvas({ nx, ny, W, H, holeRadius, domainType }: {
  nx: number; ny: number; W: number; H: number; holeRadius: number; domainType: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const cw = canvas.width, ch = canvas.height;
    const pad = 16;
    const scaleX = (cw - pad * 2) / W;
    const scaleY = (ch - pad * 2) / H;
    const sc = Math.min(scaleX, scaleY);

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(pad, pad);

    const pw = W * sc, ph = H * sc;

    // Background
    ctx.fillStyle = "hsl(217,33%,14%)";
    ctx.fillRect(0, 0, pw, ph);

    // Element fills
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x0 = (i / nx) * pw, y0 = (j / ny) * ph;
        const x1 = ((i + 1) / nx) * pw, y1 = ((j + 1) / ny) * ph;
        // Color by position (simulate stress gradient)
        const t = (i + j) / (nx + ny);
        const r = Math.round(15 + t * 30), g = Math.round(30 + t * 20), b = Math.round(50 + t * 30);
        ctx.fillStyle = `hsl(${220 - t * 30},${30 + t * 15}%,${15 + t * 10}%)`;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    // Grid lines
    ctx.strokeStyle = "hsl(217,33%,40%)";
    ctx.lineWidth = 0.8;
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx) * pw;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ph); ctx.stroke();
    }
    for (let j = 0; j <= ny; j++) {
      const y = (j / ny) * ph;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pw, y); ctx.stroke();
    }

    // Hole
    if (domainType === "circle_hole" && holeRadius > 0) {
      const cx = pw / 2, cy = ph / 2;
      const r = holeRadius * sc;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fillStyle = "hsl(217,33%,11%)";
      ctx.fill();
      ctx.strokeStyle = "hsl(38,92%,55%)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Boundary arrows (load)
    ctx.strokeStyle = "hsl(38,92%,55%)";
    ctx.fillStyle = "hsl(38,92%,55%)";
    ctx.lineWidth = 1.2;
    for (let j = 0; j <= 3; j++) {
      const y = (j / 3) * ph;
      ctx.beginPath();
      ctx.moveTo(pw + 8, y);
      ctx.lineTo(pw + 18, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pw + 8, y); ctx.lineTo(pw + 5, y - 3); ctx.lineTo(pw + 5, y + 3); ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }, [nx, ny, W, H, holeRadius, domainType]);

  return (
    <canvas ref={canvasRef} width={280} height={200} className="rounded-md border border-border w-full" />
  );
}

export default function NewAnalysis() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      projectId: undefined as any,
      name: "Kirsch Plate Analysis",
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
      magnusTruncation: 3,
    },
  });

  const watchValues = form.watch();

  const createAnalysis = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/analyses", data),
    onSuccess: async (res: any) => {
      const analysis = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
      toast({ title: "Analysis created", description: "Opening in solver..." });
      navigate(`/solver/${analysis.id}`);
    },
    onError: () => toast({ title: "Error creating analysis", variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold">New TK-FEM Analysis</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure geometry, material, mesh, and TK-FEM solver parameters</p>
      </div>

      <form onSubmit={form.handleSubmit(data => createAnalysis.mutate(data))}>
        <div className="grid md:grid-cols-3 gap-6">
          {/* Left: Config panels */}
          <div className="md:col-span-2 space-y-5">

            {/* Project & Name */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm">Project</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Project</Label>
                  <Select
                    value={String(watchValues.projectId ?? "")}
                    onValueChange={v => form.setValue("projectId", parseInt(v))}
                  >
                    <SelectTrigger data-testid="select-project">
                      <SelectValue placeholder="Select project..." />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.projectId && (
                    <p className="text-xs text-destructive mt-1">{form.formState.errors.projectId.message}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Analysis Name</Label>
                  <Input {...form.register("name")} data-testid="input-analysis-name" />
                </div>
              </CardContent>
            </Card>

            {/* Domain */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm">Domain Geometry</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Domain Type</Label>
                    <Select
                      value={watchValues.domainType}
                      onValueChange={v => form.setValue("domainType", v as any)}
                    >
                      <SelectTrigger data-testid="select-domain-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rectangle">Rectangle</SelectItem>
                        <SelectItem value="circle_hole">Rectangle with Circular Hole (Kirsch)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Plane Type</Label>
                    <Select
                      value={watchValues.planeType}
                      onValueChange={v => form.setValue("planeType", v as any)}
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
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Width W (mm)</Label>
                    <Input type="number" {...form.register("domainWidth")} data-testid="input-domain-width" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Height H (mm)</Label>
                    <Input type="number" {...form.register("domainHeight")} data-testid="input-domain-height" />
                  </div>
                  {watchValues.domainType === "circle_hole" && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Hole Radius a (mm)</Label>
                      <Input type="number" step="0.1" {...form.register("holeRadius")} data-testid="input-hole-radius" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Mesh */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm">Mesh Parameters</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <Label className="text-xs text-muted-foreground">Elements X (Nx = {watchValues.meshNx})</Label>
                    <span className="text-xs font-mono text-primary">{watchValues.meshNx}</span>
                  </div>
                  <Slider
                    min={1} max={20} step={1}
                    value={[watchValues.meshNx]}
                    onValueChange={([v]) => form.setValue("meshNx", v)}
                    data-testid="slider-mesh-nx"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <Label className="text-xs text-muted-foreground">Elements Y (Ny = {watchValues.meshNy})</Label>
                    <span className="text-xs font-mono text-primary">{watchValues.meshNy}</span>
                  </div>
                  <Slider
                    min={1} max={20} step={1}
                    value={[watchValues.meshNy]}
                    onValueChange={([v]) => form.setValue("meshNy", v)}
                    data-testid="slider-mesh-ny"
                  />
                </div>
                <div className="text-xs text-muted-foreground bg-secondary/40 px-3 py-2 rounded font-mono">
                  {watchValues.meshNx * watchValues.meshNy} elements · {(watchValues.meshNx + 1) * (watchValues.meshNy + 1)} nodes · {(watchValues.meshNx + 1) * (watchValues.meshNy + 1) * 2} DOFs
                </div>
              </CardContent>
            </Card>

            {/* Material */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm">Material Properties</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Young's Modulus E (MPa)</Label>
                    <Input type="number" {...form.register("youngModulus")} data-testid="input-young-modulus" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Poisson's Ratio ν</Label>
                    <Input type="number" step="0.01" min="0" max="0.499" {...form.register("poissonRatio")} data-testid="input-poisson" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Loading */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm">Loading</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Load Type</Label>
                    <Select value={watchValues.loadType} onValueChange={v => form.setValue("loadType", v as any)}>
                      <SelectTrigger data-testid="select-load-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="uniform_tension">Uniform Tension σ∞</SelectItem>
                        <SelectItem value="shear">Uniform Shear τ</SelectItem>
                        <SelectItem value="point_load">Point Load</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Magnitude (MPa)</Label>
                    <Input type="number" {...form.register("loadMagnitude")} data-testid="input-load-magnitude" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* TK-FEM Settings */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Cpu size={13} style={{ color: "hsl(var(--primary))" }} />
                  TK-FEM Solver Parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">Magnus Truncation Order m = {watchValues.magnusTruncation}</Label>
                    <span className="text-xs font-mono text-primary">{watchValues.magnusTruncation}</span>
                  </div>
                  <Slider
                    min={1} max={5} step={1}
                    value={[watchValues.magnusTruncation]}
                    onValueChange={([v]) => form.setValue("magnusTruncation", v)}
                    data-testid="slider-magnus"
                  />
                  <div className="flex items-start gap-2 mt-2 bg-secondary/40 px-3 py-2 rounded text-xs text-muted-foreground">
                    <Info size={12} className="shrink-0 mt-0.5 text-primary" />
                    <div>
                      <strong className="text-foreground">m=1:</strong> Linear (nilpotent closure, exact for rect elements) ·{" "}
                      <strong className="text-foreground">m=3:</strong> Magnus Ω₁+Ω₂+Ω₃ (recommended) ·{" "}
                      <strong className="text-foreground">m=5:</strong> High-order (curved elements)
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Preview */}
          <div className="space-y-5">
            <Card className="border-border bg-card sticky top-6">
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm">Mesh Preview</CardTitle></CardHeader>
              <CardContent>
                <MeshPreviewCanvas
                  nx={watchValues.meshNx}
                  ny={watchValues.meshNy}
                  W={watchValues.domainWidth}
                  H={watchValues.domainHeight}
                  holeRadius={watchValues.holeRadius}
                  domainType={watchValues.domainType}
                />
                <div className="mt-3 space-y-1.5 text-xs text-muted-foreground font-mono">
                  <div className="flex justify-between"><span>Domain:</span><span>{watchValues.domainWidth}×{watchValues.domainHeight} mm</span></div>
                  {watchValues.domainType === "circle_hole" && (
                    <div className="flex justify-between"><span>L/a ratio:</span><span>{(watchValues.domainWidth / 2 / watchValues.holeRadius).toFixed(1)}</span></div>
                  )}
                  <div className="flex justify-between"><span>Elements:</span><span>{watchValues.meshNx * watchValues.meshNy}</span></div>
                  <div className="flex justify-between"><span>DOFs:</span><span>{(watchValues.meshNx + 1) * (watchValues.meshNy + 1) * 2}</span></div>
                  <div className="flex justify-between"><span>E:</span><span>{watchValues.youngModulus.toLocaleString()} MPa</span></div>
                  <div className="flex justify-between"><span>ν:</span><span>{watchValues.poissonRatio}</span></div>
                  <div className="flex justify-between"><span>Magnus m:</span><span className="text-primary">{watchValues.magnusTruncation}</span></div>
                  <div className="flex justify-between"><span>Load:</span><span>{watchValues.loadMagnitude} MPa</span></div>
                </div>
                <Button
                  type="submit"
                  className="w-full mt-4"
                  disabled={createAnalysis.isPending}
                  data-testid="button-create-analysis"
                >
                  {createAnalysis.isPending ? "Creating..." : "Create & Open Solver"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
