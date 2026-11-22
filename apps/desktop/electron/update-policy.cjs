"use strict";

/** Only the enabled automatic-update preference authorizes background downloads. */
function shouldDownloadAvailableUpdate({ enabled }) {
  return enabled === true;
}

module.exports = { shouldDownloadAvailableUpdate };
