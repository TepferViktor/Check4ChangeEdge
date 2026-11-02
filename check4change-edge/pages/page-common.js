/* Check4Change for Microsoft Edge — helpers for the in-page dialogs
 * (tutorial, settings, status overlay).
 * Based on Check4Change by Ronen Zilberman (GPLv3). Modified in 2026.
 *
 * The dialogs are extension pages shown in an iframe inside the monitored tab.
 * The tab id comes in the query string (?tabId=N).
 */

var C4C_TAB_ID = (function () {
    var m = /[?&]tabId=(\d+)/.exec(location.search);
    return m ? parseInt(m[1], 10) : null;
})();

// Replaces sendCmdToBG from common.js: passes the tab id explicitly.
function sendCmdToBG(name, data) {
    return chrome.runtime.sendMessage({c4c: true, name: name, data: data, tabId: C4C_TAB_ID});
}

function formToObj(form, params) {
    if (isUndef(form)) form = "";
    if (isUndef(params)) params = {};

    $(form + " .param").each(function () { params[this.id] = $(this).val(); });
    $(form + " input:checkbox.param").each(function () { params[this.id] = $(this).is(":checked"); });

    return params;
}

function objToForm(form, params) {
    if (isUndef(form)) form = "";
    if (isUndef(params)) params = {};

    for (var k in params) {
        if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
        var v = params[k];

        var o = $(form + " #" + k);
        if (o.length == 0) continue;

        if (o.is(":checkbox")) {
            o[0].checked = !!v;
        } else {
            o.val(v);
        }
    }
}

// Translates the page and keeps it in sync with the language setting.
async function c4cPageI18n(onChange) {
    await c4cLoadLang();
    c4cApplyI18n(document);
    c4cOnLangChange(function () {
        c4cApplyI18n(document);
        if (onChange) onChange();
    });
}
