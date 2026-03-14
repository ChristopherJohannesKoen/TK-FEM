import { pinv } from "mathjs";
import type {
  SolverBoundarySample,
  SolverConvergencePoint,
  SolverFieldSample,
  SolverParams,
  SolverResults,
} from "@shared/solver";
import { analyzeMagnusConvergence } from "./magnus-analysis";
import { runFunctionizedSingleDomainSolve } from "./functionized-single-domain";

type Mat = number[];
type DenseMatrix = number[][];
type Vec2 = [number, number];

interface Node {
  id: number;
  x: number;
  y: number;
}

interface Element {
  id: number;
  nodeIds: [number, number, number, number];
  center: Vec2;
  characteristicSize: number;
}

interface Mesh {
  nodes: Node[];
  elements: Element[];
}

interface TransportOperators {
  Ax: Mat;
  Ay: Mat;
  n: number;
}

interface ConstitutiveData {
  matrix: DenseMatrix;
}

interface ElementRecovery {
  elementId: number;
  element: Element;
  boundaryProjection: DenseMatrix;
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

interface TKSolveArtifacts {
  mesh: Mesh;
  displacements: number[];
  nodes: SolverResults["nodes"];
  stresses: SolverResults["stresses"];
  fieldSamples: SolverFieldSample[];
  holeBoundarySamples: SolverBoundarySample[];
  elementRecoveries: Map<number, ElementRecovery>;
  maxDisp: number;
  maxVonMises: number;
  kirschSCF?: number;
  kirschError?: number;
}

const EDGE_NODE_INDICES: Array<[0 | 1 | 2 | 3, 0 | 1 | 2 | 3]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];

const LINE_GAUSS_POINTS = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)];
const LINE_GAUSS_WEIGHTS = [5 / 9, 8 / 9, 5 / 9];
const QUAD_GAUSS_POINTS = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)];
const QUAD_GAUSS_WEIGHTS = [5 / 9, 8 / 9, 5 / 9];

function matZero(n: number): Mat {
  return new Array(n * n).fill(0);
}

function matEye(n: number): Mat {
  const matrix = matZero(n);
  for (let i = 0; i < n; i++) {
    matrix[i * n + i] = 1;
  }
  return matrix;
}

function matGet(matrix: Mat, n: number, row: number, column: number) {
  return matrix[row * n + column];
}

function matSet(matrix: Mat, n: number, row: number, column: number, value: number) {
  matrix[row * n + column] = value;
}

function matAdd(A: Mat, B: Mat) {
  return A.map((value, index) => value + B[index]);
}

function matScale(A: Mat, factor: number) {
  return A.map((value) => value * factor);
}

function matMul(A: Mat, B: Mat, n: number): Mat {
  const C = matZero(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = matGet(A, n, i, k);
      if (aik === 0) {
        continue;
      }
      for (let j = 0; j < n; j++) {
        C[i * n + j] += aik * matGet(B, n, k, j);
      }
    }
  }
  return C;
}

function matVecMul(A: Mat, vector: number[], n: number) {
  const result = new Array(n).fill(0);
  for (let row = 0; row < n; row++) {
    let value = 0;
    for (let column = 0; column < n; column++) {
      value += matGet(A, n, row, column) * (vector[column] ?? 0);
    }
    result[row] = value;
  }
  return result;
}

function matNorm(A: Mat) {
  return Math.sqrt(A.reduce((sum, value) => sum + value * value, 0));
}

function matExp(A: Mat, n: number): Mat {
  let norm = 0;
  for (const value of A) {
    norm = Math.max(norm, Math.abs(value));
  }

  let scale = 0;
  while (norm * Math.pow(2, -scale) > 0.5) {
    scale += 1;
  }

  const scaled = matScale(A, Math.pow(2, -scale));
  let result = matEye(n);
  let term = matEye(n);

  for (let order = 1; order <= 14; order++) {
    term = matScale(matMul(term, scaled, n), 1 / order);
    result = matAdd(result, term);
    if (matNorm(term) < 1e-20) {
      break;
    }
  }

  for (let i = 0; i < scale; i++) {
    result = matMul(result, result, n);
  }

  return result;
}

function zeroMatrix(rows: number, columns: number): DenseMatrix {
  return Array.from({ length: rows }, () => new Array(columns).fill(0));
}

function transpose(matrix: DenseMatrix): DenseMatrix {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function multiplyDense(A: DenseMatrix, B: DenseMatrix): DenseMatrix {
  const rows = A.length;
  const columns = B[0].length;
  const inner = B.length;
  const result = zeroMatrix(rows, columns);
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      const aik = A[i][k];
      if (aik === 0) {
        continue;
      }
      for (let j = 0; j < columns; j++) {
        result[i][j] += aik * B[k][j];
      }
    }
  }
  return result;
}

function multiplyDenseVector(A: DenseMatrix, vector: number[]) {
  return A.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

function addScaled(A: DenseMatrix, B: DenseMatrix, scale: number) {
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < A[i].length; j++) {
      A[i][j] += B[i][j] * scale;
    }
  }
}

function symmetrize(matrix: DenseMatrix) {
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) {
      const value = 0.5 * (matrix[i][j] + matrix[j][i]);
      matrix[i][j] = value;
      matrix[j][i] = value;
    }
  }
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
    };
  }

  const factor = E / ((1 + nu) * (1 - 2 * nu));
  return {
    matrix: [
      [factor * (1 - nu), factor * nu, 0],
      [factor * nu, factor * (1 - nu), 0],
      [0, 0, factor * (1 - 2 * nu) / 2],
    ],
  };
}

function computeStress(constitutive: ConstitutiveData, state: number[]) {
  const sigma = multiplyDenseVector(constitutive.matrix, [
    state[2] ?? 0,
    state[5] ?? 0,
    (state[4] ?? 0) + (state[3] ?? 0),
  ]);
  const [sxx, syy, sxy] = sigma;
  return {
    sxx,
    syy,
    sxy,
    vonMises: Math.sqrt(sxx * sxx - sxx * syy + syy * syy + 3 * sxy * sxy),
  };
}

