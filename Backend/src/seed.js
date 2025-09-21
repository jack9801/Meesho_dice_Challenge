// reset data/store.json from data/seed.json
const fs = require("fs/promises");
const path = require("path");

(async () => {
  const root = path.join(__dirname, "..");
  const src = path.join(root, "data", "seed.json");
  const dest = path.join(root, "data", "store.json");
  await fs.copyFile(src, dest);
  console.log("Store reset from seed.json");
})();
