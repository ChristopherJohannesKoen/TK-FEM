# Architecture

## Runtime Shape

The app runs as a single Node process:

- Express serves the API
- Vite middleware serves the frontend in development
- Static files are served from `dist/public` in production

## Frontend

Main entrypoints:

- `client/src/main.tsx`
- `client/src/App.tsx`

Routing:

- Wouter with hash-based routing
- Pages live in `client/src/pages`

State and data flow:

- React Query for API fetching and mutation
- Form state via `react-hook-form` + `zod`
- Canvas-based rendering for mesh and result views

## Backend

Main entrypoints:

- `server/index.ts`
- `server/routes.ts`
- `server/static.ts`
- `server/vite.ts`

The backend currently uses in-memory storage via `server/storage.ts`.

## Shared Contracts

Shared types are defined in:

- `shared/schema.ts` for persisted entities
- `shared/solver.ts` for solver input and output payloads

This keeps the client and server aligned on result structure without relying on `any`.

## Build Outputs

Production build:

- client bundle -> `dist/public`
- server bundle -> `dist/index.cjs`

Optional static export:

- `script/export-static.mjs` copies `dist/public/index.html` and `dist/public/assets` to the repository root

## Design Notes

- `client/src` is the editable frontend source
- root `index.html` and `assets` are generated deployment artifacts
- the solver and the theory page are related, but they are not yet a one-to-one implementation of the full published formulation