function buildTransportOperators(E: number, nu: number, planeType: "plane_stress" | "plane_strain"): TransportOperators {
  const n = 6;
  const Ax = matZero(n);
  const Ay = matZero(n);

  matSet(Ax, n, 0, 2, 1);
  matSet(Ax, n, 1, 3, 1);
  matSet(Ay, n, 0, 4, 1);
  matSet(Ay, n, 1, 5, 1);

  return { Ax, Ay, n };
}

function transportMatrix(transport: TransportOperators, dx: number, dy: number) {
  const Omega = matAdd(matScale(transport.Ax, dx), matScale(transport.Ay, dy));
  return matExp(Omega, transport.n);
}

function quadShapeFunctions(xi: number, eta: number) {
  return [
    0.25 * (1 - xi) * (1 - eta),
    0.25 * (1 + xi) * (1 - eta),
    0.25 * (1 + xi) * (1 + eta),
    0.25 * (1 - xi) * (1 + eta),
  ] as const;
}

function quadShapeFunctionDerivatives(xi: number, eta: number) {
  return {
    dNdxi: [
      -0.25 * (1 - eta),
      0.25 * (1 - eta),
      0.25 * (1 + eta),
      -0.25 * (1 + eta),
    ] as const,
    dNdeta: [
      -0.25 * (1 - xi),
      -0.25 * (1 + xi),
      0.25 * (1 + xi),
      0.25 * (1 - xi),
    ] as const,
  };
}

function mapQuadPoint(element: Element, nodes: Node[], xi: number, eta: number) {
  const shape = quadShapeFunctions(xi, eta);
  const coordinates = element.nodeIds.map((nodeId) => nodes[nodeId]);
  return {
    x: shape.reduce((sum, value, index) => sum + value * coordinates[index].x, 0),
    y: shape.reduce((sum, value, index) => sum + value * coordinates[index].y, 0),
  };
}

function quadJacobian(element: Element, nodes: Node[], xi: number, eta: number) {
  const { dNdxi, dNdeta } = quadShapeFunctionDerivatives(xi, eta);
  const coordinates = element.nodeIds.map((nodeId) => nodes[nodeId]);
  let j11 = 0;
  let j12 = 0;
  let j21 = 0;
  let j22 = 0;

  for (let i = 0; i < 4; i++) {
    j11 += dNdxi[i] * coordinates[i].x;
    j12 += dNdxi[i] * coordinates[i].y;
    j21 += dNdeta[i] * coordinates[i].x;
    j22 += dNdeta[i] * coordinates[i].y;
  }

  return { j11, j12, j21, j22, determinant: j11 * j22 - j12 * j21 };
}

function boundaryShapeMatrix(edgeIndex: number, s: number): DenseMatrix {
  const [nodeA, nodeB] = EDGE_NODE_INDICES[edgeIndex];
  const N1 = 0.5 * (1 - s);
  const N2 = 0.5 * (1 + s);
  const matrix = zeroMatrix(2, 8);
  matrix[0][nodeA * 2] = N1;
  matrix[1][nodeA * 2 + 1] = N1;
  matrix[0][nodeB * 2] = N2;
  matrix[1][nodeB * 2 + 1] = N2;
  return matrix;
}

function edgePointAndNormal(element: Element, nodes: Node[], edgeIndex: number, s: number) {
  const [nodeAIndex, nodeBIndex] = EDGE_NODE_INDICES[edgeIndex];
  const nodeA = nodes[element.nodeIds[nodeAIndex]];
  const nodeB = nodes[element.nodeIds[nodeBIndex]];
  const x = 0.5 * ((1 - s) * nodeA.x + (1 + s) * nodeB.x);
  const y = 0.5 * ((1 - s) * nodeA.y + (1 + s) * nodeB.y);
  const tx = nodeB.x - nodeA.x;
  const ty = nodeB.y - nodeA.y;
  const length = Math.hypot(tx, ty);
  return {
    x,
    y,
    length,
    normal: [ty / Math.max(length, 1e-12), -tx / Math.max(length, 1e-12)] as Vec2,
  };
}

function edgeMidpoint(element: Element, nodes: Node[], edgeIndex: number) {
  const [nodeAIndex, nodeBIndex] = EDGE_NODE_INDICES[edgeIndex];
  const nodeA = nodes[element.nodeIds[nodeAIndex]];
  const nodeB = nodes[element.nodeIds[nodeBIndex]];
  return { x: 0.5 * (nodeA.x + nodeB.x), y: 0.5 * (nodeA.y + nodeB.y) };
}

function classifyBoundaryEdge(
  element: Element,
  nodes: Node[],
  edgeIndex: number,
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius">,
) {
  const tolerance = 1e-6;
  const [nodeAIndex, nodeBIndex] = EDGE_NODE_INDICES[edgeIndex];
  const nodeA = nodes[element.nodeIds[nodeAIndex]];
  const nodeB = nodes[element.nodeIds[nodeBIndex]];
  const midpoint = edgeMidpoint(element, nodes, edgeIndex);
  const radiusA = Math.hypot(nodeA.x, nodeA.y);
  const radiusB = Math.hypot(nodeB.x, nodeB.y);

  if (
    params.domainType === "circle_hole" &&
    Math.abs(radiusA - params.holeRadius) < 1e-5 &&
    Math.abs(radiusB - params.holeRadius) < 1e-5
  ) {
    return "hole";
  }
  if (Math.abs(nodeA.x) < tolerance && Math.abs(nodeB.x) < tolerance) {
    return "symmetry_x";
  }
  if (Math.abs(nodeA.y) < tolerance && Math.abs(nodeB.y) < tolerance) {
    return "symmetry_y";
  }
  if (Math.abs(nodeA.x - params.W) < tolerance && Math.abs(nodeB.x - params.W) < tolerance) {
    return "right";
  }
  if (Math.abs(nodeA.y - params.H) < tolerance && Math.abs(nodeB.y - params.H) < tolerance) {
    return "top";
  }
  if (Math.abs(midpoint.x - params.W) < tolerance) {
    return "right";
  }
  if (Math.abs(midpoint.y - params.H) < tolerance) {
    return "top";
  }
  return "internal";
}

