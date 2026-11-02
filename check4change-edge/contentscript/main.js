/* Check4Change for Microsoft Edge — content script.
 * Based on contentscript/main.js of Check4Change by Ronen Zilberman (GPLv3).
 * Modified in 2026: Manifest V3 port, tab-icon animation moved here from the
 * background, check4change.com integration removed, safe re-injection.
 *
 * Injected on demand by the service worker (see sendCmdToTab). The isolated
 * world keeps its globals between injections, so all mutable state lives in
 * globalThis.__c4cCS and a previous instance is torn down first.
 */

(function () {
    var prev = globalThis.__c4cCS;
    if (prev && typeof prev.teardown === "function") {
        try { prev.teardown(); } catch (e) {}
    }
    globalThis.__c4cCS = {
        origTitle: prev ? prev.origTitle : null,
        origFavicon: prev ? prev.origFavicon : null,
        countdownTID: null,
        animTID: null,
        animFrame: 1,
        listeners: {}
    };
})();

//********************************
// Favicon

// There are 3 kinds of favicons:
// 1. in a <link>
// 2. not declared so browser gets it from /favicon.ico
// 3. no favicon.ico file on server
function _c4cGetFavicon() {
    var l = document.querySelector("link[rel*='icon']");
    if (l && l.href) return l.href;
    return "/favicon.ico";
}

function c4cDoSetFavicon(url) {
    var cs = globalThis.__c4cCS;
    if (!cs.origFavicon) cs.origFavicon = _c4cGetFavicon();

    var link = document.querySelector("link[rel*='icon']");
    if (!link) {
        link = document.createElement("link");
        (document.head || document.documentElement).appendChild(link);
    }
    link.type = "image/x-icon";
    link.rel = "icon";
    link.href = url;
}

function c4cSetFavicon(url) {
    c4cDoSetFavicon(url);
    setTimeout(function () { c4cDoSetFavicon(url); }, 100);
}

function c4cResetFavicon() {
    var orig = globalThis.__c4cCS.origFavicon;
    if (!orig) return;

    // weird hacks needed for non-existent favicons:
    // set favicon to an empty favicon first, then to the original one.
    c4cDoSetFavicon("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAAZiS0dEAP8A/wD/oL2nkwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB9oFFAADATTAuQQAAAAZdEVYdENvbW1lbnQAQ3JlYXRlZCB3aXRoIEdJTVBXgQ4XAAAAEklEQVQ4y2NgGAWjYBSMAggAAAQQAAGFP6pyAAAAAElFTkSuQmCC");
    setTimeout(function () { c4cDoSetFavicon(orig); }, 100);
}

//********************************
// Tab icon animation (dancing C4C letters)

function c4cStartAnimation() {
    var cs = globalThis.__c4cCS;
    if (cs.animTID) return;
    cs.animTID = setInterval(function () {
        if (!c4cIsExtensionAlive()) { c4cCleanupOrphan(); return; }
        c4cDoSetFavicon(chrome.runtime.getURL("icons/c4c_" + cs.animFrame + ".ico"));
        cs.animFrame = (cs.animFrame % 9) + 1;
    }, 100);
}

// returns true if an animation was running
function c4cStopAnimation(resetIcon) {
    var cs = globalThis.__c4cCS;
    if (!cs.animTID) return false;
    clearInterval(cs.animTID);
    cs.animTID = null;
    if (resetIcon) c4cResetFavicon();
    return true;
}

//********************************
// Title countdown

function c4cOriginalTitle() {
    var cs = globalThis.__c4cCS;
    if (cs.origTitle === null) cs.origTitle = document.title;
    return cs.origTitle;
}

function c4cStartTitleCountdown(when) {
    var cs = globalThis.__c4cCS;
    c4cStopTitleCountdown(false);
    var orig = c4cOriginalTitle();

    var tick = function () {
        if (!c4cIsExtensionAlive()) { c4cCleanupOrphan(); return; }
        var remaining = Math.round((when - Date.now()) / 1000);
        var str = remaining > 1 ? c4cTimeInUnits(remaining, true) : c4cT("waiting");
        document.title = str + "|" + orig;
    };
    tick();
    cs.countdownTID = setInterval(tick, 300);
}

function c4cStopTitleCountdown(restoreTitle) {
    var cs = globalThis.__c4cCS;
    if (cs.countdownTID) clearInterval(cs.countdownTID);
    cs.countdownTID = null;
    if (restoreTitle !== false && cs.origTitle !== null) document.title = cs.origTitle;
}

//********************************
// Lightbox (in-page dialogs)

