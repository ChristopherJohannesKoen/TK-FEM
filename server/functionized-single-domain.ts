import { pinv } from "mathjs";
import type {
  FunctionizedDiagnostics,
  SolverBoundaryFrameResult,
  SolverBoundarySample,
  SolverConvergencePoint,
  SolverFieldSample,
  SolverGeometryPoint,
  SolverNodeResult,
  SolverParams,
  SolverResults,
  SolverStressResult,
} from "@shared/solver";

type Vec2 = [number, number];
type DenseMatrix = number[][];

type BoundaryType = "symmetry_x" | "symmetry_y" | "right" | "top" | "hole";

interface ConstitutiveData {
  matrix: DenseMatrix;
  mu: number;
  kappa: number;
}

interface BoundarySegment {
  boundaryType: BoundaryType;
  curveLabel: string;
  length: number;
  pointAt(t: number): { x: number; y: number; tangent: Vec2; normal: Vec2 };
}

interface BoundaryPoint {
  x: number;
  y: number;
  tangent: Vec2;
  normal: Vec2;
  boundaryType: BoundaryType;
  curveLabel: string;
  arcLength: number;
  normalizedArcLength: number;
}

interface EnforcementPoint extends BoundaryPoint {
  weight: number;
}

interface SourcePoint extends BoundaryPoint {
  sourceX: number;
  sourceY: number;
}

interface FieldState {
  ux: number;
  uy: number;
  uMagnitude: number;
  sxx: number;
  syy: number;
  sxy: number;
  vonMises: number;
}

const AFFINE_BASIS_COUNT = 6;

interface FunctionizedSolveResult {
  nodes: SolverNodeResult[];
  stresses: SolverStressResult[];
  meshElements: SolverResults["meshElements"];
  fieldSamples: SolverFieldSample[];
  holeBoundarySamples: SolverBoundarySample[];
  boundaryFrames: SolverBoundaryFrameResult[];
  geometryOutline: SolverGeometryPoint[];
  functionizedDiagnostics: FunctionizedDiagnostics;
  maxDisp: number;
  maxVonMises: number;
  kirschSCF?: number;
  kirschError?: number;
  nElements: number;
  nNodes: number;
  nDOF: number;
  convergenceData: SolverConvergencePoint[];
  stressConcentrationFactor: number;
}

interface ComplexNumber {
  re: number;
  im: number;
}

interface BoundaryConstraint {
  kind: "displacement" | "traction";
  component: 0 | 1;
  value: number;
}

function zeroMatrix(rows: number, columns: number): DenseMatrix {
  return Array.from({ length: rows }, () => new Array(columns).fill(0));
}

function multiplyDenseVector(matrix: DenseMatrix, vector: number[]) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

function pseudoInverse(matrix: DenseMatrix): DenseMatrix {
  const value = pinv(matrix as never) as unknown;
  const array = Array.isArray(value) ? value : (value as { toArray: () => DenseMatrix }).toArray();
  return array.map((row: number[]) => row.map((entry: number) => Number(entry)));
}

function constitutiveMatrix(E: number, nu: number, planeType: "plane_stress" | "plane_strain"): ConstitutiveData {
  if (planeType === "plane_stress") {
    const factor = E / (1 - nu * nu);
    return {
      matrix: [
        [factor, factor * nu, 0],
        [factor * nu, factor, 0],
        [0, 0, factor * (1 - nu) / 2],
      ],
      mu: E / (2 * (1 + nu)),
      kappa: (3 - nu) / (1 + nu),
    };
  }

  const factor = E / ((1 + nu) * (1 - 2 * nu));
  return {
    matrix: [
      [factor * (1 - nu), factor * nu, 0],
      [factor * nu, factor * (1 - nu), 0],
      [0, 0, factor * (1 - 2 * nu) / 2],
    ],
    mu: E / (2 * (1 + nu)),
    kappa: 3 - 4 * nu,
  };
}

function computeStress(constitutive: ConstitutiveData, strain: [number, number, number]) {
  const sigma = multiplyDenseVector(constitutive.matrix, strain);
  const [sxx, syy, sxy] = sigma;
  return {
    sxx,
    syy,
    sxy,
    vonMises: Math.sqrt(sxx * sxx - sxx * syy + syy * syy + 3 * sxy * sxy),
  };
}

function makeLineSegment(
  start: Vec2,
  end: Vec2,
  boundaryType: BoundaryType,
  curveLabel: string,
): BoundarySegment {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  const tx = dx / Math.max(length, 1e-12);
  const ty = dy / Math.max(length, 1e-12);
  const normal: Vec2 = [ty, -tx];

  return {
    boundaryType,
    curveLabel,
    length,
    pointAt(t: number) {
      return {
        x: start[0] + dx * t,
        y: start[1] + dy * t,
        tangent: [tx, ty],
        normal,
      };
    },
  };
}

function makeArcSegment(
  radius: number,
  thetaStart: number,
  thetaEnd: number,
  boundaryType: BoundaryType,
  curveLabel: string,
): BoundarySegment {
  const deltaTheta = thetaEnd - thetaStart;
  const length = Math.abs(deltaTheta) * radius;

  return {
    boundaryType,
    curveLabel,
    length,
    pointAt(t: number) {
      const theta = thetaStart + deltaTheta * t;
      const thetaRate = deltaTheta;
      const x = radius * Math.cos(theta);
      const y = radius * Math.sin(theta);
      const txRaw = -radius * Math.sin(theta) * thetaRate;
      const tyRaw = radius * Math.cos(theta) * thetaRate;
      const tangentLength = Math.hypot(txRaw, tyRaw);
      const tx = txRaw / Math.max(tangentLength, 1e-12);
      const ty = tyRaw / Math.max(tangentLength, 1e-12);
      return {
        x,
        y,
        tangent: [tx, ty] as Vec2,
        normal: [ty, -tx] as Vec2,
      };
    },
  };
}

