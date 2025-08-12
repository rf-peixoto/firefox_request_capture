/* global browser */
console.log("[ReqCap] background loaded");

let capturing = false;

// requestId -> per-request record under construction
const reqs = new Map();
// flat log of finalized entries
const captured = [];

// Utility: normalize headers into object {lowerName: value}
function headersToObject(headers = []) {
  const obj = {};
  for (const h of headers) {
    const name = (h.name || "").toLowerCase();
    if (name in obj) obj[name] = `${obj[name]}, ${h.value ?? ""}`;
    else obj[name] = h.value ?? "";
  }
  return obj;
}

// Heuristic extraction of "tokens" often relevant to auth/CSRF
function extractTokensFromHeaders(hObj) {
  const tokens = {};
  const candidates = [
	  // Generic auth
	  "authorization",
	  "proxy-authorization",
	  "authentication",
	  "x-authorization",
	  "x-auth",
	  "x-auth-token",
	  "x-authentication-token",
	  "auth-token",
	  "access-token",
	  "x-access-token",
	  "id-token",
	  "x-id-token",
	  "identity-token",
	  "refresh-token",
	  "x-refresh-token",
	  "session-token",
	  "x-session-token",
	  "x-session",
	  "x-session-id",
	  "x-sessionid",

	  // API keys / client credentials
	  "api-key",
	  "x-api-key",
	  "x-api-token",
	  "x-api-secret",
	  "x-client-id",
	  "client-id",
	  "x-client-key",
	  "x-client-secret",
	  "client-secret",
	  "x-app-id",
	  "app-id",
	  "x-app-key",
	  "x-app-token",
	  "x-app-secret",
	  "x-organization-token",
	  "x-tenant-token",

	  // CSRF / anti-forgery
	  "csrf-token",
	  "x-csrf-token",
	  "x-csrftoken",
	  "x-xsrf-token",
	  "x-xsrftoken",
	  "x-request-verification-token",

	  // Cloud / vendor-specific (commonly token-bearing)
	  // AWS SigV4 / STS
	  "x-amz-date",
	  "x-amz-security-token",
	  "x-amz-content-sha256",
	  "x-amz-target",

	  // Azure / Microsoft
	  "ocp-apim-subscription-key",
	  "ocp-apim-subscription-id",
	  "x-ms-authorization-auxiliary",
	  "x-ms-token-aad-access-token",
	  "x-ms-token-aad-id-token",
	  "x-ms-client-principal",
	  "x-ms-client-principal-id",
	  "x-ms-client-principal-name",
	  "x-ms-client-principal-idp",

	  // Google
	  "x-goog-api-key",
	  "x-goog-iam-authorization-token",
	  "x-goog-iam-authority-selector",
	  "x-goog-visitor-id",

	  // Firebase
	  "x-firebase-appcheck",
	  "x-firebase-client",

	  // Cloudflare Access
	  "cf-access-jwt-assertion",

	  // GitHub / GitLab / VCS
	  "x-github-token",
	  "x-gitlab-token",

	  // Slack / Discord / Chat APIs (often HMAC/JWT)
	  "x-slack-signature",
	  "x-slack-request-timestamp",
	  "x-discord-signature",
	  "x-discord-timestamp",

	  // Stripe / Payments (HMAC signatures)
	  "stripe-signature",

	  // Twilio
	  "x-twilio-signature",

	  // Shopify
	  "x-shopify-access-token",

	  // Sentry
	  "x-sentry-auth",

	  // Misc common patterns seen in APIs
	  "x-token",
	  "x-access",
	  "x-key",
	  "x-secret",
	  "x-signature",
	  "x-signature-timestamp",
	  "x-request-signature",
	  "x-api-signature",
	  "x-authorization-signature"
  ];

  for (const k of candidates) {
    if (hObj[k]) tokens[k] = hObj[k];
  }
  return tokens;
}

function extractCookiesFromCookieHeader(hObj) {
  const cookieHeader = hObj["cookie"];
  if (!cookieHeader) return [];
  return cookieHeader.split(/;\s*/).filter(Boolean);
}

// Fired first: capture basic request info and body meta if present
function onBeforeRequest(details) {
  if (!capturing) return;
  const base = {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    timeStamp: details.timeStamp,
    frameId: details.frameId,
    parentFrameId: details.parentFrameId,
    tabId: details.tabId,
    statusCode: null,
    ip: null,
    requestHeaders: {},
    responseHeaders: {},
    sentCookies: [],
    setCookies: [],
    sentTokens: {},
    error: null
  };
  if (details.requestBody) {
    if (details.requestBody.formData) {
      base.requestBody = { formData: details.requestBody.formData };
    } else if (details.requestBody.raw) {
      const total = details.requestBody.raw.reduce((n, p) => n + (p.bytes ? p.bytes.byteLength : 0), 0);
      base.requestBody = { rawBytes: total };
    }
  }
  reqs.set(details.requestId, base);
}

// Fired with request headers
function onBeforeSendHeaders(details) {
  if (!capturing) return;
  const rec = reqs.get(details.requestId);
  if (!rec) return;
  const hObj = headersToObject(details.requestHeaders);
  rec.requestHeaders = hObj;
  rec.sentTokens = extractTokensFromHeaders(hObj);
  rec.sentCookies = extractCookiesFromCookieHeader(hObj);
}

