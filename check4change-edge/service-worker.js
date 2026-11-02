/* Check4Change for Microsoft Edge (Manifest V3).
 * Based on Check4Change by Ronen Zilberman (GPLv3). Modified in 2026: ported to Manifest V3.
 * See LICENSE.txt and README.md.
 *
 * Service worker entry point. Scripts are loaded synchronously so that every
 * event listener is registered during the first turn of the event loop.
 */
importScripts(
    "both/i18n.js",
    "both/common.js",
    "background/utils-background.js",
    "background/tabState.js",
    "background/c4cJob.js",
    "background/main.js"
);
