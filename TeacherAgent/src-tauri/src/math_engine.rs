use serde::{Deserialize, Serialize};

const MAX_EXPRESSION_CHARS: usize = 8_000;
const MAX_EXPRESSION_DEPTH: usize = 128;

/// Supported math operations for the computation engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MathOperation {
    Simplify,
    Limit,
    Differentiate,
    Integrate,
    Solve,
    Evaluate,
}

/// Input for the math computation engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct MathComputeInput {
    pub operation: MathOperation,
    pub expression: String,
    pub variable: Option<String>,
    pub point: Option<f64>, // for limit/evaluate
    pub parameters: Option<std::collections::HashMap<String, String>>,
}

/// Output from the math computation engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct MathComputeOutput {
    pub result: String,
    pub latex: Option<String>,
    pub normalized_expression: String,
    pub operation: MathOperation,
    pub steps: Vec<String>,
    pub warnings: Vec<String>,
    pub confidence: f64,
    pub engine: String,
}

/// Compute a math expression using the built-in engine.
pub(crate) fn compute_math(input: MathComputeInput) -> Result<MathComputeOutput, String> {
    let expr = input.expression.trim().to_string();
    if expr.is_empty() {
        return Err("expression cannot be empty".to_string());
    }
    if expr.len() > MAX_EXPRESSION_CHARS {
        return Err(format!(
            "expression exceeds {MAX_EXPRESSION_CHARS} character limit"
        ));
    }
    validate_expression_depth(&expr)?;

    let variable = input.variable.clone().unwrap_or_else(|| "x".to_string());

    match input.operation {
        MathOperation::Differentiate => compute_derivative(&expr, &variable),
        MathOperation::Evaluate => compute_evaluate(&expr, &variable, input.point),
        MathOperation::Simplify => compute_simplify(&expr),
        MathOperation::Limit => compute_limit(&expr, &variable, input.point),
        MathOperation::Integrate => compute_integral(&expr, &variable),
        MathOperation::Solve => compute_solve(&expr, &variable),
    }
}

