import json
import math
import sys
from typing import List

import sympy as sp


def parse_matrix(values: List[float], n: int) -> sp.Matrix:
    rows = []
    index = 0
    for _ in range(n):
        row = []
        for _ in range(n):
            row.append(sp.nsimplify(values[index], rational=True))
            index += 1
        rows.append(row)
    return sp.Matrix(rows)


def matrix_signature(matrix: sp.Matrix):
    return tuple(sp.simplify(value) for value in matrix)


def matrix_norm(matrix: sp.Matrix) -> float:
    if matrix.rows == 0 or matrix.cols == 0:
        return 0.0
    return float(matrix.norm("fro").evalf())


def is_zero_matrix(matrix: sp.Matrix) -> bool:
    return bool(matrix.equals(sp.zeros(matrix.rows, matrix.cols)))


def unique_basis(matrices: List[sp.Matrix]) -> List[sp.Matrix]:
    unique: List[sp.Matrix] = []
    seen = set()
    for matrix in matrices:
        if is_zero_matrix(matrix):
            continue
        signature = matrix_signature(matrix)
        if signature in seen:
            continue
        seen.add(signature)
        unique.append(matrix)
    return unique


def lower_central_series(base_basis: List[sp.Matrix], max_depth: int = 6):
    series = [
        {
            "level": 1,
            "matrixCount": len(base_basis),
            "maxNorm": max((matrix_norm(matrix) for matrix in base_basis), default=0.0),
        }
    ]

    current_basis = base_basis
    closure_order = None

    for level in range(1, max_depth + 1):
        next_basis = unique_basis(
            [sp.simplify(A * B - B * A) for A in current_basis for B in base_basis],
        )
        series.append(
            {
                "level": level + 1,
                "matrixCount": len(next_basis),
                "maxNorm": max((matrix_norm(matrix) for matrix in next_basis), default=0.0),
            }
        )

        if not next_basis:
            closure_order = level
            break

        current_basis = next_basis

    return series, closure_order


def main():
    payload = json.loads(sys.stdin.read())
    n = int(payload["n"])
    Ax = parse_matrix(payload["Ax"], n)
    Ay = parse_matrix(payload["Ay"], n)
    hx = float(payload["hx"])
    hy = float(payload["hy"])

    base_basis = unique_basis([Ax, Ay])
    series, closure_order = lower_central_series(base_basis)

    convergence_metric = max(
        hx * matrix_norm(Ax),
        hy * matrix_norm(Ay),
        math.hypot(hx, hy) * matrix_norm(Ax + Ay),
    )

    notes = []
    if closure_order is not None:
        notes.append(
            f"SymPy detected a nilpotent lower-central-series closure at class m={closure_order}.",
        )
    else:
        notes.append("SymPy did not detect finite closure within the configured commutator depth.")

    if convergence_metric < math.pi:
        notes.append("The sufficient norm-based Magnus convergence criterion is satisfied.")
    else:
        notes.append("The sufficient norm-based Magnus convergence criterion is not satisfied.")

    result = {
        "backend": "sympy",
        "finiteSeriesExact": closure_order is not None,
        "closureOrder": closure_order,
        "convergenceGuaranteed": convergence_metric < math.pi,
        "convergenceMetric": convergence_metric,
        "convergenceThreshold": math.pi,
        "notes": notes,
        "lowerCentralSeries": series,
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
