import { type Project, type InsertProject, type Analysis, type InsertAnalysis, type Bookmark, type InsertBookmark } from "@shared/schema";

export interface IStorage {
  // Projects
  getProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(data: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  // Analyses
  getAnalyses(projectId: number): Promise<Analysis[]>;
  getAllAnalyses(): Promise<Analysis[]>;
  getAnalysis(id: number): Promise<Analysis | undefined>;
  createAnalysis(data: InsertAnalysis): Promise<Analysis>;
  updateAnalysis(id: number, data: Partial<Analysis>): Promise<Analysis | undefined>;
  deleteAnalysis(id: number): Promise<void>;

  // Bookmarks
  getBookmarks(analysisId: number): Promise<Bookmark[]>;
  createBookmark(data: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(id: number): Promise<void>;
}

export class MemStorage implements IStorage {
  private projectsMap: Map<number, Project> = new Map();
  private analysesMap: Map<number, Analysis> = new Map();
  private bookmarksMap: Map<number, Bookmark> = new Map();
  private projectCounter = 1;
  private analysisCounter = 1;
  private bookmarkCounter = 1;

  constructor() {
    // Seed with a demo project
    const demoProject: Project = {
      id: 1,
      name: "Kirsch Plate Demo",
      description: "Classic plate with circular hole under uniaxial tension — Kirsch benchmark (SCF = 3.0)",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.projectsMap.set(1, demoProject);
    this.projectCounter = 2;

    const demoAnalysis: Analysis = {
      id: 1,
      projectId: 1,
      name: "2×2 Mesh — Magnus m=3",
      analysisMode: "meshed",
      domainType: "circle_hole",
      domainWidth: 10.0,
      domainHeight: 10.0,
      holeRadius: 1.0,
      meshNx: 4,
      meshNy: 4,
      youngModulus: 200000.0,
      poissonRatio: 0.3,
      planeType: "plane_stress",
      loadType: "uniform_tension",
      loadMagnitude: 100.0,
      magnusMode: "auto",
      magnusTruncation: 3,
      boundaryQuadratureOrder: 8,
      status: "pending",
      results: null,
      errorMessage: null,
      createdAt: new Date(),
    };
    this.analysesMap.set(1, demoAnalysis);
    this.analysisCounter = 2;
  }

  async getProjects(): Promise<Project[]> {
    return Array.from(this.projectsMap.values()).sort((a, b) => b.id - a.id);
  }
  async getProject(id: number): Promise<Project | undefined> {
    return this.projectsMap.get(id);
  }
  async createProject(data: InsertProject): Promise<Project> {
    const p: Project = {
      id: this.projectCounter++,
      name: data.name,
      description: data.description ?? "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.projectsMap.set(p.id, p);
    return p;
  }
  async updateProject(id: number, data: Partial<InsertProject>): Promise<Project | undefined> {
    const p = this.projectsMap.get(id);
    if (!p) return undefined;
    const updated: Project = { ...p, ...data, description: data.description ?? p.description, updatedAt: new Date() };
    this.projectsMap.set(id, updated);
    return updated;
  }
  async deleteProject(id: number): Promise<void> {
    this.projectsMap.delete(id);
    for (const [aId, a] of Array.from(this.analysesMap.entries())) {
      if (a.projectId === id) this.analysesMap.delete(aId);
    }
  }

  async getAnalyses(projectId: number): Promise<Analysis[]> {
    return Array.from(this.analysesMap.values()).filter(a => a.projectId === projectId).sort((a, b) => b.id - a.id);
  }
  async getAllAnalyses(): Promise<Analysis[]> {
    return Array.from(this.analysesMap.values()).sort((a, b) => b.id - a.id);
  }
  async getAnalysis(id: number): Promise<Analysis | undefined> {
    return this.analysesMap.get(id);
  }
  async createAnalysis(data: InsertAnalysis): Promise<Analysis> {
    const a: Analysis = {
      id: this.analysisCounter++,
      projectId: data.projectId,
      name: data.name,
      analysisMode: data.analysisMode ?? "meshed",
      domainType: data.domainType ?? "rectangle",
      domainWidth: data.domainWidth ?? 10.0,
      domainHeight: data.domainHeight ?? 10.0,
      holeRadius: data.holeRadius ?? 1.0,
      meshNx: data.meshNx ?? 4,
      meshNy: data.meshNy ?? 4,
      youngModulus: data.youngModulus ?? 200000.0,
      poissonRatio: data.poissonRatio ?? 0.3,
      planeType: data.planeType ?? "plane_stress",
      loadType: data.loadType ?? "uniform_tension",
      loadMagnitude: data.loadMagnitude ?? 100.0,
      magnusMode: data.magnusMode ?? "auto",
      magnusTruncation: data.magnusTruncation ?? 3,
      boundaryQuadratureOrder: data.boundaryQuadratureOrder ?? 8,
      status: "pending",
      results: null,
      errorMessage: null,
      createdAt: new Date(),
    };
    this.analysesMap.set(a.id, a);
    return a;
  }
  async updateAnalysis(id: number, data: Partial<Analysis>): Promise<Analysis | undefined> {
    const a = this.analysesMap.get(id);
    if (!a) return undefined;
    const updated = { ...a, ...data };
    this.analysesMap.set(id, updated);
    return updated;
  }
  async deleteAnalysis(id: number): Promise<void> {
    this.analysesMap.delete(id);
  }

  async getBookmarks(analysisId: number): Promise<Bookmark[]> {
    return Array.from(this.bookmarksMap.values()).filter(b => b.analysisId === analysisId);
  }
  async createBookmark(data: InsertBookmark): Promise<Bookmark> {
    const b: Bookmark = {
      id: this.bookmarkCounter++,
      analysisId: data.analysisId,
      label: data.label,
      viewState: data.viewState ?? null,
    };
    this.bookmarksMap.set(b.id, b);
    return b;
  }
  async deleteBookmark(id: number): Promise<void> {
    this.bookmarksMap.delete(id);
  }
}

export const storage = new MemStorage();