function tractionForBoundary(boundaryType: string, params: Pick<SolverParams, "loadType" | "loadMag">): Vec2 | null {
  if (params.loadType === "uniform_tension" && boundaryType === "right") {
    return [params.loadMag, 0];
  }
  if (params.loadType === "shear" && boundaryType === "top") {
    return [params.loadMag, 0];
  }
  return null;
}

function computeBasisAtPoint(
  point: Vec2,
  center: Vec2,
  normal: Vec2,
  transport: TransportOperators,
  constitutive: ConstitutiveData,
) {
  const T = transportMatrix(transport, point[0] - center[0], point[1] - center[1]);
  const U = zeroMatrix(2, transport.n);
  const Q = zeroMatrix(2, transport.n);

  for (let column = 0; column < transport.n; column++) {
    U[0][column] = matGet(T, transport.n, 0, column);
    U[1][column] = matGet(T, transport.n, 1, column);
    const basisState = new Array(transport.n).fill(0);
    basisState[column] = 1;
    const transported = matVecMul(T, basisState, transport.n);
    const stress = computeStress(constitutive, transported);
    Q[0][column] = stress.sxx * normal[0] + stress.sxy * normal[1];
    Q[1][column] = stress.sxy * normal[0] + stress.syy * normal[1];
  }

  return { U, Q };
}

function displacementBasisAtPoint(point: Vec2, center: Vec2, transport: TransportOperators) {
  const T = transportMatrix(transport, point[0] - center[0], point[1] - center[1]);
  const U = zeroMatrix(2, transport.n);
  for (let column = 0; column < transport.n; column++) {
    U[0][column] = matGet(T, transport.n, 0, column);
    U[1][column] = matGet(T, transport.n, 1, column);
  }
  return U;
}

function buildElementCenter(element: Element, nodes: Node[]): Vec2 {
  const coordinates = element.nodeIds.map((nodeId) => nodes[nodeId]);
  return [
    coordinates.reduce((sum, node) => sum + node.x, 0) / 4,
    coordinates.reduce((sum, node) => sum + node.y, 0) / 4,
  ];
}

function characteristicSize(element: Element, nodes: Node[]) {
  const lengths = EDGE_NODE_INDICES.map(([a, b]) => {
    const nodeA = nodes[element.nodeIds[a]];
    const nodeB = nodes[element.nodeIds[b]];
    return Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
  });
  return lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
}

function generateRectMesh(W: number, H: number, nx: number, ny: number): Mesh {
  const nodes: Node[] = [];
  const elements: Element[] = [];

  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      nodes.push({ id: j * (nx + 1) + i, x: (i / nx) * W, y: (j / ny) * H });
    }
  }

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const provisional: Element = {
        id: elements.length,
        nodeIds: [
          j * (nx + 1) + i,
          j * (nx + 1) + i + 1,
          (j + 1) * (nx + 1) + i + 1,
          (j + 1) * (nx + 1) + i,
        ],
        center: [0, 0],
        characteristicSize: 0,
      };
      provisional.center = buildElementCenter(provisional, nodes);
      provisional.characteristicSize = characteristicSize(provisional, nodes);
      elements.push(provisional);
    }
  }

  return { nodes, elements };
}

function generateQuarterHoleMesh(W: number, H: number, holeRadius: number, nx: number, ny: number): Mesh {
  const thetaCorner = Math.atan2(H, W);
  const nRight = Math.max(1, Math.min(nx - 1, Math.round((thetaCorner / (Math.PI / 2)) * nx)));
  const nTop = Math.max(1, nx - nRight);
  const angles: number[] = [];

  for (let i = 0; i <= nRight; i++) {
    angles.push((thetaCorner * i) / nRight);
  }
  for (let i = 1; i <= nTop; i++) {
    angles.push(thetaCorner + ((Math.PI / 2 - thetaCorner) * i) / nTop);
  }

  const nodes: Node[] = [];
  const elements: Element[] = [];
  const nodeIndex = new Map<string, number>();
  const radialFractions = Array.from({ length: ny + 1 }, (_, index) => Math.pow(index / ny, 1.25));

  function outerPoint(theta: number): Vec2 {
    const tolerance = 1e-9;
    if (theta <= thetaCorner + tolerance) {
      return Math.abs(theta) < tolerance ? [W, 0] : [W, W * Math.tan(theta)];
    }
    return Math.abs(theta - Math.PI / 2) < tolerance ? [0, H] : [H / Math.tan(theta), H];
  }

  for (let radialIndex = 0; radialIndex <= ny; radialIndex++) {
    for (let angleIndex = 0; angleIndex < angles.length; angleIndex++) {
      const theta = angles[angleIndex];
      const inner: Vec2 = [holeRadius * Math.cos(theta), holeRadius * Math.sin(theta)];
      const outer = outerPoint(theta);
      const fraction = radialFractions[radialIndex];
      const id = nodes.length;
      nodes.push({
        id,
        x: inner[0] + fraction * (outer[0] - inner[0]),
        y: inner[1] + fraction * (outer[1] - inner[1]),
      });
      nodeIndex.set(`${radialIndex}:${angleIndex}`, id);
    }
  }

  for (let radialIndex = 0; radialIndex < ny; radialIndex++) {
    for (let angleIndex = 0; angleIndex < angles.length - 1; angleIndex++) {
      const provisional: Element = {
        id: elements.length,
        nodeIds: [
          nodeIndex.get(`${radialIndex}:${angleIndex}`)!,
          nodeIndex.get(`${radialIndex + 1}:${angleIndex}`)!,
          nodeIndex.get(`${radialIndex + 1}:${angleIndex + 1}`)!,
          nodeIndex.get(`${radialIndex}:${angleIndex + 1}`)!,
        ],
        center: [0, 0],
        characteristicSize: 0,
      };
      provisional.center = buildElementCenter(provisional, nodes);
      provisional.characteristicSize = characteristicSize(provisional, nodes);
      elements.push(provisional);
    }
  }

  return { nodes, elements };
}