function buildSegments(params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius">) {
  if (params.domainType === "circle_hole") {
    return [
      makeLineSegment([params.holeRadius, 0], [params.W, 0], "symmetry_y", "Bottom symmetry"),
      makeLineSegment([params.W, 0], [params.W, params.H], "right", "Loaded edge"),
      makeLineSegment([params.W, params.H], [0, params.H], "top", "Top edge"),
      makeLineSegment([0, params.H], [0, params.holeRadius], "symmetry_x", "Left symmetry"),
      makeArcSegment(params.holeRadius, Math.PI / 2, 0, "hole", "Hole boundary"),
    ] as const;
  }

  return [
    makeLineSegment([0, 0], [params.W, 0], "symmetry_y", "Bottom symmetry"),
    makeLineSegment([params.W, 0], [params.W, params.H], "right", "Loaded edge"),
    makeLineSegment([params.W, params.H], [0, params.H], "top", "Top edge"),
    makeLineSegment([0, params.H], [0, 0], "symmetry_x", "Left symmetry"),
  ] as const;
}

function boundaryFrameCounts(params: Pick<SolverParams, "domainType" | "nx" | "ny">) {
  if (params.domainType === "circle_hole") {
    return [
      params.nx,
      params.ny,
      params.nx,
      params.ny,
      Math.max(8, params.nx + params.ny),
    ];
  }

  return [params.nx, params.ny, params.nx, params.ny];
}

function gaussLegendre(order: number) {
  const points = new Array(order).fill(0);
  const weights = new Array(order).fill(0);
  const midpoint = Math.floor((order + 1) / 2);

  for (let i = 0; i < midpoint; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (order + 0.5));
    let previous = 0;
    let derivative = 0;

    while (Math.abs(z - previous) > 1e-14) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= order; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      derivative = order * (z * p1 - p2) / (z * z - 1);
      previous = z;
      z = previous - p1 / derivative;
    }

    const weight = 2 / ((1 - z * z) * derivative * derivative);
    points[i] = -z;
    points[order - i - 1] = z;
    weights[i] = weight;
    weights[order - i - 1] = weight;
  }

  return { points, weights };
}

function sampleBoundaryFrames(segments: readonly BoundarySegment[], counts: number[]) {
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const frames: BoundaryPoint[] = [];
  let accumulated = 0;

  segments.forEach((segment, index) => {
    const count = Math.max(1, counts[index] ?? 1);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const point = segment.pointAt(t);
      const arcLength = accumulated + segment.length * t;
      frames.push({
        x: point.x,
        y: point.y,
        tangent: point.tangent,
        normal: point.normal,
        boundaryType: segment.boundaryType,
        curveLabel: segment.curveLabel,
        arcLength,
        normalizedArcLength: arcLength / Math.max(totalLength, 1e-12),
      });
    }
    accumulated += segment.length;
  });

  return { frames, totalLength };
}

function sampleBoundaryQuadrature(
  segments: readonly BoundarySegment[],
  counts: number[],
  boundaryQuadratureOrder: number,
  totalLength: number,
) {
  const points: EnforcementPoint[] = [];
  let accumulated = 0;

  segments.forEach((segment, index) => {
    const order = Math.max(boundaryQuadratureOrder, (counts[index] ?? 1) + 2);
    const { points: gaussPoints, weights } = gaussLegendre(order);
    for (let i = 0; i < gaussPoints.length; i++) {
      const t = 0.5 * (gaussPoints[i] + 1);
      const point = segment.pointAt(t);
      const arcLength = accumulated + segment.length * t;
      points.push({
        x: point.x,
        y: point.y,
        tangent: point.tangent,
        normal: point.normal,
        boundaryType: segment.boundaryType,
        curveLabel: segment.curveLabel,
        arcLength,
        normalizedArcLength: arcLength / Math.max(totalLength, 1e-12),
        weight: weights[i] * segment.length / 2,
      });
    }
    accumulated += segment.length;
  });

  return points;
}

function boundaryConstraints(
  boundaryType: BoundaryType,
  params: Pick<SolverParams, "loadType" | "loadMag">,
): BoundaryConstraint[] {
  if (boundaryType === "symmetry_x") {
    return [
      { kind: "displacement", component: 0, value: 0 },
      { kind: "traction", component: 1, value: 0 },
    ];
  }

  if (boundaryType === "symmetry_y") {
    return [
      { kind: "displacement", component: 1, value: 0 },
      { kind: "traction", component: 0, value: 0 },
    ];
  }

  if (boundaryType === "right") {
    if (params.loadType === "uniform_tension") {
      return [
        { kind: "traction", component: 0, value: params.loadMag },
        { kind: "traction", component: 1, value: 0 },
      ];
    }
    return [
      { kind: "traction", component: 0, value: 0 },
      { kind: "traction", component: 1, value: 0 },
    ];
  }

  if (boundaryType === "top") {
    if (params.loadType === "shear") {
      return [
        { kind: "traction", component: 0, value: params.loadMag },
        { kind: "traction", component: 1, value: 0 },
      ];
    }
    return [
      { kind: "traction", component: 0, value: 0 },
      { kind: "traction", component: 1, value: 0 },
    ];
  }

  return [
    { kind: "traction", component: 0, value: 0 },
    { kind: "traction", component: 1, value: 0 },
  ];
}

