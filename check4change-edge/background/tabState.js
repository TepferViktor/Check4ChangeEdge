/* Check4Change for Microsoft Edge — selection state of a tab.
 * Based on background/tabState.js of Check4Change by Ronen Zilberman (GPLv3).
 * Modified in 2026: rewritten as plain functions over a JSON object so the
 * state can live in chrome.storage.session (the service worker may be stopped
 * at any time); scripting API instead of tabs.executeScript.
 *
 * A selection state looks like:
 *   {frameURL: "top" | <frame url>, ranges: [...], lastText: "...", lastHtmlText: "..."}
 * Only one frame per tab is supported; the topmost frame with a selection wins.
 */

// Frame id that matches the stored frame. Frame ids change between reloads,
// so non-top frames are found by URL. Returns -1 if there is no such frame.
async function selectionFrameId(tabId, frameURL) {
    if (frameURL === "top") return 0;
    var frames = await getTabFrames(tabId);
    var res = (frames || []).filter(function (f) { return f.url === frameURL; });
    if (res.length === 0) return -1;
    return res[0].frameId;
}

async function getSelectionData(tabId, frameId) {
    try {
        var data = await sendCmdToTab(tabId, "getSelectionData", null, frameId);
        if (!data || !data.text) return null;
        return data;
    } catch (e) {
        debug("getSelectionData failed", e);
        return null;
    }
}

// Reads the current selection of the tab. Returns a selection state or null.
async function captureSelection(tabId) {
    var framesWithSelection = await getFramesWithSelection(tabId);
    if (framesWithSelection.length === 0) return null;

    var frameId = Math.min.apply(null, framesWithSelection);
    var frameURL = "top";
    if (frameId !== 0) {
        var frames = await getTabFrames(tabId);
        var f = (frames || []).filter(function (x) { return x.frameId === frameId; })[0];
        if (!f) return null;
        frameURL = f.url;
    }

    var data = await getSelectionData(tabId, frameId);
    if (!data) return null;

    return {
        frameURL: frameURL,
        ranges: data.ranges,
        lastText: data.text,
        lastHtmlText: data.htmlText
    };
}

// Attempts to restore the stored selection ranges in the tab. Returns boolean success.
async function restoreSelection(tabId, sel) {
    if (!sel) return false;
    try {
        var frameId = await selectionFrameId(tabId, sel.frameURL);
        if (frameId === -1) return false;
        return !!(await sendCmdToTab(tabId, "recreateSelection", sel.ranges, frameId));
    } catch (e) {
        debug("restoreSelection failed", e);
        return false;
    }
}

// Updates the stored snapshot of the text and reports whether it changed.
// Mutates sel. Returns {changed, lost, newText}; lost = the text could not be found.
async function updateAndHasChanged(tabId, sel, checkHTML) {
    var ok = await restoreSelection(tabId, sel);
    if (!ok) return {changed: true, lost: true, newText: null};

    var frameId = await selectionFrameId(tabId, sel.frameURL);
    var data = (frameId === -1) ? null : await getSelectionData(tabId, frameId);
    if (!data) return {changed: true, lost: true, newText: null};

    var newText = data.text;
    var oldText = sel.lastText;
    if (checkHTML === true) {
        newText = data.htmlText;
        oldText = sel.lastHtmlText;
    }

    // compare without whitespace, it tends to change between loads
    var result = (String(newText || "").replace(/\s/g, "") !== String(oldText || "").replace(/\s/g, ""));

    // store last seen text
    sel.lastText = data.text;
    sel.lastHtmlText = data.htmlText;

    return {changed: result, lost: false, newText: data.text};
}