fn validate_expression_depth(expr: &str) -> Result<(), String> {
    let mut depth = 0usize;
    for character in expr.chars() {
        match character {
            '(' => {
                depth += 1;
                if depth > MAX_EXPRESSION_DEPTH {
                    return Err(format!(
                        "expression nesting exceeds {MAX_EXPRESSION_DEPTH} levels"
                    ));
                }
            }
            ')' => {
                if depth == 0 {
                    return Err("expression contains unmatched closing parenthesis".to_string());
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    if depth != 0 {
        return Err("expression contains unmatched opening parenthesis".to_string());
    }
    Ok(())
}

/// Compute the derivative of an expression with respect to a variable.
/// Supports: polynomials, sin, cos, ln, exp, constants
fn compute_derivative(expr: &str, variable: &str) -> Result<MathComputeOutput, String> {
    let normalized = normalize_expression(expr);
    let mut steps = Vec::new();
    let mut warnings = Vec::new();

    // Try to parse as a polynomial: a*x^n + b*x^m + ...
    if let Some(derivative) = differentiate_polynomial(&normalized, variable) {
        steps.push(format!("对 {} 关于 {} 求导", normalized, variable));
        steps.push(format!("结果：{}", derivative));

        return Ok(MathComputeOutput {
            result: derivative.clone(),
            latex: Some(expression_to_latex(&derivative)),
            normalized_expression: normalized,
            operation: MathOperation::Differentiate,
            steps,
            warnings,
            confidence: 0.9,
            engine: "builtin".to_string(),
        });
    }

    // Try basic function differentiation
    if let Some(derivative) = differentiate_basic_function(&normalized, variable) {
        steps.push(format!("对 {} 关于 {} 求导", normalized, variable));
        steps.push(format!("结果：{}", derivative));

        return Ok(MathComputeOutput {
            result: derivative.clone(),
            latex: Some(expression_to_latex(&derivative)),
            normalized_expression: normalized,
            operation: MathOperation::Differentiate,
            steps,
            warnings,
            confidence: 0.85,
            engine: "builtin".to_string(),
        });
    }

    warnings.push("表达式超出内置引擎的符号求导能力，返回数值近似建议。".to_string());
    Ok(MathComputeOutput {
        result: format!("无法对 {} 进行符号求导", normalized),
        latex: None,
        normalized_expression: normalized,
        operation: MathOperation::Differentiate,
        steps: vec!["建议使用数值微分或更强大的符号计算引擎。".to_string()],
        warnings,
        confidence: 0.0,
        engine: "builtin".to_string(),
    })
}

/// Evaluate an expression at a given point.
fn compute_evaluate(
    expr: &str,
    variable: &str,
    point: Option<f64>,
) -> Result<MathComputeOutput, String> {
    let normalized = normalize_expression(expr);
    let x = point.ok_or("求值需要指定变量的值 (point 参数)")?;
    let mut steps = Vec::new();
    let warnings = Vec::new();

    steps.push(format!("将 {} = {} 代入 {}", variable, x, normalized));

    if let Some(value) = evaluate_expression(&normalized, variable, x) {
        steps.push(format!("计算结果：{}", format_number(value)));

        Ok(MathComputeOutput {
            result: format_number(value),
            latex: Some(format_number(value)),
            normalized_expression: normalized,
            operation: MathOperation::Evaluate,
            steps,
            warnings,
            confidence: 1.0,
            engine: "builtin".to_string(),
        })
    } else {
        Ok(MathComputeOutput {
            result: "无法计算该表达式的值".to_string(),
            latex: None,
            normalized_expression: normalized,
            operation: MathOperation::Evaluate,
            steps: vec!["表达式包含不支持的函数或结构。".to_string()],
            warnings: vec!["内置引擎只支持多项式和基本初等函数的求值。".to_string()],
            confidence: 0.0,
            engine: "builtin".to_string(),
        })
    }
}

/// Simplify an expression.
fn compute_simplify(expr: &str) -> Result<MathComputeOutput, String> {
    let normalized = normalize_expression(expr);
    let simplified = simplify_expression(&normalized);
    let mut steps = Vec::new();
    let warnings = Vec::new();

    steps.push(format!("化简：{}", normalized));
    if simplified != normalized {
        steps.push(format!("结果：{}", simplified));
    } else {
        steps.push("表达式已是最简形式。".to_string());
    }

    Ok(MathComputeOutput {
        result: simplified.clone(),
        latex: Some(expression_to_latex(&simplified)),
        normalized_expression: normalized,
        operation: MathOperation::Simplify,
        steps,
        warnings,
        confidence: 0.8,
        engine: "builtin".to_string(),
    })
}

/// Compute a basic limit.
fn compute_limit(
    expr: &str,
    variable: &str,
    point: Option<f64>,
) -> Result<MathComputeOutput, String> {
    let normalized = normalize_expression(expr);
    let x = point.ok_or("求极限需要指定趋近点 (point 参数)")?;
    let mut steps = Vec::new();
    let mut warnings = Vec::new();

    steps.push(format!("求 lim({} → {}) {}", variable, x, normalized));

    // Try direct substitution
    if let Some(value) = evaluate_expression(&normalized, variable, x) {
        if value.is_finite() {
            steps.push(format!(
                "直接代入 {} = {}：{}",
                variable,
                x,
                format_number(value)
            ));
            steps.push("函数在该点连续，极限等于函数值。".to_string());

            return Ok(MathComputeOutput {
                result: format_number(value),
                latex: Some(format_number(value)),
                normalized_expression: normalized,
                operation: MathOperation::Limit,
                steps,
                warnings,
                confidence: 0.95,
                engine: "builtin".to_string(),
            });
        }
    }

    // Check for 0/0 indeterminate form
    if normalized.contains('/') {
        warnings.push("检测到分式结构，可能存在不定式。".to_string());
        steps.push("直接代入可能产生 0/0 或 ∞/∞ 型不定式。".to_string());
        steps.push("建议使用洛必达法则、等价无穷小替换或因式分解。".to_string());

        return Ok(MathComputeOutput {
            result: "不定式，需要进一步分析".to_string(),
            latex: None,
            normalized_expression: normalized,
            operation: MathOperation::Limit,
            steps,
            warnings,
            confidence: 0.5,
            engine: "builtin".to_string(),
        });
    }

    warnings.push("内置引擎对复杂极限的分析能力有限。".to_string());
    Ok(MathComputeOutput {
        result: "建议使用更强大的符号计算引擎分析此极限".to_string(),
        latex: None,
        normalized_expression: normalized,
        operation: MathOperation::Limit,
        steps,
        warnings,
        confidence: 0.2,
        engine: "builtin".to_string(),
    })
}

/// Compute a basic integral (polynomial only).
fn compute_integral(expr: &str, variable: &str) -> Result<MathComputeOutput, String> {
    let normalized = normalize_expression(expr);
    let mut steps = Vec::new();
    let mut warnings = Vec::new();

    if let Some(integral) = integrate_polynomial(&normalized, variable) {
        steps.push(format!("对 {} 关于 {} 积分", normalized, variable));
        steps.push(format!("结果：{} + C", integral));

        return Ok(MathComputeOutput {
            result: format!("{} + C", integral),
            latex: Some(format!("{} + C", expression_to_latex(&integral))),
            normalized_expression: normalized,
            operation: MathOperation::Integrate,
            steps,
            warnings,
            confidence: 0.85,
            engine: "builtin".to_string(),
        });
    }

    warnings.push("内置引擎只支持多项式积分。".to_string());
    Ok(MathComputeOutput {
        result: "该积分超出内置引擎能力".to_string(),
        latex: None,
        normalized_expression: normalized,
        operation: MathOperation::Integrate,
        steps: vec!["建议使用换元法、分部积分法或更强大的符号计算引擎。".to_string()],
        warnings,
        confidence: 0.0,
        engine: "builtin".to_string(),
    })
}

/// Solve a basic equation.
fn compute_solve(expr: &str, variable: &str) -> Result<MathComputeOutput, String> {
    let normalized = normalize_expression(expr);
    let mut steps = Vec::new();
    let mut warnings = Vec::new();

    // Handle equation format: "left = right" or just "expression = 0"
    let (left, right) = if let Some(eq_pos) = normalized.find('=') {
        let l = normalized[..eq_pos].trim().to_string();
        let r = normalized[eq_pos + 1..].trim().to_string();
        (l, r)
    } else {
        (normalized.clone(), "0".to_string())
    };

    steps.push(format!("解方程：{} = {}", left, right));

    // Try linear equation: ax + b = c
    if let Some(solution) = solve_linear(&left, &right, variable) {
        steps.push(format!("{} = {}", variable, solution));

        return Ok(MathComputeOutput {
            result: format!("{} = {}", variable, solution),
            latex: Some(format!("{} = {}", variable, solution)),
            normalized_expression: normalized,
            operation: MathOperation::Solve,
            steps,
            warnings,
            confidence: 0.9,
            engine: "builtin".to_string(),
        });
    }

    warnings.push("内置引擎只支持线性方程求解。".to_string());
    Ok(MathComputeOutput {
        result: "该方程超出内置引擎的求解能力".to_string(),
        latex: None,
        normalized_expression: normalized,
        operation: MathOperation::Solve,
        steps: vec!["建议使用因式分解、配方法或数值求解。".to_string()],
        warnings,
        confidence: 0.0,
        engine: "builtin".to_string(),
    })
}

// ===== Expression Parsing and Computation Helpers =====

fn normalize_expression(expr: &str) -> String {
    expr.trim()
        .replace(" ", "")
        .replace("**", "^")
        .replace("×", "*")
        .replace("÷", "/")
}

/// Try to differentiate a polynomial expression.
/// Supports: x^n, a*x^n, sums of polynomial terms
fn differentiate_polynomial(expr: &str, var: &str) -> Option<String> {
    let terms = split_addition_subtraction(expr);
    if terms.is_empty() {
        return None;
    }

    let mut result_terms = Vec::new();

    for (term, sign) in &terms {
        if let Some(deriv) = differentiate_term(term, var) {
            if deriv == "0" {
                continue;
            }
            let prefixed = if *sign < 0 && deriv != "0" {
                format!("-{}", deriv)
            } else {
                deriv
            };
            result_terms.push(prefixed);
        } else {
            return None;
        }
    }

    if result_terms.is_empty() {
        Some("0".to_string())
    } else {
        Some(join_terms(&result_terms))
    }
}

/// Differentiate a single term (coefficient * x^power)
fn differentiate_term(term: &str, var: &str) -> Option<String> {
    let term = term.trim();

    // Constant
    if term.parse::<f64>().is_ok() {
        return Some("0".to_string());
    }

    // Just the variable: x
    if term == var {
        return Some("1".to_string());
    }

    // x^n
    if let Some(pow_str) = term.strip_prefix(&format!("{}^", var)) {
        if let Ok(n) = pow_str.parse::<f64>() {
            let coeff = n;
            let new_pow = n - 1.0;
            return Some(format_power_coeff(var, coeff, new_pow));
        }
    }

    // a*x^n or a*x
    if let Some(star_pos) = term.find('*') {
        let coeff_str = term[..star_pos].trim();
        let rest = term[star_pos + 1..].trim();

        if let Ok(coeff) = coeff_str.parse::<f64>() {
            if rest == var {
                return Some(format_number(coeff));
            }
            if let Some(pow_str) = rest.strip_prefix(&format!("{}^", var)) {
                if let Ok(n) = pow_str.parse::<f64>() {
                    let new_coeff = coeff * n;
                    let new_pow = n - 1.0;
                    return Some(format_power_coeff(var, new_coeff, new_pow));
                }
            }
        }
    }

    // n*x (coefficient on the left without explicit *)
    for (i, _) in term.char_indices().skip(1) {
        if !term.is_char_boundary(i) {
            continue;
        }
        let prefix = &term[..i];
        let suffix = &term[i..];
        if let Ok(coeff) = prefix.parse::<f64>() {
            if suffix == var {
                return Some(format_number(coeff));
            }
            if let Some(pow_str) = suffix.strip_prefix(&format!("{}^", var)) {
                if let Ok(n) = pow_str.parse::<f64>() {
                    let new_coeff = coeff * n;
                    let new_pow = n - 1.0;
                    return Some(format_power_coeff(var, new_coeff, new_pow));
                }
            }
        }
    }

    None
}

/// Try to differentiate basic functions: sin, cos, ln, exp
fn differentiate_basic_function(expr: &str, var: &str) -> Option<String> {
    let expr = expr.trim();

    // sin(x)
    if let Some(inner) = strip_function(expr, "sin") {
        if inner == var {
            return Some(format!("cos({})", var));
        }
    }

    // cos(x)
    if let Some(inner) = strip_function(expr, "cos") {
        if inner == var {
            return Some(format!("-sin({})", var));
        }
    }

    // ln(x)
    if let Some(inner) = strip_function(expr, "ln") {
        if inner == var {
            return Some(format!("1/{}", var));
        }
    }

    // exp(x) or e^x
    if let Some(inner) = strip_function(expr, "exp") {
        if inner == var {
            return Some(format!("exp({})", var));
        }
    }
    if expr == format!("e^{}", var) || expr == format!("ℯ^{}", var) {
        return Some(expr.to_string());
    }

    None
}

fn strip_function(expr: &str, func: &str) -> Option<String> {
    let prefix = format!("{}(", func);
    if expr.starts_with(&prefix) && expr.ends_with(')') {
        let inner = &expr[prefix.len()..expr.len() - 1];
        Some(inner.to_string())
    } else {
        None
    }
}

/// Integrate a polynomial term.
fn integrate_polynomial(expr: &str, var: &str) -> Option<String> {
    let terms = split_addition_subtraction(expr);
    if terms.is_empty() {
        return None;
    }

    let mut result_terms = Vec::new();

    for (term, sign) in &terms {
        if let Some(integral) = integrate_term(term, var) {
            let prefixed = if *sign < 0 {
                format!("-{}", integral)
            } else {
                integral
            };
            result_terms.push(prefixed);
        } else {
            return None;
        }
    }

    if result_terms.is_empty() {
        Some("0".to_string())
    } else {
        Some(join_terms(&result_terms))
    }
}

fn integrate_term(term: &str, var: &str) -> Option<String> {
    let term = term.trim();

    // Constant: a -> a*x
    if let Ok(a) = term.parse::<f64>() {
        if a == 1.0 {
            return Some(var.to_string());
        }
        return Some(format!("{}*{}", a, var));
    }

    // Just x -> x^2/2
    if term == var {
        return Some(format!("{}^2/2", var));
    }

    // x^n -> x^(n+1)/(n+1)
    if let Some(pow_str) = term.strip_prefix(&format!("{}^", var)) {
        if let Ok(n) = pow_str.parse::<f64>() {
            let new_pow = n + 1.0;
            return Some(format!("{}^{}", var, format_number(new_pow)));
        }
    }

    // a*x^n
    if let Some(star_pos) = term.find('*') {
        let coeff_str = term[..star_pos].trim();
        let rest = term[star_pos + 1..].trim();

        if let Ok(coeff) = coeff_str.parse::<f64>() {
            if rest == var {
                return Some(format!("{}*{}^2/2", coeff, var));
            }
            if let Some(pow_str) = rest.strip_prefix(&format!("{}^", var)) {
                if let Ok(n) = pow_str.parse::<f64>() {
                    let new_coeff = coeff / (n + 1.0);
                    let new_pow = n + 1.0;
                    return Some(format!(
                        "{}*{}^{}",
                        format_number(new_coeff),
                        var,
                        format_number(new_pow)
                    ));
                }
            }
        }
    }

    None
}

/// Solve a linear equation: left = right for variable
fn solve_linear(left: &str, right: &str, var: &str) -> Option<String> {
    // Parse left side as ax + b
    let (left_coeff, left_const) = parse_linear(left, var)?;
    let (right_coeff, right_const) = parse_linear(right, var)?;

    // ax + b = cx + d  =>  (a-c)x = d - b
    let coeff = left_coeff - right_coeff;
    let constant = right_const - left_const;

    if coeff.abs() < 1e-10 {
        return None; // No solution or infinite solutions
    }

    let solution = constant / coeff;
    Some(format_number(solution))
}

/// Parse a linear expression: returns (coefficient of var, constant)
fn parse_linear(expr: &str, var: &str) -> Option<(f64, f64)> {
    let terms = split_addition_subtraction(expr);
    let mut coeff = 0.0;
    let mut constant = 0.0;

    for (term, sign) in &terms {
        let sign_f = *sign as f64;
        let term = term.trim();

        if term == var {
            coeff += sign_f * 1.0;
        } else if let Some(star_pos) = term.find('*') {
            let c = term[..star_pos].trim();
            let v = term[star_pos + 1..].trim();
            if v == var {
                if let Ok(c_val) = c.parse::<f64>() {
                    coeff += sign_f * c_val;
                }
            }
        } else if let Ok(val) = term.parse::<f64>() {
            constant += sign_f * val;
        } else {
            // Try parsing as coefficient*variable
            for (i, _) in term.char_indices().skip(1) {
                if !term.is_char_boundary(i) {
                    continue;
                }
                let prefix = &term[..i];
                let suffix = &term[i..];
                if suffix == var {
                    if let Ok(c_val) = prefix.parse::<f64>() {
                        coeff += sign_f * c_val;
                        break;
                    }
                }
            }
        }
    }

    Some((coeff, constant))
}

/// Evaluate an expression at a given point.
fn evaluate_expression(expr: &str, var: &str, x: f64) -> Option<f64> {
    let expr = expr.replace(var, &format_number(x));
    evaluate_simple(&expr)
}

/// Simple expression evaluator for numeric expressions.
/// Processes operators by precedence: first +/- (lowest), then */, then ^ (highest).
fn evaluate_simple(expr: &str) -> Option<f64> {
    let expr = expr.trim();

    // Direct number
    if let Ok(val) = expr.parse::<f64>() {
        return Some(val);
    }

    // Handle parentheses
    if expr.starts_with('(') && expr.ends_with(')') {
        return evaluate_simple(&expr[1..expr.len() - 1]);
    }

    // Handle basic functions
    if let Some(inner) = strip_function(expr, "sin") {
        let val = evaluate_simple(&inner)?;
        return Some(val.sin());
    }
    if let Some(inner) = strip_function(expr, "cos") {
        let val = evaluate_simple(&inner)?;
        return Some(val.cos());
    }
    if let Some(inner) = strip_function(expr, "ln") {
        let val = evaluate_simple(&inner)?;
        return if val > 0.0 { Some(val.ln()) } else { None };
    }
    if let Some(inner) = strip_function(expr, "exp") {
        let val = evaluate_simple(&inner)?;
        return Some(val.exp());
    }
    if let Some(inner) = strip_function(expr, "sqrt") {
        let val = evaluate_simple(&inner)?;
        return if val >= 0.0 { Some(val.sqrt()) } else { None };
    }

    // Handle e^x
    if let Some(pow) = expr.strip_prefix("e^") {
        let val = evaluate_simple(pow)?;
        return Some(val.exp());
    }

    // Lowest precedence: addition and subtraction (find last +/- at depth 0)
    if let Some(pos) = find_last_op_at_depth(expr, '+', 0) {
        let left = evaluate_simple(&expr[..pos])?;
        let right = evaluate_simple(&expr[pos + 1..])?;
        return Some(left + right);
    }
    if let Some(pos) = find_last_subtraction(expr) {
        let left = evaluate_simple(&expr[..pos])?;
        let right = evaluate_simple(&expr[pos + 1..])?;
        return Some(left - right);
    }

    // Medium precedence: multiplication and division
    if let Some(pos) = find_last_op_at_depth(expr, '*', 0) {
        let left = evaluate_simple(&expr[..pos])?;
        let right = evaluate_simple(&expr[pos + 1..])?;
        return Some(left * right);
    }
    if let Some(pos) = find_last_op_at_depth(expr, '/', 0) {
        let left = evaluate_simple(&expr[..pos])?;
        let right = evaluate_simple(&expr[pos + 1..])?;
        return if right.abs() > 1e-15 {
            Some(left / right)
        } else {
            None
        };
    }

    // Highest precedence: power (right-associative, find last '^')
    if let Some(pos) = find_last_op_at_depth(expr, '^', 0) {
        let base = evaluate_simple(&expr[..pos])?;
        let exp = evaluate_simple(&expr[pos + 1..])?;
        return Some(base.powf(exp));
    }

    // Unary negation at start
    if let Some(rest) = expr.strip_prefix('-') {
        let val = evaluate_simple(rest)?;
        return Some(-val);
    }

    None
}

/// Find the last occurrence of an operator at the given parenthesis depth.
fn find_last_op_at_depth(expr: &str, op: char, target_depth: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut last_pos = None;
    for (i, c) in expr.chars().enumerate() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            c if c == op && depth == target_depth => last_pos = Some(i),
            _ => {}
        }
    }
    last_pos
}

/// Find the position of an operator, respecting parentheses.
fn find_operator(expr: &str, op: char) -> Option<usize> {
    let mut depth = 0;
    for (i, c) in expr.chars().enumerate() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            c if c == op && depth == 0 => return Some(i),
            _ => {}
        }
    }
    None
}