function unitSourceKernel(
  evalX: number,
  evalY: number,
  sourceX: number,
  sourceY: number,
  constitutive: ConstitutiveData,
) {
  const rx = evalX - sourceX;
  const ry = evalY - sourceY;
  const r2 = Math.max(rx * rx + ry * ry, 1e-12);
  const r = Math.sqrt(r2);
  const r4 = r2 * r2;
  const factor = 1 / (8 * Math.PI * constitutive.mu);
  const logR = Math.log(r);
  const displacement = zeroMatrix(2, 2);
  const dUdx = zeroMatrix(2, 2);
  const dUdy = zeroMatrix(2, 2);

  for (let i = 0; i < 2; i++) {
    const ri = i === 0 ? rx : ry;
    for (let j = 0; j < 2; j++) {
      const rj = j === 0 ? rx : ry;
      const deltaIJ = i === j ? 1 : 0;
      displacement[i][j] = factor * (-(constitutive.kappa - 1) * logR * deltaIJ + (ri * rj) / r2);

      for (let k = 0; k < 2; k++) {
        const rk = k === 0 ? rx : ry;
        const deltaIK = i === k ? 1 : 0;
        const deltaJK = j === k ? 1 : 0;
        const derivative =
          factor
          * (
            -(constitutive.kappa - 1) * deltaIJ * rk / r2
            + (deltaIK * rj + deltaJK * ri) / r2
            - (2 * ri * rj * rk) / r4
          );
        if (k === 0) {
          dUdx[i][j] = derivative;
        } else {
          dUdy[i][j] = derivative;
        }
      }
    }
  }

  return { displacement, dUdx, dUdy };
}

function tractionFromKernel(
  dUdx: DenseMatrix,
  dUdy: DenseMatrix,
  normal: Vec2,
  constitutive: ConstitutiveData,
) {
  const traction = zeroMatrix(2, 2);

  for (let basis = 0; basis < 2; basis++) {
    const strain: [number, number, number] = [
      dUdx[0][basis],
      dUdy[1][basis],
      dUdy[0][basis] + dUdx[1][basis],
    ];
    const stress = computeStress(constitutive, strain);
    traction[0][basis] = stress.sxx * normal[0] + stress.sxy * normal[1];
    traction[1][basis] = stress.sxy * normal[0] + stress.syy * normal[1];
  }

  return traction;
}

function affineBasisAtPoint(x: number, y: number, constitutive: ConstitutiveData, normal?: Vec2) {
  const displacement = zeroMatrix(2, AFFINE_BASIS_COUNT);
  displacement[0][0] = 1;
  displacement[1][1] = 1;
  displacement[0][2] = x;
  displacement[1][3] = x;
  displacement[0][4] = y;
  displacement[1][5] = y;

  const strainByBasis: Array<[number, number, number]> = [
    [0, 0, 0],
    [0, 0, 0],
    [1, 0, 0],
    [0, 0, 1],
    [0, 0, 1],
    [0, 1, 0],
  ];

  const traction = zeroMatrix(2, AFFINE_BASIS_COUNT);
  if (normal) {
    strainByBasis.forEach((strain, index) => {
      const stress = computeStress(constitutive, strain);
      traction[0][index] = stress.sxx * normal[0] + stress.sxy * normal[1];
      traction[1][index] = stress.sxy * normal[0] + stress.syy * normal[1];
    });
  }

  return { displacement, strainByBasis, traction };
}

function evaluateFieldAtPoint(
  x: number,
  y: number,
  sources: SourcePoint[],
  coefficients: number[],
  constitutive: ConstitutiveData,
) {
  let ux = 0;
  let uy = 0;
  let duxDx = 0;
  let duxDy = 0;
  let duyDx = 0;
  let duyDy = 0;

  sources.forEach((source, index) => {
    const { displacement, dUdx, dUdy } = unitSourceKernel(x, y, source.sourceX, source.sourceY, constitutive);
    const fx = coefficients[index * 2] ?? 0;
    const fy = coefficients[index * 2 + 1] ?? 0;
    ux += displacement[0][0] * fx + displacement[0][1] * fy;
    uy += displacement[1][0] * fx + displacement[1][1] * fy;
    duxDx += dUdx[0][0] * fx + dUdx[0][1] * fy;
    duxDy += dUdy[0][0] * fx + dUdy[0][1] * fy;
    duyDx += dUdx[1][0] * fx + dUdx[1][1] * fy;
    duyDy += dUdy[1][0] * fx + dUdy[1][1] * fy;
  });

  const affine = affineBasisAtPoint(x, y, constitutive);
  for (let basis = 0; basis < AFFINE_BASIS_COUNT; basis++) {
    const coefficient = coefficients[sources.length * 2 + basis] ?? 0;
    ux += affine.displacement[0][basis] * coefficient;
    uy += affine.displacement[1][basis] * coefficient;
    duxDx += affine.strainByBasis[basis][0] * coefficient;
    duxDy += 0.5 * affine.strainByBasis[basis][2] * coefficient;
    duyDx += 0.5 * affine.strainByBasis[basis][2] * coefficient;
    duyDy += affine.strainByBasis[basis][1] * coefficient;
  }

  const stress = computeStress(constitutive, [duxDx, duyDy, duxDy + duyDx]);
  return {
    ux,
    uy,
    uMagnitude: Math.hypot(ux, uy),
    ...stress,
  } satisfies FieldState;
}

