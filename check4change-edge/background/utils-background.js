/* Check4Change for Microsoft Edge — service worker utilities.
 * Based on background/utils-background.js of Check4Change by Ronen Zilberman (GPLv3).
 * Modified in 2026: Manifest V3 port (scripting API, offscreen audio, no
 * blocking webRequest), Referer spoofing removed, e-mail queue removed.
 */

var C4C_CS_CSS = ["libs/featherlight/featherlight.css"];
var C4C_CS_FILES = [
    "libs/featherlight/jquery.min.js",
    "libs/featherlight/featherlight.js",
    "both/i18n.js",
    "both/common.js",
    "both/c4cUti.js",
    "contentscript/c4cSelection.js",
    "contentscript/main.js"
];

function c4cIconUrl(name) {
    return chrome.runtime.getURL("icons/" + (name || "c4c.ico"));
}

async function getCurrentTabId() {
    var d = await chrome.tabs.query({currentWindow: true, active: true});
    return d.length ? d[0].id : null;
}

async function isTabIdValid(tabId) {
    try {
        await chrome.tabs.get(tabId);
        return true;
    } catch (e) {
        return false;
    }
}

function stripHash(url) {
    if (!url) return url;
    var i = url.indexOf("#");
    return i < 0 ? url : url.substring(0, i);
}

////////////////////////////////////////////////////////////////////////////////////
// Content scripts

async function injectContentScripts(tabId, frameId) {
    var target = {tabId: tabId, frameIds: [frameId]};
    await chrome.scripting.insertCSS({target: target, files: C4C_CS_CSS});
    await chrome.scripting.executeScript({target: target, files: C4C_CS_FILES});
}

function _c4cTabMessage(name, data) {
    return {c4c: true, name: name, data: data};
}

// Sends a command to a frame of a tab (top frame by default).
// Injects the content scripts first if they are not there yet.
// Throws if the page can't be scripted (browser pages, add-ons store...).
async function sendCmdToTab(tabId, name, data, frameId) {
    if (isUndef(frameId)) frameId = 0;
    if (tabId === null) tabId = await getCurrentTabId();

    try {
        return await chrome.tabs.sendMessage(tabId, _c4cTabMessage(name, data), {frameId: frameId});
    } catch (e) {
        // not injected yet (or injected by a previous version of the extension)
    }

    await injectContentScripts(tabId, frameId);
    return await chrome.tabs.sendMessage(tabId, _c4cTabMessage(name, data), {frameId: frameId});
}

// Sends a command only if the content scripts are already there. Never throws.
async function sendCmdToTabNoInject(tabId, name, data, frameId) {
    try {
        return await chrome.tabs.sendMessage(tabId, _c4cTabMessage(name, data), {frameId: frameId || 0});
    } catch (e) {
        return undefined;
    }
}

// Ids of the frames that currently have a non-empty selection.
async function getFramesWithSelection(tabId) {
    var results;
    try {
        results = await chrome.scripting.executeScript({
            target: {tabId: tabId, allFrames: true},
            func: function () {
                try {
                    var s = document.getSelection();
                    return !!(s && s.toString());
                } catch (e) {
                    return false;
                }
            }
        });
    } catch (e) {
        return [];
    }
    return results.filter(function (r) { return r && r.result === true; })
        .map(function (r) { return r.frameId; });
}

function getTabFrames(tabId) {
    return chrome.webNavigation.getAllFrames({tabId: tabId});
}

////////////////////////////////////////////////////////////////////////////////////
// Tabs and windows

async function tabBringToFront(tabId) {
    try {
        // set the tab in the foreground of window
        await chrome.tabs.update(tabId, {active: true});

        // bring window to front
        var tab = await chrome.tabs.get(tabId);
        var win = await chrome.windows.get(tab.windowId);
        if (win.focused) return;

        await chrome.windows.update(tab.windowId, {focused: true, drawAttention: true});
        win = await chrome.windows.get(tab.windowId);
        if (win.focused) return;

        // Windows sometimes refuses to focus a background window: minimize and restore it.
        var restoreState = (win.state === "maximized") ? "maximized" : "normal";
        if (win.state !== "minimized") {
            await chrome.windows.update(tab.windowId, {state: "minimized"});
            await new Promise(function (r) { setTimeout(r, 400); });
        }
        for (var i = 0; i < 20; i++) {
            await chrome.windows.update(tab.windowId, {state: restoreState, focused: true, drawAttention: true});
            win = await chrome.windows.get(tab.windowId);
            if (win.focused) break;
            await new Promise(function (r) { setTimeout(r, 100); });
        }
    } catch (e) {
        error("tabBringToFront", e);
    }
}

function openNewTab(url, active) {
    return chrome.tabs.create({url: url, active: active});
}