/// Find the last subtraction operator (not at the start).
fn find_last_subtraction(expr: &str) -> Option<usize> {
    let mut depth = 0;
    let mut last_pos = None;
    for (i, c) in expr.chars().enumerate() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            '-' if depth == 0 && i > 0 => last_pos = Some(i),
            _ => {}
        }
    }
    last_pos
}

/// Split an expression by + and - operators, respecting parentheses.
fn split_addition_subtraction(expr: &str) -> Vec<(String, i32)> {
    let mut terms = Vec::new();
    let mut current = String::new();
    let mut sign = 1i32;
    let mut depth = 0;

    for c in expr.chars() {
        match c {
            '(' => {
                depth += 1;
                current.push(c);
            }
            ')' => {
                depth -= 1;
                current.push(c);
            }
            '+' if depth == 0 => {
                if !current.is_empty() {
                    terms.push((current.clone(), sign));
                    current.clear();
                }
                sign = 1;
            }
            '-' if depth == 0 && !current.is_empty() => {
                terms.push((current.clone(), sign));
                current.clear();
                sign = -1;
            }
            '-' if depth == 0 && current.is_empty() => {
                sign = -1;
            }
            _ => {
                current.push(c);
            }
        }
    }

    if !current.is_empty() {
        terms.push((current, sign));
    }

    terms
}