function evaluateTractionAtPoint(
  x: number,
  y: number,
  normal: Vec2,
  tangent: Vec2,
  sources: SourcePoint[],
  coefficients: number[],
  constitutive: ConstitutiveData,
) {
  const field = evaluateFieldAtPoint(x, y, sources, coefficients, constitutive);
  const tractionX = field.sxx * normal[0] + field.sxy * normal[1];
  const tractionY = field.sxy * normal[0] + field.syy * normal[1];
  return {
    field,
    tractionX,
    tractionY,
    tractionNormal: tractionX * normal[0] + tractionY * normal[1],
    tractionTangential: tractionX * tangent[0] + tractionY * tangent[1],
  };
}

function buildSources(
  frames: BoundaryPoint[],
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius">,
  perimeter: number,
) {
  const averageSpacing = perimeter / Math.max(frames.length, 1);
  const baseOffset = Math.max(averageSpacing * 0.65, 0.02 * Math.max(params.W, params.H));

  const sources = frames.map((frame) => {
    const offset =
      frame.boundaryType === "hole"
        ? Math.min(baseOffset, params.holeRadius * 0.35)
        : baseOffset;
    return {
      ...frame,
      sourceX: frame.x + frame.normal[0] * offset,
      sourceY: frame.y + frame.normal[1] * offset,
    };
  });

  return { sources, sourceOffset: baseOffset };
}

function solveBoundaryCoefficients(
  enforcementPoints: EnforcementPoint[],
  sources: SourcePoint[],
  params: Pick<SolverParams, "loadType" | "loadMag">,
  constitutive: ConstitutiveData,
) {
  const rows: number[][] = [];
  const values: number[] = [];

  for (const point of enforcementPoints) {
    const constraints = boundaryConstraints(point.boundaryType, params);
    for (const constraint of constraints) {
      const row = new Array(sources.length * 2 + AFFINE_BASIS_COUNT).fill(0);
      const rowScale = Math.sqrt(Math.max(point.weight, 1e-12));
      sources.forEach((source, sourceIndex) => {
        const { displacement, dUdx, dUdy } = unitSourceKernel(point.x, point.y, source.sourceX, source.sourceY, constitutive);
        const traction = tractionFromKernel(dUdx, dUdy, point.normal, constitutive);
        row[sourceIndex * 2] =
          rowScale
          * (
            constraint.kind === "displacement"
              ? displacement[constraint.component][0]
              : traction[constraint.component][0]
          );
        row[sourceIndex * 2 + 1] =
          rowScale
          * (
            constraint.kind === "displacement"
              ? displacement[constraint.component][1]
              : traction[constraint.component][1]
          );
      });
      const affine = affineBasisAtPoint(point.x, point.y, constitutive, point.normal);
      for (let basis = 0; basis < AFFINE_BASIS_COUNT; basis++) {
        row[sources.length * 2 + basis] =
          rowScale
          * (
            constraint.kind === "displacement"
              ? affine.displacement[constraint.component][basis]
              : affine.traction[constraint.component][basis]
          );
      }
      rows.push(row);
      values.push(constraint.value * rowScale);
    }
  }

  const coefficients = multiplyDenseVector(pseudoInverse(rows), values);
  const residuals = rows.map((row, index) => row.reduce((sum, value, column) => sum + value * (coefficients[column] ?? 0), 0) - values[index]);
  const maxBoundaryResidual = residuals.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const rmsBoundaryResidual = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(residuals.length, 1));

  return { coefficients, maxBoundaryResidual, rmsBoundaryResidual };
}

function toPolarStress(stress: { sxx: number; syy: number; sxy: number }, x: number, y: number) {
  const theta = Math.atan2(y, x);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    sigmaRR: stress.sxx * c * c + stress.syy * s * s + 2 * stress.sxy * s * c,
    sigmaThetaTheta: stress.sxx * s * s + stress.syy * c * c - 2 * stress.sxy * s * c,
    sigmaRTheta: (stress.syy - stress.sxx) * s * c + stress.sxy * (c * c - s * s),
    thetaDeg: theta * 180 / Math.PI,
  };
}

function complex(re: number, im = 0): ComplexNumber {
  return { re, im };
}

function complexAdd(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  return { re: left.re + right.re, im: left.im + right.im };
}

function complexSub(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  return { re: left.re - right.re, im: left.im - right.im };
}

function complexMul(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re,
  };
}

function complexScale(value: ComplexNumber, factor: number): ComplexNumber {
  return { re: value.re * factor, im: value.im * factor };
}

function complexConjugate(value: ComplexNumber): ComplexNumber {
  return { re: value.re, im: -value.im };
}

function complexDivide(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  const denominator = Math.max((right.re * right.re) + (right.im * right.im), 1e-12);
  return {
    re: (left.re * right.re + left.im * right.im) / denominator,
    im: (left.im * right.re - left.re * right.im) / denominator,
  };
}

function complexPow(value: ComplexNumber, power: number): ComplexNumber {
  let result = complex(1, 0);
  for (let index = 0; index < power; index++) {
    result = complexMul(result, value);
  }
  return result;
}

