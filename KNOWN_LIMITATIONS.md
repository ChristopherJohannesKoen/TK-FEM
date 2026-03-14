# Known Limitations

## Solver Fidelity

The current solver now uses a transport-based, boundary-only TK assembly for the implemented benchmark workflows, but it is still not the complete end-state of the full Trefftz-Koen theory described in the paper and appendices.

Current gaps:

- the implemented transport operator is the affine exact-closure case for homogeneous linear elasticity; the broader Appendix A operator family and Koenian geometry-connection treatment are not yet implemented
- the meshed path still approximates the circular hole with body-fitted polygonal edges; exact curved functionation is currently available only in the functionized single-domain benchmark path
- the frontend and backend currently implement the `TK-Q4-edge` style workflow; higher-order edge enrichments such as the `TK-Q8-edge` variant are not yet present
- the convergence study is generated from actual in-app benchmark solves, but it is still limited to the built-in structured mesh family rather than an external Gmsh/photoelastic validation pipeline
- the functionized single-domain mode is currently implemented for the built-in analytic geometries only; there is no general CAD/NURBS import and no arbitrary geometry functionation pipeline yet
- the exact functionized circle-hole path is currently scoped to the Kirsch uniform-tension benchmark; other circular-hole load cases should still use the meshed solver path

## Magnus Analysis

- the SymPy-backed Lie-algebra closure path still requires Python plus `sympy`; without that environment the backend falls back to numeric screening
- for the currently implemented straight-path homogeneous benchmark case, Magnus closure is the exact first-order case; nontrivial adaptive truncation for curved, heterogeneous, or rotated-anisotropy cases remains future work

## Scope

- the code remains limited to 2D linear isotropic plane stress/strain analyses
- the generic functionized boundary-only solver is productionized for the rectangle case, but the broader one-domain exact solution library from the theory is not yet complete
- heterogeneous materials, rotated orthotropy, nonlinear constitutive response, 3D solids, and the photoelastic experiment workflow from the paper are still outside the implemented solver scope

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

Treat the current codebase as a serious benchmark-oriented research implementation, not a certified production engineering solver for safety-critical design decisions.
