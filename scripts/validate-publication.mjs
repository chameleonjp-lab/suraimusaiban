import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const config = JSON.parse(readFileSync("config/production.json", "utf8"));
const html = readFileSync("dist/index.html", "utf8");
const png = readFileSync("dist/social-card.png");
assert.equal(
  config.siteUrl,
  "https://chameleonjp-lab.github.io/suraimusaiban/",
);
assert.equal(config.basePath, "/suraimusaiban/");
assert.match(config.supabasePublishableKey, /^sb_publishable_/);
assert.match(
  html,
  /rel="canonical" href="https:\/\/chameleonjp-lab.github.io\/suraimusaiban\/"/,
);
assert.match(html, /name="twitter:card" content="summary_large_image"/);
assert.match(
  html,
  /property="og:image" content="https:\/\/chameleonjp-lab.github.io\/suraimusaiban\/social-card.png"/,
);
assert.match(html, /src="\/suraimusaiban\/assets\//);
assert.equal(png.subarray(1, 4).toString(), "PNG");
assert.equal(png.readUInt32BE(16), 1732);
assert.equal(png.readUInt32BE(20), 908);
assert(png.length < 5_000_000, "Social image must fit X's image size limit");
const release = JSON.parse(readFileSync("dist/release.json", "utf8"));
assert.equal(release.siteUrl, config.siteUrl);
assert.equal(release.release, config.release);
assert(html.includes(release.commit));
console.log(
  `Publication artifacts verified: canonical URL, subpath assets, X/OGP card, ${png.readUInt32BE(16)}x${png.readUInt32BE(20)} PNG, release ${release.commit}`,
);
