const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const DAILY_FIELDS = "ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === "/api/tushare/daily") {
      await handleTushareDaily(req, res, requestUrl);
      return;
    }

    serveStatic(requestUrl.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

function serveStatic(pathname, res) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(ROOT, normalized);
  if (!filePath.startsWith(ROOT)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleTushareDaily(req, res, requestUrl) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const tokenFromHeader = req.headers["x-tushare-token"];
  const token = tokenFromHeader || process.env.TUSHARE_TOKEN;
  const mcpUrl = process.env.TUSHARE_MCP_URL;
  const tsCode = requestUrl.searchParams.get("ts_code");
  const endDate = formatDate(new Date());
  const startDate = formatDate(new Date(Date.now() - 370 * 24 * 60 * 60 * 1000));

  if (!tsCode) {
    sendJson(res, 400, { error: "缺少 ts_code 参数。" });
    return;
  }

  if (mcpUrl) {
    try {
      const mcpData = await fetchDailyViaMcp(mcpUrl, { tsCode, startDate, endDate });
      sendJson(res, 200, { ...mcpData, startDate, endDate, source: "tushare-mcp" });
      return;
    } catch (error) {
      if (!token) {
        sendJson(res, 502, { error: `Tushare MCP 请求失败：${error.message}` });
        return;
      }
    }
  }

  if (!token) {
    sendJson(res, 400, { error: "缺少 Tushare token。请在页面设置中填写，或设置 TUSHARE_TOKEN/TUSHARE_MCP_URL 环境变量。" });
    return;
  }

  const data = await fetchDailyViaRest(token, { tsCode, startDate, endDate });
  sendJson(res, 200, { ...data, startDate, endDate, source: "tushare-rest" });
}

async function fetchDailyViaRest(token, { tsCode, startDate, endDate }) {
  const payload = {
    api_name: "daily",
    token,
    params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
    fields: DAILY_FIELDS
  };

  const upstream = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await upstream.json();
  if (!upstream.ok || data.code !== 0) {
    throw new Error(data.msg || "Tushare 请求失败");
  }

  return { fields: data.data.fields, items: data.data.items };
}

async function fetchDailyViaMcp(mcpUrl, { tsCode, startDate, endDate }) {
  const client = createMcpClient(mcpUrl);
  await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "auto-parts-dashboard", version: "1.0.0" }
  });

  const toolsResult = await client.request("tools/list", {});
  const tools = toolsResult.tools || [];
  const tool = pickDailyTool(tools);
  if (!tool) {
    throw new Error("MCP 未暴露 daily 或通用 Tushare 查询工具");
  }

  const args = buildMcpArguments(tool, { tsCode, startDate, endDate });
  const callResult = await client.request("tools/call", { name: tool.name, arguments: args });
  return normalizeMcpToolResult(callResult);
}

function createMcpClient(mcpUrl) {
  let requestId = 1;
  let sessionId = "";

  return {
    async request(method, params) {
      const headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json"
      };
      if (sessionId) headers["Mcp-Session-Id"] = sessionId;

      const response = await fetch(mcpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params })
      });

      const nextSession = response.headers.get("mcp-session-id");
      if (nextSession) sessionId = nextSession;

      const text = await response.text();
      const payload = parseMcpResponse(text);
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message || `MCP ${method} 请求失败`);
      }
      return payload.result || payload;
    }
  };
}

function parseMcpResponse(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  const dataLine = trimmed.split(/\r?\n/).find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error("MCP 返回格式无法解析");
  return JSON.parse(dataLine.slice(5).trim());
}

function pickDailyTool(tools) {
  return tools.find((tool) => tool.name === "daily")
    || tools.find((tool) => /(^|[_-])daily($|[_-])/.test(tool.name))
    || tools.find((tool) => /tushare|query|api|call/i.test(tool.name));
}

function buildMcpArguments(tool, { tsCode, startDate, endDate }) {
  const properties = tool.inputSchema?.properties || {};
  const propertyNames = Object.keys(properties);
  const commonParams = { ts_code: tsCode, start_date: startDate, end_date: endDate };

  if (propertyNames.includes("api_name")) {
    return { api_name: "daily", params: commonParams, fields: DAILY_FIELDS };
  }

  if (propertyNames.includes("params")) {
    return { params: { api_name: "daily", ...commonParams }, fields: DAILY_FIELDS };
  }

  return { ...commonParams, fields: DAILY_FIELDS };
}

function normalizeMcpToolResult(callResult) {
  const content = callResult.content || [];
  const textContent = content.find((item) => item.type === "text")?.text;
  const raw = textContent ? JSON.parse(textContent) : callResult;
  const data = raw.data || raw.result?.data || raw.result || raw;

  if (data.fields && data.items) return { fields: data.fields, items: data.items };
  if (Array.isArray(data.items) && Array.isArray(raw.fields)) return { fields: raw.fields, items: data.items };
  throw new Error("MCP 返回中没有识别到 Tushare fields/items 数据");
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
