
const fs = require("fs");
const file = "data/questions/linear-algebra-basics.seed.json";
let content = fs.readFileSync(file, "utf8");
content = content.replace(/\\begin\{vmatrix\}/g, "\\\\begin{vmatrix}");
content = content.replace(/\\end\{vmatrix\}/g, "\\\\end{vmatrix}");
// Also the \\ must be \\\\
content = content.replace(/1 \\ 2/g, "1 \\\\\\\\ 2");
fs.writeFileSync(file, content, "utf8");