function generateMesh(params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius" | "nx" | "ny">): Mesh {
  return params.domainType === "circle_hole"
    ? generateQuarterHoleMesh(params.W, params.H, params.holeRadius, params.nx, params.ny)
    : generateRectMesh(params.W, params.H, params.nx, params.ny);
}

function buildTKElementMatrices(
  element: Element,
  mesh: Mesh,
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius" | "loadType" | "loadMag">,
  transport: TransportOperators,
  constitutive: ConstitutiveData,
) {
  const boundarySamples = zeroMatrix(8, transport.n);
  const fe = new Array(8).fill(0);

  element.nodeIds.forEach((nodeId, localIndex) => {
    const node = mesh.nodes[nodeId];
    const U = displacementBasisAtPoint([node.x, node.y], element.center, transport);
    for (let column = 0; column < transport.n; column++) {
      boundarySamples[localIndex * 2][column] = U[0][column];
      boundarySamples[localIndex * 2 + 1][column] = U[1][column];
    }
  });

  const boundaryProjection = pseudoInverse(boundarySamples);
  const Ke = zeroMatrix(8, 8);

  for (let edgeIndex = 0; edgeIndex < EDGE_NODE_INDICES.length; edgeIndex++) {
    const boundaryType = classifyBoundaryEdge(element, mesh.nodes, edgeIndex, params);
    const traction = tractionForBoundary(boundaryType, params);

    for (let gpIndex = 0; gpIndex < LINE_GAUSS_POINTS.length; gpIndex++) {
      const s = LINE_GAUSS_POINTS[gpIndex];
      const weight = LINE_GAUSS_WEIGHTS[gpIndex];
      const edgeData = edgePointAndNormal(element, mesh.nodes, edgeIndex, s);
      const basis = computeBasisAtPoint(
        [edgeData.x, edgeData.y],
        element.center,
        edgeData.normal,
        transport,
        constitutive,
      );
      const N = boundaryShapeMatrix(edgeIndex, s);
      const scale = weight * edgeData.length / 2;
      addScaled(Ke, multiplyDense(transpose(N), multiplyDense(basis.Q, boundaryProjection)), scale);

      if (traction) {
        const loadContribution = multiplyDenseVector(transpose(N), traction);
        for (let i = 0; i < 8; i++) {
          fe[i] += loadContribution[i] * scale;
        }
      }
    }
  }

  symmetrize(Ke);

  return {
    Ke,
    fe,
    recovery: {
      elementId: element.id,
      element,
      boundaryProjection,
    } satisfies ElementRecovery,
  };
}

function assembleTKSystem(
  mesh: Mesh,
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius" | "loadType" | "loadMag">,
  transport: TransportOperators,
  constitutive: ConstitutiveData,
) {
  const nDOF = mesh.nodes.length * 2;
  const K = zeroMatrix(nDOF, nDOF);
  const F = new Array(nDOF).fill(0);
  const recoveries = new Map<number, ElementRecovery>();

  for (const element of mesh.elements) {
    const { Ke, fe, recovery } = buildTKElementMatrices(element, mesh, params, transport, constitutive);
    recoveries.set(element.id, recovery);
    const dofs = element.nodeIds.flatMap((nodeId) => [nodeId * 2, nodeId * 2 + 1]);

    for (let i = 0; i < dofs.length; i++) {
      F[dofs[i]] += fe[i];
      for (let j = 0; j < dofs.length; j++) {
        K[dofs[i]][dofs[j]] += Ke[i][j];
      }
    }
  }

  if (params.loadType === "point_load") {
    const targetNode = mesh.nodes.reduce((best, node) => {
      const bestDistance = Math.hypot(best.x - params.W, best.y - params.H);
      const currentDistance = Math.hypot(node.x - params.W, node.y - params.H);
      return currentDistance < bestDistance ? node : best;
    }, mesh.nodes[0]);
    F[targetNode.id * 2 + 1] -= params.loadMag;
  }

  return { K, F, recoveries };
}

function buildStandardElementStiffness(element: Element, nodes: Node[], constitutive: ConstitutiveData) {
  const Ke = zeroMatrix(8, 8);

  for (let i = 0; i < QUAD_GAUSS_POINTS.length; i++) {
    for (let j = 0; j < QUAD_GAUSS_POINTS.length; j++) {
      const xi = QUAD_GAUSS_POINTS[i];
      const eta = QUAD_GAUSS_POINTS[j];
      const weight = QUAD_GAUSS_WEIGHTS[i] * QUAD_GAUSS_WEIGHTS[j];
      const shapeDerivatives = quadShapeFunctionDerivatives(xi, eta);
      const jacobian = quadJacobian(element, nodes, xi, eta);
      const detJ = jacobian.determinant;
      const invJ = [
        [jacobian.j22 / detJ, -jacobian.j12 / detJ],
        [-jacobian.j21 / detJ, jacobian.j11 / detJ],
      ];

      const dNdx = shapeDerivatives.dNdxi.map((value, index) => value * invJ[0][0] + shapeDerivatives.dNdeta[index] * invJ[0][1]);
      const dNdy = shapeDerivatives.dNdxi.map((value, index) => value * invJ[1][0] + shapeDerivatives.dNdeta[index] * invJ[1][1]);
      const B = zeroMatrix(3, 8);

      for (let k = 0; k < 4; k++) {
        B[0][2 * k] = dNdx[k];
        B[1][2 * k + 1] = dNdy[k];
        B[2][2 * k] = dNdy[k];
        B[2][2 * k + 1] = dNdx[k];
      }

      addScaled(Ke, multiplyDense(multiplyDense(transpose(B), constitutive.matrix), B), weight * detJ);
    }
  }

  symmetrize(Ke);
  return Ke;
}

