"""数学计算引擎（基于 SymPy）。"""

from __future__ import annotations

from .schema import MathResult

# 支持的操作
SUPPORTED_OPS = {"simplify", "expand", "factor", "diff", "integrate", "solve", "eval", "limit"}


def compute_math(expression: str, operation: str = "eval", variable: str = "x") -> MathResult:
    """执行数学计算，返回结构化结果。"""
    try:
        from sympy import (
            symbols, sympify, simplify, expand, factor,
            diff, integrate, solve, latex, Rational
        )
        from sympy.parsing.sympy_parser import (
            parse_expr, standard_transformations,
            implicit_multiplication_application, convert_xor
        )
    except ImportError:
        return MathResult(ok=False, error="SymPy 未安装")

    expression = expression.strip()
    if not expression:
        return MathResult(ok=False, error="表达式不能为空")

    operation = operation.lower().strip()
    if operation not in SUPPORTED_OPS:
        return MathResult(
            ok=False,
            error=f"不支持的操作 '{operation}'，支持: {', '.join(sorted(SUPPORTED_OPS))}"
        )

    try:
        import sympy as _sympy
        x = symbols(variable)
        local_dict = {
            variable: x,
            "sin": _sympy.sin, "cos": _sympy.cos, "tan": _sympy.tan,
            "ln": _sympy.log, "log": _sympy.log, "exp": _sympy.exp,
            "sqrt": _sympy.sqrt, "pi": _sympy.pi, "E": _sympy.E, "I": _sympy.I,
        }
        expr = parse_expr(
            expression,
            local_dict=local_dict,
            transformations=standard_transformations + (convert_xor,),
        )

        steps: list[str] = [f"输入表达式: {expression}"]
        warnings: list[str] = []

        if operation == "simplify":
            result_expr = simplify(expr)
            steps.append(f"化简结果: {result_expr}")

        elif operation == "expand":
            result_expr = expand(expr)
            steps.append(f"展开结果: {result_expr}")

        elif operation == "factor":
            result_expr = factor(expr)
            steps.append(f"因式分解结果: {result_expr}")

        elif operation == "diff":
            result_expr = diff(expr, x)
            steps.append(f"对 {variable} 求导: {result_expr}")

        elif operation == "integrate":
            result_expr = integrate(expr, x)
            steps.append(f"对 {variable} 积分: {result_expr}")

        elif operation == "solve":
            solutions = solve(expr, x)
            if not solutions:
                result_expr = "无解"
                warnings.append("方程无解或超出求解能力")
            elif len(solutions) == 1:
                result_expr = f"{variable} = {solutions[0]}"
            else:
                result_expr = ", ".join(f"{variable} = {s}" for s in solutions)
            steps.append(f"求解结果: {result_expr}")

        elif operation == "eval":
            result_expr = expr
            steps.append(f"表达式: {result_expr}")

        elif operation == "limit":
            from sympy import limit as sympy_limit, oo
            # Parse point from expression if provided as "expr, x, 0" format
            parts = [p.strip() for p in expression.split(",")]
            if len(parts) >= 3:
                limit_expr = parse_expr(parts[0], local_dict=local_dict, transformations=standard_transformations + (convert_xor,))
                limit_var = symbols(parts[1]) if parts[1] != variable else x
                try:
                    limit_point = parse_expr(parts[2], local_dict=local_dict)
                except Exception:
                    limit_point = 0
            else:
                limit_expr = expr
                limit_var = x
                limit_point = 0
            result_expr = sympy_limit(limit_expr, limit_var, limit_point)
            steps.append(f"求极限: lim({limit_var}→{limit_point}) {limit_expr} = {result_expr}")

        try:
            latex_str = latex(result_expr) if not isinstance(result_expr, str) else str(result_expr)
        except Exception:
            latex_str = str(result_expr)

        return MathResult(
            ok=True,
            input=expression,
            result=str(result_expr),
            latex=latex_str,
            steps=steps,
            warnings=warnings,
        )

    except Exception as e:
        return MathResult(ok=False, error=f"计算失败: {e}")
