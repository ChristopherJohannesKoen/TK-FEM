import { pgTable, text, serial, integer, real, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Project table — stores a named TK-FEM analysis project
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// Analysis table — stores a complete TK-FEM analysis run
export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  analysisMode: text("analysis_mode").notNull().default("meshed"), // meshed | functionized
  // Geometry parameters
  domainType: text("domain_type").notNull().default("rectangle"), // rectangle | circle_hole
  domainWidth: real("domain_width").notNull().default(10.0),
  domainHeight: real("domain_height").notNull().default(10.0),
  holeRadius: real("hole_radius").notNull().default(1.0),
  // Mesh parameters
  meshNx: integer("mesh_nx").notNull().default(4),
  meshNy: integer("mesh_ny").notNull().default(4),
  // Material parameters
  youngModulus: real("young_modulus").notNull().default(200000.0),
  poissonRatio: real("poisson_ratio").notNull().default(0.3),
  planeType: text("plane_type").notNull().default("plane_stress"), // plane_stress | plane_strain
  // Loading
  loadType: text("load_type").notNull().default("uniform_tension"), // uniform_tension | point_load | shear
  loadMagnitude: real("load_magnitude").notNull().default(100.0),
  // TK-FEM specific
  magnusMode: text("magnus_mode").notNull().default("auto"), // auto | manual
  magnusTruncation: integer("magnus_truncation").notNull().default(3),
  boundaryQuadratureOrder: integer("boundary_quadrature_order").notNull().default(8),
  // Solver status and results (JSON)
  status: text("status").notNull().default("pending"), // pending | running | complete | error
  results: jsonb("results"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAnalysisSchema = createInsertSchema(analyses).omit({ id: true, createdAt: true, results: true, status: true, errorMessage: true });
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analyses.$inferSelect;

// Saved results viewer bookmarks
export const bookmarks = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id").notNull(),
  label: text("label").notNull(),
  viewState: jsonb("view_state"),
});

export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({ id: true });
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;