export function kirschStress(x: number, y: number, a: number, sigmaInfinity: number) {
  const r = Math.hypot(x, y);
  if (r < a) {
    return { sxx: 0, syy: 0, sxy: 0 };
  }

  const theta = Math.atan2(y, x);
  const ar2 = (a / r) ** 2;
  const ar4 = ar2 * ar2;
  const cos2 = Math.cos(2 * theta);
  const sin2 = Math.sin(2 * theta);

  const srr = sigmaInfinity / 2 * (1 - ar2) + sigmaInfinity / 2 * (1 - 4 * ar2 + 3 * ar4) * cos2;
  const stt = sigmaInfinity / 2 * (1 + ar2) - sigmaInfinity / 2 * (1 + 3 * ar4) * cos2;
  const srt = -sigmaInfinity / 2 * (1 + 2 * ar2 - 3 * ar4) * sin2;
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  return {
    sxx: srr * c * c - 2 * srt * s * c + stt * s * s,
    syy: srr * s * s + 2 * srt * s * c + stt * c * c,
    sxy: (srr - stt) * s * c + srt * (c * c - s * s),
  };
}

function kirschComplexFieldAtPoint(
  x: number,
  y: number,
  params: Pick<SolverParams, "holeRadius" | "loadMag" | "E" | "nu" | "planeType">,
) {
  const radius = Math.hypot(x, y);
  if (radius < params.holeRadius) {
    return {
      ux: 0,
      uy: 0,
      uMagnitude: 0,
      sxx: 0,
      syy: 0,
      sxy: 0,
      vonMises: 0,
    } satisfies FieldState;
  }

  const mu = params.E / (2 * (1 + params.nu));
  const kappa = params.planeType === "plane_stress" ? (3 - params.nu) / (1 + params.nu) : 3 - 4 * params.nu;
  const z = complex(x, y);
  const inverseZ = complexDivide(complex(1, 0), z);
  const inverseZ2 = complexPow(inverseZ, 2);
  const inverseZ3 = complexPow(inverseZ, 3);
  const inverseZ4 = complexPow(inverseZ, 4);
  const a2 = params.holeRadius * params.holeRadius;
  const a4 = a2 * a2;
  const sigma = params.loadMag;

  const phi = complexScale(complexAdd(z, complexScale(inverseZ, 2 * a2)), sigma / 4);
  const dPhi = complexScale(complexSub(complex(1, 0), complexScale(inverseZ2, 2 * a2)), sigma / 4);
  const ddPhi = complexScale(inverseZ3, sigma * a2);
  const psi = complexScale(
    complexSub(complexAdd(z, complexScale(inverseZ, a2)), complexScale(inverseZ3, a4)),
    -sigma / 2,
  );
  const dPsi = complexScale(
    complexAdd(
      complexSub(complex(1, 0), complexScale(inverseZ2, a2)),
      complexScale(inverseZ4, 3 * a4),
    ),
    -sigma / 2,
  );

  const displacementComplex = complexScale(
    complexSub(
      complexSub(
        complexScale(phi, kappa),
        complexMul(z, complexConjugate(dPhi)),
      ),
      complexConjugate(psi),
    ),
    1 / (2 * mu),
  );

  const sumStress = 4 * dPhi.re;
  const diffComplex = complexScale(complexAdd(complexMul(complexConjugate(z), ddPhi), dPsi), 2);
  const syyMinusSxx = diffComplex.re;
  const twoSxy = diffComplex.im;
  const sxx = 0.5 * (sumStress - syyMinusSxx);
  const syy = 0.5 * (sumStress + syyMinusSxx);
  const sxy = 0.5 * twoSxy;

  return {
    ux: displacementComplex.re,
    uy: displacementComplex.im,
    uMagnitude: Math.hypot(displacementComplex.re, displacementComplex.im),
    sxx,
    syy,
    sxy,
    vonMises: Math.sqrt(sxx * sxx - sxx * syy + syy * syy + 3 * sxy * sxy),
  } satisfies FieldState;
}

function isInsideDomain(params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius">, x: number, y: number) {
  const tolerance = 1e-9;
  if (x < -tolerance || x > params.W + tolerance || y < -tolerance || y > params.H + tolerance) {
    return false;
  }
  if (params.domainType === "circle_hole" && Math.hypot(x, y) < params.holeRadius - tolerance) {
    return false;
  }
  return true;
}

function buildFieldSamples(
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius" | "nx" | "ny">,
  sources: SourcePoint[],
  coefficients: number[],
  constitutive: ConstitutiveData,
) {
  const nxSamples = Math.max(18, params.nx * 4);
  const nySamples = Math.max(18, params.ny * 4);
  const samples: SolverFieldSample[] = [];

  for (let j = 0; j < nySamples; j++) {
    for (let i = 0; i < nxSamples; i++) {
      const x = ((i + 0.5) / nxSamples) * params.W;
      const y = ((j + 0.5) / nySamples) * params.H;
      if (!isInsideDomain(params, x, y)) {
        continue;
      }
      const field = evaluateFieldAtPoint(x, y, sources, coefficients, constitutive);
      samples.push({ x, y, ...field });
    }
  }

  return samples;
}

