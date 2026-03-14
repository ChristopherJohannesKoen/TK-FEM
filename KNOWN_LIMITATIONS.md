# Known Limitations

## Solver Fidelity

The current solver is not yet a full production-grade implementation of the complete Trefftz-Koen theory described in the theory page and paper.

Current gaps:

- element stiffness is still based on a Q4-style formulation with a Magnus-based correction layer
- convergence datasets shown in the UI are seeded reference values, not fully generated studies
- Kirsch SCF extraction is still an approximate postprocessing step
- the new stress and deflection plots visualize the current postprocessed fields, but the underlying stress recovery is still centroid-based

## Magnus Analysis

- the SymPy-backed Lie-algebra closure path requires Python plus `sympy`; without that environment the backend falls back to numeric screening
- auto/manual Magnus mode selection is productionized in the UI and API, but the mathematical quality of the decision still depends on the current transport operators and solver formulation

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
