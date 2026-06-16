const fs = require("fs");
const path = require("path");

const rootExportPath = path.resolve("genco-company-default-rtdb-export (6).json");
const liveCapacityPath = path.resolve("recovery/live-capacityBuilding-before-merge-2026-06-08.json");
const liveFodderPath = path.resolve("recovery/live-fodderFarmers-before-merge-2026-06-08.json");

const readJson = (file) => {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text || text === "null") return {};
  return JSON.parse(text);
};

const asObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
};

const root = readJson(rootExportPath);
const liveCapacity = asObject(readJson(liveCapacityPath));
const liveFodder = asObject(readJson(liveFodderPath));

const exportedCapacity = asObject(root.capacityBuilding);
const exportedFodder = asObject(root.fodderFarmers);

const missingFrom = (source, live) => {
  const missing = {};
  for (const [id, record] of Object.entries(source)) {
    if (!(id in live)) {
      missing[id] = record;
    }
  }
  return missing;
};

const missingCapacity = missingFrom(exportedCapacity, liveCapacity);
const missingFodder = missingFrom(exportedFodder, liveFodder);

fs.mkdirSync("recovery", { recursive: true });
fs.writeFileSync(
  "recovery/missing-capacityBuilding-from-export-6.json",
  JSON.stringify(missingCapacity, null, 2),
  "utf8"
);
fs.writeFileSync(
  "recovery/missing-fodderFarmers-from-export-6.json",
  JSON.stringify(missingFodder, null, 2),
  "utf8"
);

const combined = {};
for (const [id, record] of Object.entries(missingCapacity)) {
  combined[`capacityBuilding/${id}`] = record;
}
for (const [id, record] of Object.entries(missingFodder)) {
  combined[`fodderFarmers/${id}`] = record;
}

fs.writeFileSync(
  "recovery/capacity-fodder-merge-update-2026-06-08.json",
  JSON.stringify(combined, null, 2),
  "utf8"
);

const summarize = (name, data) => {
  const entries = Object.entries(data);
  console.log(`${name}_COUNT=${entries.length}`);
  console.log(
    `${name}_SAMPLE=${entries
      .slice(0, 5)
      .map(([id, record]) => {
        const programme = record.programme || record.Programme || "";
        const label =
          record.topicTrained ||
          record.topicDiscussed ||
          record.location ||
          record.Location ||
          record.username ||
          "";
        return `${id}:${programme}:${String(label).slice(0, 35)}`;
      })
      .join(" | ")}`
  );
};

console.log(`EXPORT_CAPACITY_COUNT=${Object.keys(exportedCapacity).length}`);
console.log(`LIVE_CAPACITY_COUNT=${Object.keys(liveCapacity).length}`);
summarize("MISSING_CAPACITY", missingCapacity);
console.log(`EXPORT_FODDER_COUNT=${Object.keys(exportedFodder).length}`);
console.log(`LIVE_FODDER_COUNT=${Object.keys(liveFodder).length}`);
summarize("MISSING_FODDER", missingFodder);
console.log(`COMBINED_UPDATE_COUNT=${Object.keys(combined).length}`);