function assembleStandardSystem(
  mesh: Mesh,
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius" | "loadType" | "loadMag">,
  constitutive: ConstitutiveData,
) {
  const nDOF = mesh.nodes.length * 2;
  const K = zeroMatrix(nDOF, nDOF);
  const F = new Array(nDOF).fill(0);

  for (const element of mesh.elements) {
    const Ke = buildStandardElementStiffness(element, mesh.nodes, constitutive);
    const dofs = element.nodeIds.flatMap((nodeId) => [nodeId * 2, nodeId * 2 + 1]);

    for (let edgeIndex = 0; edgeIndex < EDGE_NODE_INDICES.length; edgeIndex++) {
      const boundaryType = classifyBoundaryEdge(element, mesh.nodes, edgeIndex, params);
      const traction = tractionForBoundary(boundaryType, params);
      if (!traction) {
        continue;
      }

      for (let gpIndex = 0; gpIndex < LINE_GAUSS_POINTS.length; gpIndex++) {
        const s = LINE_GAUSS_POINTS[gpIndex];
        const weight = LINE_GAUSS_WEIGHTS[gpIndex];
        const edgeData = edgePointAndNormal(element, mesh.nodes, edgeIndex, s);
        const N = boundaryShapeMatrix(edgeIndex, s);
        const contribution = multiplyDenseVector(transpose(N), traction);
        const scale = weight * edgeData.length / 2;
        for (let i = 0; i < dofs.length; i++) {
          F[dofs[i]] += contribution[i] * scale;
        }
      }
    }

    for (let i = 0; i < dofs.length; i++) {
      for (let j = 0; j < dofs.length; j++) {
        K[dofs[i]][dofs[j]] += Ke[i][j];
      }
    }
  }

  if (params.loadType === "point_load") {
    const targetNode = mesh.nodes.reduce((best, node) => {
      const bestDistance = Math.hypot(best.x - params.W, best.y - params.H);
      const currentDistance = Math.hypot(node.x - params.W, node.y - params.H);
      return currentDistance < bestDistance ? node : best;
    }, mesh.nodes[0]);
    F[targetNode.id * 2 + 1] -= params.loadMag;
  }

  return { K, F };
}

function applyDirichlet(K: DenseMatrix, F: number[], dof: number, value: number) {
  for (let row = 0; row < K.length; row++) {
    F[row] -= K[row][dof] * value;
    K[row][dof] = 0;
    K[dof][row] = 0;
  }
  K[dof][dof] = 1;
  F[dof] = value;
}

function applyBoundaryConditions(K: DenseMatrix, F: number[], nodes: Node[]) {
  const tolerance = 1e-6;
  for (const node of nodes) {
    if (Math.abs(node.x) < tolerance) {
      applyDirichlet(K, F, node.id * 2, 0);
    }
    if (Math.abs(node.y) < tolerance) {
      applyDirichlet(K, F, node.id * 2 + 1, 0);
    }
  }
}

