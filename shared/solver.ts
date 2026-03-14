export type MagnusMode = "auto" | "manual";
export type MagnusAnalysisBackend = "sympy" | "numeric" | "manual";
export type MagnusStrategy = "finite_closure" | "truncated_magnus" | "manual_truncation";

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
}

export interface SolverResults {
  nodes: SolverNodeResult[];
  stresses: SolverStressResult[];
  meshElements: SolverMeshElement[];
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
