"""SymPy 数学引擎测试。"""

import pytest
from document_worker.math_engine import compute_math


class TestMathEngine:
    """数学计算引擎测试。"""

    def test_expand(self):
        result = compute_math("(x+1)**2", operation="expand")
        assert result.ok is True
        assert "x**2" in result.result
        assert "2*x" in result.result
        assert len(result.steps) > 0

    def test_factor(self):
        result = compute_math("x**2 + 2*x + 1", operation="factor")
        assert result.ok is True
        assert "(x + 1)" in result.result or "(x+1)" in result.result

    def test_diff_polynomial(self):
        result = compute_math("x**3 + 2*x", operation="diff")
        assert result.ok is True
        assert "3*x**2" in result.result
        assert "2" in result.result

    def test_diff_trig(self):
        result = compute_math("sin(x)", operation="diff")
        assert result.ok is True
        assert "cos(x)" in result.result

    def test_integrate_polynomial(self):
        result = compute_math("2*x + 1", operation="integrate")
        assert result.ok is True
        assert "x**2" in result.result

    def test_solve_linear(self):
        result = compute_math("x - 3", operation="solve")
        assert result.ok is True
        assert "3" in result.result

    def test_solve_quadratic(self):
        result = compute_math("x**2 - 4", operation="solve")
        assert result.ok is True
        assert "2" in result.result
        assert "-2" in result.result

    def test_simplify(self):
        result = compute_math("x**2 + 2*x + 1", operation="simplify")
        assert result.ok is True
        assert result.result  # 非空

    def test_eval_expression(self):
        result = compute_math("x**2 + 1", operation="eval")
        assert result.ok is True
        assert result.input == "x**2 + 1"

    def test_empty_expression(self):
        result = compute_math("", operation="eval")
        assert result.ok is False
        assert "空" in result.error

    def test_invalid_operation(self):
        result = compute_math("x+1", operation="invalid")
        assert result.ok is False
        assert "不支持" in result.error

    def test_invalid_expression(self):
        result = compute_math("+++", operation="eval")
        assert result.ok is False
        assert "计算失败" in result.error

    def test_latex_output(self):
        result = compute_math("(x+1)**2", operation="expand")
        assert result.ok is True
        # LaTeX 应包含 x
        assert "x" in result.latex.lower() or result.latex != ""

    def test_variable_custom(self):
        result = compute_math("t**2 + 1", operation="diff", variable="t")
        assert result.ok is True
        assert "2*t" in result.result
