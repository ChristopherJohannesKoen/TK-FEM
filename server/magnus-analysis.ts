import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  MagnusAnalysis,
  MagnusMode,
  MagnusSeriesLevel,
  MagnusStrategy,
} from "@shared/solver";

type Mat = number[];

interface RawMagnusAnalysis {
  backend: "sympy" | "numeric";
  finiteSeriesExact: boolean;
  closureOrder: number | null;
  convergenceGuaranteed: boolean;
  convergenceMetric: number;
  convergenceThreshold: number;
  notes: string[];
  lowerCentralSeries: MagnusSeriesLevel[];
}

interface AnalyzeMagnusInput {
  Ax: Mat;
  Ay: Mat;
  n: number;
  hx: number;
  hy: number;
  requestedMagnusOrder: number;
  mode: MagnusMode;
}

function matZero(n: number): Mat {
  return new Array(n * n).fill(0);
}

function matMul(A: Mat, B: Mat, n: number): Mat {
  const C = matZero(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = A[i * n + k];
      if (aik === 0) {
        continue;
      }

      for (let j = 0; j < n; j++) {
        C[i * n + j] += aik * B[k * n + j];
      }
    }
  }

  return C;
}

function matAdd(A: Mat, B: Mat): Mat {
  return A.map((value, index) => value + B[index]);
}

function matComm(A: Mat, B: Mat, n: number): Mat {
  const AB = matMul(A, B, n);
  const BA = matMul(B, A, n);
  return AB.map((value, index) => value - BA[index]);
}

function matrixNorm(A: Mat) {
  return Math.sqrt(A.reduce((sum, value) => sum + value * value, 0));
}

function matrixSignature(A: Mat, tolerance = 1e-12) {
  return A
    .map((value) => (Math.abs(value) < tolerance ? 0 : Number(value.toFixed(12))))
    .join(",");
}

function isZeroMatrix(A: Mat, tolerance = 1e-12) {
  return A.every((value) => Math.abs(value) < tolerance);
}

