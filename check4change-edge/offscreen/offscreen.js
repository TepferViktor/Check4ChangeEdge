/* Check4Change for Microsoft Edge — offscreen document that plays alert sounds.
 * Part of a modified version of Check4Change by Ronen Zilberman (GPLv3).
 * A Manifest V3 service worker has no DOM and can't play audio itself.
 */

var player = null;

function stopPlayer() {
    if (!player) return;
    try {
        player.pause();
        player.removeAttribute("src");
        player.load();
    } catch (e) {}
    player = null;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.c4c !== true || msg.target !== "offscreen") return false;

    if (msg.name === "play") {
        stopPlayer();
        var d = msg.data || {};
        var audio = new Audio(d.src);
        audio.volume = Math.min(1, Math.max(0, typeof d.volume === "number" ? d.volume : 0.5));
        audio.loop = !!d.loop;
        player = audio;
        audio.play().then(function () {
            sendResponse(true);
        }, function (e) {
            console.error("[c4c] audio playback error", e, d.src && d.src.substring(0, 80));
            sendResponse(false);
        });
        return true;
    }

    if (msg.name === "stop") {
        stopPlayer();
        sendResponse(true);
        return false;
    }

    return false;
});