////////////////////////////////////////////////////////////////////////////////////
// Notifications

function c4cNotificationId(tabId) {
    return "c4c:" + tabId;
}

function c4cTabIdFromNotificationId(id) {
    var m = /^c4c:(\d+)$/.exec(id || "");
    return m ? parseInt(m[1], 10) : null;
}

function showNotification(tabId, title, message) {
    message = String(message || "");
    if (message.length > 300) message = message.substring(0, 297) + "...";
    return chrome.notifications.create(c4cNotificationId(tabId), {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/c4c-128.png"),
        title: title,
        message: message,
        priority: 2
    }).catch(function (e) { error("notification", e); });
}

// Notification that is not tied to a tab (e.g. "can't work on this page").
function showInfoNotification(message) {
    return chrome.notifications.create("c4c-info:" + Date.now(), {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/c4c-128.png"),
        title: "Check4Change",
        message: message
    }).catch(function (e) { error("notification", e); });
}

////////////////////////////////////////////////////////////////////////////////////
// Sound. A service worker has no DOM, so audio plays in an offscreen document.

var C4C_OFFSCREEN_URL = "offscreen/offscreen.html";
var C4C_BUILTIN_SOUNDS = ["change.mp3", "change2.mp3", "change3.mp3", "change4.mp3", "change5.mp3", "change6.mp3"];
var _c4cOffscreenCreating = null;

async function hasOffscreenDocument() {
    var contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL(C4C_OFFSCREEN_URL)]
    });
    return contexts.length > 0;
}

async function ensureOffscreenDocument() {
    if (await hasOffscreenDocument()) return;
    if (!_c4cOffscreenCreating) {
        _c4cOffscreenCreating = chrome.offscreen.createDocument({
            url: C4C_OFFSCREEN_URL,
            reasons: ["AUDIO_PLAYBACK"],
            justification: "Plays the alert sound when a monitored page changes."
        }).finally(function () {
            _c4cOffscreenCreating = null;
        });
    }
    await _c4cOffscreenCreating;
}

async function resolveSoundSource(soundFile) {
    if (soundFile === "custom") {
        var r = await chrome.storage.local.get("customSound");
        if (r.customSound && r.customSound.dataUrl) return r.customSound.dataUrl;
        soundFile = "change.mp3";
    }
    if (C4C_BUILTIN_SOUNDS.indexOf(soundFile) < 0) soundFile = "change.mp3";
    return chrome.runtime.getURL("audio/" + soundFile);
}

async function playSound(soundFile, volume, loop) {
    try {
        var src = await resolveSoundSource(soundFile);
        var vol = parseFloat(volume);
        if (isNaN(vol)) vol = 0.5;
        vol = Math.min(1, Math.max(0, vol));

        await ensureOffscreenDocument();
        await chrome.runtime.sendMessage({
            c4c: true,
            target: "offscreen",
            name: "play",
            data: {src: src, volume: vol, loop: !!loop}
        });
    } catch (e) {
        error("playSound", e);
    }
}

async function playSoundStop() {
    try {
        if (!(await hasOffscreenDocument())) return;
        await chrome.runtime.sendMessage({c4c: true, target: "offscreen", name: "stop"});
    } catch (e) {
        // nothing to stop
    }
}

////////////////////////////////////////////////////////////////////////////////////
// Last main-frame request per tab, to be able to repeat a POST.
// Kept in storage.session because the service worker may be stopped between
// the page load and the moment the user starts monitoring.

function c4cReqKey(tabId) {
    return "req:" + tabId;
}

function setupReqCache() {
    chrome.webRequest.onBeforeRequest.addListener(function (details) {
        if (details.tabId < 0) return;
        var POSTData = null;
        if (details.method === "POST" && details.requestBody && details.requestBody.formData) {
            POSTData = details.requestBody.formData;
        }
        var obj = {};
        obj[c4cReqKey(details.tabId)] = {url: details.url, method: details.method, POSTData: POSTData};
        chrome.storage.session.set(obj).catch(function () {});
    }, {urls: ["<all_urls>"], types: ["main_frame"]}, ["requestBody"]);
}

// How the page now in the tab was requested: {wasPost, POSTData}.
// wasPost without POSTData means a body that can't be replayed (e.g. JSON).
async function getTabRequestInfo(tabId, url) {
    var key = c4cReqKey(tabId);
    var r = await chrome.storage.session.get(key);
    var req = r[key];
    if (!req || (url && stripHash(req.url) !== stripHash(url))) {
        return {wasPost: false, POSTData: null};
    }
    return {wasPost: req.method === "POST", POSTData: req.POSTData || null};
}

function clearReqCache(tabId) {
    return chrome.storage.session.remove(c4cReqKey(tabId)).catch(function () {});
}
