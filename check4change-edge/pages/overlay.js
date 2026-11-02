/* Check4Change for Microsoft Edge — status dialog shown while a tab is monitored.
 * Based on pages/overlay.js of Check4Change by Ronen Zilberman (GPLv3).
 * Modified in 2026: the countdown follows the job in chrome.storage.session
 * instead of messages from the background page. */

var when = 0;

function showTimeRemaining() {
    var remaining = Math.round((when - Date.now()) / 1000);
    var str = remaining > 1 ? c4cTimeInUnits(remaining, false) : c4cT("waiting");
    $(".data-time-remaining").text(str);
}

async function setupDialog() {
    var job = await sendCmdToBG("getJob");
    if (!job) return;

    when = job.when || 0;
    $(".data-text").val(removeWhitespaceHeader(job.text || ""));
    showTimeRemaining();
}

function handleDialog() {
    $("#reload").click(function () {
        sendCmdToBG("reloadJob");
    });
    $("#stop").click(function () {
        sendCmdToBG("stopJob");
    });
    $("#hide").click(function () {
        sendCmdToBG("hideOverlay");
    });
    $("#update").click(function () {
        sendCmdToBG("openSettingsDialog");
    });

    // the job is rescheduled after every reload
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== "session" || C4C_TAB_ID === null) return;
        var c = changes["job:" + C4C_TAB_ID];
        if (!c || !c.newValue) return;
        when = c.newValue.when || 0;
        var sel = c.newValue.sel;
        if (sel) $(".data-text").val(removeWhitespaceHeader(sel.lastText || ""));
        showTimeRemaining();
    });

    setInterval(showTimeRemaining, 300);
}

async function start() {
    await c4cPageI18n(showTimeRemaining);
    handleDialog();
    await setupDialog();
}

start();
