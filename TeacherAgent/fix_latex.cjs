
const fs = require("fs");
const glob = require("glob");

const replacements = [
  // Limits
  { from: /lim_\{x-\>0\}/g, to: "\\\\lim_{x \\\\to 0}" },
  { from: /lim_\{x-\>2\}/g, to: "\\\\lim_{x \\\\to 2}" },
  { from: /lim_\{x-\>1\}/g, to: "\\\\lim_{x \\\\to 1}" },
  { from: /lim_\{x-\>∞\}/g, to: "\\\\lim_{x \\\\to \\\\infty}" },
  { from: /lim_\{x-\>\}/g, to: "\\\\lim_{x \\\\to \\\\infty}" }, // Assuming  is infinity in some encodings
  { from: /lim_\{x→0\}/g, to: "\\\\lim_{x \\\\to 0}" },
  { from: /lim_\{x→\+∞\}/g, to: "\\\\lim_{x \\\\to +\\\\infty}" },
  { from: /lim_\{x→0⁺\}/g, to: "\\\\lim_{x \\\\to 0^+}" },
  { from: /lim_\{x→∞\}/g, to: "\\\\lim_{x \\\\to \\\\infty}" },
  { from: /lim_\{x→a\}/g, to: "\\\\lim_{x \\\\to a}" },
  { from: /lim_\{h→0\}/g, to: "\\\\lim_{h \\\\to 0}" },
  { from: /lim_\{b→\+∞\}/g, to: "\\\\lim_{b \\\\to +\\\\infty}" },
  { from: /lim_\{t→0⁺\}/g, to: "\\\\lim_{t \\\\to 0^+}" },
  { from: /lim_\{\(x,y\)→\(x₀,y₀\)\}/g, to: "\\\\lim_{(x,y) \\\\to (x_0,y_0)}" },
  { from: /lim_\{x0\}/g, to: "\\\\lim_{x \\\\to 0}" }, // Fix typos in mean value theorems
  { from: /lim_\{x\+\}/g, to: "\\\\lim_{x \\\\to +\\\\infty}" },
  { from: /lim_\{x0\?\}/g, to: "\\\\lim_{x \\\\to 0^+}" },

  // Fractions
  { from: /sin x \/ x /g, to: "\\\\frac{\\\\sin x}{x} " },
  { from: /sin x \/ x/g, to: "\\\\frac{\\\\sin x}{x}" },
  { from: /\(x\^2 - 4\) \/ \(x - 2\)/g, to: "\\\\frac{x^2 - 4}{x - 2}" },
  { from: /\(sqrt\(1\+x\) - 1\) \/ x/g, to: "\\\\frac{\\\\sqrt{1+x} - 1}{x}" },
  { from: /\(1 - cos x\) \/ x\^2/g, to: "\\\\frac{1 - \\\\cos x}{x^2}" },
  { from: /\(e\^x - 1\) \/ x/g, to: "\\\\frac{e^x - 1}{x}" },
  { from: /\(3x\^2-1\)\/\(2x\^2\+x\)/g, to: "\\\\frac{3x^2-1}{2x^2+x}" },
  { from: /ln x \/ x/g, to: "\\\\frac{\\\\ln x}{x}" },
  { from: /\(eˣ - 1\) \/ x/g, to: "\\\\frac{e^x - 1}{x}" },
  { from: /\(eˣ - 1 - x\) \/ x²/g, to: "\\\\frac{e^x - 1 - x}{x^2}" },
  { from: /\(e\? - 1\) \/ x/g, to: "\\\\frac{e^x - 1}{x}" },
  { from: /\(e\? - 1 - x\) \/ x2/g, to: "\\\\frac{e^x - 1 - x}{x^2}" },
  { from: /x\^2 sin\(1\/x\)/g, to: "x^2 \\\\sin(\\\\frac{1}{x})" },
  { from: /\(1\+x\)\^\{1\/x\}/g, to: "(1+x)^{\\\\frac{1}{x}}" },

  // Other Math Fixes
  { from: /x·ln x/g, to: "x \\\\ln x" },
  { from: /xln x/g, to: "x \\\\ln x" },
  { from: /∫sin²x dx/g, to: "\\\\int \\\\sin^2 x \\\\, dx" },
  { from: /∫x\^n dx/g, to: "\\\\int x^n \\\\, dx" },
  { from: /∫1\/x dx/g, to: "\\\\int \\\\frac{1}{x} \\\\, dx" },
  { from: /∫e\^x dx/g, to: "\\\\int e^x \\\\, dx" },
  { from: /∫x·e\^x dx/g, to: "\\\\int x e^x \\\\, dx" },
  { from: /∫2x·e\^\(x²\) dx/g, to: "\\\\int 2x e^{x^2} \\\\, dx" },
  { from: /∫2x·cos\(x²\) dx/g, to: "\\\\int 2x \\\\cos(x^2) \\\\, dx" },
  { from: /∫\(3x\+5\)\/\(\(x-1\)\(x\+2\)\) dx/g, to: "\\\\int \\\\frac{3x+5}{(x-1)(x+2)} \\\\, dx" },
  { from: /∫√\(1-x²\) dx/g, to: "\\\\int \\\\sqrt{1-x^2} \\\\, dx" }
];

const files = glob.sync("data/**/*.json");
for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  let modified = false;

  for (const { from, to } of replacements) {
    if (content.match(from)) {
      content = content.replace(from, to);
      modified = true;
    }
  }
  
  if (modified) {
    fs.writeFileSync(file, content, "utf8");
    console.log("Updated", file);
  }
}

