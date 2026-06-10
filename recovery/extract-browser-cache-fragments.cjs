const fs = require("fs");
const path = require("path");

const roots = [
  "recovery/browser-cache-copies",
].filter((dir) => fs.existsSync(dir));

const terms = [
  "capacityBuilding",
  "fodderFarmers",
  "training_cache",
  "admin-page:capacity-building",
  "admin-page:fodder-farmers",
];

const outDir = "recovery/browser-cache-fragments";
fs.mkdirSync(outDir, { recursive: true });

const files = [];
for (const root of roots) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(ldb|log|txt)$/i.test(entry.name) || /^MANIFEST/i.test(entry.name)) {
        files.push(full);
      }
    }
  }
}

const normalize = (text) =>
  text
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ");

const summary = [];

for (const file of files) {
  const buffer = fs.readFileSync(file);
  const text = buffer.toString("utf8");
  const lower = text.toLowerCase();
  const fileHits = [];

  for (const term of terms) {
    let index = 0;
    const needle = term.toLowerCase();
    while ((index = lower.indexOf(needle, index)) !== -1) {
      const start = Math.max(0, index - 1500);
      const end = Math.min(text.length, index + 40000);
      fileHits.push({ term, index, fragment: normalize(text.slice(start, end)) });
      index += needle.length;
    }
  }

  if (!fileHits.length) continue;

  const base = path
    .relative("recovery/browser-cache-copies", file)
    .replace(/[^a-zA-Z0-9_.-]+/g, "_");
  fileHits.forEach((hit, i) => {
    const out = path.join(outDir, `${base}.${i + 1}.${hit.term.replace(/[^a-zA-Z0-9_-]+/g, "_")}.txt`);
    fs.writeFileSync(out, hit.fragment, "utf8");
    const idCount = (hit.fragment.match(/"id"\s*:\s*"/g) || []).length;
    summary.push({
      term: hit.term,
      file,
      out,
      idCount,
      hasValueArray: hit.fragment.includes('"value":['),
      length: hit.fragment.length,
      preview: hit.fragment.slice(0, 220),
    });
  });
}

summary.sort((a, b) => b.idCount - a.idCount || b.length - a.length);
fs.writeFileSync(
  path.join(outDir, "summary.json"),
  JSON.stringify(summary, null, 2),
  "utf8"
);

for (const item of summary.slice(0, 30)) {
  console.log(`${item.idCount}\t${item.term}\t${item.out}`);
}
console.log(`fragments=${summary.length}`);
