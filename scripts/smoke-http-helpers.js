const { EventEmitter } = require("events");
const {
  createAppError,
  publicErrorMessage,
  errorPayload,
  sendJson,
  sendError,
  sendText,
  hasRequestBody,
  isJsonContentType,
  getBody
} = require("../lib/http");

const failures = [];

function fail(message) {
  failures.push(message);
}

function check(name, ok) {
  if (!ok) fail(name);
}

function createResponse(requestId) {
  return {
    headers: null,
    statusCode: null,
    body: "",
    ended: false,
    requestId,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
      this.ended = true;
    }
  };
}

function createRequest({ method = "POST", headers = {}, chunks = [] } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;
  req.destroyed = false;
  req.destroy = () => {
    req.destroyed = true;
  };
  req.pushBody = () => {
    for (const chunk of chunks) req.emit("data", Buffer.from(chunk));
    req.emit("end");
  };
  return req;
}

async function readBody(req) {
  const pending = getBody(req);
  req.pushBody();
  return pending;
}

async function expectReject(name, action, predicate) {
  try {
    await action();
    fail(`${name} rejects`);
  } catch (error) {
    check(`${name} has expected error`, predicate(error));
  }
}

async function main() {
  const validation = createAppError("字段不对", 400, "VALIDATION_ERROR", {
    fields: { message: "不能为空。" }
  });
  const payload = errorPayload(validation);
  check("errorPayload marks failures", payload.ok === false);
  check("errorPayload keeps public message", payload.error === "字段不对");
  check("errorPayload keeps code", payload.code === "VALIDATION_ERROR");
  check("errorPayload exposes validation fields", payload.fields?.message === "不能为空。");
  check("publicErrorMessage hides server errors", publicErrorMessage(new Error("secret")) === "服务暂时不可用，请稍后再试。");
  check("publicErrorMessage maps invalid JSON", publicErrorMessage(createAppError("bad", 400, "INVALID_JSON")) === "请求内容不是有效的 JSON。");

  const jsonRes = createResponse("abc123");
  sendJson(jsonRes, 201, { ok: true });
  check("sendJson writes status", jsonRes.statusCode === 201);
  check("sendJson writes JSON content type", /application\/json/.test(jsonRes.headers["Content-Type"]));
  check("sendJson injects requestId", JSON.parse(jsonRes.body).requestId === "abc123");

  const jsonHeadRes = createResponse("head123");
  jsonHeadRes.headOnly = true;
  sendJson(jsonHeadRes, 200, { ok: true });
  check("sendJson HEAD writes status", jsonHeadRes.statusCode === 200);
  check("sendJson HEAD keeps content length", Number(jsonHeadRes.headers["Content-Length"]) > 0);
  check("sendJson HEAD omits body", jsonHeadRes.body === "");

  const errorRes = createResponse("err001");
  sendError(errorRes, 400, validation, { scope: "smoke" });
  const errorBody = JSON.parse(errorRes.body);
  check("sendError writes status", errorRes.statusCode === 400);
  check("sendError keeps extras", errorBody.scope === "smoke");
  check("sendError keeps requestId", errorBody.requestId === "err001");

  const textRes = createResponse();
  sendText(textRes, 202, "hello", "text/plain; charset=utf-8", { "X-Test": "1" });
  check("sendText writes plain body", textRes.statusCode === 202 && textRes.body === "hello");
  check("sendText keeps custom headers", textRes.headers["X-Test"] === "1");

  const textHeadRes = createResponse();
  textHeadRes.headOnly = true;
  sendText(textHeadRes, 204, "hidden");
  check("sendText HEAD writes status", textHeadRes.statusCode === 204);
  check("sendText HEAD keeps content length", Number(textHeadRes.headers["Content-Length"]) > 0);
  check("sendText HEAD omits body", textHeadRes.body === "");

  check("GET has no request body", hasRequestBody({ method: "GET" }) === false);
  check("POST has request body", hasRequestBody({ method: "POST" }) === true);
  check("JSON content type is accepted", isJsonContentType({ headers: { "content-type": "application/json; charset=utf-8" } }) === true);
  check("Vendor JSON content type is accepted", isJsonContentType({ headers: { "content-type": "application/vnd.api+json" } }) === true);
  check("Text content type is rejected", isJsonContentType({ headers: { "content-type": "text/plain" } }) === false);

  const body = await readBody(createRequest({
    headers: { "content-type": "application/json" },
    chunks: ['{"message":"hello"}']
  }));
  check("getBody parses JSON body", body.message === "hello");

  const empty = await readBody(createRequest({
    method: "GET",
    chunks: []
  }));
  check("getBody returns empty object for empty body", Object.keys(empty).length === 0);

  await expectReject("getBody non-JSON content type", () => readBody(createRequest({
    headers: { "content-type": "text/plain" },
    chunks: ["message=hello"]
  })), error => error.status === 415 && error.code === "UNSUPPORTED_MEDIA_TYPE");

  await expectReject("getBody invalid JSON", () => readBody(createRequest({
    headers: { "content-type": "application/json" },
    chunks: ["{"]
  })), error => error.status === 400 && error.code === "INVALID_JSON");

  await expectReject("getBody oversized body", () => readBody(createRequest({
    headers: { "content-type": "application/json" },
    chunks: ["x".repeat(1_000_001)]
  })), error => error.status === 413 && error.code === "BODY_TOO_LARGE");

  if (failures.length) {
    console.error(`HTTP helper smoke failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }

  console.log("HTTP helper smoke checks passed.");
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
