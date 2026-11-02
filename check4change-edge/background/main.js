/* Check4Change for Microsoft Edge — service worker main.
 * Based on background/main.js of Check4Change by Ronen Zilberman (GPLv3).
 * Modified in 2026: Manifest V3 port; check4change.com integration (ids,
 * cookies, VIP, e-mail, statistics, first-run page, feedback links) removed;
 * UI language switch added.
 *
 * Every event listener is registered synchronously at the top level, as a
 * Manifest V3 service worker requires.
 */

var _c4cLangPromise = c4cLoadLang();
function c4cLangReady() {
    return _c4cLangPromise;
}

//////////////////////////////////////////
// Parameters

function c4cParams_getHardDefaults() {
    return {
        duration: 30,
        units: "seconds",
        delayDuration: 3,
        doRandom: false,
        randomPercentage: 30,
        doContinue: false,
        dontReload: false,
        notifyPopup: true,
        notifySound: true,
        notifyFocus: false,
        soundFile: "change.mp3",
        volume: 0.5,
        audioLoop: false,
        noOverlay: false,
        doAnimation: true,
        checkHTML: false
    };
}

var C4C_BOOL_PARAMS = ["doRandom", "doContinue", "dontReload", "notifyPopup", "notifySound",
    "notifyFocus", "audioLoop", "noOverlay", "doAnimation", "checkHTML"];

// Accepts parameters from a form (strings, booleans) and returns a clean copy.
function sanitizeParams(p) {
    var d = c4cParams_getHardDefaults();
    var o = {};
    p = p || {};
    for (var k in d) o[k] = (k in p) ? p[k] : d[k];

    C4C_BOOL_PARAMS.forEach(function (key) {
        o[key] = (o[key] === true || o[key] === "true");
    });

    var dur = parseInt(o.duration, 10);
    o.duration = dur > 0 ? dur : d.duration;
    if (["seconds", "minutes", "hours"].indexOf(o.units) < 0) o.units = d.units;

    var settle = parseInt(o.delayDuration, 10);
    o.delayDuration = settle >= 0 ? Math.min(settle, 600) : d.delayDuration;

    var rp = parseInt(o.randomPercentage, 10);
    o.randomPercentage = rp >= 0 ? Math.min(rp, 100) : d.randomPercentage;

    var vol = parseFloat(o.volume);
    o.volume = isNaN(vol) ? d.volume : Math.min(1, Math.max(0, vol));

    if (o.soundFile !== "custom" && C4C_BUILTIN_SOUNDS.indexOf(o.soundFile) < 0) o.soundFile = d.soundFile;
    return o;
}

async function getSystemDefaultParams() {
    var r = await chrome.storage.local.get("defaultParams");
    return sanitizeParams(r.defaultParams || {});
}

async function setSystemDefaultParams(params) {
    await chrome.storage.local.set({defaultParams: sanitizeParams(params)});
}

///////////////////////////////////////////////////////////////
// In-page dialogs

// Opens the tutorial / settings / overlay dialog in the tab.
async function openDialogInTab(tabId, cmd) {
    try {
        await sendCmdToTab(tabId, cmd, {tabId: tabId});
        return true;
    } catch (e) {
        debug("can't open dialog", e);
        await c4cLangReady();
        showInfoNotification(c4cT("cannotRunHere"));
        return false;
    }
}

//************************* Context menu *******/

var C4C_QUICK = [[30, "seconds"], [5, "minutes"], [15, "minutes"], [60, "minutes"], [4, "hours"]];
var _c4cMenuChain = Promise.resolve();

function _c4cMenuCreate(props) {
    return new Promise(function (resolve) {
        chrome.contextMenus.create(props, function () {
            void chrome.runtime.lastError;
            resolve();
        });
    });
}

function createContextMenu() {
    _c4cMenuChain = _c4cMenuChain.then(async function () {
        await c4cLangReady();
        await chrome.contextMenus.removeAll();

        await _c4cMenuCreate({id: "stop", title: c4cT("menuStop"), contexts: ["all"]});
        await _c4cMenuCreate({id: "markSelection", title: c4cT("menuMark"), contexts: ["all"]});
        await _c4cMenuCreate({id: "sep1", type: "separator", contexts: ["all"]});

        for (var i = 0; i < C4C_QUICK.length; i++) {
            var n = C4C_QUICK[i][0], units = C4C_QUICK[i][1];
            await _c4cMenuCreate({
                id: "quick_" + n + "_" + units,
                title: c4cT("menuQuick", {n: n, unit: c4cUnitWord(n, units)}),
                contexts: ["all"]
            });
        }

        await _c4cMenuCreate({id: "custom", title: c4cT("menuCustom"), contexts: ["all"]});
    }).catch(function (e) { error("createContextMenu", e); });

    return _c4cMenuChain.then(function () { return updateContextMenu(); });
}

// The menu is global, so it reflects the active tab.
async function updateContextMenu(tabId) {
    try {
        var tabs = await chrome.tabs.query({active: true, lastFocusedWindow: true});
        if (tabs.length) tabId = tabs[0].id;
        if (tabId == null) return;

        var job = await jobGet(tabId);
        var running = !!job;
        await c4cLangReady();

        await chrome.contextMenus.update("stop", {enabled: running});
        await chrome.contextMenus.update("markSelection", {enabled: running});
        await chrome.contextMenus.update("custom", {title: running ? c4cT("menuUpdate") : c4cT("menuCustom")});
    } catch (e) {
        debug("updateContextMenu", e);
    }
}

