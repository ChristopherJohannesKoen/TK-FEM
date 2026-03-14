# Known Limitations

## Solver Fidelity

The current solver now uses a transport-based, boundary-only TK assembly for the implemented benchmark workflows, but it is still not the complete end-state of the full Trefftz-Koen theory described in the paper and appendices.

Current gaps:

- the current meshed transport family is the flat commuting affine benchmark lift; it gives the homogeneous-isotropic `m=1` closure claimed by the theory draft, but it is still not the full higher-order Appendix A/B operator family
- the meshed quarter-hole benchmark has been moved back to a body-fitted polygonal hole boundary until the geometric connection `A_g` is implemented; exact curved meshed transport is still out of scope
- because the meshed benchmark path is still an affine `TK-Q4-edge` family, stress-concentration accuracy on the circular-hole benchmark is still limited and should not be treated as a fully converged reference solution
- the frontend and backend currently implement the `TK-Q4-edge` style workflow; higher-order edge enrichments such as the `TK-Q8-edge` variant are not yet present
- the convergence study is generated from actual in-app benchmark solves, but it is still limited to the built-in structured mesh family rather than an external Gmsh/photoelastic validation pipeline
- the functionized single-domain mode now uses a direct boundary-integral collocation solve on the built-in analytic geometries, but there is still no general CAD/NURBS import and no arbitrary geometry functionation pipeline yet
- the functionized circle-hole mode now uses a BIE/DtN-style boundary solve plus boundary-kinematic SCF extraction for the Kirsch uniform-tension benchmark, but its conditioning and SCF accuracy are still resolution-sensitive; other circular-hole load cases should still use the meshed solver path

## Magnus Analysis

- the SymPy-backed Lie-algebra closure path still requires Python plus `sympy`; without that environment the backend falls back to numeric screening
- for the current homogeneous-isotropic meshed benchmark transport, the implemented operator pair is flat and abelian, so the closure check should report exact finite Magnus closure with `m=1`
- the broader non-abelian Magnus cases from the theory draft still remain future work; once curved-geometry connections or richer transport operators are added, closure will again need symbolic or numeric screening

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
