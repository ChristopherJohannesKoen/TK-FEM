import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertProjectSchema, insertAnalysisSchema, insertBookmarkSchema } from "@shared/schema";
import { runTKFEM } from "./tkfem-solver";
import type { SolverParams } from "@shared/solver";
import { z } from "zod";

function parsePositiveInt(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export function registerRoutes(httpServer: Server, app: Express) {

  // ── Projects ──────────────────────────────────────────────────────────────
  app.get("/api/projects", async (req, res) => {
    const projects = await storage.getProjects();
    res.json(projects);
  });

  app.get("/api/projects/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project id" });
    const project = await storage.getProject(id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  });

  app.post("/api/projects", async (req, res) => {
    const parsed = insertProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const project = await storage.createProject(parsed.data);
    res.status(201).json(project);
  });

  app.put("/api/projects/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project id" });
    const parsed = insertProjectSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const project = await storage.updateProject(id, parsed.data);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  });

  app.delete("/api/projects/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project id" });
    await storage.deleteProject(id);
    res.status(204).end();
  });

  // ── Analyses ──────────────────────────────────────────────────────────────
  app.get("/api/analyses", async (req, res) => {
    const analyses = await storage.getAllAnalyses();
    res.json(analyses);
  });

  app.get("/api/projects/:projectId/analyses", async (req, res) => {
    const projectId = parsePositiveInt(req.params.projectId);
    if (!projectId) return res.status(400).json({ message: "Invalid project id" });
    const analyses = await storage.getAnalyses(projectId);
    res.json(analyses);
  });

  app.get("/api/analyses/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid analysis id" });
    const analysis = await storage.getAnalysis(id);
    if (!analysis) return res.status(404).json({ message: "Analysis not found" });
    res.json(analysis);
  });

  app.post("/api/analyses", async (req, res) => {
    const parsed = insertAnalysisSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const analysis = await storage.createAnalysis(parsed.data);
    res.status(201).json(analysis);
  });

  app.put("/api/analyses/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid analysis id" });
    const analysis = await storage.getAnalysis(id);
    if (!analysis) return res.status(404).json({ message: "Analysis not found" });
    const updated = await storage.updateAnalysis(id, req.body);
    res.json(updated);
  });

  app.delete("/api/analyses/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid analysis id" });
    await storage.deleteAnalysis(id);
    res.status(204).end();
  });

  // ── Solver endpoint ───────────────────────────────────────────────────────
  app.post("/api/analyses/:id/run", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid analysis id" });
    const analysis = await storage.getAnalysis(id);
    if (!analysis) return res.status(404).json({ message: "Analysis not found" });

    // Mark as running
    await storage.updateAnalysis(id, { status: "running" });

    try {
      const params: SolverParams = {
        domainType: analysis.domainType as "rectangle" | "circle_hole",
        W: analysis.domainWidth,
        H: analysis.domainHeight,
        holeRadius: analysis.holeRadius,
        nx: analysis.meshNx,
        ny: analysis.meshNy,
        E: analysis.youngModulus,
        nu: analysis.poissonRatio,
        planeType: analysis.planeType as "plane_stress" | "plane_strain",
        loadType: analysis.loadType,
        loadMag: analysis.loadMagnitude,
        magnusTrunc: analysis.magnusTruncation,
      };
      const results = await runTKFEM(params);

      const updated = await storage.updateAnalysis(id, {
        status: "complete",
        results,
        errorMessage: null,
      });
      res.json(updated);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      await storage.updateAnalysis(id, { status: "error", errorMessage: message });
      res.status(500).json({ message: `Solver error: ${message}` });
    }
  });

  // ── Quick solve (no persistence) ─────────────────────────────────────────
  const quickSolveSchema = z.object({
    domainType: z.enum(["rectangle", "circle_hole"]).default("circle_hole"),
    W: z.number().min(1).max(1000).default(10),
    H: z.number().min(1).max(1000).default(10),
    holeRadius: z.number().min(0).max(50).default(1),
    nx: z.number().int().min(1).max(20).default(4),
    ny: z.number().int().min(1).max(20).default(4),
    E: z.number().min(1).default(200000),
    nu: z.number().min(0).max(0.499).default(0.3),
    planeType: z.enum(["plane_stress", "plane_strain"]).default("plane_stress"),
    loadType: z.string().default("uniform_tension"),
    loadMag: z.number().default(100),
    magnusTrunc: z.number().int().min(1).max(5).default(3),
  });

  app.post("/api/solve", async (req, res) => {
    const parsed = quickSolveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    try {
      const results = await runTKFEM(parsed.data);
      res.json(results);
    } catch (error: unknown) {
      res.status(500).json({ message: `Solver error: ${getErrorMessage(error)}` });
    }
  });

  // ── Kirsch analytical endpoint ───────────────────────────────────────────
  app.get("/api/kirsch", async (req, res) => {
    const a = parseFloat(req.query.a as string) || 1;
    const sigma = parseFloat(req.query.sigma as string) || 100;
    const nPoints = parseInt(req.query.n as string) || 50;

    const { kirschStress } = await import("./tkfem-solver");
    const results = [];
    // Sample along θ from 0 to π at r = a (hole boundary)
    for (let i = 0; i <= nPoints; i++) {
      const theta = (i / nPoints) * Math.PI;
      const x = a * Math.cos(theta);
      const y = a * Math.sin(theta);
      const s = kirschStress(x + 1e-9, y + 1e-9, a, sigma);
      results.push({ theta: theta * 180 / Math.PI, x, y, ...s });
    }
    res.json(results);
  });

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  app.get("/api/analyses/:analysisId/bookmarks", async (req, res) => {
    const analysisId = parsePositiveInt(req.params.analysisId);
    if (!analysisId) return res.status(400).json({ message: "Invalid analysis id" });
    const bookmarks = await storage.getBookmarks(analysisId);
    res.json(bookmarks);
  });

  app.post("/api/analyses/:analysisId/bookmarks", async (req, res) => {
    const analysisId = parsePositiveInt(req.params.analysisId);
    if (!analysisId) return res.status(400).json({ message: "Invalid analysis id" });
    const parsed = insertBookmarkSchema.safeParse({ ...req.body, analysisId });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const bookmark = await storage.createBookmark(parsed.data);
    res.status(201).json(bookmark);
  });

  app.delete("/api/bookmarks/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid bookmark id" });
    await storage.deleteBookmark(id);
    res.status(204).end();
  });
}
