# Known Limitations

## Solver Fidelity

The current solver now uses a transport-based, boundary-only TK assembly for the implemented benchmark workflows, but it is still not the complete end-state of the full Trefftz-Koen theory described in the paper and appendices.

Current gaps:

- the implemented transport operator is the affine exact-closure case for homogeneous linear elasticity; the broader Appendix A operator family and Koenian geometry-connection treatment are not yet implemented
- the benchmark hole mesh is body-fitted and boundary-sampled, but the circular boundary is still represented by polygonal edge segments rather than an exact curved TK geometry connection
- the frontend and backend currently implement the `TK-Q4-edge` style workflow; higher-order edge enrichments such as the `TK-Q8-edge` variant are not yet present
- the convergence study is generated from actual in-app benchmark solves, but it is still limited to the built-in structured mesh family rather than an external Gmsh/photoelastic validation pipeline

## Magnus Analysis

- the SymPy-backed Lie-algebra closure path still requires Python plus `sympy`; without that environment the backend falls back to numeric screening
- for the currently implemented straight-path homogeneous benchmark case, Magnus closure is the exact first-order case; nontrivial adaptive truncation for curved, heterogeneous, or rotated-anisotropy cases remains future work

## Scope

- the code remains limited to 2D linear isotropic plane stress/strain analyses
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
