# Known Limitations

## Solver Fidelity

The current solver is not yet a full production-grade implementation of the complete Trefftz-Koen theory described in the theory page and paper.

Current gaps:

- element stiffness is still based on a Q4-style formulation with a Magnus-based correction layer
- convergence datasets shown in the UI are seeded reference values, not fully generated studies
- Kirsch SCF extraction is still an approximate postprocessing step

## Storage

The application currently uses in-memory storage only.

Implications:

- restarting the server clears projects, analyses, and bookmarks
- there is no durable project history yet

## Deployment Model

There are two frontend outputs in the repository:

- editable source in `client/src`
- generated static snapshot in root `index.html` and `assets`

If the root snapshot is deployed, it must be refreshed after each build.

## Recommendation

Treat the current codebase as a strong prototype and research UI, not a validated engineering solver for production decision-making.
