/* Check4Change for Microsoft Edge — settings dialog.
 * Based on pages/settingsDialog.js of Check4Change by Ronen Zilberman (GPLv3).
 * Modified in 2026: VIP, e-mail and feedback removed, all sounds available,
 * own sound file kept in chrome.storage.local (a File can't be passed through
 * Chromium messages), language switch added.
 */

var C4C_MAX_SOUND_MB = 5;
var settingsData = null;

function getSelectedSound() {
    return $("#soundChoice").val() || "change.mp3";
}

function getFormParams() {
    var base = (settingsData && settingsData.params) ? $.extend({}, settingsData.params) : {};
    var p = formToObj("", base);
    p.soundFile = getSelectedSound();
    return p;
}

// Adds the user's own sound (if any) to the list.
async function refreshCustomSoundOption(selectIt) {
    var r = await chrome.storage.local.get("customSound");
    $("#soundChoice option[value='custom']").remove();
    if (r.customSound && r.customSound.name) {
        $("#soundChoice").append($("<option>", {value: "custom"}).text(r.customSound.name));
        if (selectIt) $("#soundChoice").val("custom");
    }
}

function flashSaved() {
    var note = $("#savedNote");
    note.text(c4cT("saved"));
    clearTimeout(flashSaved._tid);
    flashSaved._tid = setTimeout(function () { note.text(""); }, 2000);
}

function onSoundFileChosen() {
    var input = this;
    var f = input.files && input.files[0];
    $("#fileError").text("");
    if (!f) return;

    if (f.size > C4C_MAX_SOUND_MB * 1024 * 1024) {
        $("#fileError").text(c4cT("fileTooBig", {mb: C4C_MAX_SOUND_MB}));
        input.value = "";
        return;
    }

    var reader = new FileReader();
    reader.onload = async function () {
        try {
            await chrome.storage.local.set({customSound: {name: f.name, dataUrl: reader.result}});
            await refreshCustomSoundOption(true);
        } catch (e) {
            error("saving sound", e);
            $("#fileError").text(c4cT("fileReadError"));
        }
    };
    reader.onerror = function () {
        $("#fileError").text(c4cT("fileReadError"));
    };
    reader.readAsDataURL(f);
    input.value = "";
}

async function setupDialog() {
    settingsData = await sendCmdToBG("getSettingsData");
    if (!settingsData) return;

    $(".data-text").val(removeWhitespaceHeader(settingsData.selectionText || ""));

    if (settingsData.running) {
        $("#start").attr("data-i18n", "update").text(c4cT("update"));
    }

    // set form options from params
    objToForm("", settingsData.params);

    await refreshCustomSoundOption(false);
    var sound = settingsData.params.soundFile;
    if (!$("#soundChoice option[value='" + sound + "']").length) sound = "change.mp3";
    $("#soundChoice").val(sound);

    var r = await chrome.storage.local.get("uiLang");
    $("#uiLang").val(r.uiLang || "auto");
}

function handleSettingsDialog() {
    $(".numeric").on("input", function () {
        var v = parseInt(this.value, 10);
        this.value = isNaN(v) ? "" : v;
    });

    $("#selectfile").click(function () {
        $("#soundFileChooser").click();
    });
    $("#soundFileChooser").change(onSoundFileChosen);

    $("#testSound").click(function () {
        sendCmdToBG("testSound", {soundFile: getSelectedSound(), volume: $("#volume").val()});
    });

    $("#start").click(function () {
        sendCmdToBG("startJob", getFormParams());
    });

    $("#saveDefaults").click(async function () {
        await sendCmdToBG("saveDefaults", getFormParams());
        flashSaved();
    });

    $("#uiLang").change(function () {
        chrome.storage.local.set({uiLang: $("#uiLang").val()});
    });
}

async function start() {
    await c4cPageI18n();
    handleSettingsDialog();
    await setupDialog();
}

start();
