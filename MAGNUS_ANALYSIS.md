# Magnus Analysis

## Purpose

The application now supports two Magnus execution modes:

- `auto`: evaluate Lie-algebra closure and choose an effective Magnus order
- `manual`: report the closure diagnostics but keep the user-requested truncation order

This decision is attached to each solver result as `results.magnusAnalysis`.

## Backends

The backend selects one of two analysis paths:

- `sympy`: symbolic lower-central-series analysis through `python/magnus_analysis.py`
- `numeric`: numeric commutator screening in `server/magnus-analysis.ts`

The SymPy path is preferred because it can detect finite closure more defensibly than the numeric fallback.

## Setup

Install the Python dependency before using the symbolic path:

```powershell
py -m pip install -r requirements.txt
```

If Python or `sympy` is unavailable, the backend still runs and records `backend: "numeric"`.

## Output Contract

`results.magnusAnalysis` reports:

- execution mode and backend
- whether finite exact closure was detected
- whether Magnus truncation is required
- closure order, if finite
- requested, recommended, and applied Magnus orders
- sufficient convergence-bound data
- lower-central-series diagnostics and notes

## UI Surfaces

- `New Analysis`: choose auto or manual Magnus mode
- `Solver`: see the applied Magnus strategy and backend after a run
- `Results`: inspect full Magnus diagnostics, closure tables, stress contours, deflection contours, and the deformed mesh