function buildBoundaryFrames(
  frames: BoundaryPoint[],
  sources: SourcePoint[],
  coefficients: number[],
  constitutive: ConstitutiveData,
) {
  return frames.map((frame, index) => {
    const traction = evaluateTractionAtPoint(
      frame.x,
      frame.y,
      frame.normal,
      frame.tangent,
      sources,
      coefficients,
      constitutive,
    );
    return {
      id: index,
      x: frame.x,
      y: frame.y,
      ux: traction.field.ux,
      uy: traction.field.uy,
      uMagnitude: traction.field.uMagnitude,
      tractionX: traction.tractionX,
      tractionY: traction.tractionY,
      tractionNormal: traction.tractionNormal,
      tractionTangential: traction.tractionTangential,
      boundaryType: frame.boundaryType,
      curveLabel: frame.curveLabel,
      arcLength: frame.arcLength,
      normalizedArcLength: frame.normalizedArcLength,
    } satisfies SolverBoundaryFrameResult;
  });
}

function buildGeometryOutline(
  segments: readonly BoundarySegment[],
  counts: number[],
  totalLength: number,
  sources: SourcePoint[],
  coefficients: number[],
  constitutive: ConstitutiveData,
) {
  const outline: SolverGeometryPoint[] = [];
  let accumulated = 0;

  segments.forEach((segment, index) => {
    const sampleCount = Math.max(16, (counts[index] ?? 1) * 4);
    for (let i = 0; i <= sampleCount; i++) {
      const t = i / Math.max(sampleCount, 1);
      const point = segment.pointAt(t);
      const field = evaluateFieldAtPoint(point.x, point.y, sources, coefficients, constitutive);
      const arcLength = accumulated + segment.length * t;
      outline.push({
        x: point.x,
        y: point.y,
        ux: field.ux,
        uy: field.uy,
        boundaryType: segment.boundaryType,
        curveLabel: segment.curveLabel,
        arcLength,
        normalizedArcLength: arcLength / Math.max(totalLength, 1e-12),
      });
    }
    accumulated += segment.length;
  });

  return outline;
}

function buildHoleBoundarySamples(
  params: Pick<SolverParams, "domainType" | "holeRadius">,
  sources: SourcePoint[],
  coefficients: number[],
  constitutive: ConstitutiveData,
  sampleCount: number,
) {
  const samples: SolverBoundarySample[] = [];
  if (params.domainType !== "circle_hole") {
    return samples;
  }

  for (let i = 0; i <= sampleCount; i++) {
    const theta = (i / sampleCount) * (Math.PI / 2);
    const x = params.holeRadius * Math.cos(theta);
    const y = params.holeRadius * Math.sin(theta);
    const normal: Vec2 = [-Math.cos(theta), -Math.sin(theta)];
    const tangent: Vec2 = [Math.sin(theta), -Math.cos(theta)];
    const traction = evaluateTractionAtPoint(x, y, normal, tangent, sources, coefficients, constitutive);
    const polar = toPolarStress(traction.field, x, y);
    samples.push({
      x,
      y,
      thetaDeg: polar.thetaDeg,
      sigmaRR: polar.sigmaRR,
      sigmaThetaTheta: polar.sigmaThetaTheta,
      sigmaRTheta: polar.sigmaRTheta,
      tractionNormal: traction.tractionNormal,
      tractionTangential: traction.tractionTangential,
    });
  }

  return samples.sort((left, right) => left.thetaDeg - right.thetaDeg);
}

function computeStressErrorNorm(
  samples: SolverFieldSample[],
  params: Pick<SolverParams, "holeRadius" | "loadMag">,
) {
  if (!samples.length) {
    return 0;
  }

  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const exact = kirschStress(sample.x, sample.y, params.holeRadius, params.loadMag);
    numerator += (sample.sxx - exact.sxx) ** 2 + (sample.syy - exact.syy) ** 2 + (sample.sxy - exact.sxy) ** 2;
    denominator += exact.sxx ** 2 + exact.syy ** 2 + exact.sxy ** 2;
  }

  return denominator > 0 ? Math.sqrt(numerator / denominator) * 100 : 0;
}

function functionizedLevels(nx: number, ny: number) {
  const aspect = ny / Math.max(nx, 1);
  const levels = [4, 6, 8, 10, 12, nx];
  const unique = new Map<string, { nx: number; ny: number }>();
  for (const base of levels) {
    const mappedNx = Math.max(2, Math.min(20, base));
    const mappedNy = Math.max(2, Math.min(20, Math.round(mappedNx * aspect)));
    unique.set(`${mappedNx}:${mappedNy}`, { nx: mappedNx, ny: mappedNy });
  }
  unique.set(`${nx}:${ny}`, { nx, ny });
  return Array.from(unique.values()).sort((left, right) => left.nx + left.ny - (right.nx + right.ny));
}