function solveLinearSystem(K: DenseMatrix, F: number[]) {
  const n = F.length;
  const A = K.map((row, index) => [...row, F[index]]);

  for (let pivot = 0; pivot < n; pivot++) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < n; row++) {
      if (Math.abs(A[row][pivot]) > Math.abs(A[maxRow][pivot])) {
        maxRow = row;
      }
    }
    [A[pivot], A[maxRow]] = [A[maxRow], A[pivot]];

    const pivotValue = A[pivot][pivot];
    if (Math.abs(pivotValue) < 1e-14) {
      continue;
    }

    for (let row = pivot + 1; row < n; row++) {
      const factor = A[row][pivot] / pivotValue;
      for (let column = pivot; column <= n; column++) {
        A[row][column] -= factor * A[pivot][column];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    if (Math.abs(A[row][row]) < 1e-14) {
      continue;
    }
    let value = A[row][n];
    for (let column = row + 1; column < n; column++) {
      value -= A[row][column] * x[column];
    }
    x[row] = value / A[row][row];
  }

  return x;
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

function evaluateTKFieldAtPoint(
  recovery: ElementRecovery,
  displacements: number[],
  transport: TransportOperators,
  constitutive: ConstitutiveData,
  x: number,
  y: number,
): FieldState {
  const q = recovery.element.nodeIds.flatMap((nodeId) => [displacements[nodeId * 2] ?? 0, displacements[nodeId * 2 + 1] ?? 0]);
  const coefficients = multiplyDenseVector(recovery.boundaryProjection, q);
  const state = matVecMul(transportMatrix(transport, x - recovery.element.center[0], y - recovery.element.center[1]), coefficients, transport.n);
  const stress = computeStress(constitutive, state);

  return {
    ux: state[0] ?? 0,
    uy: state[1] ?? 0,
    uMagnitude: Math.hypot(state[0] ?? 0, state[1] ?? 0),
    ...stress,
  };
}

function evaluateStandardFieldAtPoint(
  element: Element,
  nodes: Node[],
  displacements: number[],
  constitutive: ConstitutiveData,
  xi: number,
  eta: number,
): FieldState {
  const shape = quadShapeFunctions(xi, eta);
  const derivatives = quadShapeFunctionDerivatives(xi, eta);
  const jacobian = quadJacobian(element, nodes, xi, eta);
  const invJ = [
    [jacobian.j22 / jacobian.determinant, -jacobian.j12 / jacobian.determinant],
    [-jacobian.j21 / jacobian.determinant, jacobian.j11 / jacobian.determinant],
  ];
  const dNdx = derivatives.dNdxi.map((value, index) => value * invJ[0][0] + derivatives.dNdeta[index] * invJ[0][1]);
  const dNdy = derivatives.dNdxi.map((value, index) => value * invJ[1][0] + derivatives.dNdeta[index] * invJ[1][1]);
  const local = element.nodeIds.flatMap((nodeId) => [displacements[nodeId * 2] ?? 0, displacements[nodeId * 2 + 1] ?? 0]);

  const ux = shape.reduce((sum, value, index) => sum + value * local[index * 2], 0);
  const uy = shape.reduce((sum, value, index) => sum + value * local[index * 2 + 1], 0);
  const exx = dNdx.reduce((sum, value, index) => sum + value * local[index * 2], 0);
  const eyy = dNdy.reduce((sum, value, index) => sum + value * local[index * 2 + 1], 0);
  const gxy =
    dNdy.reduce((sum, value, index) => sum + value * local[index * 2], 0) +
    dNdx.reduce((sum, value, index) => sum + value * local[index * 2 + 1], 0);
  const sigma = multiplyDenseVector(constitutive.matrix, [exx, eyy, gxy]);
  const [sxx, syy, sxy] = sigma;

  return {
    ux,
    uy,
    uMagnitude: Math.hypot(ux, uy),
    sxx,
    syy,
    sxy,
    vonMises: Math.sqrt(sxx * sxx - sxx * syy + syy * syy + 3 * sxy * sxy),
  };
}

function buildFieldSamples(
  mesh: Mesh,
  displacements: number[],
  recoveries: Map<number, ElementRecovery>,
  transport: TransportOperators,
  constitutive: ConstitutiveData,
) {
  const samples: SolverFieldSample[] = [];

  for (const element of mesh.elements) {
    const recovery = recoveries.get(element.id);
    if (!recovery) {
      continue;
    }
    for (const xi of QUAD_GAUSS_POINTS) {
      for (const eta of QUAD_GAUSS_POINTS) {
        const point = mapQuadPoint(element, mesh.nodes, xi, eta);
        const field = evaluateTKFieldAtPoint(recovery, displacements, transport, constitutive, point.x, point.y);
        samples.push({ x: point.x, y: point.y, ...field });
      }
    }
  }

  return samples;
}

function buildHoleBoundarySamplesTK(
  mesh: Mesh,
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius">,
  displacements: number[],
  recoveries: Map<number, ElementRecovery>,
  transport: TransportOperators,
  constitutive: ConstitutiveData,
) {
  const samples: SolverBoundarySample[] = [];
  if (params.domainType !== "circle_hole") {
    return samples;
  }

  for (const element of mesh.elements) {
    const recovery = recoveries.get(element.id);
    if (!recovery) {
      continue;
    }
    for (let edgeIndex = 0; edgeIndex < EDGE_NODE_INDICES.length; edgeIndex++) {
      if (classifyBoundaryEdge(element, mesh.nodes, edgeIndex, params) !== "hole") {
        continue;
      }
      for (const s of LINE_GAUSS_POINTS) {
        const edgeData = edgePointAndNormal(element, mesh.nodes, edgeIndex, s);
        const field = evaluateTKFieldAtPoint(recovery, displacements, transport, constitutive, edgeData.x, edgeData.y);
        const polar = toPolarStress(field, edgeData.x, edgeData.y);
        const tangent: Vec2 = [-edgeData.normal[1], edgeData.normal[0]];
        const tractionX = field.sxx * edgeData.normal[0] + field.sxy * edgeData.normal[1];
        const tractionY = field.sxy * edgeData.normal[0] + field.syy * edgeData.normal[1];
        samples.push({
          x: edgeData.x,
          y: edgeData.y,
          thetaDeg: polar.thetaDeg,
          sigmaRR: polar.sigmaRR,
          sigmaThetaTheta: polar.sigmaThetaTheta,
          sigmaRTheta: polar.sigmaRTheta,
          tractionNormal: tractionX * edgeData.normal[0] + tractionY * edgeData.normal[1],
          tractionTangential: tractionX * tangent[0] + tractionY * tangent[1],
        });
      }
    }
  }

  return samples.sort((left, right) => left.thetaDeg - right.thetaDeg);
}

function buildHoleBoundarySamplesStandard(
  mesh: Mesh,
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius">,
  displacements: number[],
  constitutive: ConstitutiveData,
) {
  const samples: SolverBoundarySample[] = [];
  if (params.domainType !== "circle_hole") {
    return samples;
  }

  for (const element of mesh.elements) {
    for (let edgeIndex = 0; edgeIndex < EDGE_NODE_INDICES.length; edgeIndex++) {
      if (classifyBoundaryEdge(element, mesh.nodes, edgeIndex, params) !== "hole") {
        continue;
      }
      for (const s of LINE_GAUSS_POINTS) {
        const [xi, eta] = edgeIndex === 0 ? [s, -1] : edgeIndex === 1 ? [1, s] : edgeIndex === 2 ? [-s, 1] : [-1, -s];
        const point = mapQuadPoint(element, mesh.nodes, xi, eta);
        const field = evaluateStandardFieldAtPoint(element, mesh.nodes, displacements, constitutive, xi, eta);
        const edgeData = edgePointAndNormal(element, mesh.nodes, edgeIndex, s);
        const polar = toPolarStress(field, point.x, point.y);
        const tangent: Vec2 = [-edgeData.normal[1], edgeData.normal[0]];
        const tractionX = field.sxx * edgeData.normal[0] + field.sxy * edgeData.normal[1];
        const tractionY = field.sxy * edgeData.normal[0] + field.syy * edgeData.normal[1];
        samples.push({
          x: point.x,
          y: point.y,
          thetaDeg: polar.thetaDeg,
          sigmaRR: polar.sigmaRR,
          sigmaThetaTheta: polar.sigmaThetaTheta,
          sigmaRTheta: polar.sigmaRTheta,
          tractionNormal: tractionX * edgeData.normal[0] + tractionY * edgeData.normal[1],
          tractionTangential: tractionX * tangent[0] + tractionY * tangent[1],
        });
      }
    }
  }

  return samples.sort((left, right) => left.thetaDeg - right.thetaDeg);
}

function computeStressErrorNormTK(
  mesh: Mesh,
  params: Pick<SolverParams, "holeRadius" | "loadMag">,
  displacements: number[],
  recoveries: Map<number, ElementRecovery>,
  transport: TransportOperators,
  constitutive: ConstitutiveData,
) {
  let numerator = 0;
  let denominator = 0;

  for (const element of mesh.elements) {
    const recovery = recoveries.get(element.id);
    if (!recovery) {
      continue;
    }
    for (let i = 0; i < QUAD_GAUSS_POINTS.length; i++) {
      for (let j = 0; j < QUAD_GAUSS_POINTS.length; j++) {
        const xi = QUAD_GAUSS_POINTS[i];
        const eta = QUAD_GAUSS_POINTS[j];
        const point = mapQuadPoint(element, mesh.nodes, xi, eta);
        const field = evaluateTKFieldAtPoint(recovery, displacements, transport, constitutive, point.x, point.y);
        const exact = kirschStress(point.x, point.y, params.holeRadius, params.loadMag);
        const jacobian = quadJacobian(element, mesh.nodes, xi, eta);
        const weight = QUAD_GAUSS_WEIGHTS[i] * QUAD_GAUSS_WEIGHTS[j] * Math.abs(jacobian.determinant);
        numerator += ((field.sxx - exact.sxx) ** 2 + (field.syy - exact.syy) ** 2 + (field.sxy - exact.sxy) ** 2) * weight;
        denominator += (exact.sxx ** 2 + exact.syy ** 2 + exact.sxy ** 2) * weight;
      }
    }
  }

  return denominator > 0 ? Math.sqrt(numerator / denominator) * 100 : 0;
}

function computeStressErrorNormStandard(
  mesh: Mesh,
  params: Pick<SolverParams, "holeRadius" | "loadMag">,
  displacements: number[],
  constitutive: ConstitutiveData,
) {
  let numerator = 0;
  let denominator = 0;

  for (const element of mesh.elements) {
    for (let i = 0; i < QUAD_GAUSS_POINTS.length; i++) {
      for (let j = 0; j < QUAD_GAUSS_POINTS.length; j++) {
        const xi = QUAD_GAUSS_POINTS[i];
        const eta = QUAD_GAUSS_POINTS[j];
        const point = mapQuadPoint(element, mesh.nodes, xi, eta);
        const field = evaluateStandardFieldAtPoint(element, mesh.nodes, displacements, constitutive, xi, eta);
        const exact = kirschStress(point.x, point.y, params.holeRadius, params.loadMag);
        const jacobian = quadJacobian(element, mesh.nodes, xi, eta);
        const weight = QUAD_GAUSS_WEIGHTS[i] * QUAD_GAUSS_WEIGHTS[j] * Math.abs(jacobian.determinant);
        numerator += ((field.sxx - exact.sxx) ** 2 + (field.syy - exact.syy) ** 2 + (field.sxy - exact.sxy) ** 2) * weight;
        denominator += (exact.sxx ** 2 + exact.syy ** 2 + exact.sxy ** 2) * weight;
      }
    }
  }

  return denominator > 0 ? Math.sqrt(numerator / denominator) * 100 : 0;
}

function solveTKCase(
  mesh: Mesh,
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius" | "loadType" | "loadMag">,
  transport: TransportOperators,
  constitutive: ConstitutiveData,
  includeFieldSamples: boolean,
): TKSolveArtifacts {
  const { K, F, recoveries } = assembleTKSystem(mesh, params, transport, constitutive);
  applyBoundaryConditions(K, F, mesh.nodes);
  const displacements = solveLinearSystem(K, F);

  const nodes = mesh.nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    ux: displacements[node.id * 2] ?? 0,
    uy: displacements[node.id * 2 + 1] ?? 0,
    uMagnitude: Math.hypot(displacements[node.id * 2] ?? 0, displacements[node.id * 2 + 1] ?? 0),
  }));

  const stresses = mesh.elements.map((element) => {
    const recovery = recoveries.get(element.id)!;
    const field = evaluateTKFieldAtPoint(recovery, displacements, transport, constitutive, element.center[0], element.center[1]);
    return { elementId: element.id, cx: element.center[0], cy: element.center[1], sxx: field.sxx, syy: field.syy, sxy: field.sxy, vonMises: field.vonMises };
  });

  const fieldSamples = includeFieldSamples ? buildFieldSamples(mesh, displacements, recoveries, transport, constitutive) : [];
  const holeBoundarySamples = buildHoleBoundarySamplesTK(mesh, params, displacements, recoveries, transport, constitutive);
  const kirschSCF = params.domainType === "circle_hole" && params.loadMag > 0
    ? Math.max(...holeBoundarySamples.map((sample) => sample.sigmaThetaTheta / params.loadMag), 0)
    : undefined;
  const kirschError = typeof kirschSCF === "number" ? Math.abs(kirschSCF - 3) / 3 * 100 : undefined;

  return {
    mesh,
    displacements,
    nodes,
    stresses,
    fieldSamples,
    holeBoundarySamples,
    elementRecoveries: recoveries,
    maxDisp: Math.max(...nodes.map((node) => node.uMagnitude), ...fieldSamples.map((sample) => sample.uMagnitude), 0),
    maxVonMises: Math.max(...stresses.map((stress) => stress.vonMises), ...fieldSamples.map((sample) => sample.vonMises), 0),
    kirschSCF,
    kirschError,
  };
}

