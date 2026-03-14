# Development

## Local Workflow

1. Install dependencies with `npm.cmd install`
2. Run `npm.cmd run dev`
3. Make changes in `client/src`, `server`, or `shared`
4. Run `npm.cmd run verify` before shipping

## Coding Conventions

- Keep source edits in `client/src`, `server`, and `shared`
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

## Maintenance Checklist

- Run `npm.cmd run check`
- Run `npm.cmd run build`
- If the root site snapshot is used for deployment, run `npm.cmd run export:static`
- Review [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) before making claims about solver fidelity