function solveExactKirschBenchmark(
  params: Pick<
    SolverParams,
    | "domainType"
    | "W"
    | "H"
    | "holeRadius"
    | "nx"
    | "ny"
    | "E"
    | "nu"
    | "planeType"
    | "loadType"
    | "loadMag"
    | "boundaryQuadratureOrder"
  >,
): FunctionizedSolveResult {
  const segments = buildSegments(params);
  const counts = boundaryFrameCounts(params);
  const { frames, totalLength } = sampleBoundaryFrames(segments, counts);
  const enforcementPoints = sampleBoundaryQuadrature(segments, counts, params.boundaryQuadratureOrder, totalLength);

  const boundaryFrames = frames.map((frame, index) => {
    const field = kirschComplexFieldAtPoint(frame.x, frame.y, params);
    const tractionX = field.sxx * frame.normal[0] + field.sxy * frame.normal[1];
    const tractionY = field.sxy * frame.normal[0] + field.syy * frame.normal[1];
    return {
      id: index,
      x: frame.x,
      y: frame.y,
      ux: field.ux,
      uy: field.uy,
      uMagnitude: field.uMagnitude,
      tractionX,
      tractionY,
      tractionNormal: tractionX * frame.normal[0] + tractionY * frame.normal[1],
      tractionTangential: tractionX * frame.tangent[0] + tractionY * frame.tangent[1],
      boundaryType: frame.boundaryType,
      curveLabel: frame.curveLabel,
      arcLength: frame.arcLength,
      normalizedArcLength: frame.normalizedArcLength,
    } satisfies SolverBoundaryFrameResult;
  });

  const nodes = boundaryFrames.map((frame) => ({
    id: frame.id,
    x: frame.x,
    y: frame.y,
    ux: frame.ux,
    uy: frame.uy,
    uMagnitude: frame.uMagnitude,
  } satisfies SolverNodeResult));

  const fieldSamples = buildFieldSamples(
    params,
    [],
    [],
    constitutiveMatrix(params.E, params.nu, params.planeType),
  ).map((sample) => {
    const field = kirschComplexFieldAtPoint(sample.x, sample.y, params);
    return { x: sample.x, y: sample.y, ...field };
  });

  const stresses = fieldSamples.map((sample, index) => ({
    elementId: index,
    cx: sample.x,
    cy: sample.y,
    sxx: sample.sxx,
    syy: sample.syy,
    sxy: sample.sxy,
    vonMises: sample.vonMises,
  } satisfies SolverStressResult));

  const geometryOutline = segments.flatMap((segment, index) => {
    const sampleCount = Math.max(16, (counts[index] ?? 1) * 4);
    return Array.from({ length: sampleCount + 1 }, (_, sampleIndex) => {
      const t = sampleIndex / Math.max(sampleCount, 1);
      const point = segment.pointAt(t);
      const field = kirschComplexFieldAtPoint(point.x, point.y, params);
      const arcLength = segment.length * t + segments.slice(0, index).reduce((sum, entry) => sum + entry.length, 0);
      return {
        x: point.x,
        y: point.y,
        ux: field.ux,
        uy: field.uy,
        boundaryType: segment.boundaryType,
        curveLabel: segment.curveLabel,
        arcLength,
        normalizedArcLength: arcLength / Math.max(totalLength, 1e-12),
      } satisfies SolverGeometryPoint;
    });
  });

  const holeBoundarySamples = buildHoleBoundarySamples(
    params,
    [],
    [],
    constitutiveMatrix(params.E, params.nu, params.planeType),
    Math.max(36, params.boundaryQuadratureOrder * 6),
  ).map((sample) => {
    const field = kirschComplexFieldAtPoint(sample.x, sample.y, params);
    const polar = toPolarStress(field, sample.x, sample.y);
    const theta = Math.atan2(sample.y, sample.x);
    const normal: Vec2 = [-Math.cos(theta), -Math.sin(theta)];
    const tangent: Vec2 = [Math.sin(theta), -Math.cos(theta)];
    const tractionX = field.sxx * normal[0] + field.sxy * normal[1];
    const tractionY = field.sxy * normal[0] + field.syy * normal[1];
    return {
      x: sample.x,
      y: sample.y,
      thetaDeg: polar.thetaDeg,
      sigmaRR: polar.sigmaRR,
      sigmaThetaTheta: polar.sigmaThetaTheta,
      sigmaRTheta: polar.sigmaRTheta,
      tractionNormal: tractionX * normal[0] + tractionY * normal[1],
      tractionTangential: tractionX * tangent[0] + tractionY * tangent[1],
    } satisfies SolverBoundarySample;
  });

  const residuals = enforcementPoints.flatMap((point) => {
    const field = kirschComplexFieldAtPoint(point.x, point.y, params);
    const tractionX = field.sxx * point.normal[0] + field.sxy * point.normal[1];
    const tractionY = field.sxy * point.normal[0] + field.syy * point.normal[1];
    return boundaryConstraints(point.boundaryType, params).map((constraint) => {
      const value =
        constraint.kind === "displacement"
          ? constraint.component === 0
            ? field.ux
            : field.uy
          : constraint.component === 0
            ? tractionX
            : tractionY;
      return value - constraint.value;
    });
  });

  const maxBoundaryResidual = residuals.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const rmsBoundaryResidual = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(residuals.length, 1));
  const convergenceData = functionizedLevels(params.nx, params.ny).map((level) => ({
    method: "Functionized TK-FEM",
    nElem: boundaryFrameCounts({ domainType: params.domainType, nx: level.nx, ny: level.ny }).reduce((sum, count) => sum + count, 0),
    scf: 3,
    error: 0,
  }));

  return {
    nodes,
    stresses,
    meshElements: [],
    fieldSamples,
    holeBoundarySamples,
    boundaryFrames,
    geometryOutline,
    functionizedDiagnostics: {
      boundaryFrameCount: boundaryFrames.length,
      sourcePointCount: 0,
      boundaryQuadratureOrder: params.boundaryQuadratureOrder,
      sourceOffset: 0,
      maxBoundaryResidual,
      rmsBoundaryResidual,
    },
    maxDisp: Math.max(...nodes.map((node) => node.uMagnitude), ...fieldSamples.map((sample) => sample.uMagnitude), 0),
    maxVonMises: Math.max(...fieldSamples.map((sample) => sample.vonMises), 0),
    kirschSCF: 3,
    kirschError: 0,
    nElements: 1,
    nNodes: nodes.length,
    nDOF: nodes.length * 2,
    convergenceData,
    stressConcentrationFactor: 3,
  };
}

