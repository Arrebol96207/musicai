const DEBUG_ERRORS = process.env.CLAUDIO_DEBUG_ERRORS === "1";

function createAppError(message, status = 500, code = "APP_ERROR", details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function publicErrorMessage(error) {
  if (!error) return "服务暂时不可用，请稍后再试。";
  if (error.name === "AbortError") return "请求超时了，请稍后再试。";
  if (error.code === "NO_PLAYABLE_MUSIC") return error.message;
  if (error.code === "INVALID_JSON") return "请求内容不是有效的 JSON。";
  if (error.code === "BODY_TOO_LARGE") return "请求内容过大。";
  if (error.status && error.status < 500) return error.message || "请求参数不正确。";
  return error.publicMessage || "服务暂时不可用，请稍后再试。";
}

function errorPayload(error, extra = {}) {
  const payload = {
    ok: false,
    error: publicErrorMessage(error),
    code: error?.code || "SERVER_ERROR",
    ...extra
  };
  if (error?.details?.fields) payload.fields = error.details.fields;
  if (DEBUG_ERRORS && error?.details) payload.details = error.details;
  if (DEBUG_ERRORS && error?.message && payload.error !== error.message) payload.debug = error.message;
  return payload;
}

function sendJson(res, status, payload, headers = {}) {
  const responsePayload = res.requestId && payload && typeof payload === "object" && !Array.isArray(payload)
    ? { requestId: res.requestId, ...payload }
    : payload;
  const body = JSON.stringify(responsePayload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(res.headOnly ? undefined : body);
}

function sendError(res, status, error, extra = {}, headers = {}) {
  return sendJson(res, status, errorPayload(error, extra), headers);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(text),
    ...headers
  });
  res.end(res.headOnly ? undefined : text);
}

function hasRequestBody(req) {
  return !["GET", "HEAD"].includes(req.method);
}

function isJsonContentType(req) {
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  return !contentType || contentType === "application/json" || contentType.endsWith("+json");
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    if (hasRequestBody(req) && !isJsonContentType(req)) {
      reject(createAppError("请求 Content-Type 必须是 application/json。", 415, "UNSUPPORTED_MEDIA_TYPE"));
      return;
    }

    let raw = "";
    let rejected = false;
    req.on("data", chunk => {
      if (rejected) return;
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > 1_000_000) {
        rejected = true;
        req.destroy();
        reject(createAppError("请求内容过大。", 413, "BODY_TOO_LARGE"));
      }
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(createAppError("请求内容不是有效的 JSON。", 400, "INVALID_JSON"));
      }
    });
    req.on("error", error => {
      if (!rejected) reject(error);
    });
  });
}

module.exports = {
  createAppError,
  publicErrorMessage,
  errorPayload,
  sendJson,
  sendError,
  sendText,
  hasRequestBody,
  isJsonContentType,
  getBody
};
