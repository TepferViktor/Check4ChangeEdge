/* Check4Change for Microsoft Edge — tutorial dialog.
 * Based on Check4Change by Ronen Zilberman (GPLv3). Modified in 2026. */

c4cPageI18n();

$(".closebutton").click(function () {
    sendCmdToBG("closeLightBox");
});
