/* Check4Change for Microsoft Edge — monitoring jobs.
 * Based on background/c4cJob.js of Check4Change by Ronen Zilberman (GPLv3).
 * Modified in 2026: Manifest V3 port.
 *
 * A Manifest V3 service worker is stopped after ~30 s of inactivity, so a job
 * is a plain JSON object kept in chrome.storage.session ("job:<tabId>") and the
 * waiting is done by chrome.alarms. Waits shorter than 30 s also get a
 * setTimeout (fires before the worker can be stopped); the alarm then serves
 * as a safety net. Jobs live until the browser is closed, like in the original.
 *
 * Job phases:
 *   waiting   — counting down to the next reload (deadline = when)
 *   reloading — reload issued, waiting for the page to finish loading
 *               (deadline = watchdog: check anyway if the page never finishes)
 *   settling  — page loaded, waiting delayDuration seconds before checking
 *
 * Every scheduling bumps job.seq, so stale timers are ignored. All work on a
 * job runs under a per-tab lock.
 */

var C4C_SHORT_TIMER_LIMIT = 30 * 1000;
var C4C_BACKSTOP_GRACE = 2 * 1000;
var C4C_RELOAD_WATCHDOG = 2 * 60 * 1000;
var C4C_MAX_INTERVAL = 30 * 24 * 3600 * 1000;
var C4C_MIN_RANDOM_INTERVAL = 5 * 1000;

var _c4cTimers = new Map();
var _c4cLocks = new Map();

function c4cJobKey(tabId) { return "job:" + tabId; }
function c4cAlarmName(tabId) { return "c4c:" + tabId; }

function c4cTabIdFromAlarm(name) {
    var m = /^c4c:(\d+)$/.exec(name || "");
    return m ? parseInt(m[1], 10) : null;
}

//********************************************
// Storage

async function jobGet(tabId) {
    if (tabId == null) return null;
    var key = c4cJobKey(tabId);
    var r = await chrome.storage.session.get(key);
    return r[key] || null;
}

async function jobPut(job) {
    var obj = {};
    obj[c4cJobKey(job.tabId)] = job;
    await chrome.storage.session.set(obj);
}

async function jobDel(tabId) {
    await chrome.storage.session.remove(c4cJobKey(tabId));
}

async function jobAll() {
    var all = await chrome.storage.session.get(null);
    return Object.keys(all).filter(function (k) { return k.indexOf("job:") === 0; })
        .map(function (k) { return all[k]; });
}

// Serializes all work on one tab.
function withTabLock(tabId, fn) {
    var prev = _c4cLocks.get(tabId) || Promise.resolve();
    var run = prev.then(function () { return fn(); });
    var tail = run.catch(function (e) { error("job task failed", e); });
    _c4cLocks.set(tabId, tail);
    tail.then(function () {
        if (_c4cLocks.get(tabId) === tail) _c4cLocks.delete(tabId);
    });
    return run;
}

//********************************************
// Timing

function nextRefreshInterval(params) {
    var time = parseInt(params.duration, 10);
    if (!(time > 0)) time = 30;
    if (params.units === "hours") time *= 3600;
    if (params.units === "minutes") time *= 60;
    time = time * 1000;

    if (params.doRandom) {
        var p = Math.min(100, Math.max(0, parseInt(params.randomPercentage, 10) || 0)) / 100.0;
        // the original clamped at 5 milliseconds; 5 seconds was meant
        var minTime = Math.max((1 - p) * time, Math.min(C4C_MIN_RANDOM_INTERVAL, time));
        var maxTime = (1 + p) * time;

        // a random value between minTime and maxTime
        time = Math.floor(minTime + Math.random() * (maxTime - minTime));
    }

    if (time > C4C_MAX_INTERVAL) time = C4C_MAX_INTERVAL;
    return time;
}

function clearJobTimers(tabId) {
    var tid = _c4cTimers.get(tabId);
    if (tid) clearTimeout(tid);
    _c4cTimers.delete(tabId);
    return chrome.alarms.clear(c4cAlarmName(tabId)).catch(function () {});
}

// Arms the timer for job.deadline.
async function scheduleTimer(job) {
    var tabId = job.tabId;
    var old = _c4cTimers.get(tabId);
    if (old) clearTimeout(old);
    _c4cTimers.delete(tabId);

    var delay = Math.max(0, job.deadline - Date.now());
    var alarmWhen = job.deadline;

    if (delay < C4C_SHORT_TIMER_LIMIT) {
        var seq = job.seq;
        var tid = setTimeout(function () {
            if (_c4cTimers.get(tabId) === tid) _c4cTimers.delete(tabId);
            onJobTimer(tabId, seq);
        }, delay);
        _c4cTimers.set(tabId, tid);
        alarmWhen = job.deadline + C4C_BACKSTOP_GRACE;
    }

    await chrome.alarms.create(c4cAlarmName(tabId), {when: Math.max(alarmWhen, Date.now() + 500)});
}

