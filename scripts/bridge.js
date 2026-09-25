/**
 * Official Mozo App Store host bridge.
 *
 * CDN bundles cannot load `/v4/app-store/sdk/mozo-sdk.js` (that path 404s off
 * the API origin, and a remote <script src> fails review). Copy this file
 * into every zip entry folder (`widget/`, `admin-config/`, …) and call
 * `MozoApp.bridge.connect()` before any host method.
 *
 *   iframe -> host   mozo:hello, mozo:ready, mozo:rpc, mozo:ui:resize, mozo:ui:toast
 *   host   -> iframe mozo:init, mozo:rpc:result, mozo:event
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MozoApp = root.MozoApp || {};
    root.MozoApp.bridge = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MSG_PREFIX = "mozo:";
  var RPC_TIMEOUT_MS = 20000;
  var HELLO_INTERVAL_MS = 200;
  var HELLO_ATTEMPTS = 80;

  function namespaced(ns, methods) {
    var api = {};
    methods.forEach(function (name) {
      api[name] = function (args) {
        return api.__call(ns + "." + name, args || {});
      };
    });
    return api;
  }

  function installClient() {
    var pending = {};
    var eventHandlers = {};
    var readyCallbacks = [];
    var callSeq = 0;
    var hostOrigin = null;
    var sessionState = null;
    var isReady = false;

    function post(type, payload) {
      if (!hostOrigin) return;
      window.parent.postMessage({ type: MSG_PREFIX + type, payload: payload || {} }, hostOrigin);
    }

    function call(method, args) {
      return new Promise(function (resolve, reject) {
        if (!hostOrigin) {
          reject(new Error("Mozo host is not connected"));
          return;
        }
        var id = "mozoapp_" + ++callSeq + "_" + Date.now();
        pending[id] = { resolve: resolve, reject: reject };
        post("rpc", { id: id, method: method, args: args || {} });
        setTimeout(function () {
          if (pending[id]) {
            delete pending[id];
            reject(new Error('Mozo call "' + method + '" timed out'));
          }
        }, RPC_TIMEOUT_MS);
      });
    }

    window.addEventListener("message", function (event) {
      var data = event.data;
      if (!data || typeof data.type !== "string" || data.type.indexOf(MSG_PREFIX) !== 0) return;
      if (hostOrigin && hostOrigin !== "*" && event.origin && event.origin !== "null" && event.origin !== hostOrigin) {
        return;
      }

      var type = data.type.slice(MSG_PREFIX.length);
      var payload = data.payload || {};

      if (type === "init") {
        if (isReady) return;
        hostOrigin = event.origin && event.origin !== "null" ? event.origin : "*";
        sessionState = payload.session || null;
        isReady = true;
        post("ready", {});
        readyCallbacks.forEach(function (callback) { callback(api); });
        readyCallbacks = [];
        return;
      }

      if (type === "rpc:result") {
        var entry = pending[payload.id];
        if (!entry) return;
        delete pending[payload.id];
        if (payload.error) entry.reject(new Error(payload.error));
        else entry.resolve(payload.data);
        return;
      }

      if (type === "event" || type === "broadcast") {
        (eventHandlers[payload.event] || []).forEach(function (handler) {
          handler(payload.data);
        });
      }
    });

    var api = {
      ready: function (callback) {
        if (isReady) callback(api);
        else readyCallbacks.push(callback);
      },
      call: call,
      session: {
        get: function () { return sessionState; },
        getToken: function () { return sessionState ? sessionState.token : null; },
        getContext: function () { return sessionState ? sessionState.context : null; },
        me: function () { return call("session.me", {}); }
      },
      ui: {
        resize: function (height) { post("ui:resize", { height: height }); },
        showToast: function (message, type) { post("ui:toast", { message: message, type: type || "info" }); },
        setLocale: function (locale) {
          post("ui:setLocale", { locale: locale });
          return call("ui.setLocale", { locale: locale });
        },
        closeModal: function () { post("ui:closeModal", {}); return call("ui.closeModal", {}); }
      },
      storage: {
        get: function (key) { return call("storage.get", { key: key }); },
        set: function (key, value) { return call("storage.set", { key: key, value: value }); },
        remove: function (key) { return call("storage.remove", { key: key }); },
        list: function (prefix) { return call("storage.list", { prefix: prefix }); },
        increment: function (key, delta) { return call("storage.increment", { key: key, delta: delta }); }
      },
      basket: {
        getSummary: function () { return call("basket.getSummary", {}); },
        getTip: function () { return call("basket.getTip", {}); },
        setTip: function (args) { return call("basket.setTip", args || {}); },
        clearTip: function () { return call("basket.clearTip", {}); }
      },
      tables: namespaced("tables", ["list", "getById", "getOccupancy"]),
      areas: namespaced("areas", ["list"]),
      orders: namespaced("orders", ["list", "getById", "create", "update"]),
      menu: namespaced("menu", ["getItems", "getCategories", "getItem", "createItem", "updateItem", "updateStock", "updateStatus", "deleteItem", "createCategory", "updateCategory", "deleteCategory"]),
      payments: namespaced("payments", ["list", "getById"]),
      venue: namespaced("venue", ["getCurrent", "getConfig", "getOpeningHours"]),
      analytics: namespaced("analytics", ["getSummary"]),
      notifications: namespaced("notifications", ["send"]),
      on: function (event, handler) {
        if (!eventHandlers[event]) eventHandlers[event] = [];
        eventHandlers[event].push(handler);
      },
      off: function (event, handler) {
        eventHandlers[event] = (eventHandlers[event] || []).filter(function (item) {
          return item !== handler;
        });
      }
    };

    api.tables.__call = call;
    api.areas.__call = call;
    api.orders.__call = call;
    api.menu.__call = call;
    api.payments.__call = call;
    api.venue.__call = call;
    api.analytics.__call = call;
    api.notifications.__call = call;

    var attempts = 0;
    var helloTimer = setInterval(function () {
      if (isReady || ++attempts > HELLO_ATTEMPTS) {
        clearInterval(helloTimer);
        return;
      }
      try {
        window.parent.postMessage({ type: MSG_PREFIX + "hello", payload: {} }, "*");
      } catch (error) {
        /* parent may not be listening yet */
      }
    }, HELLO_INTERVAL_MS);

    return api;
  }

  function connect(options) {
    var timeoutMs = (options && options.timeoutMs) || HELLO_ATTEMPTS * HELLO_INTERVAL_MS;
    // Always speak hello/init ourselves. Placement preview injects a half
    // window.Mozo (ready + basket, no storage). Preferring it makes connect()
    // succeed and then storage/menu look like a dead host.
    var host = installClient();

    return new Promise(function (resolve, reject) {
      var settled = false;
      host.ready(function () {
        if (settled) return;
        settled = true;
        resolve(host);
      });
      setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("The Mozo host did not respond"));
      }, timeoutMs);
    });
  }

  return { connect: connect };
});
