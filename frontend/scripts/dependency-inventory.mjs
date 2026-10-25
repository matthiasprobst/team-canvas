import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
function reviewedLicense(path, version) {
  // These releases omit package.json license metadata; verify the bundled license text.
  if (!((path === "node_modules/fuzzy" && version === "0.1.3") || (path === "node_modules/khroma" && version === "2.1.0"))) return "UNKNOWN";
  for (const file of ["LICENSE", "license", "LICENSE.md", "LICENSE-MIT"]) {
    try {
      const contents = readFileSync(new URL(`../${path}/${file}`, import.meta.url), "utf8");
      if (contents.includes("Permission is hereby granted, free of charge") && contents.includes('THE SOFTWARE IS PROVIDED "AS IS"')) return "MIT (bundled license reviewed)";
    } catch { /* Try the next conventional filename. */ }
  }
  return "UNKNOWN";
}
const packages = Object.entries(lock.packages).filter(([path]) => path).map(([path, entry]) => ({
  path, version: entry.version, license: entry.license ?? reviewedLicense(path, entry.version), development: !!entry.dev,
  resolved: entry.resolved, integrity: entry.integrity,
}));
const destination = new URL("../dist/", import.meta.url);
mkdirSync(destination, { recursive: true });
writeFileSync(new URL("dependency-inventory.json", destination), JSON.stringify({ lockfileVersion: lock.lockfileVersion, packages }, null, 2) + "\n");
console.log(`Recorded ${packages.length} resolved packages; ${packages.filter(pkg => pkg.license === "UNKNOWN").length} require license review.`);