// Called by setTimeout (with seq) or by chrome.alarms (without seq).
function onJobTimer(tabId, seq) {
    return withTabLock(tabId, async function () {
        var job = await jobGet(tabId);
        if (!job) {
            await clearJobTimers(tabId);
            return;
        }
        if (isDef(seq) && seq !== job.seq) return; // stale timer

        // an early or stale alarm: re-arm for the current deadline
        if (Date.now() < job.deadline - 250) {
            await scheduleTimer(job);
            return;
        }

        if (!(await isTabIdValid(tabId))) {
            await dropJob(tabId);
            return;
        }

        debug("timer", tabId, job.phase);
        if (job.phase === "waiting") {
            await doReload(job);
        } else if (job.phase === "reloading") {
            // watchdog: the page never finished loading
            await beginCheck(job);
        } else if (job.phase === "settling") {
            await performCheck(job);
        }
    });
}

//********************************************
// Job steps (all called under the tab lock)

async function updateTabVisuals(job) {
    var tabId = job.tabId;
    try {
        if (job.alerting && job.params.doAnimation) {
            await sendCmdToTab(tabId, "startAnimation");
        } else {
            await sendCmdToTab(tabId, "setFavicon", c4cIconUrl("c4c.ico"));
        }
        await sendCmdToTab(tabId, "startTitleCountdown", job.when);

        if (!job.params.noOverlay) {
            await sendCmdToTab(tabId, "castOverlay", {tabId: tabId});
        }
    } catch (e) {
        // the page can't be scripted right now (error page, still loading...)
        debug("updateTabVisuals failed", e);
    }
}

async function scheduleWait(job) {
    job.phase = "waiting";
    job.seq++;
    job.when = c4cGetNow() + nextRefreshInterval(job.params);
    job.deadline = job.when;
    await jobPut(job);
    await scheduleTimer(job);
    await updateTabVisuals(job);
}

async function doReload(job) {
    debug("doReload", job.tabId);

    if (job.params.dontReload) {
        // skip straight to the check
        await performCheck(job);
        return;
    }

    job.phase = "reloading";
    job.seq++;
    job.when = 0; // the timer is stopped
    job.deadline = c4cGetNow() + C4C_RELOAD_WATCHDOG;
    await jobPut(job);
    await scheduleTimer(job);

    try {
        var tab = await chrome.tabs.get(job.tabId);

        if (job.POSTData) {
            try {
                await sendCmdToTab(job.tabId, "doPOST", {url: job.url, POSTData: job.POSTData});
                return;
            } catch (e) {
                debug("POST replay failed, falling back to GET", e);
            }
        }

        if (stripHash(tab.url) === stripHash(job.url) && !job.wasPost) {
            // keeps the original Referer, doesn't add history entries
            await chrome.tabs.reload(job.tabId);
        } else {
            // the user navigated away in this tab: go back to the monitored page.
            // Also used for a POST page whose body can't be replayed: reloading it
            // would stop at the browser's "Confirm form resubmission" prompt.
            await chrome.tabs.update(job.tabId, {url: job.url});
        }
    } catch (e) {
        error("reload failed", e);
    }
}

// The page has loaded: wait for it to settle, then check.
async function beginCheck(job) {
    if (job.params.dontReload) {
        await performCheck(job);
        return;
    }

    var settle = parseFloat(job.params.delayDuration);
    if (!(settle >= 0)) settle = 0;

    job.phase = "settling";
    job.seq++;
    job.when = 0;
    job.deadline = c4cGetNow() + settle * 1000;
    await jobPut(job);
    await scheduleTimer(job);
}

async function performCheck(job) {
    debug("performCheck", job.tabId);

    var r = await updateAndHasChanged(job.tabId, job.sel, job.params.checkHTML === true);
    debug("changed:", r.changed, "lost:", r.lost);

    if (!r.changed) {
        await scheduleWait(job);
        return;
    }

    if (job.params.doContinue) {
        if (job.params.doAnimation) job.alerting = true;
        await scheduleWait(job);
    } else {
        await stopJobLocked(job.tabId);
    }
    await notifyChange(job, r);
}

