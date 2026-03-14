import { Router, Switch, Route, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";

// Pages
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import NewAnalysis from "@/pages/NewAnalysis";
import Solver from "@/pages/Solver";
import Results from "@/pages/Results";
import Theory from "@/pages/Theory";
import NotFound from "@/pages/not-found";

// Icons (lucide-react)
import {
  LayoutDashboard,
  FolderOpen,
  Cpu,
  BarChart3,
  BookOpen,
  FlaskConical,
  Sun,
  Moon,
  Menu,
  X,
} from "lucide-react";
import { useState, useEffect } from "react";

function TKFEMLogo() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-label="TK-FEM"
      className="w-8 h-8 shrink-0"
    >
      {/* Grid/mesh background */}
      <rect x="2" y="2" width="44" height="44" rx="6" fill="hsl(222,47%,13%)" stroke="hsl(38,92%,55%)" strokeWidth="1.5"/>
      {/* Mesh lines */}
      <line x1="18" y1="2" x2="18" y2="46" stroke="hsl(38,92%,35%)" strokeWidth="0.5"/>
      <line x1="30" y1="2" x2="30" y2="46" stroke="hsl(38,92%,35%)" strokeWidth="0.5"/>
      <line x1="2" y1="18" x2="46" y2="18" stroke="hsl(38,92%,35%)" strokeWidth="0.5"/>
      <line x1="2" y1="30" x2="46" y2="30" stroke="hsl(38,92%,35%)" strokeWidth="0.5"/>
      {/* TK letters */}
      <text x="8" y="38" fontFamily="sans-serif" fontSize="18" fontWeight="700" fill="hsl(38,92%,55%)">T</text>
      <text x="24" y="38" fontFamily="sans-serif" fontSize="14" fontWeight="600" fill="hsl(199,89%,60%)">K</text>
      {/* Stress indicator dot */}
      <circle cx="40" cy="10" r="4" fill="hsl(199,89%,48%)" opacity="0.9"/>
    </svg>
  );
}

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/projects", label: "Projects", icon: FolderOpen },
  { path: "/new-analysis", label: "New Analysis", icon: FlaskConical },
  { path: "/solver", label: "Solver", icon: Cpu },
  { path: "/results", label: "Results", icon: BarChart3 },
  { path: "/theory", label: "Theory", icon: BookOpen },
];

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [location] = useLocation();

  return (
    <aside
      className={`flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-300 ${collapsed ? "w-14" : "w-56"}`}
      style={{ background: "hsl(var(--sidebar-background))", borderColor: "hsl(var(--sidebar-border))" }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-4 border-b border-sidebar-border min-h-[60px]">
        <TKFEMLogo />
        {!collapsed && (
          <div className="flex-1 overflow-hidden">
            <div className="font-bold text-sm tracking-wide" style={{ color: "hsl(var(--primary))" }}>TK-FEM</div>
            <div className="text-xs opacity-60 truncate" style={{ color: "hsl(var(--sidebar-foreground))" }}>Trefftz-Koen Solver</div>
          </div>
        )}
        <button
          onClick={onToggle}
          className="ml-auto p-1 rounded hover:bg-sidebar-accent transition-colors"
          style={{ color: "hsl(var(--sidebar-foreground))" }}
          aria-label="Toggle sidebar"
          data-testid="button-toggle-sidebar"
        >
          {collapsed ? <Menu size={16} /> : <X size={16} />}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ path, label, icon: Icon }) => {
          const active = location === path || (path !== "/" && location.startsWith(path));
          return (
            <Link
              key={path}
              href={path}
              className={`nav-link flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all ${
                active
                  ? "bg-primary/15 text-primary font-semibold"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary"
              }`}
              data-testid={`link-nav-${label.toLowerCase()}`}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-3 pt-2 border-t border-sidebar-border text-xs opacity-40" style={{ color: "hsl(var(--sidebar-foreground))" }}>
        {!collapsed && <div className="truncate">v1.0.0 · C.J. Koen 2026</div>}
      </div>
    </aside>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    document.documentElement.classList.toggle("light", !dark);
  }, [dark]);
  return (
    <button
      onClick={() => setDark(!dark)}
      className="p-2 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
      aria-label="Toggle theme"
      data-testid="button-theme-toggle"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function AppShell() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">TK-FEM</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">Trefftz-Koen Hybrid Finite Element Solver</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/projects" component={Projects} />
            <Route path="/new-analysis" component={NewAnalysis} />
            <Route path="/solver" component={Solver} />
            <Route path="/solver/:id" component={Solver} />
            <Route path="/results" component={Results} />
            <Route path="/results/:id" component={Results} />
            <Route path="/theory" component={Theory} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AppShell />
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
