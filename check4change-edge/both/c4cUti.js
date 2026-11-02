/* this file is a part of Check4Change
 *
 * Copyright 2006-2015 Ronen Zilberman
 * See license.txt for details.
 *
 * Modified in 2026 for the Microsoft Edge (Manifest V3) port: legacy XUL/XPCOM
 * helpers, preferences, network and sound helpers removed; only the DOM path
 * utilities used for saving and restoring a selection are kept.
 * The id-uniqueness test no longer renames elements in the page.
 */

function c4cUti_assert(cond, m) {
    if (!cond) {
        error(m);
    }
}

//***************** DOM NODE UTILS   */
/**
 * Determine whether a node's text content is entirely whitespace.
 */
function c4cUti_isNodeAllWs(nod) {
    return !(/[^\t\n\r ]/.test(nod.data));
}

/**
 * Determine if a node should be ignored by the iterator functions:
 * a comment node, or a text node that is all whitespace.
 */
function c4cUti_isNodeIgnorable(nod) {
    return (nod.nodeType == 8) || // A comment node
        ((nod.nodeType == 3) && c4cUti_isNodeAllWs(nod)); // a text node, all ws
}

// returns index child in parents.childNodes. Skips ignoreable nodes.
function c4cUti_getChildIndex(child) {
    try {
        if (child.parentNode == null) return null;

        var list = child.parentNode.childNodes;
        var res = 0;
        for (var i = 0; i < list.length; i++) {
            if (list[i] == child) return res;
            if (!c4cUti_isNodeIgnorable(list[i])) res++;
        }
        return -1;

    } catch (e) { c4cUti_assert(false, e); return null; }
}

// get child for given index and parent, skiping ignorable nodes.
function c4cUti_getChild(parent, index) {
    try {
        var list = parent.childNodes;
        var c = 0;
        for (var i = 0; i < list.length; i++) {
            if (c4cUti_isNodeIgnorable(list[i])) continue;
            if (c == index) return list[i];
            c++;
        }
        return null;

    } catch (e) { return null; }
}

// Test if an id is unique in the document.
// this should be so ofcourse, but in case it isn't.
function c4cUti_isUniqueId(doc, id) {
    try {
        return doc.querySelectorAll("#" + CSS.escape(id)).length === 1;
    } catch (e) { c4cUti_assert(false, e); return true; }
}

function c4cUti_domNodeToPath(root, ptr) {
    try {
        var i = 0;
        var arr = [];
        while (ptr != root) {
            arr[i++] = ptr.id;
            arr[i++] = c4cUti_getChildIndex(ptr);
            ptr = ptr.parentNode;
        }
        return arr;

    } catch (e) { c4cUti_assert(false, e); return null; }
}

// return object. <res>.node = node res.bestGuess is boolean
function c4cUti_domPathToNode(root, arr, abspos) {
    try {
        var res = {};
        var start = arr.length;
        var ele;

        // if abspos is set, use root as head.
        if (!abspos) {

            // step 1. get latest element with id
            for (var i = 0; i < arr.length; i += 2) {
                var id = arr[i];
                if ((id == null) || (id == "")) continue;

                ele = root.getElementById(id);
                if (ele != null) {
                    if (c4cUti_isUniqueId(root, id)) { // test for rare case that ele's id is not unique in document.
                        start = i;
                        root = ele;
                        break;
                    }
                }
            }
        }

        res.bestGuess = false;
        // /start/ points to the starting position
        for (var j = start - 1; j >= 0; j -= 2) {
            var ch = c4cUti_getChild(root, arr[j]);
            if (ch == null) {
                res.bestGuess = true;
                break;
            }
            root = ch;
        }
        res.node = root;
        return res;
    } catch (e) { return null; }
}

function c4cUti_getNodeMaxOffset(doc, node) {
    if (node.nodeType == 3) {
        return node.length;
    } else {
        return node.childNodes.length;
    }
}
