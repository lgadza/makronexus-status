import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");
const css = readFileSync(resolve(root, "public/assets/styles.css"), "utf8");
const js = readFileSync(resolve(root, "public/assets/app.js"), "utf8");

for (const id of [
  "overall-panel",
  "overall-title",
  "overall-message",
  "last-checked",
  "service-list",
  "incidents",
  "continuity-guidance",
  "maintenance",
]) {
  assert(html.includes('id="' + id + '"'), "Missing status hook: " + id);
}

assert(css.includes("Light editorial presentation"), "Editorial theme is missing");
assert(css.includes("background: var(--page);"), "Light page ground is missing");
assert(css.includes(".status-card,\n.timeline-card,"), "Flat status sections are missing");
assert(css.includes("border-bottom: 1px solid var(--line);"), "Section rules are missing");
assert(css.includes("@media (max-width: 720px)"), "Mobile layout is missing");
assert(css.includes("@media (prefers-reduced-motion: reduce)"), "Motion fallback is missing");
assert(js.includes("LIVE_REFRESH_MS"), "Live checks must remain active");
assert(js.includes("PROBE_SEEN_PREFIX"), "Safe observation behaviour must remain active");

process.stdout.write("Status page editorial contract passed.\n");