/// Join terms with + or - signs.
fn join_terms(terms: &[String]) -> String {
    if terms.is_empty() {
        return "0".to_string();
    }

    let mut result = terms[0].clone();
    for term in &terms[1..] {
        if term.starts_with('-') {
            result.push_str(term);
        } else {
            result.push('+');
            result.push_str(term);
        }
    }
    result
}

/// Format a power with coefficient.
fn format_power_coeff(var: &str, coeff: f64, power: f64) -> String {
    if power == 0.0 {
        format_number(coeff)
    } else if power == 1.0 {
        if (coeff - 1.0).abs() < 1e-10 {
            var.to_string()
        } else {
            format!("{}*{}", format_number(coeff), var)
        }
    } else {
        if (coeff - 1.0).abs() < 1e-10 {
            format!("{}^{}", var, format_number(power))
        } else {
            format!("{}*{}^{}", format_number(coeff), var, format_number(power))
        }
    }
}

/// Format a number nicely (remove unnecessary decimals).
fn format_number(n: f64) -> String {
    if n == n.floor() && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else if n.abs() < 0.001 || n.abs() > 1e10 {
        format!("{:.6e}", n)
    } else {
        let s = format!("{:.10}", n);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

/// Simplify an expression (basic cleanup).
fn simplify_expression(expr: &str) -> String {
    let mut result = expr.to_string();

    // Remove *1 and 1*
    result = result.replace("*1", "").replace("1*", "");

    // Remove +0
    result = result.replace("+0", "");

    // Clean up double signs
    result = result.replace("+-", "-").replace("--", "+");

    // Remove leading +
    if result.starts_with('+') {
        result = result[1..].to_string();
    }

    if result.is_empty() {
        "0".to_string()
    } else {
        result
    }
}

/// Convert an expression to LaTeX.
fn expression_to_latex(expr: &str) -> String {
    let latex = expr.to_string();

    // Replace ^ with LaTeX superscript notation
    // Simple case: x^n -> x^{n}
    let mut result = String::new();
    let chars: Vec<char> = latex.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '^' {
            result.push('^');
            result.push('{');
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_digit() || chars[i] == '.' || chars[i] == '-')
            {
                result.push(chars[i]);
                i += 1;
            }
            result.push('}');
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }

    // Replace * with \cdot
    result = result.replace("*", "\\cdot ");

    // Replace fractions a/b with \frac{a}{b}
    if let Some(slash_pos) = find_operator(&result, '/') {
        let numerator = &result[..slash_pos];
        let denominator = &result[slash_pos + 1..];
        if !numerator.is_empty() && !denominator.is_empty() {
            result = format!("\\frac{{{}}}{{{}}}", numerator, denominator);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivative_of_polynomial() {
        let result = compute_derivative("x^3", "x").unwrap();
        assert_eq!(result.result, "3*x^2");
        assert_eq!(result.confidence, 0.9);
    }

    #[test]
    fn derivative_of_constant() {
        let result = compute_derivative("5", "x").unwrap();
        assert_eq!(result.result, "0");
    }

    #[test]
    fn derivative_of_linear() {
        let result = compute_derivative("3*x", "x").unwrap();
        assert_eq!(result.result, "3");
    }

    #[test]
    fn derivative_of_sum() {
        let result = compute_derivative("x^2+3*x+1", "x").unwrap();
        assert_eq!(result.result, "2*x+3");
    }

    #[test]
    fn derivative_of_sin() {
        let result = compute_derivative("sin(x)", "x").unwrap();
        assert_eq!(result.result, "cos(x)");
    }

    #[test]
    fn derivative_of_cos() {
        let result = compute_derivative("cos(x)", "x").unwrap();
        assert_eq!(result.result, "-sin(x)");
    }

    #[test]
    fn evaluate_polynomial() {
        let result = compute_evaluate("x^2+2*x+1", "x", Some(3.0)).unwrap();
        assert_eq!(result.result, "16");
    }

    #[test]
    fn evaluate_trig() {
        let result = compute_evaluate("sin(x)", "x", Some(0.0)).unwrap();
        assert_eq!(result.result, "0");
    }

    #[test]
    fn limit_at_continuous_point() {
        let result = compute_limit("x^2+1", "x", Some(2.0)).unwrap();
        assert_eq!(result.result, "5");
    }

    #[test]
    fn integral_of_polynomial() {
        let result = compute_integral("x^2", "x").unwrap();
        assert!(result.result.contains("x^3"));
        assert!(result.result.contains("+ C"));
    }

    #[test]
    fn solve_linear_equation() {
        let result = compute_solve("2*x+3=7", "x").unwrap();
        assert_eq!(result.result, "x = 2");
    }

    #[test]
    fn simplify_expression_removes_extras() {
        let result = compute_simplify("x*1+0").unwrap();
        assert_eq!(result.result, "x");
    }

    #[test]
    fn format_number_integers() {
        assert_eq!(format_number(5.0), "5");
        assert_eq!(format_number(-3.0), "-3");
    }

    #[test]
    fn format_number_decimals() {
        assert_eq!(format_number(2.5), "2.5");
        assert_eq!(format_number(3.125), "3.125");
    }
}