// Fired when response headers arrive
function onHeadersReceived(details) {
  if (!capturing) return;
  const rec = reqs.get(details.requestId);
  if (!rec) return;
  const hObj = headersToObject(details.responseHeaders);
  rec.responseHeaders = hObj;
  const setCookieLines = details.responseHeaders
    .filter(h => (h.name || "").toLowerCase() === "set-cookie")
    .map(h => h.value || "")
    .filter(Boolean);
  rec.setCookies.push(...setCookieLines);
}

// Fired when completed
function onCompleted(details) {
  if (!capturing) return;
  const rec = reqs.get(details.requestId);
  if (!rec) return;
  rec.statusCode = details.statusCode ?? null;
  rec.ip = details.ip ?? null;
  rec.fromCache = details.fromCache ?? false;
  rec.timeStampCompleted = details.timeStamp;
  captured.push(rec);
  reqs.delete(details.requestId);
}

// Fired on errors
function onErrorOccurred(details) {
  if (!capturing) return;
  const rec = reqs.get(details.requestId) || {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    timeStamp: details.timeStamp,
    requestHeaders: {},
    responseHeaders: {},
    sentCookies: [],
    setCookies: [],
    sentTokens: {},
    statusCode: null,
    ip: null
  };
  rec.error = details.error || "Unknown error";
  rec.timeStampError = details.timeStamp;
  captured.push(rec);
  reqs.delete(details.requestId);
}

// Add listeners with fallback for FF compatibility
function addListeners() {
  console.log("[ReqCap] adding listeners");
  const urlFilter = { urls: ["<all_urls>"] };
  const tryAdd = (target, fn, filter, opts) => {
    try { target.addListener(fn, filter, opts); return true; }
    catch (e) { console.warn("Listener add failed, falling back:", e); return false; }
  };
  if (!tryAdd(browser.webRequest.onBeforeRequest, onBeforeRequest, urlFilter, ["requestBody"])) {
    tryAdd(browser.webRequest.onBeforeRequest, onBeforeRequest, urlFilter, []);
  }
  if (!tryAdd(browser.webRequest.onBeforeSendHeaders, onBeforeSendHeaders, urlFilter, ["requestHeaders", "extraHeaders"])) {
    if (!tryAdd(browser.webRequest.onBeforeSendHeaders, onBeforeSendHeaders, urlFilter, ["requestHeaders"])) {
      tryAdd(browser.webRequest.onBeforeSendHeaders, onBeforeSendHeaders, urlFilter, []);
    }
  }
  if (!tryAdd(browser.webRequest.onHeadersReceived, onHeadersReceived, urlFilter, ["responseHeaders", "extraHeaders"])) {
    if (!tryAdd(browser.webRequest.onHeadersReceived, onHeadersReceived, urlFilter, ["responseHeaders"])) {
      tryAdd(browser.webRequest.onHeadersReceived, onHeadersReceived, urlFilter, []);
    }
  }
  tryAdd(browser.webRequest.onCompleted, onCompleted, urlFilter, []);
  tryAdd(browser.webRequest.onErrorOccurred, onErrorOccurred, urlFilter, []);
}

function removeListeners() {
  console.log("[ReqCap] removing listeners");
  try { browser.webRequest.onBeforeRequest.removeListener(onBeforeRequest); } catch {}
  try { browser.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders); } catch {}
  try { browser.webRequest.onHeadersReceived.removeListener(onHeadersReceived); } catch {}
  try { browser.webRequest.onCompleted.removeListener(onCompleted); } catch {}
  try { browser.webRequest.onErrorOccurred.removeListener(onErrorOccurred); } catch {}
}

// Export captured data
async function exportData() {
  const now = new Date();
  const filename = `request-capture_${now.toISOString().replace(/[:.]/g, "-")}.json`;
  const cookieIndex = {};
  for (const rec of captured) {
    for (const sc of rec.setCookies) {
      const name = (sc.split("=")[0] || "").trim();
      if (!name) continue;
      if (!cookieIndex[name]) cookieIndex[name] = [];
      cookieIndex[name].push({
        url: rec.url,
        statusCode: rec.statusCode,
        setCookie: sc,
        timeStamp: rec.timeStampCompleted ?? rec.timeStamp
      });
    }
  }
  const tokenIndex = {};
  for (const rec of captured) {
    for (const [k, v] of Object.entries(rec.sentTokens || {})) {
      if (!tokenIndex[k]) tokenIndex[k] = [];
      tokenIndex[k].push({
        url: rec.url,
        method: rec.method,
        value: v,
        timeStamp: rec.timeStamp
      });
    }
  }
  const payload = {
    version: "1.0.2",
    exportedAt: now.toISOString(),
    count: captured.length,
    cookieIndex,
    tokenIndex,
    entries: captured
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  await browser.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  });
}

// Message handling from popup
browser.runtime.onMessage.addListener(async (msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "start") {
    console.log("[ReqCap] start requested");
    if (!capturing) {
      capturing = true;
      captured.length = 0;
      reqs.clear();
      addListeners();
    }
    return { capturing };
  }
  if (msg.type === "stop_export") {
    console.log("[ReqCap] stop & export requested");
    if (capturing) {
      capturing = false;
      removeListeners();
      await exportData();
    }
    return { capturing };
  }
  if (msg.type === "state") {
    return { capturing, pending: reqs.size, captured: captured.length };
  }
});
