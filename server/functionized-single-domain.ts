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

interface BoundaryElement {
  id: number;
  boundaryType: BoundaryType;
  curveLabel: string;
  length: number;
  arcStart: number;
  arcEnd: number;
  midpoint: BoundaryPoint;
  pointAt(localT: number): BoundaryPoint;
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

interface BoundaryConstraint {
  kind: "displacement" | "traction";
  component: 0 | 1;
  value: number;
}

interface BoundarySolveResult {
  displacements: number[];
  tractions: number[];
  maxBoundaryResidual: number;
  rmsBoundaryResidual: number;
  systemConditionEstimate: number;
}

interface FunctionizedCoreResult {
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
  stressError: number;
}

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

function zeroMatrix(rows: number, columns: number): DenseMatrix {
  return Array.from({ length: rows }, () => new Array(columns).fill(0));
}

function multiplyDenseVector(matrix: DenseMatrix, vector: number[]) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

function addScaled(target: DenseMatrix, source: DenseMatrix, scale: number) {
  for (let i = 0; i < target.length; i++) {
    for (let j = 0; j < target[i].length; j++) {
      target[i][j] += source[i][j] * scale;
    }
  }
}

function denseFrobeniusNorm(matrix: DenseMatrix) {
  return Math.sqrt(matrix.reduce((sum, row) => sum + row.reduce((rowSum, value) => rowSum + value * value, 0), 0));
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

function makeLineSegment(start: Vec2, end: Vec2, boundaryType: BoundaryType, curveLabel: string): BoundarySegment {
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

function boundaryElementCounts(params: Pick<SolverParams, "domainType" | "nx" | "ny">) {
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

function buildBoundaryElements(segments: readonly BoundarySegment[], counts: number[]) {
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const elements: BoundaryElement[] = [];
  let accumulated = 0;

  segments.forEach((segment, segmentIndex) => {
    const count = Math.max(1, counts[segmentIndex] ?? 1);
    for (let index = 0; index < count; index++) {
      const tStart = index / count;
      const tEnd = (index + 1) / count;
      const tMid = 0.5 * (tStart + tEnd);
      const arcStart = accumulated + segment.length * tStart;
      const arcEnd = accumulated + segment.length * tEnd;
      const midpoint = segment.pointAt(tMid);
      const arcMid = 0.5 * (arcStart + arcEnd);

      elements.push({
        id: elements.length,
        boundaryType: segment.boundaryType,
        curveLabel: segment.curveLabel,
        length: arcEnd - arcStart,
        arcStart,
        arcEnd,
        midpoint: {
          x: midpoint.x,
          y: midpoint.y,
          tangent: midpoint.tangent,
          normal: midpoint.normal,
          boundaryType: segment.boundaryType,
          curveLabel: segment.curveLabel,
          arcLength: arcMid,
          normalizedArcLength: arcMid / Math.max(totalLength, 1e-12),
        },
        pointAt(localT: number) {
          const t = tStart + (tEnd - tStart) * localT;
          const point = segment.pointAt(t);
          const arcLength = arcStart + (arcEnd - arcStart) * localT;
          return {
            x: point.x,
            y: point.y,
            tangent: point.tangent,
            normal: point.normal,
            boundaryType: segment.boundaryType,
            curveLabel: segment.curveLabel,
            arcLength,
            normalizedArcLength: arcLength / Math.max(totalLength, 1e-12),
          };
        },
      });
    }
    accumulated += segment.length;
  });

  return { elements, totalLength };
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

function kelvinKernel(
  evalX: number,
  evalY: number,
  sourceX: number,
  sourceY: number,
  constitutive: ConstitutiveData,
) {
  const rx = evalX - sourceX;
  const ry = evalY - sourceY;
  const r2 = Math.max(rx * rx + ry * ry, 1e-18);
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

function integrateKernelBlock(
  collocation: BoundaryElement,
  element: BoundaryElement,
  constitutive: ConstitutiveData,
  order: number,
  kind: "displacement" | "traction",
) {
  const block = zeroMatrix(2, 2);
  const { points, weights } = gaussLegendre(Math.max(order, 4));
  const intervals: Array<[number, number]> = collocation.id === element.id ? [[0, 0.5], [0.5, 1]] : [[0, 1]];

  for (const [start, end] of intervals) {
    const jacobian = (end - start) / 2;
    for (let index = 0; index < points.length; index++) {
      const localT = start + (points[index] + 1) * jacobian;
      const point = element.pointAt(localT);
      const scale = weights[index] * jacobian * element.length;
      if (kind === "displacement") {
        const kernel = kelvinKernel(
          collocation.midpoint.x,
          collocation.midpoint.y,
          point.x,
          point.y,
          constitutive,
        ).displacement;
        addScaled(block, kernel, scale);
      } else {
        const { dUdx, dUdy } = kelvinKernel(
          point.x,
          point.y,
          collocation.midpoint.x,
          collocation.midpoint.y,
          constitutive,
        );
        const kernel = tractionFromKernel(dUdx, dUdy, point.normal, constitutive);
        addScaled(block, kernel, scale);
      }
    }
  }

  return block;
}

function buildBoundaryIntegralOperators(
  elements: BoundaryElement[],
  constitutive: ConstitutiveData,
  order: number,
) {
  const size = elements.length * 2;
  const H = zeroMatrix(size, size);
  const G = zeroMatrix(size, size);

  elements.forEach((collocation) => {
    const rowOffset = collocation.id * 2;
    elements.forEach((element) => {
      const columnOffset = element.id * 2;
      const displacementBlock = integrateKernelBlock(collocation, element, constitutive, order, "displacement");
      const tractionBlock = integrateKernelBlock(collocation, element, constitutive, order, "traction");

      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          G[rowOffset + i][columnOffset + j] += displacementBlock[i][j];
          H[rowOffset + i][columnOffset + j] += tractionBlock[i][j];
        }
      }
    });

    H[rowOffset][rowOffset] += 0.5;
    H[rowOffset + 1][rowOffset + 1] += 0.5;
  });

  return { H, G };
}

function solveBoundarySystem(
  elements: BoundaryElement[],
  H: DenseMatrix,
  G: DenseMatrix,
  params: Pick<SolverParams, "loadType" | "loadMag">,
): BoundarySolveResult {
  const size = elements.length * 2;
  const uKnown = new Array<number | undefined>(size).fill(undefined);
  const tKnown = new Array<number | undefined>(size).fill(undefined);

  elements.forEach((element) => {
    const constraints = boundaryConstraints(element.boundaryType, params);
    constraints.forEach((constraint) => {
      const index = element.id * 2 + constraint.component;
      if (constraint.kind === "displacement") {
        uKnown[index] = constraint.value;
      } else {
        tKnown[index] = constraint.value;
      }
    });
  });

  const unknownIndex = new Array<number>(size).fill(-1);
  let unknownCount = 0;
  for (let index = 0; index < size; index++) {
    const hasKnownDisplacement = uKnown[index] !== undefined;
    const hasKnownTraction = tKnown[index] !== undefined;
    if (hasKnownDisplacement === hasKnownTraction) {
      throw new Error("Each functionized boundary component must prescribe exactly one of displacement or traction.");
    }
    unknownIndex[index] = unknownCount++;
  }

  const A = zeroMatrix(size, unknownCount);
  const rhs = new Array(size).fill(0);

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const systemColumn = unknownIndex[column];
      if (uKnown[column] === undefined) {
        A[row][systemColumn] += H[row][column];
      } else {
        rhs[row] -= H[row][column] * (uKnown[column] ?? 0);
      }

      if (tKnown[column] === undefined) {
        A[row][systemColumn] -= G[row][column];
      } else {
        rhs[row] += G[row][column] * (tKnown[column] ?? 0);
      }
    }
  }

  const Ainv = pseudoInverse(A);
  const solution = multiplyDenseVector(Ainv, rhs);
  const displacements = new Array(size).fill(0);
  const tractions = new Array(size).fill(0);

  for (let index = 0; index < size; index++) {
    const systemColumn = unknownIndex[index];
    if (uKnown[index] === undefined) {
      displacements[index] = solution[systemColumn] ?? 0;
      tractions[index] = tKnown[index] ?? 0;
    } else {
      displacements[index] = uKnown[index] ?? 0;
      tractions[index] = solution[systemColumn] ?? 0;
    }
  }

  const residuals = new Array(size).fill(0);
  for (let row = 0; row < size; row++) {
    let value = 0;
    for (let column = 0; column < size; column++) {
      value += H[row][column] * displacements[column];
      value -= G[row][column] * tractions[column];
    }
    residuals[row] = value;
  }

  const maxBoundaryResidual = residuals.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const rmsBoundaryResidual = Math.sqrt(
    residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(residuals.length, 1),
  );

  return {
    displacements,
    tractions,
    maxBoundaryResidual,
    rmsBoundaryResidual,
    systemConditionEstimate: denseFrobeniusNorm(A) * denseFrobeniusNorm(Ainv),
  };
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

function evaluateInteriorDisplacement(
  x: number,
  y: number,
  elements: BoundaryElement[],
  displacements: number[],
  tractions: number[],
  constitutive: ConstitutiveData,
  order: number,
) {
  const result: Vec2 = [0, 0];
  const { points, weights } = gaussLegendre(Math.max(order, 4));

  elements.forEach((element) => {
    const boundaryDisp: Vec2 = [displacements[element.id * 2] ?? 0, displacements[element.id * 2 + 1] ?? 0];
    const boundaryTraction: Vec2 = [tractions[element.id * 2] ?? 0, tractions[element.id * 2 + 1] ?? 0];

    for (let index = 0; index < points.length; index++) {
      const localT = 0.5 * (points[index] + 1);
      const boundaryPoint = element.pointAt(localT);
      const scale = weights[index] * element.length / 2;
      const displacementKernel = kelvinKernel(x, y, boundaryPoint.x, boundaryPoint.y, constitutive).displacement;
      const tractionEval = kelvinKernel(boundaryPoint.x, boundaryPoint.y, x, y, constitutive);
      const tractionKernel = tractionFromKernel(
        tractionEval.dUdx,
        tractionEval.dUdy,
        boundaryPoint.normal,
        constitutive,
      );

      result[0] +=
        scale
        * (
          displacementKernel[0][0] * boundaryTraction[0]
          + displacementKernel[0][1] * boundaryTraction[1]
          - tractionKernel[0][0] * boundaryDisp[0]
          - tractionKernel[0][1] * boundaryDisp[1]
        );
      result[1] +=
        scale
        * (
          displacementKernel[1][0] * boundaryTraction[0]
          + displacementKernel[1][1] * boundaryTraction[1]
          - tractionKernel[1][0] * boundaryDisp[0]
          - tractionKernel[1][1] * boundaryDisp[1]
        );
    }
  });

  return result;
}

function evaluateDisplacementWithFallback(
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius">,
  x: number,
  y: number,
  elements: BoundaryElement[],
  displacements: number[],
  tractions: number[],
  constitutive: ConstitutiveData,
  order: number,
) {
  if (!isInsideDomain(params, x, y)) {
    return null;
  }
  return evaluateInteriorDisplacement(x, y, elements, displacements, tractions, constitutive, order);
}

function finiteDifferenceComponent(
  current: Vec2,
  forward: Vec2 | null,
  backward: Vec2 | null,
  epsilon: number,
  component: 0 | 1,
) {
  if (forward && backward) {
    return (forward[component] - backward[component]) / (2 * epsilon);
  }
  if (forward) {
    return (forward[component] - current[component]) / epsilon;
  }
  if (backward) {
    return (current[component] - backward[component]) / epsilon;
  }
  return 0;
}

function evaluateFieldAtPoint(
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius">,
  x: number,
  y: number,
  elements: BoundaryElement[],
  displacements: number[],
  tractions: number[],
  constitutive: ConstitutiveData,
  order: number,
) {
  const current = evaluateInteriorDisplacement(x, y, elements, displacements, tractions, constitutive, order);
  const epsilon = Math.max(1e-5 * Math.max(params.W, params.H), 1e-4);
  const forwardX = evaluateDisplacementWithFallback(params, x + epsilon, y, elements, displacements, tractions, constitutive, order);
  const backwardX = evaluateDisplacementWithFallback(params, x - epsilon, y, elements, displacements, tractions, constitutive, order);
  const forwardY = evaluateDisplacementWithFallback(params, x, y + epsilon, elements, displacements, tractions, constitutive, order);
  const backwardY = evaluateDisplacementWithFallback(params, x, y - epsilon, elements, displacements, tractions, constitutive, order);
  const duxDx = finiteDifferenceComponent(current, forwardX, backwardX, epsilon, 0);
  const duxDy = finiteDifferenceComponent(current, forwardY, backwardY, epsilon, 0);
  const duyDx = finiteDifferenceComponent(current, forwardX, backwardX, epsilon, 1);
  const duyDy = finiteDifferenceComponent(current, forwardY, backwardY, epsilon, 1);
  const stress = computeStress(constitutive, [duxDx, duyDy, duxDy + duyDx]);

  return {
    ux: current[0],
    uy: current[1],
    uMagnitude: Math.hypot(current[0], current[1]),
    ...stress,
  } satisfies FieldState;
}

function evaluateBoundaryTraction(element: BoundaryElement, tractions: number[]) {
  const tx = tractions[element.id * 2] ?? 0;
  const ty = tractions[element.id * 2 + 1] ?? 0;
  return {
    tractionX: tx,
    tractionY: ty,
    tractionNormal: tx * element.midpoint.normal[0] + ty * element.midpoint.normal[1],
    tractionTangential: tx * element.midpoint.tangent[0] + ty * element.midpoint.tangent[1],
  };
}

function buildBoundaryFrames(
  elements: BoundaryElement[],
  displacements: number[],
  tractions: number[],
) {
  return elements.map((element) => {
    const ux = displacements[element.id * 2] ?? 0;
    const uy = displacements[element.id * 2 + 1] ?? 0;
    const traction = evaluateBoundaryTraction(element, tractions);
    return {
      id: element.id,
      x: element.midpoint.x,
      y: element.midpoint.y,
      ux,
      uy,
      uMagnitude: Math.hypot(ux, uy),
      tractionX: traction.tractionX,
      tractionY: traction.tractionY,
      tractionNormal: traction.tractionNormal,
      tractionTangential: traction.tractionTangential,
      boundaryType: element.boundaryType,
      curveLabel: element.curveLabel,
      arcLength: element.midpoint.arcLength,
      normalizedArcLength: element.midpoint.normalizedArcLength,
    } satisfies SolverBoundaryFrameResult;
  });
}

function buildGeometryOutline(
  elements: BoundaryElement[],
  totalLength: number,
  displacements: number[],
) {
  if (!elements.length) {
    return [] as SolverGeometryPoint[];
  }

  const outline: SolverGeometryPoint[] = [];
  const lastIndex = elements.length - 1;

  for (let index = 0; index < elements.length; index++) {
    const current = elements[index];
    const previous = elements[index === 0 ? lastIndex : index - 1];
    const point = current.pointAt(0);
    outline.push({
      x: point.x,
      y: point.y,
      ux: 0.5 * ((displacements[previous.id * 2] ?? 0) + (displacements[current.id * 2] ?? 0)),
      uy: 0.5 * ((displacements[previous.id * 2 + 1] ?? 0) + (displacements[current.id * 2 + 1] ?? 0)),
      boundaryType: point.boundaryType,
      curveLabel: point.curveLabel,
      arcLength: current.arcStart,
      normalizedArcLength: current.arcStart / Math.max(totalLength, 1e-12),
    });
  }

  const first = elements[0];
  const closingPoint = first.pointAt(0);
  outline.push({
    x: closingPoint.x,
    y: closingPoint.y,
    ux: outline[0]?.ux ?? 0,
    uy: outline[0]?.uy ?? 0,
    boundaryType: closingPoint.boundaryType,
    curveLabel: closingPoint.curveLabel,
    arcLength: totalLength,
    normalizedArcLength: 1,
  });

  return outline;
}

function buildFieldSamples(
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius" | "nx" | "ny" | "boundaryQuadratureOrder">,
  elements: BoundaryElement[],
  displacements: number[],
  tractions: number[],
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
      const field = evaluateFieldAtPoint(
        params,
        x,
        y,
        elements,
        displacements,
        tractions,
        constitutive,
        params.boundaryQuadratureOrder,
      );
      samples.push({ x, y, ...field });
    }
  }

  return samples;
}

function holeBoundaryState(
  theta: number,
  elements: BoundaryElement[],
  displacements: number[],
  tractions: number[],
) {
  const holeElements = elements
    .filter((element) => element.boundaryType === "hole")
    .map((element) => ({
      element,
      theta: Math.atan2(element.midpoint.y, element.midpoint.x),
      ux: displacements[element.id * 2] ?? 0,
      uy: displacements[element.id * 2 + 1] ?? 0,
      tx: tractions[element.id * 2] ?? 0,
      ty: tractions[element.id * 2 + 1] ?? 0,
    }))
    .sort((left, right) => left.theta - right.theta);

  if (!holeElements.length) {
    return null;
  }

  if (theta <= holeElements[0].theta) {
    const point = holeElements[0];
    const next = holeElements[Math.min(1, holeElements.length - 1)] ?? point;
    const span = Math.max(next.theta - point.theta, 1e-12);
    return {
      ux: point.ux,
      uy: point.uy,
      duxDTheta: (next.ux - point.ux) / span,
      duyDTheta: (next.uy - point.uy) / span,
      tx: point.tx,
      ty: point.ty,
    };
  }

  if (theta >= holeElements[holeElements.length - 1].theta) {
    const point = holeElements[holeElements.length - 1];
    const previous = holeElements[Math.max(holeElements.length - 2, 0)] ?? point;
    const span = Math.max(point.theta - previous.theta, 1e-12);
    return {
      ux: point.ux,
      uy: point.uy,
      duxDTheta: (point.ux - previous.ux) / span,
      duyDTheta: (point.uy - previous.uy) / span,
      tx: point.tx,
      ty: point.ty,
    };
  }

  for (let index = 0; index < holeElements.length - 1; index++) {
    const left = holeElements[index];
    const right = holeElements[index + 1];
    if (theta < left.theta || theta > right.theta) {
      continue;
    }

    const span = Math.max(right.theta - left.theta, 1e-12);
    const t = (theta - left.theta) / span;
    return {
      ux: left.ux + (right.ux - left.ux) * t,
      uy: left.uy + (right.uy - left.uy) * t,
      duxDTheta: (right.ux - left.ux) / span,
      duyDTheta: (right.uy - left.uy) / span,
      tx: left.tx + (right.tx - left.tx) * t,
      ty: left.ty + (right.ty - left.ty) * t,
    };
  }

  return null;
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

function nearestHoleElement(theta: number, elements: BoundaryElement[]) {
  return elements
    .filter((element) => element.boundaryType === "hole")
    .reduce<BoundaryElement | null>((best, element) => {
      const currentTheta = Math.atan2(element.midpoint.y, element.midpoint.x);
      if (!best) {
        return element;
      }
      const bestTheta = Math.atan2(best.midpoint.y, best.midpoint.x);
      return Math.abs(currentTheta - theta) < Math.abs(bestTheta - theta) ? element : best;
    }, null);
}

function buildHoleBoundarySamples(
  params: Pick<
    SolverParams,
    "domainType" | "W" | "H" | "holeRadius" | "boundaryQuadratureOrder" | "E" | "nu" | "planeType"
  >,
  elements: BoundaryElement[],
  displacements: number[],
  tractions: number[],
) {
  const samples: SolverBoundarySample[] = [];
  if (params.domainType !== "circle_hole") {
    return samples;
  }

  const sampleCount = Math.max(36, params.boundaryQuadratureOrder * 6);
  const tangentialModulus = params.planeType === "plane_stress" ? params.E : params.E / (1 - params.nu * params.nu);

  for (let index = 0; index <= sampleCount; index++) {
    const theta = (index / sampleCount) * (Math.PI / 2);
    const x = params.holeRadius * Math.cos(theta);
    const y = params.holeRadius * Math.sin(theta);
    const normal: Vec2 = [-Math.cos(theta), -Math.sin(theta)];
    const tangent: Vec2 = [Math.sin(theta), -Math.cos(theta)];
    const state = holeBoundaryState(theta, elements, displacements, tractions);
    if (!state) {
      continue;
    }
    const ur = state.ux * Math.cos(theta) + state.uy * Math.sin(theta);
    const uTheta = -state.ux * Math.sin(theta) + state.uy * Math.cos(theta);
    void uTheta;
    const duThetaDTheta =
      -state.duxDTheta * Math.sin(theta)
      - state.ux * Math.cos(theta)
      + state.duyDTheta * Math.cos(theta)
      - state.uy * Math.sin(theta);
    const epsilonThetaTheta = (duThetaDTheta + ur) / Math.max(params.holeRadius, 1e-12);
    const tractionNormal = state.tx * normal[0] + state.ty * normal[1];
    const tractionTangential = state.tx * tangent[0] + state.ty * tangent[1];
    samples.push({
      x,
      y,
      thetaDeg: theta * 180 / Math.PI,
      sigmaRR: tractionNormal,
      sigmaThetaTheta: tangentialModulus * epsilonThetaTheta,
      sigmaRTheta: tractionTangential,
      tractionNormal,
      tractionTangential,
    });
  }

  return samples.sort((left, right) => left.thetaDeg - right.thetaDeg);
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
): FunctionizedCoreResult {
  const segments = buildSegments(params);
  const counts = boundaryElementCounts(params);
  const { elements, totalLength } = buildBoundaryElements(segments, counts);
  const constitutive = constitutiveMatrix(params.E, params.nu, params.planeType);
  const { H, G } = buildBoundaryIntegralOperators(elements, constitutive, params.boundaryQuadratureOrder);
  const boundarySolve = solveBoundarySystem(elements, H, G, params);
  const boundaryFrames = buildBoundaryFrames(elements, boundarySolve.displacements, boundarySolve.tractions);
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
    elements,
    boundarySolve.displacements,
    boundarySolve.tractions,
    constitutive,
  );
  const stresses = fieldSamples.map((sample, index) => ({
    elementId: index,
    cx: sample.x,
    cy: sample.y,
    sxx: sample.sxx,
    syy: sample.syy,
    sxy: sample.sxy,
    vonMises: sample.vonMises,
  } satisfies SolverStressResult));
  const geometryOutline = buildGeometryOutline(elements, totalLength, boundarySolve.displacements);
  const holeBoundarySamples = buildHoleBoundarySamples(
    params,
    elements,
    boundarySolve.displacements,
    boundarySolve.tractions,
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
      boundaryElementCount: elements.length,
      boundaryQuadratureOrder: params.boundaryQuadratureOrder,
      systemConditionEstimate: boundarySolve.systemConditionEstimate,
      maxBoundaryResidual: boundarySolve.maxBoundaryResidual,
      rmsBoundaryResidual: boundarySolve.rmsBoundaryResidual,
    } satisfies FunctionizedDiagnostics,
    maxDisp: Math.max(...nodes.map((node) => node.uMagnitude), ...fieldSamples.map((sample) => sample.uMagnitude), 0),
    maxVonMises: Math.max(...stresses.map((stress) => stress.vonMises), ...fieldSamples.map((sample) => sample.vonMises), 0),
    kirschSCF,
    kirschError,
    stressError: params.domainType === "circle_hole" ? computeStressErrorNorm(fieldSamples, params) : 0,
  };
}

