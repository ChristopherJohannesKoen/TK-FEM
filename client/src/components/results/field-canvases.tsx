import { useEffect, useRef } from "react";
import type {
  DeflectionField,
  SolverFieldSample,
  SolverGeometryPoint,
  SolverMeshElement,
  SolverNodeResult,
  SolverResults,
  StressField,
} from "@shared/solver";

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  spanX: number;
  spanY: number;
  maxSpan: number;
}

interface ScalarRange {
  min: number;
  max: number;
}

function getBounds(nodes: SolverNodeResult[]): Bounds | null {
  if (!nodes.length) {
    return null;
  }

  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);

  return {
    minX,
    maxX,
    minY,
    maxY,
    spanX,
    spanY,
    maxSpan: Math.max(spanX, spanY),
  };
}

function createProjector(bounds: Bounds, width: number, height: number, padding: number) {
  const scale = Math.min(
    Math.max((width - padding * 2) / bounds.spanX, 1),
    Math.max((height - padding * 2) / bounds.spanY, 1),
  );
  const contentWidth = bounds.spanX * scale;
  const contentHeight = bounds.spanY * scale;
  const offsetX = (width - contentWidth) / 2 - bounds.minX * scale;
  const offsetY = (height + contentHeight) / 2 + bounds.minY * scale;

  return {
    scale,
    toCanvas(x: number, y: number) {
      return {
        x: offsetX + x * scale,
        y: offsetY - y * scale,
      };
    },
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function interpolateColor(start: [number, number, number], end: [number, number, number], t: number) {
  return `rgb(${Math.round(lerp(start[0], end[0], t))}, ${Math.round(lerp(start[1], end[1], t))}, ${Math.round(
    lerp(start[2], end[2], t),
  )})`;
}

function colorForValue(value: number, range: ScalarRange) {
  const { min, max } = range;

  if (!Number.isFinite(value)) {
    return "rgb(71, 85, 105)";
  }

  if (min < 0 && max > 0) {
    const limit = Math.max(Math.abs(min), Math.abs(max), 1e-9);
    const normalized = (value + limit) / (2 * limit);

    if (normalized <= 0.5) {
      return interpolateColor([24, 70, 160], [244, 244, 235], normalized / 0.5);
    }

    return interpolateColor([244, 244, 235], [176, 34, 34], (normalized - 0.5) / 0.5);
  }

  const t = (value - min) / Math.max(max - min, 1e-9);
  if (t <= 0.33) {
    return interpolateColor([13, 36, 83], [17, 138, 178], t / 0.33);
  }
  if (t <= 0.66) {
    return interpolateColor([17, 138, 178], [255, 208, 102], (t - 0.33) / 0.33);
  }

  return interpolateColor([255, 208, 102], [176, 34, 34], (t - 0.66) / 0.34);
}

function formatScalar(value: number) {
  const absValue = Math.abs(value);
  if (absValue === 0) {
    return "0";
  }
  if (absValue >= 1e4 || absValue < 1e-3) {
    return value.toExponential(2);
  }
  if (absValue >= 100) {
    return value.toFixed(1);
  }
  if (absValue >= 1) {
    return value.toFixed(3);
  }
  return value.toFixed(4);
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  range: ScalarRange,
  width: number,
  height: number,
  label: string,
) {
  const barWidth = 12;
  const barHeight = height - 56;
  const x = width - 30;
  const y = 20;

  for (let i = 0; i < barHeight; i++) {
    const t = 1 - i / Math.max(barHeight - 1, 1);
    const value = range.min + (range.max - range.min) * t;
    ctx.fillStyle = colorForValue(value, range);
    ctx.fillRect(x, y + i, barWidth, 1);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, barWidth, barHeight);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
  ctx.textAlign = "left";
  ctx.fillText(formatScalar(range.max), x - 70, y + 10);
  ctx.fillText(formatScalar((range.max + range.min) / 2), x - 70, y + barHeight / 2 + 4);
  ctx.fillText(formatScalar(range.min), x - 70, y + barHeight);

  ctx.save();
  ctx.translate(x - 84, y + barHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawEmptyState(ctx: CanvasRenderingContext2D, width: number, height: number, message: string) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "hsl(222, 39%, 11%)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function getStressRange(results: SolverResults, field: StressField): ScalarRange {
  const source = results.fieldSamples.length ? results.fieldSamples : results.stresses;
  const values = source.map((sample) => sample[field]).filter(Number.isFinite);
  if (!values.length) {
    return { min: 0, max: 1 };
  }

  if (field === "vonMises") {
    return { min: Math.min(0, Math.min(...values)), max: Math.max(...values) };
  }

  const limit = Math.max(Math.abs(Math.min(...values)), Math.abs(Math.max(...values)), 1e-9);
  return { min: -limit, max: limit };
}

function getDeflectionRange(results: SolverResults, field: DeflectionField): ScalarRange {
  const source = results.fieldSamples.length ? results.fieldSamples : results.nodes;
  const values = source.map((sample) => sample[field]).filter(Number.isFinite);
  if (!values.length) {
    return { min: 0, max: 1 };
  }

  if (field === "uMagnitude") {
    return { min: 0, max: Math.max(...values, 1e-9) };
  }

  const limit = Math.max(Math.abs(Math.min(...values)), Math.abs(Math.max(...values)), 1e-9);
  return { min: -limit, max: limit };
}

function drawElementPolygons(
  ctx: CanvasRenderingContext2D,
  projector: ReturnType<typeof createProjector>,
  elements: SolverMeshElement[],
  nodeMap: Map<number, SolverNodeResult>,
  getValue: (element: SolverMeshElement) => number,
  range: ScalarRange,
) {
  for (const element of elements) {
    const elementNodes = element.nodeIds.map((nodeId) => nodeMap.get(nodeId)).filter(Boolean) as SolverNodeResult[];
    if (elementNodes.length < 3) {
      continue;
    }

    ctx.beginPath();
    elementNodes.forEach((node, index) => {
      const point = projector.toCanvas(node.x, node.y);
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = colorForValue(getValue(element), range);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function drawSampleField(
  ctx: CanvasRenderingContext2D,
  projector: ReturnType<typeof createProjector>,
  samples: SolverFieldSample[],
  getValue: (sample: SolverFieldSample) => number,
  range: ScalarRange,
) {
  if (!samples.length) {
    return;
  }

  const xs = Array.from(new Set(samples.map((sample) => Number(sample.x.toFixed(6))))).sort((a, b) => a - b);
  const ys = Array.from(new Set(samples.map((sample) => Number(sample.y.toFixed(6))))).sort((a, b) => a - b);
  const dx = xs.length > 1 ? Math.min(...xs.slice(1).map((x, index) => x - xs[index])) : 0;
  const dy = ys.length > 1 ? Math.min(...ys.slice(1).map((y, index) => y - ys[index])) : 0;
  const halfWidth = Math.max(projector.scale * (dx || 0.15) * 0.48, 3);
  const halfHeight = Math.max(projector.scale * (dy || 0.15) * 0.48, 3);

  for (const sample of samples) {
    const point = projector.toCanvas(sample.x, sample.y);
    ctx.fillStyle = colorForValue(getValue(sample), range);
    ctx.fillRect(point.x - halfWidth, point.y - halfHeight, halfWidth * 2, halfHeight * 2);
  }
}

function drawGeometryOutline(
  ctx: CanvasRenderingContext2D,
  projector: ReturnType<typeof createProjector>,
  outline: SolverGeometryPoint[],
  options?: {
    deformed?: boolean;
    amplification?: number;
    valueForPoint?: (point: SolverGeometryPoint) => number;
    range?: ScalarRange;
  },
) {
  if (outline.length < 2) {
    return;
  }

  const deformed = options?.deformed ?? false;
  const amplification = options?.amplification ?? 1;
  const valueForPoint = options?.valueForPoint;
  const range = options?.range;

  for (let index = 1; index < outline.length; index++) {
    const previous = outline[index - 1];
    const current = outline[index];
    const pointA = projector.toCanvas(
      previous.x + (deformed ? previous.ux * amplification : 0),
      previous.y + (deformed ? previous.uy * amplification : 0),
    );
    const pointB = projector.toCanvas(
      current.x + (deformed ? current.ux * amplification : 0),
      current.y + (deformed ? current.uy * amplification : 0),
    );
    ctx.beginPath();
    ctx.moveTo(pointA.x, pointA.y);
    ctx.lineTo(pointB.x, pointB.y);
    if (valueForPoint && range) {
      const average = 0.5 * (valueForPoint(previous) + valueForPoint(current));
      ctx.strokeStyle = colorForValue(average, range);
      ctx.lineWidth = deformed ? 2 : 1;
    }
    ctx.stroke();
  }
}

function drawQuarterHoleMask(
  ctx: CanvasRenderingContext2D,
  projector: ReturnType<typeof createProjector>,
  outline: SolverGeometryPoint[],
  options?: {
    deformed?: boolean;
    amplification?: number;
  },
) {
  if (!outline.length) {
    return;
  }

  const deformed = options?.deformed ?? false;
  const amplification = options?.amplification ?? 1;
  const origin = projector.toCanvas(0, 0);

  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  outline.forEach((point) => {
    const projected = projector.toCanvas(
      point.x + (deformed ? point.ux * amplification : 0),
      point.y + (deformed ? point.uy * amplification : 0),
    );
    ctx.lineTo(projected.x, projected.y);
  });
  ctx.closePath();
  ctx.fillStyle = "hsl(222, 39%, 11%)";
  ctx.fill();
}

export function getStressFieldLabel(field: StressField) {
  switch (field) {
    case "sxx":
      return "sigma_xx";
    case "syy":
      return "sigma_yy";
    case "sxy":
      return "tau_xy";
    default:
      return "von Mises";
  }
}

export function getDeflectionFieldLabel(field: DeflectionField) {
  switch (field) {
    case "ux":
      return "u_x";
    case "uy":
      return "u_y";
    default:
      return "|u|";
  }
}

export function StressContourCanvas({ results, field }: { results: SolverResults; field: StressField }) {
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
    const elements = results.meshElements ?? [];
    const bounds = getBounds(results.nodes);

    if (!bounds || (!elements.length && !results.fieldSamples.length)) {
      drawEmptyState(ctx, width, height, "No stress field is available for this analysis.");
      return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "hsl(222, 39%, 11%)";
    ctx.fillRect(0, 0, width, height);

    const projector = createProjector(bounds, width - 54, height, 26);
    const nodeMap = new Map(results.nodes.map((node) => [node.id, node]));
    const stressMap = new Map(results.stresses.map((stress) => [stress.elementId, stress]));
    const range = getStressRange(results, field);

    if (results.fieldSamples.length) {
      drawSampleField(ctx, projector, results.fieldSamples, (sample) => sample[field], range);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 0.8;
      for (const element of elements) {
        const elementNodes = element.nodeIds.map((nodeId) => nodeMap.get(nodeId)).filter(Boolean) as SolverNodeResult[];
        if (elementNodes.length < 3) {
          continue;
        }
        ctx.beginPath();
        elementNodes.forEach((node, index) => {
          const point = projector.toCanvas(node.x, node.y);
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      drawElementPolygons(
        ctx,
        projector,
        elements,
        nodeMap,
        (element) => stressMap.get(element.id)?.[field] ?? 0,
        range,
      );
    }

    if (results.geometryOutline.length) {
      if (elements.length) {
        drawQuarterHoleMask(ctx, projector, results.geometryOutline);
      }
      ctx.strokeStyle = elements.length ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.28)";
      ctx.lineWidth = elements.length ? 1.2 : 1;
      drawGeometryOutline(ctx, projector, results.geometryOutline);
    }

    ctx.fillStyle = "rgba(255,255,255,0.84)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${getStressFieldLabel(field)} contour`, 18, 18);
    drawLegend(ctx, range, width, height, `${getStressFieldLabel(field)} [MPa]`);
  }, [field, results]);

  return <canvas ref={canvasRef} width={760} height={420} className="w-full rounded-md border border-border bg-card" />;
}

export function DeflectionContourCanvas({ results, field }: { results: SolverResults; field: DeflectionField }) {
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
    const elements = results.meshElements ?? [];
    const bounds = getBounds(results.nodes);

    if (!bounds || (!elements.length && !results.fieldSamples.length)) {
      drawEmptyState(ctx, width, height, "No nodal deflection field is available for this analysis.");
      return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "hsl(222, 39%, 11%)";
    ctx.fillRect(0, 0, width, height);

    const projector = createProjector(bounds, width - 54, height, 26);
    const nodeMap = new Map(results.nodes.map((node) => [node.id, node]));
    const range = getDeflectionRange(results, field);

    if (results.fieldSamples.length) {
      drawSampleField(ctx, projector, results.fieldSamples, (sample) => sample[field], range);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 0.8;
      for (const element of elements) {
        const elementNodes = element.nodeIds.map((nodeId) => nodeMap.get(nodeId)).filter(Boolean) as SolverNodeResult[];
        if (elementNodes.length < 3) {
          continue;
        }
        ctx.beginPath();
        elementNodes.forEach((node, index) => {
          const point = projector.toCanvas(node.x, node.y);
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      drawElementPolygons(
        ctx,
        projector,
        elements,
        nodeMap,
        (element) => {
          const values = element.nodeIds
            .map((nodeId) => nodeMap.get(nodeId)?.[field] ?? 0)
            .filter(Number.isFinite);

          return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        },
        range,
      );
    }

    if (results.geometryOutline.length) {
      if (elements.length) {
        drawQuarterHoleMask(ctx, projector, results.geometryOutline);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = elements.length ? 1.2 : 1;
      drawGeometryOutline(ctx, projector, results.geometryOutline);
    }

    ctx.fillStyle = "rgba(255,255,255,0.84)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${getDeflectionFieldLabel(field)} contour`, 18, 18);
    drawLegend(ctx, range, width, height, `${getDeflectionFieldLabel(field)} [mm]`);
  }, [field, results]);

  return <canvas ref={canvasRef} width={760} height={420} className="w-full rounded-md border border-border bg-card" />;
}

export function DeformedShapeCanvas({ results, field }: { results: SolverResults; field: DeflectionField }) {
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
    const elements = results.meshElements ?? [];
    const bounds = getBounds(results.nodes);

    if (!bounds || (!elements.length && !results.geometryOutline.length)) {
      drawEmptyState(ctx, width, height, "No deformed shape is available for this analysis.");
      return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "hsl(222, 39%, 11%)";
    ctx.fillRect(0, 0, width, height);

    const projector = createProjector(bounds, width - 54, height, 26);
    const nodeMap = new Map(results.nodes.map((node) => [node.id, node]));
    const range = getDeflectionRange(results, field);
    const maxDisp = Math.max(...results.nodes.map((node) => node.uMagnitude), 0);
    const amplification = maxDisp > 0 ? (0.14 * bounds.maxSpan) / maxDisp : 1;

    if (elements.length) {
      for (const element of elements) {
        const elementNodes = element.nodeIds.map((nodeId) => nodeMap.get(nodeId)).filter(Boolean) as SolverNodeResult[];
        if (elementNodes.length < 3) {
          continue;
        }

        ctx.beginPath();
        elementNodes.forEach((node, index) => {
          const point = projector.toCanvas(node.x, node.y);
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.closePath();
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      for (const element of elements) {
        const elementNodes = element.nodeIds.map((nodeId) => nodeMap.get(nodeId)).filter(Boolean) as SolverNodeResult[];
        if (elementNodes.length < 3) {
          continue;
        }

        const averageValue =
          elementNodes.reduce((sum, node) => sum + (node[field] ?? 0), 0) / Math.max(elementNodes.length, 1);

        ctx.beginPath();
        elementNodes.forEach((node, index) => {
          const point = projector.toCanvas(node.x + node.ux * amplification, node.y + node.uy * amplification);
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.closePath();
        ctx.fillStyle = colorForValue(averageValue, range);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.32)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (results.geometryOutline.length) {
        drawQuarterHoleMask(ctx, projector, results.geometryOutline);
        drawQuarterHoleMask(ctx, projector, results.geometryOutline, {
          deformed: true,
          amplification,
        });
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1;
        drawGeometryOutline(ctx, projector, results.geometryOutline);
        drawGeometryOutline(ctx, projector, results.geometryOutline, {
          deformed: true,
          amplification,
          valueForPoint: (point) => {
            if (field === "uMagnitude") {
              return Math.hypot(point.ux, point.uy);
            }
            return point[field];
          },
          range,
        });
      }
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      drawGeometryOutline(ctx, projector, results.geometryOutline);
      drawGeometryOutline(ctx, projector, results.geometryOutline, {
        deformed: true,
        amplification,
        valueForPoint: (point) => {
          if (field === "uMagnitude") {
            return Math.hypot(point.ux, point.uy);
          }
          return point[field];
        },
        range,
      });
    }

    ctx.fillStyle = "rgba(255,255,255,0.84)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${elements.length ? "Deformed mesh" : "Deformed outline"} colored by ${getDeflectionFieldLabel(field)}`, 18, 18);
    ctx.fillText(`Amplification x${formatScalar(amplification)}`, 18, 36);
    drawLegend(ctx, range, width, height, `${getDeflectionFieldLabel(field)} [mm]`);
  }, [field, results]);

  return <canvas ref={canvasRef} width={760} height={420} className="w-full rounded-md border border-border bg-card" />;
}
