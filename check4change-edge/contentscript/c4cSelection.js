/* this file is a part of Check4Change
 *
 * Copyright 2006-2015 Ronen Zilberman
 * See license.txt for details.
 *
 * Modified in 2026 for the Microsoft Edge (Manifest V3) port: legacy IE branch
 * removed, implicit global fixed.
 */

function getSelectionHtml(doc) {
    var html = "";
    var sel = doc.getSelection();
    if (sel && sel.rangeCount) {
        var container = doc.createElement("div");
        for (var i = 0, len = sel.rangeCount; i < len; ++i) {
            container.appendChild(sel.getRangeAt(i).cloneContents());
        }
        html = container.innerHTML;
    }
    return html;
}


function getSelectionText(doc) {
    var sel = doc.getSelection();
    return sel ? sel.toString() : "";
}

function getSelectionRanges(doc) {
    // save container, by array of child indices.
    var ranges = [];
    var sel = doc.getSelection();
    if (!sel) return ranges;
    for (var i = 0; i < sel.rangeCount; i++) {
        var range = sel.getRangeAt(i);
        var obj = {};
        obj.startPath = c4cUti_domNodeToPath(doc, range.startContainer);
        obj.endPath = c4cUti_domNodeToPath(doc, range.endContainer);

        obj.startOffset = range.startOffset;
        // if end offset is the end of the element, mark it as such.
        obj.endOffset = range.endOffset;
        if (c4cUti_getNodeMaxOffset(doc, range.endContainer) == range.endOffset) {
            obj.endOffset = 10000;
        }

        ranges[i] = obj;
    }

    return ranges;
}

function recreateSelection(doc, ranges, doAbsPos) {
    var selection = doc.getSelection();
    if (!selection || !ranges || ranges.length === 0) return false;

    selection.removeAllRanges();
    for (var i = 0; i < ranges.length; i++) {
        var obj = ranges[i];
        var range = _recreateOneRange(doc, obj.startPath, obj.startOffset, obj.endPath, obj.endOffset, doAbsPos);
        if (range == null) return false; // error

        selection.addRange(range);
    }

    return true;
}


function _recreateOneRange(doc, startPath, startOffset, endPath, endOffset, doAbsPos) {
    try {
        // recreate the range
        var range = doc.createRange();

        var sres = c4cUti_domPathToNode(doc, startPath, doAbsPos);
        var startContainer = sres.node;
        // decide on startOffset
        if (sres.bestGuess) {
            startOffset = 0;
        } else {
            startOffset = Math.min(startOffset, c4cUti_getNodeMaxOffset(doc, startContainer));
        }

        var eres = c4cUti_domPathToNode(doc, endPath, doAbsPos);
        var endContainer = eres.node;
        // decide on endOffset
        if (eres.bestGuess) {
            endOffset = c4cUti_getNodeMaxOffset(doc, endContainer);
        } else {
            endOffset = Math.min(endOffset, c4cUti_getNodeMaxOffset(doc, endContainer));
        }

        range.setStart(startContainer, startOffset);
        range.setEnd(endContainer, endOffset);

        return range;
    } catch (e) {
        // if we failed to reconstruct the selection, return null;
        debug("error reconstructing range: " + e);
        return null;
    }
}