function buildFunctionizedConvergenceData(
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
  current: FunctionizedCoreResult,
) {
  if (params.domainType !== "circle_hole" || params.loadType !== "uniform_tension" || params.loadMag <= 0) {
    return [] satisfies SolverConvergencePoint[];
  }

  const studies = new Map<string, FunctionizedCoreResult>();
  studies.set(`${params.nx}:${params.ny}`, current);

  return functionizedLevels(params.nx, params.ny).map((level) => {
    const key = `${level.nx}:${level.ny}`;
    let study = studies.get(key);
    if (!study) {
      study = solveFunctionizedCore({
        ...params,
        nx: level.nx,
        ny: level.ny,
      });
      studies.set(key, study);
    }

    return {
      method: "Functionized TK-FEM",
      nElem: study.functionizedDiagnostics.boundaryElementCount,
      scf: Number((study.kirschSCF ?? 0).toFixed(4)),
      error: Number(study.stressError.toFixed(4)),
    } satisfies SolverConvergencePoint;
  });
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

  if (params.domainType === "circle_hole" && params.loadType !== "uniform_tension") {
    throw new Error("Functionized circle-hole mode is currently validated for the uniform-tension Kirsch benchmark only.");
  }

  const current = solveFunctionizedCore(params);
  const convergenceData = buildFunctionizedConvergenceData(params, current);

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