function getPythonScriptPath() {
  const candidates = [
    path.resolve(process.cwd(), "python", "magnus_analysis.py"),
    path.resolve(process.cwd(), "dist", "python", "magnus_analysis.py"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function runSymPyAnalysis({
  Ax,
  Ay,
  n,
  hx,
  hy,
}: Omit<AnalyzeMagnusInput, "requestedMagnusOrder" | "mode">): Promise<RawMagnusAnalysis> {
  const scriptPath = getPythonScriptPath();
  if (!scriptPath) {
    throw new Error("SymPy analysis script not found.");
  }

  return await new Promise<RawMagnusAnalysis>((resolve, reject) => {
    const child = spawn("python", [scriptPath], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `SymPy analysis exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as RawMagnusAnalysis);
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.write(
      JSON.stringify({
        Ax,
        Ay,
        n,
        hx,
        hy,
      }),
    );
    child.stdin.end();
  });
}

function runNumericAnalysis({
  Ax,
  Ay,
  n,
  hx,
  hy,
}: Omit<AnalyzeMagnusInput, "requestedMagnusOrder" | "mode">): RawMagnusAnalysis {
  const tolerance = 1e-10;
  const baseBasis: Mat[] = [];
  const baseSeen = new Set<string>();

  for (const matrix of [Ax, Ay]) {
    if (isZeroMatrix(matrix, tolerance)) {
      continue;
    }

    const signature = matrixSignature(matrix);
    if (baseSeen.has(signature)) {
      continue;
    }

    baseSeen.add(signature);
    baseBasis.push(matrix);
  }

  const lowerCentralSeries: MagnusSeriesLevel[] = [
    {
      level: 1,
      matrixCount: baseBasis.length,
      maxNorm: Math.max(...baseBasis.map(matrixNorm), 0),
    },
  ];

  let closureOrder: number | null = null;
  let currentBasis = baseBasis;

  for (let level = 1; level <= 6; level++) {
    const nextBasis: Mat[] = [];
    const nextSeen = new Set<string>();

    for (const A of currentBasis) {
      for (const B of baseBasis) {
        const commutator = matComm(A, B, n);
        if (isZeroMatrix(commutator, tolerance)) {
          continue;
        }

        const signature = matrixSignature(commutator);
        if (nextSeen.has(signature)) {
          continue;
        }

        nextSeen.add(signature);
        nextBasis.push(commutator);
      }
    }

    lowerCentralSeries.push({
      level: level + 1,
      matrixCount: nextBasis.length,
      maxNorm: Math.max(...nextBasis.map(matrixNorm), 0),
    });

    if (!nextBasis.length) {
      closureOrder = level;
      break;
    }

    currentBasis = nextBasis;
  }

  const generatorNorms = [
    hx * matrixNorm(Ax),
    hy * matrixNorm(Ay),
    Math.hypot(hx, hy) * matrixNorm(matAdd(Ax, Ay)),
  ];
  const convergenceMetric = Math.max(...generatorNorms);

  return {
    backend: "numeric",
    finiteSeriesExact: closureOrder !== null,
    closureOrder,
    convergenceGuaranteed: convergenceMetric < Math.PI,
    convergenceMetric,
    convergenceThreshold: Math.PI,
    notes: [
      "Numeric fallback was used for Magnus closure analysis.",
    ],
    lowerCentralSeries,
  };
}

function buildSummary(
  mode: MagnusMode,
  strategy: MagnusStrategy,
  appliedMagnusOrder: number,
  rawAnalysis: RawMagnusAnalysis,
) {
  if (rawAnalysis.finiteSeriesExact && rawAnalysis.closureOrder !== null) {
    if (mode === "auto") {
      return `Finite Lie-algebra closure detected at class m=${rawAnalysis.closureOrder}; exact finite Magnus series applied.`;
    }

    return `Finite Lie-algebra closure detected at class m=${rawAnalysis.closureOrder}; manual mode kept m=${appliedMagnusOrder}.`;
  }

  if (strategy === "truncated_magnus") {
    return `Finite closure was not detected; truncated Magnus expansion applied with m=${appliedMagnusOrder}.`;
  }

  return `Manual truncation applied with m=${appliedMagnusOrder}; no automatic Magnus-order adjustment was performed.`;
}

export async function analyzeMagnusConvergence(input: AnalyzeMagnusInput): Promise<MagnusAnalysis> {
  let rawAnalysis: RawMagnusAnalysis;

  try {
    rawAnalysis = await runSymPyAnalysis(input);
  } catch (error) {
    rawAnalysis = runNumericAnalysis(input);
    rawAnalysis.notes.unshift(
      `SymPy analysis was unavailable at runtime: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const recommendedMagnusOrder =
    rawAnalysis.finiteSeriesExact && rawAnalysis.closureOrder !== null
      ? rawAnalysis.closureOrder
      : rawAnalysis.convergenceGuaranteed
        ? Math.max(input.requestedMagnusOrder, 3)
        : 5;

  let appliedMagnusOrder = input.requestedMagnusOrder;
  let strategy: MagnusStrategy = input.mode === "auto" ? "truncated_magnus" : "manual_truncation";
  const notes = [...rawAnalysis.notes];

  if (rawAnalysis.finiteSeriesExact && rawAnalysis.closureOrder !== null) {
    if (input.mode === "auto") {
      appliedMagnusOrder = rawAnalysis.closureOrder;
      strategy = "finite_closure";
      notes.unshift(`Automatic mode reduced the effective Magnus order to the exact closure class m=${rawAnalysis.closureOrder}.`);
    } else {
      notes.unshift(`Finite closure exists at m=${rawAnalysis.closureOrder}, but manual mode preserved the requested order m=${input.requestedMagnusOrder}.`);
    }
  } else if (input.mode === "auto") {
    appliedMagnusOrder = recommendedMagnusOrder;
    notes.unshift(`Automatic mode selected m=${recommendedMagnusOrder} because finite closure was not detected.`);
    if (!rawAnalysis.convergenceGuaranteed) {
      notes.push("The sufficient norm-based Magnus convergence criterion was not satisfied; the selected truncation remains heuristic.");
    }
  } else {
    if (!rawAnalysis.convergenceGuaranteed) {
      notes.push("The sufficient norm-based Magnus convergence criterion was not satisfied; manual truncation remains heuristic.");
    }
  }

  return {
    mode: input.mode,
    backend: rawAnalysis.backend,
    finiteSeriesExact: rawAnalysis.finiteSeriesExact,
    truncationRequired: !rawAnalysis.finiteSeriesExact,
    closureOrder: rawAnalysis.closureOrder,
    requestedMagnusOrder: input.requestedMagnusOrder,
    recommendedMagnusOrder,
    appliedMagnusOrder,
    convergenceGuaranteed: rawAnalysis.convergenceGuaranteed,
    convergenceMetric: Number(rawAnalysis.convergenceMetric.toFixed(6)),
    convergenceThreshold: Number(rawAnalysis.convergenceThreshold.toFixed(6)),
    strategy,
    summary: buildSummary(input.mode, strategy, appliedMagnusOrder, rawAnalysis),
    notes,
    lowerCentralSeries: rawAnalysis.lowerCentralSeries.map((level) => ({
      ...level,
      maxNorm: Number(level.maxNorm.toFixed(6)),
    })),
  };
}
