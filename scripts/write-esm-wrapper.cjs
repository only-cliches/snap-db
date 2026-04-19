const fs = require("fs");
const path = require("path");

const outFile = path.join(__dirname, "..", "bin", "src", "index.mjs");
const source = [
  'import { createRequire } from "module";',
  "",
  "const require = createRequire(import.meta.url);",
  'const cjs = require("./index.js");',
  "",
  "export const SnapDB = cjs.SnapDB;",
  "export default cjs.SnapDB;",
  ""
].join("\n");

fs.writeFileSync(outFile, source, "utf-8");