function solveStandardCase(
  mesh: Mesh,
  params: Pick<SolverParams, "domainType" | "W" | "H" | "holeRadius" | "loadType" | "loadMag">,
  constitutive: ConstitutiveData,
) {
  const { K, F } = assembleStandardSystem(mesh, params, constitutive);
  applyBoundaryConditions(K, F, mesh.nodes);
  const displacements = solveLinearSystem(K, F);
  const holeBoundarySamples = buildHoleBoundarySamplesStandard(mesh, params, displacements, constitutive);
  const kirschSCF = params.domainType === "circle_hole" && params.loadMag > 0
    ? Math.max(...holeBoundarySamples.map((sample) => sample.sigmaThetaTheta / params.loadMag), 0)
    : undefined;
  return { displacements, kirschSCF };
}

function benchmarkLevels(nx: number, ny: number) {
  const aspect = ny / Math.max(nx, 1);
  const levels = [4, 8, 12, 16, nx];
  const pairs = new Map<string, { nx: number; ny: number }>();
  for (const base of levels) {
    const mappedNx = Math.max(2, Math.min(20, base));
    const mappedNy = Math.max(2, Math.min(20, Math.round(mappedNx * aspect)));
    pairs.set(`${mappedNx}:${mappedNy}`, { nx: mappedNx, ny: mappedNy });
  }
  pairs.set(`${nx}:${ny}`, { nx, ny });
  return Array.from(pairs.values()).sort((left, right) => left.nx * left.ny - right.nx * right.ny);
}

