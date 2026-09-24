/**
 * Mozo App Store iframe bridge.
 *
 * Guest View loads index.html in an iframe and waits 15s for `mozo:hello`.
 * Catalog check `runtime.boot` requires this file next to index.html and
 * `MozoApp.bridge.connect()` before the app boots.
 *
 * Module hosts still mount() from app.js; this file is the iframe handshake.
 */
(function (root) {
    'use strict';

    try {
        if (root.parent && root.parent !== root) {
            root.parent.postMessage({ type: 'mozo:hello', payload: {} }, '*');
        }
    } catch (error) {
        // Cross-origin frame access can throw; hello still used the wildcard target.
    }

    var app = root.MozoApp || {};
    app.bridge = app.bridge || {};
    app.bridge.connect = function connect() {
        return Promise.resolve(root.MozoAppContext || { version: 1 });
    };
    root.MozoApp = app;
})(typeof window !== 'undefined' ? window : globalThis);
