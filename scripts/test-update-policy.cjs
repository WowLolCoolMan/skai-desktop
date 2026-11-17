const assert = require("node:assert/strict");
const { shouldDownloadAvailableUpdate } = require("../apps/desktop/electron/update-policy.cjs");

assert.equal(shouldDownloadAvailableUpdate({ enabled: true, manualCheck: false }), true, "automatic checks download when enabled");
assert.equal(shouldDownloadAvailableUpdate({ enabled: false, manualCheck: false }), false, "in-flight automatic checks respect a later opt-out");
assert.equal(shouldDownloadAvailableUpdate({ enabled: false, manualCheck: true }), true, "manual checks work with automatic checks disabled");
console.log("Update policy checks passed.");