export async function runTKFEM(params: SolverParams): Promise<SolverResults> {
  const startedAt = Date.now();
  const {
    W,
    H,
    holeRadius,
    nx,
    ny,
    E,
    nu,
    planeType,
    loadType,
    loadMag,
    magnusTrunc,
    magnusMode,
    boundaryQuadratureOrder,
  } = params;

  if (params.domainType === "circle_hole") {
    if (holeRadius <= 0) {
      throw new Error("Hole radius must be greater than zero for the Kirsch benchmark.");
    }
    if (holeRadius >= Math.min(W, H)) {
      throw new Error("Hole radius must be smaller than the plate dimensions.");
    }
  }

  const transport = buildTransportOperators(E, nu, planeType);
  const constitutive = constitutiveMatrix(E, nu, planeType);
  const magnusAnalysis = await analyzeMagnusConvergence({
    Ax: transport.Ax,
    Ay: transport.Ay,
    n: transport.n,
    hx: params.analysisMode === "functionized" ? W : generateMesh({ domainType: params.domainType, W, H, holeRadius, nx, ny }).elements[0]?.characteristicSize ?? W,
    hy: params.analysisMode === "functionized" ? H : generateMesh({ domainType: params.domainType, W, H, holeRadius, nx, ny }).elements[0]?.characteristicSize ?? H,
    requestedMagnusOrder: magnusTrunc,
    mode: magnusMode,
  });

  if (params.analysisMode === "functionized") {
    const functionized = runFunctionizedSingleDomainSolve({
      domainType: params.domainType,
      W,
      H,
      holeRadius,
      nx,
      ny,
      E,
      nu,
      planeType,
      loadType,
      loadMag,
      boundaryQuadratureOrder,
    });

    return {
      analysisMode: "functionized",
      nodes: functionized.nodes,
      stresses: functionized.stresses,
      meshElements: functionized.meshElements,
      fieldSamples: functionized.fieldSamples,
      holeBoundarySamples: functionized.holeBoundarySamples,
      boundaryFrames: functionized.boundaryFrames,
      geometryOutline: functionized.geometryOutline,
      functionizedDiagnostics: functionized.functionizedDiagnostics,
      maxDisp: functionized.maxDisp,
      maxVonMises: functionized.maxVonMises,
      kirschSCF: functionized.kirschSCF,
      kirschError: functionized.kirschError,
      magnusOrder: magnusAnalysis.appliedMagnusOrder,
      nElements: functionized.nElements,
      nNodes: functionized.nNodes,
      nDOF: functionized.nDOF,
      convergenceData: functionized.convergenceData,
      stressConcentrationFactor: functionized.stressConcentrationFactor,
      magnusAnalysis,
      executionTimeMs: Date.now() - startedAt,
    };
  }

  const mesh = generateMesh({ domainType: params.domainType, W, H, holeRadius, nx, ny });
  const representativeElement = mesh.elements[0];
  if (!representativeElement) {
    throw new Error("Mesh generation produced no elements.");
  }

  const tk = solveTKCase(
    mesh,
    { domainType: params.domainType, W, H, holeRadius, loadType, loadMag },
    transport,
    constitutive,
    true,
  );

  const convergenceData: SolverConvergencePoint[] = [];
  if (params.domainType === "circle_hole") {
    for (const level of benchmarkLevels(nx, ny)) {
      const studyMesh = generateMesh({ domainType: params.domainType, W, H, holeRadius, nx: level.nx, ny: level.ny });
      const tkStudy = solveTKCase(
        studyMesh,
        { domainType: params.domainType, W, H, holeRadius, loadType, loadMag },
        transport,
        constitutive,
        false,
      );
      convergenceData.push({
        method: "TK-FEM",
        nElem: studyMesh.elements.length,
        scf: Number((tkStudy.kirschSCF ?? 0).toFixed(4)),
        error: Number(computeStressErrorNormTK(studyMesh, { holeRadius, loadMag }, tkStudy.displacements, tkStudy.elementRecoveries, transport, constitutive).toFixed(4)),
      });

      const standardStudy = solveStandardCase(
        studyMesh,
        { domainType: params.domainType, W, H, holeRadius, loadType, loadMag },
        constitutive,
      );
      convergenceData.push({
        method: "Standard FEM",
        nElem: studyMesh.elements.length,
        scf: Number((standardStudy.kirschSCF ?? 0).toFixed(4)),
        error: Number(computeStressErrorNormStandard(studyMesh, { holeRadius, loadMag }, standardStudy.displacements, constitutive).toFixed(4)),
      });
    }
  }

  return {
    analysisMode: "meshed",
    nodes: tk.nodes,
    stresses: tk.stresses,
    meshElements: tk.mesh.elements.map((element) => ({ id: element.id, nodeIds: [...element.nodeIds] })),
    fieldSamples: tk.fieldSamples,
    holeBoundarySamples: tk.holeBoundarySamples,
    boundaryFrames: [],
    geometryOutline: [],
    functionizedDiagnostics: null,
    maxDisp: tk.maxDisp,
    maxVonMises: tk.maxVonMises,
    kirschSCF: tk.kirschSCF,
    kirschError: tk.kirschError,
    magnusOrder: magnusAnalysis.appliedMagnusOrder,
    nElements: tk.mesh.elements.length,
    nNodes: tk.mesh.nodes.length,
    nDOF: tk.mesh.nodes.length * 2,
    convergenceData,
    stressConcentrationFactor: tk.kirschSCF ?? 0,
    magnusAnalysis,
    executionTimeMs: Date.now() - startedAt,
  };
}
