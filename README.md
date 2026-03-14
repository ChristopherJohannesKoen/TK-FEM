# TK-FEM

TK-FEM is a Vite + React + TypeScript frontend with an Express + TypeScript backend for exploring Trefftz-Koen finite element ideas and visualizing solver output.

## Quick Start

Prerequisites:

- Node.js 20+ or 22+
- npm 10+
- Python 3.11+ recommended for SymPy-backed Magnus closure analysis

Install and run:

```powershell
npm.cmd install
py -m pip install -r requirements.txt
npm.cmd run dev
```

Open `http://localhost:5000`.

If Python or `sympy` is not available, the backend falls back to a numeric Magnus screening path. The application still runs, but the Lie-algebra closure check is less rigorous than the SymPy path.

## Common Commands

```powershell
npm.cmd run dev
npm.cmd run check
npm.cmd run build
npm.cmd run start
npm.cmd run verify
```

Static site export for the repository root:

```powershell
npm.cmd run build
npm.cmd run export:static
```

## Source Of Truth

Edit source files here:

- `client/src` for the React application
- `server` for the API and solver entrypoints
- `shared` for contracts used by both sides
- `python` for SymPy-backed symbolic Magnus analysis

Do not treat these as source files:

- `index.html` at the repository root
- `assets/*` at the repository root

Those root files are a generated static snapshot. Refresh them with `npm run export:static`.

## Project Layout

- `client/src/pages` application screens
- `client/src/components` reusable UI
- `server/routes.ts` API surface
- `server/tkfem-solver.ts` solver implementation
- `shared/schema.ts` storage models
- `shared/solver.ts` shared solver result contracts
- `script` build and export scripts
- `python/magnus_analysis.py` symbolic Magnus closure and convergence analysis

## Quality Gates

The baseline verification flow is:

```powershell
npm.cmd run verify
```

That runs the TypeScript check and production build.

## Additional Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DEVELOPMENT.md](./DEVELOPMENT.md)
- [MAGNUS_ANALYSIS.md](./MAGNUS_ANALYSIS.md)
- [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)