function c4cOpenLightBox(page, data, width, height) {
    var url = chrome.runtime.getURL(page);
    if (data && data.tabId != null) url += "?tabId=" + encodeURIComponent(data.tabId);

    // if a lightbox is open, if its the same URL do nothing, otherwise close it
    var cur = $.featherlight.current();
    if (cur) {
        if (cur.iframe === url) {
            debug("lightbox already open");
            return;
        }
        c4cCloseLightbox();
    }

    $.featherlight.defaults.closeOnEsc = true;
    $.featherlight.defaults.closeOnClick = "anywhere";
    $.featherlight.defaults.closeIcon = "&#10005;";
    $.featherlight({iframe: url, iframeWidth: width, iframeHeight: height});
}

function c4cCloseLightbox() {
    try { $.featherlight.close(); } catch (e) {}
}

//********************************

// The extension was reloaded or removed: undo everything visible.
function c4cCleanupOrphan() {
    c4cStopAnimation(true);
    c4cStopTitleCountdown(true);
    c4cCloseLightbox();
    var cs = globalThis.__c4cCS;
    if (cs.teardown) cs.teardown();
}

var c4cContentHandlers = {

    getSelectionData: function () {
        return {
            text: getSelectionText(document),
            htmlText: getSelectionHtml(document),
            ranges: getSelectionRanges(document)
        };
    },

    recreateSelection: function (ranges) {
        var doAbsPos = false;
        return recreateSelection(document, ranges, doAbsPos);
    },

    startTitleCountdown: function (when) {
        c4cStartTitleCountdown(when || 0);
        return true;
    },

    stopTitleCountdown: function () {
        c4cStopTitleCountdown(true);
        return true;
    },

    setFavicon: function (url) {
        // the animation owns the icon while it runs
        if (!globalThis.__c4cCS.animTID) c4cSetFavicon(url);
        return true;
    },

    resetFavicon: function () {
        c4cStopAnimation(false);
        c4cResetFavicon();
        return true;
    },

    startAnimation: function () {
        c4cStartAnimation();
        return true;
    },

    stopAnimation: function () {
        c4cStopAnimation(true);
        return true;
    },

    openTutorial: function (data) {
        c4cOpenLightBox("pages/tutorial.html", data, 600, 370);
        return true;
    },

    openSettingsDialog: function (data) {
        c4cOpenLightBox("pages/settingsDialog.html", data, 620, 630);
        return true;
    },

    castOverlay: function (data) {
        c4cOpenLightBox("pages/overlay.html", data, 600, 390);
        return true;
    },

    closeLightbox: function () {
        c4cCloseLightbox();
        return true;
    },

    uncastOverlay: function () {
        c4cCloseLightbox();
        return true;
    },

    // Re-submit the POST form that produced this page.
    doPOST: function (obj) {
        var data = obj.POSTData || {};
        var form = document.createElement("form");
        form.setAttribute("method", "post");
        form.setAttribute("action", obj.url);
        form.style.display = "none";

        for (var key in data) {
            if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
            var values = Array.isArray(data[key]) ? data[key] : [data[key]];
            for (var i = 0; i < values.length; i++) {
                var field = document.createElement("input");
                field.setAttribute("type", "hidden");
                field.setAttribute("name", key);
                field.setAttribute("value", values[i]);
                form.appendChild(field);
            }
        }

        (document.body || document.documentElement).appendChild(form);
        // a field named "submit" would shadow form.submit()
        HTMLFormElement.prototype.submit.call(form);
        return true;
    }
};

function c4cOnPageClick() {
    if (!c4cIsExtensionAlive()) { c4cCleanupOrphan(); return; }
    // stop the dancing icon right away, the service worker stops the sound
    c4cStopAnimation(true);
    sendCmdToBG("click").catch(function () {});
}

(function c4cContentInit() {
    var cs = globalThis.__c4cCS;

    c4cLoadLang();
    cs.listeners.lang = c4cOnLangChange(function () {});
    cs.listeners.message = c4cListen(c4cContentHandlers);
    cs.listeners.click = c4cOnPageClick;
    document.addEventListener("click", cs.listeners.click, true);

    cs.teardown = function () {
        try { chrome.runtime.onMessage.removeListener(cs.listeners.message); } catch (e) {}
        try { chrome.storage.onChanged.removeListener(cs.listeners.lang); } catch (e) {}
        document.removeEventListener("click", cs.listeners.click, true);
        if (cs.countdownTID) clearInterval(cs.countdownTID);
        if (cs.animTID) clearInterval(cs.animTID);
        cs.countdownTID = null;
        cs.animTID = null;
        cs.teardown = null;
    };

    debug("content script ready");
})();
