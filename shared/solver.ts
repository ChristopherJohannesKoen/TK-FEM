export interface SolverNodeResult {
  id: number;
  x: number;
  y: number;
  ux: number;
  uy: number;
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

export interface SolverConvergencePoint {
  method: string;
  nElem: number;
  scf: number;
  error: number;
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
}

export interface SolverResults {
  nodes: SolverNodeResult[];
  stresses: SolverStressResult[];
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
  executionTimeMs: number;
}

export type StressField = "vonMises" | "sxx" | "syy" | "sxy";
