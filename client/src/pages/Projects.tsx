import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { Plus, Trash2, FlaskConical, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Project, Analysis } from "@shared/schema";

type CreateProjectPayload = Pick<Project, "name" | "description">;

export default function Projects() {
  const { toast } = useToast();
  const [showNew, setShowNew] = useState(false);

  const { data: projects = [], isLoading } = useQuery<Project[]>({ queryKey: ["/api/projects"] });
  const { data: analyses = [] } = useQuery<Analysis[]>({ queryKey: ["/api/analyses"] });

  const form = useForm<CreateProjectPayload>({
    defaultValues: { name: "", description: "" },
  });

  const createProject = useMutation({
    mutationFn: (data: CreateProjectPayload) => apiRequest("POST", "/api/projects", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowNew(false);
      form.reset();
      toast({ title: "Project created" });
    },
    onError: () => toast({ title: "Error creating project", variant: "destructive" }),
  });

  const deleteProject = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
      toast({ title: "Project deleted" });
    },
  });

  const getAnalysisCount = (projectId: number) =>
    analyses.filter(a => a.projectId === projectId).length;

  const getStatusCounts = (projectId: number) => {
    const pAnalyses = analyses.filter(a => a.projectId === projectId);
    return {
      complete: pAnalyses.filter(a => a.status === "complete").length,
      pending: pAnalyses.filter(a => a.status !== "complete").length,
    };
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">Organize your TK-FEM analyses</p>
        </div>
        <Button onClick={() => setShowNew(true)} data-testid="button-new-project">
          <Plus size={14} className="mr-2" />
          New Project
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-24 rounded-lg bg-card animate-pulse border border-border" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
          <FolderOpen size={32} className="mx-auto mb-3 opacity-30" />
          <div className="font-medium">No projects yet</div>
          <div className="text-sm mt-1">Create a project to start organizing your analyses</div>
          <Button onClick={() => setShowNew(true)} className="mt-4" variant="outline" size="sm">
            Create first project
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map(project => {
            const { complete, pending } = getStatusCounts(project.id);
            const total = getAnalysisCount(project.id);
            return (
              <Card key={project.id} className="border-border bg-card hover:border-primary/40 transition-colors">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{project.name}</div>
                      {project.description && (
                        <div className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{project.description}</div>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-xs text-muted-foreground font-mono">{total} analyses</span>
                        {complete > 0 && <Badge variant="outline" className="text-xs text-green-400 border-green-400/30">{complete} solved</Badge>}
                        {pending > 0 && <Badge variant="outline" className="text-xs">{pending} pending</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/new-analysis?projectId=${project.id}`}>
                        <Button variant="outline" size="sm" data-testid={`button-add-analysis-${project.id}`}>
                          <FlaskConical size={13} className="mr-1.5" />
                          Add Analysis
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteProject.mutate(project.id)}
                        className="text-muted-foreground hover:text-destructive"
                        data-testid={`button-delete-project-${project.id}`}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Project Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(data => createProject.mutate(data))} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Kirsch Plate Analysis" {...field} data-testid="input-project-name" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Optional description..." {...field} data-testid="input-project-description" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
                <Button type="submit" disabled={createProject.isPending} data-testid="button-submit-project">
                  {createProject.isPending ? "Creating..." : "Create Project"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
