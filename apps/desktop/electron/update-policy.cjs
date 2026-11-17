"use strict";

/** Automatic checks can download unless the user opted out; explicit checks always may. */
function shouldDownloadAvailableUpdate({ enabled, manualCheck }) {
  return enabled === true || manualCheck === true;
}

module.exports = { shouldDownloadAvailableUpdate };
