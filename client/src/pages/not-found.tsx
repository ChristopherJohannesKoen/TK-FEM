import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 text-center px-6">
      <div className="text-6xl font-mono font-bold text-muted-foreground/20 mb-4">404</div>
      <div className="text-lg font-semibold mb-2">Page not found</div>
      <div className="text-sm text-muted-foreground mb-6">The page you are looking for does not exist.</div>
      <Link href="/">
        <Button variant="outline">Return to Dashboard</Button>
      </Link>
    </div>
  );
}
