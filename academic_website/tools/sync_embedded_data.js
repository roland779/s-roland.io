const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const htmlPath = path.join(root, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");

for (const [id, file] of [
  ["i18nData", "i18n.json"],
  ["pubData", "publications.json"]
]) {
  const data = JSON.parse(fs.readFileSync(path.join(root, "academic_website", "data", file), "utf8"));
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const pattern = new RegExp(`(<script id="${id}" type="application/json">)[\\s\\S]*?(</script>)`, "g");
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${id} script, found ${matches.length}`);
  html = html.replace(pattern, (_, open, close) => `${open}${json}${close}`);
}

fs.writeFileSync(htmlPath, html, "utf8");
