/* Check4Change for Microsoft Edge — helpers shared by the service worker,
 * content scripts and extension pages.
 * Based on both/utils-general.js of Check4Change by Ronen Zilberman (GPLv3).
 * Modified in 2026: Firefox wrapper removed (MV3 chrome.* APIs return promises),
 * messaging made safe for several listening contexts, telemetry removed.
 *
 * Only `var` and function declarations: content scripts may be evaluated twice.
 */

// Set to true to get verbose logs in the consoles.
var C4C_DEBUG = false;

function debug() {
    if (!C4C_DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[c4c]");
    console.log.apply(console, args);
}

function error() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[c4c]");
    console.error.apply(console, args);
}

function isUndef(p) { return typeof p === "undefined"; }
function isDef(p) { return !isUndef(p); }

function removeWhitespaceHeader(str) {
    if (str == null) return str;
    return String(str).replace(/^\s+/g, "");
}

function c4cGetNow() {
    return Date.now();
}

// Remaining time in human units. remaining is in seconds.
// shortForm: "5m"; long form: "5 minutes" (localized, with plural forms).
function c4cTimeInUnits(remaining, shortForm) {
    var unit = "seconds";
    if (remaining > 60) {
        remaining = Math.round(remaining / 60);
        unit = "minutes";
    }
    if (remaining > 60) {
        remaining = Math.round(remaining / 60);
        unit = "hours";
    }
    if (shortForm) return remaining + c4cT("short_" + unit);
    return remaining + " " + c4cUnitWord(remaining, unit);
}

//**************** Messaging ***********************
// Every message of the extension looks like {c4c: true, name, data, tabId?}.
// Messages for the offscreen document additionally carry `target: "offscreen"`.
//
// In Chromium a runtime message reaches every extension context at once and the
// first sendResponse wins, so a context answers only commands it has a handler for.

// Returns the registered listener so that it can be removed later.
function c4cListen(handlers) {
    var listener = function (msg, sender, sendResponse) {
        if (!msg || msg.c4c !== true || msg.target) return false;
        var h = handlers[msg.name];
        if (typeof h !== "function") return false;

        var res;
        try {
            res = h.call(handlers, msg.data, sender, msg);
        } catch (e) {
            error("handler " + msg.name + " failed", e);
            sendResponse(null);
            return false;
        }
        Promise.resolve(res).then(function (r) {
            sendResponse(isUndef(r) ? null : r);
        }, function (e) {
            error("handler " + msg.name + " failed", e);
            sendResponse(null);
        });
        return true;
    };
    chrome.runtime.onMessage.addListener(listener);
    return listener;
}

// From a content script or an extension page to the service worker.
function sendCmdToBG(name, data) {
    return chrome.runtime.sendMessage({c4c: true, name: name, data: data});
}

function c4cIsExtensionAlive() {
    try {
        return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}