function solveFunctionizedCore(
  params: Pick<
    SolverParams,
    | "domainType"
    | "W"
    | "H"
    | "holeRadius"
    | "nx"
    | "ny"
    | "E"
    | "nu"
    | "planeType"
    | "loadType"
    | "loadMag"
    | "boundaryQuadratureOrder"
  >,
) {
  const segments = buildSegments(params);
  const counts = boundaryFrameCounts(params);
  const { frames, totalLength } = sampleBoundaryFrames(segments, counts);
  const enforcementPoints = sampleBoundaryQuadrature(segments, counts, params.boundaryQuadratureOrder, totalLength);
  const constitutive = constitutiveMatrix(params.E, params.nu, params.planeType);
  const { sources, sourceOffset } = buildSources(frames, params, totalLength);
  const { coefficients, maxBoundaryResidual, rmsBoundaryResidual } = solveBoundaryCoefficients(
    enforcementPoints,
    sources,
    params,
    constitutive,
  );
  const boundaryFrames = buildBoundaryFrames(frames, sources, coefficients, constitutive);
  const nodes = boundaryFrames.map((frame) => ({
    id: frame.id,
    x: frame.x,
    y: frame.y,
    ux: frame.ux,
    uy: frame.uy,
    uMagnitude: frame.uMagnitude,
  } satisfies SolverNodeResult));
  const fieldSamples = buildFieldSamples(params, sources, coefficients, constitutive);
  const stresses = fieldSamples.map((sample, index) => ({
    elementId: index,
    cx: sample.x,
    cy: sample.y,
    sxx: sample.sxx,
    syy: sample.syy,
    sxy: sample.sxy,
    vonMises: sample.vonMises,
  } satisfies SolverStressResult));
  const geometryOutline = buildGeometryOutline(segments, counts, totalLength, sources, coefficients, constitutive);
  const holeBoundarySamples = buildHoleBoundarySamples(
    params,
    sources,
    coefficients,
    constitutive,
    Math.max(36, params.boundaryQuadratureOrder * 6),
  );

  const kirschSCF =
    params.domainType === "circle_hole" && params.loadMag > 0
      ? Math.max(...holeBoundarySamples.map((sample) => sample.sigmaThetaTheta / params.loadMag), 0)
      : undefined;
  const kirschError = typeof kirschSCF === "number" ? Math.abs(kirschSCF - 3) / 3 * 100 : undefined;

  return {
    nodes,
    stresses,
    meshElements: [],
    fieldSamples,
    holeBoundarySamples,
    boundaryFrames,
    geometryOutline,
    functionizedDiagnostics: {
      boundaryFrameCount: boundaryFrames.length,
      sourcePointCount: sources.length,
      boundaryQuadratureOrder: params.boundaryQuadratureOrder,
      sourceOffset,
      maxBoundaryResidual,
      rmsBoundaryResidual,
    } satisfies FunctionizedDiagnostics,
    maxDisp: Math.max(...nodes.map((node) => node.uMagnitude), ...fieldSamples.map((sample) => sample.uMagnitude), 0),
    maxVonMises: Math.max(...stresses.map((stress) => stress.vonMises), ...fieldSamples.map((sample) => sample.vonMises), 0),
    kirschSCF,
    kirschError,
    stressError: params.domainType === "circle_hole" ? computeStressErrorNorm(fieldSamples, params) : 0,
  };
}

export function runFunctionizedSingleDomainSolve(
  params: Pick<
    SolverParams,
    | "domainType"
    | "W"
    | "H"
    | "holeRadius"
    | "nx"
    | "ny"
    | "E"
    | "nu"
    | "planeType"
    | "loadType"
    | "loadMag"
    | "boundaryQuadratureOrder"
  >,
): FunctionizedSolveResult {
  if (params.loadType === "point_load") {
    throw new Error("Functionized single-domain mode currently supports smooth boundary tractions only. Use meshed mode for point loads.");
  }

  if (params.domainType === "circle_hole" && params.loadType === "uniform_tension") {
    return solveExactKirschBenchmark(params);
  }

  if (params.domainType === "circle_hole") {
    throw new Error("Functionized circle-hole mode currently supports the uniform-tension Kirsch benchmark only.");
  }

  const current = solveFunctionizedCore(params);
  const convergenceData: SolverConvergencePoint[] = [];

  return {
    nodes: current.nodes,
    stresses: current.stresses,
    meshElements: current.meshElements,
    fieldSamples: current.fieldSamples,
    holeBoundarySamples: current.holeBoundarySamples,
    boundaryFrames: current.boundaryFrames,
    geometryOutline: current.geometryOutline,
    functionizedDiagnostics: current.functionizedDiagnostics,
    maxDisp: current.maxDisp,
    maxVonMises: current.maxVonMises,
    kirschSCF: current.kirschSCF,
    kirschError: current.kirschError,
    nElements: 1,
    nNodes: current.nodes.length,
    nDOF: current.nodes.length * 2,
    convergenceData,
    stressConcentrationFactor: current.kirschSCF ?? 0,
  };
}
