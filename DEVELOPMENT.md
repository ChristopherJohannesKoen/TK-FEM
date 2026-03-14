# Development

## Local Workflow

1. Install dependencies with `npm.cmd install`
2. Install the symbolic Magnus dependency with `py -m pip install -r requirements.txt`
3. Run `npm.cmd run dev`
4. Make changes in `client/src`, `server`, `shared`, or `python`
5. Run `npm.cmd run verify` before shipping

## Coding Conventions

- Keep source edits in `client/src`, `server`, and `shared`
- Keep symbolic Magnus logic in `python` and the Node wrapper in `server/magnus-analysis.ts`
- Keep frontend and backend contracts in `shared`
- Prefer explicit types over `any`
- Validate route params and request bodies
- Treat generated root assets as build output, not hand-edited source

## Build And Release

Development server:

```powershell
npm.cmd run dev
```

Production bundle:

```powershell
npm.cmd run build
```

Run the production server:

```powershell
npm.cmd run start
```

Refresh the root static snapshot:

```powershell
npm.cmd run build
npm.cmd run export:static
```

## Magnus Workflow

- `magnusMode: "auto"` tries the SymPy backend first and falls back to numeric closure screening if Python or `sympy` is unavailable
- `magnusMode: "manual"` still computes the closure diagnostics but preserves the requested truncation order
- `script/build.ts` copies the Python analysis script and `requirements.txt` into `dist` so production builds retain the symbolic path

## Maintenance Checklist

- Run `npm.cmd run check`
- Run `npm.cmd run build`
- Confirm `py -m pip install -r requirements.txt` succeeds on the target machine if symbolic Magnus analysis is required
- If the root site snapshot is used for deployment, run `npm.cmd run export:static`
- Review [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) before making claims about solver fidelity
