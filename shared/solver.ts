export type MagnusMode = "auto" | "manual";
export type MagnusAnalysisBackend = "sympy" | "numeric" | "manual";
export type MagnusStrategy = "finite_closure" | "truncated_magnus" | "manual_truncation";
export type AnalysisMode = "meshed" | "functionized";

export interface SolverNodeResult {
  id: number;
  x: number;
  y: number;
  ux: number;
  uy: number;
  uMagnitude: number;
}

export interface SolverStressResult {
  elementId: number;
  cx: number;
  cy: number;
  sxx: number;
  syy: number;
  sxy: number;
  vonMises: number;
}

export interface SolverMeshElement {
  id: number;
  nodeIds: number[];
}

export interface SolverFieldSample {
  x: number;
  y: number;
  ux: number;
  uy: number;
  uMagnitude: number;
  sxx: number;
  syy: number;
  sxy: number;
  vonMises: number;
}

export interface SolverBoundarySample {
  x: number;
  y: number;
  thetaDeg: number;
  sigmaRR: number;
  sigmaThetaTheta: number;
  sigmaRTheta: number;
  tractionNormal: number;
  tractionTangential: number;
}

export interface SolverBoundaryFrameResult {
  id: number;
  x: number;
  y: number;
  ux: number;
  uy: number;
  uMagnitude: number;
  tractionX: number;
  tractionY: number;
  tractionNormal: number;
  tractionTangential: number;
  boundaryType: string;
  curveLabel: string;
  arcLength: number;
  normalizedArcLength: number;
}

export interface SolverGeometryPoint {
  x: number;
  y: number;
  ux: number;
  uy: number;
  boundaryType: string;
  curveLabel: string;
  arcLength: number;
  normalizedArcLength: number;
}

export interface SolverConvergencePoint {
  method: string;
  nElem: number;
  scf: number;
  error: number;
}

export interface MagnusSeriesLevel {
  level: number;
  matrixCount: number;
  maxNorm: number;
}

export interface MagnusAnalysis {
  mode: MagnusMode;
  backend: MagnusAnalysisBackend;
  finiteSeriesExact: boolean;
  truncationRequired: boolean;
  closureOrder: number | null;
  requestedMagnusOrder: number;
  recommendedMagnusOrder: number;
  appliedMagnusOrder: number;
  convergenceGuaranteed: boolean;
  convergenceMetric: number;
  convergenceThreshold: number;
  strategy: MagnusStrategy;
  summary: string;
  notes: string[];
  lowerCentralSeries: MagnusSeriesLevel[];
}

export interface SolverParams {
  analysisMode: AnalysisMode;
  domainType: "rectangle" | "circle_hole";
  W: number;
  H: number;
  holeRadius: number;
  nx: number;
  ny: number;
  E: number;
  nu: number;
  planeType: "plane_stress" | "plane_strain";
  loadType: string;
  loadMag: number;
  magnusTrunc: number;
  magnusMode: MagnusMode;
  boundaryQuadratureOrder: number;
}

export interface FunctionizedDiagnostics {
  boundaryFrameCount: number;
  sourcePointCount: number;
  boundaryQuadratureOrder: number;
  sourceOffset: number;
  maxBoundaryResidual: number;
  rmsBoundaryResidual: number;
}

export interface SolverResults {
  analysisMode: AnalysisMode;
  nodes: SolverNodeResult[];
  stresses: SolverStressResult[];
  meshElements: SolverMeshElement[];
  fieldSamples: SolverFieldSample[];
  holeBoundarySamples: SolverBoundarySample[];
  boundaryFrames: SolverBoundaryFrameResult[];
  geometryOutline: SolverGeometryPoint[];
  functionizedDiagnostics: FunctionizedDiagnostics | null;
  maxDisp: number;
  maxVonMises: number;
  kirschSCF?: number;
  kirschError?: number;
  magnusOrder: number;
  nElements: number;
  nNodes: number;
  nDOF: number;
  convergenceData: SolverConvergencePoint[];
  stressConcentrationFactor: number;
  magnusAnalysis: MagnusAnalysis;
  executionTimeMs: number;
}

export type StressField = "vonMises" | "sxx" | "syy" | "sxy";
export type DeflectionField = "uMagnitude" | "ux" | "uy";