async function notifyChange(job, r) {
    await c4cLangReady();
    var p = job.params;

    var text = r.lost ? c4cT("textLost") : (removeWhitespaceHeader(r.newText || "") || c4cT("textEmpty"));

    if (p.notifyPopup && !p.notifyFocus) {
        showNotification(job.tabId, c4cT("notifyTitle"), text);
    }
    if (p.notifySound) {
        playSound(p.soundFile, p.volume, p.audioLoop);
    }
    if (p.notifyFocus) {
        tabBringToFront(job.tabId);
    }
    if (p.doAnimation) {
        try {
            await sendCmdToTab(job.tabId, "startAnimation");
        } catch (e) {
            debug("animation failed", e);
        }
    }
}

// Removes the job and undoes the tab visuals.
async function stopJobLocked(tabId) {
    await clearJobTimers(tabId);
    var job = await jobGet(tabId);
    if (!job) return;

    await jobDel(tabId);
    try { await chrome.tabs.update(tabId, {autoDiscardable: true}); } catch (e) {}

    await sendCmdToTabNoInject(tabId, "stopTitleCountdown");
    await sendCmdToTabNoInject(tabId, "resetFavicon");
    await sendCmdToTabNoInject(tabId, "uncastOverlay");
    updateContextMenu(tabId);
}

// The tab is gone: forget the job.
async function dropJob(tabId) {
    await clearJobTimers(tabId);
    await jobDel(tabId);
}

//********************************************
// Public API (takes the tab lock)

function startJob(tabId, params) {
    return withTabLock(tabId, async function () {
        await sendCmdToTabNoInject(tabId, "closeLightbox");

        var sel = await captureSelection(tabId);
        if (!sel) {
            debug("no selection");
            await openDialogInTab(tabId, "openTutorial");
            return false;
        }

        var tab = await chrome.tabs.get(tabId);
        var old = await jobGet(tabId);
        var req = await getTabRequestInfo(tabId, tab.url);

        var job = {
            tabId: tabId,
            url: tab.url,
            params: sanitizeParams(params),
            sel: sel,
            POSTData: req.POSTData,
            wasPost: req.wasPost,
            phase: "waiting",
            seq: old ? (old.seq || 0) + 1 : 1,
            when: 0,
            deadline: 0,
            alerting: false,
            startedAt: c4cGetNow()
        };

        // keep the tab from being discarded while it's monitored
        try { await chrome.tabs.update(tabId, {autoDiscardable: false}); } catch (e) {}

        await scheduleWait(job);
        updateContextMenu(tabId);
        return true;
    });
}

function stopJob(tabId) {
    return withTabLock(tabId, function () { return stopJobLocked(tabId); });
}

function reloadJobNow(tabId) {
    return withTabLock(tabId, async function () {
        var job = await jobGet(tabId);
        if (job) await doReload(job);
    });
}

function hideJobOverlay(tabId) {
    return withTabLock(tabId, async function () {
        var job = await jobGet(tabId);
        if (!job) return;
        job.params.noOverlay = true;
        await jobPut(job);
    });
}

// Restores the monitored selection in the page (context menu "Mark monitored text").
async function restoreJobSelection(tabId) {
    var job = await jobGet(tabId);
    if (!job) return false;
    return restoreSelection(tabId, job.sel);
}

// The user has seen the alert: stop the sound and the dancing icon.
function stopAlert(tabId) {
    var p = playSoundStop();
    if (tabId == null) return p;
    return withTabLock(tabId, async function () {
        await p;
        var job = await jobGet(tabId);
        if (job && job.alerting) {
            job.alerting = false;
            await jobPut(job);
        }
        await sendCmdToTabNoInject(tabId, "stopAnimation");
        if (job) await sendCmdToTabNoInject(tabId, "setFavicon", c4cIconUrl("c4c.ico"));
    });
}

// Tab finished loading.
function onJobTabComplete(tabId, url) {
    return withTabLock(tabId, async function () {
        var job = await jobGet(tabId);
        if (!job) return;
        debug("tab complete", tabId, job.phase, url);

        await updateTabVisuals(job);

        if (job.phase === "reloading" || job.phase === "settling") {
            // our reload (or a redirect while settling): (re)start the settle wait
            await beginCheck(job);
            return;
        }

        // waiting: the page was loaded by the user or by itself
        if (stripHash(url) === stripHash(job.url)) {
            await beginCheck(job);
        }
        // otherwise the user navigated away; the timer will bring the page back
    });
}