async function handleMenuClick(info, tab) {
    if (!tab || tab.id == null || tab.id < 0) return;
    var tabId = tab.id;
    var job = await jobGet(tabId);
    var hasSelection = (await getFramesWithSelection(tabId)).length > 0;

    switch (info.menuItemId) {
        case "custom":
            if (!hasSelection) {
                if (job) {
                    await restoreJobSelection(tabId);
                } else {
                    await openDialogInTab(tabId, "openTutorial");
                    return;
                }
            }
            await openDialogInTab(tabId, "openSettingsDialog");
            return;
        case "stop":
            await sendCmdToTabNoInject(tabId, "closeLightbox");
            await stopJob(tabId);
            return;
        case "markSelection":
            if (job) await restoreJobSelection(tabId);
            return;
    }

    var m = /^quick_(\d+)_(\w+)$/.exec(String(info.menuItemId));
    if (m) {
        var params = await getSystemDefaultParams();
        params.duration = parseInt(m[1], 10);
        params.units = m[2];

        if (job && !hasSelection) {
            await restoreJobSelection(tabId);
        }
        await startJob(tabId, params);
    }
}

//************************* Toolbar button *******/

async function handleActionButtonClick(tab) {
    if (!tab || tab.id == null) return;
    await stopAlert(tab.id);

    // if there's a job running, show its status
    var job = await jobGet(tab.id);
    if (job) {
        await openDialogInTab(tab.id, "castOverlay");
        return;
    }

    // open dialog or tutorial based on selection
    var frames = await getFramesWithSelection(tab.id);
    await openDialogInTab(tab.id, frames.length ? "openSettingsDialog" : "openTutorial");
}

//********************************************
// Commands from content scripts and dialog pages

// Dialog pages pass the tab id explicitly; content scripts are identified by sender.tab.
function c4cSenderTabId(sender, msg) {
    if (msg && typeof msg.tabId === "number") return msg.tabId;
    if (sender && sender.tab && typeof sender.tab.id === "number") return sender.tab.id;
    return null;
}

var c4cHandlers = {

    // settings dialog
    getSettingsData: async function (dummy, sender, msg) {
        var tabId = c4cSenderTabId(sender, msg);
        var job = await jobGet(tabId);
        var sel = await captureSelection(tabId);
        var url = job ? job.url : (await chrome.tabs.get(tabId)).url;
        return {
            running: !!job,
            url: url,
            params: job ? job.params : await getSystemDefaultParams(),
            selectionText: sel ? sel.lastText : (job ? job.sel.lastText : "")
        };
    },

    // status overlay
    getJob: async function (dummy, sender, msg) {
        var job = await jobGet(c4cSenderTabId(sender, msg));
        if (!job) return null;
        return {url: job.url, params: job.params, text: job.sel.lastText, when: job.when, phase: job.phase};
    },

    startJob: function (params, sender, msg) {
        return startJob(c4cSenderTabId(sender, msg), params);
    },

    reloadJob: async function (dummy, sender, msg) {
        var tabId = c4cSenderTabId(sender, msg);
        await sendCmdToTabNoInject(tabId, "closeLightbox");
        await reloadJobNow(tabId);
    },

    stopJob: async function (dummy, sender, msg) {
        var tabId = c4cSenderTabId(sender, msg);
        await sendCmdToTabNoInject(tabId, "closeLightbox");
        await stopJob(tabId);
    },

    hideOverlay: async function (dummy, sender, msg) {
        var tabId = c4cSenderTabId(sender, msg);
        await sendCmdToTabNoInject(tabId, "closeLightbox");
        await hideJobOverlay(tabId);
    },

    openSettingsDialog: function (dummy, sender, msg) {
        return openDialogInTab(c4cSenderTabId(sender, msg), "openSettingsDialog");
    },

    closeLightBox: function (dummy, sender, msg) {
        return sendCmdToTabNoInject(c4cSenderTabId(sender, msg), "closeLightbox");
    },

    saveDefaults: function (params) {
        return setSystemDefaultParams(params);
    },

    testSound: function (data) {
        return playSound(data && data.soundFile, data && data.volume, false);
    },

    // a click anywhere in a page with our content script
    click: function (dummy, sender, msg) {
        return stopAlert(c4cSenderTabId(sender, msg));
    }
};

//********************************************
// Event listeners (top level)

chrome.runtime.onInstalled.addListener(function () {
    chrome.alarms.clearAll();
    createContextMenu();
});

chrome.runtime.onStartup.addListener(function () {
    // jobs don't survive a browser restart; drop their alarms
    chrome.alarms.clearAll();
    createContextMenu();
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
    handleMenuClick(info, tab).catch(function (e) { error("menu", e); });
});

chrome.action.onClicked.addListener(function (tab) {
    handleActionButtonClick(tab).catch(function (e) { error("action", e); });
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status !== "complete") return;
    onJobTabComplete(tabId, tab.url).catch(function (e) { error("tab complete", e); });
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
    updateContextMenu(activeInfo.tabId);
});

chrome.tabs.onRemoved.addListener(function (tabId) {
    withTabLock(tabId, function () { return dropJob(tabId); });
    clearReqCache(tabId);
});

chrome.alarms.onAlarm.addListener(function (alarm) {
    var tabId = c4cTabIdFromAlarm(alarm.name);
    if (tabId !== null) onJobTimer(tabId);
});

chrome.notifications.onClicked.addListener(function (id) {
    var tabId = c4cTabIdFromNotificationId(id);
    chrome.notifications.clear(id);
    if (tabId === null) return;
    stopAlert(tabId);
    tabBringToFront(tabId);
});

chrome.notifications.onClosed.addListener(function (id, byUser) {
    var tabId = c4cTabIdFromNotificationId(id);
    if (tabId !== null && byUser) stopAlert(tabId);
});

c4cOnLangChange(function () {
    createContextMenu();
});

setupReqCache();
c4cListen(c4cHandlers);
