
const fs = require("fs");
const glob = require("glob");

const files = glob.sync("data/**/*.json");
for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  let modified = false;

  // Fix lim_{...} - match until Chinese character or end of sentence
  const limRegex = /(?<!\$)(lim_\{[^\}]+\}[^。，\u4e00-\u9fa5]+)/g;
  if (limRegex.test(content)) {
    content = content.replace(limRegex, "$$$1$$");
    modified = true;
  }
  
  if (modified) {
    fs.writeFileSync(file, content, "utf8");
    console.log("Updated", file);
  }
}

