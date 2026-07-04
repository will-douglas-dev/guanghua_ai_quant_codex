const companies = [
  { name: "福耀玻璃", code: "600660.SH", focus: "全球汽车玻璃龙头，海外产能和高附加值产品占比是关键变量。" },
  { name: "华域汽车", code: "600741.SH", focus: "综合零部件平台，客户覆盖广，适合观察整车周期和盈利修复。" },
  { name: "拓普集团", code: "601689.SH", focus: "轻量化底盘、热管理和智能驾驶执行器，新能源客户弹性较强。" },
  { name: "星宇股份", code: "601799.SH", focus: "车灯龙头，受益于智能车灯和高端车型配置升级。" },
  { name: "伯特利", code: "603596.SH", focus: "制动系统和线控制动代表企业，智能底盘景气度观察样本。" },
  { name: "保隆科技", code: "603197.SH", focus: "TPMS、传感器、空气悬架部件，智能化和国产替代方向。" },
  { name: "银轮股份", code: "002126.SZ", focus: "热管理系统供应商，新能源车和储能热管理双线跟踪。" },
  { name: "旭升集团", code: "603305.SH", focus: "铝合金精密压铸件，轻量化与海外新能源客户相关度高。" },
  { name: "德赛西威", code: "002920.SZ", focus: "智能座舱和智能驾驶域控龙头，偏电子零部件属性。" },
  { name: "中鼎股份", code: "000887.SZ", focus: "密封、减震和空气悬架业务，传统和新业务切换值得跟踪。" }
];

const select = document.querySelector("#companySelect");
const tokenInput = document.querySelector("#tokenInput");
const fetchButton = document.querySelector("#fetchButton");
const sampleButton = document.querySelector("#sampleButton");
const canvas = document.querySelector("#priceChart");
const ctx = canvas.getContext("2d");
let currentRows = [];

init();

function init() {
  companies.forEach((company) => {
    const option = document.createElement("option");
    option.value = company.code;
    option.textContent = `${company.name} (${company.code})`;
    select.append(option);
  });

  document.querySelector("#leaderGrid").innerHTML = companies.map((company) => `
    <article class="leader-card">
      <strong>${company.name}</strong>
      <span>${company.code}</span>
      <p>${company.focus}</p>
    </article>
  `).join("");

  select.addEventListener("change", () => loadSampleForSelection());
  fetchButton.addEventListener("click", fetchTushareData);
  sampleButton.addEventListener("click", loadSampleForSelection);
  window.addEventListener("resize", () => drawChart(currentRows));
  setInterval(updateClock, 1000);
  updateClock();
  loadSampleForSelection();
}

async function fetchTushareData() {
  const company = selectedCompany();
  setStatus("拉取中...");

  try {
    const response = await fetch(`/api/tushare/daily?ts_code=${encodeURIComponent(company.code)}`, {
      headers: tokenInput.value.trim() ? { "x-tushare-token": tokenInput.value.trim() } : {}
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Tushare 请求失败");
    updateDashboard(normalizeTushare(payload.fields, payload.items), payload.source === "tushare-mcp" ? "TUSHARE MCP" : "TUSHARE REST");
  } catch (error) {
    setStatus(`使用样例：${error.message}`);
    loadSampleForSelection(false);
  }
}

function normalizeTushare(fields, items) {
  const index = Object.fromEntries(fields.map((field, fieldIndex) => [field, fieldIndex]));
  return items.map((item) => ({
    date: item[index.trade_date],
    close: Number(item[index.close]),
    pct: Number(item[index.pct_chg]),
    amount: Number(item[index.amount]) / 100000,
    volume: Number(item[index.vol])
  })).reverse();
}

function loadSampleForSelection(overwriteStatus = true) {
  const rows = makeSampleRows(selectedCompany().code);
  updateDashboard(rows, overwriteStatus ? "SAMPLE DATA" : document.querySelector("#dataStatus").textContent);
}

function updateDashboard(rows, sourceLabel) {
  currentRows = rows;
  const company = selectedCompany();
  const metrics = calculateMetrics(rows);
  document.querySelector("#chartTitle").textContent = `${company.name} (${company.code}) 一年股价走势`;
  document.querySelector("#returnMetric").textContent = formatPercent(metrics.totalReturn);
  document.querySelector("#drawdownMetric").textContent = formatPercent(metrics.maxDrawdown);
  document.querySelector("#amountMetric").textContent = metrics.avgAmount.toFixed(2);
  document.querySelector("#volMetric").textContent = formatPercent(metrics.annualVol);
  document.querySelector("#returnSignal").textContent = metrics.totalReturn >= 0 ? "UPTREND" : "DOWNTREND";
  setStatus(sourceLabel);
  updateStage(metrics, company);
  drawChart(rows);
}

function calculateMetrics(rows) {
  const first = rows[0].close;
  const last = rows[rows.length - 1].close;
  let peak = first;
  let maxDrawdown = 0;
  rows.forEach((row) => {
    peak = Math.max(peak, row.close);
    maxDrawdown = Math.min(maxDrawdown, (row.close - peak) / peak);
  });
  const returns = rows.slice(1).map((row, index) => (row.close - rows[index].close) / rows[index].close);
  const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / returns.length;
  return {
    totalReturn: (last - first) / first,
    maxDrawdown,
    avgAmount: rows.reduce((sum, row) => sum + row.amount, 0) / rows.length,
    annualVol: Math.sqrt(variance) * Math.sqrt(252)
  };
}

function updateStage(metrics, company) {
  const title = document.querySelector("#stageTitle");
  const copy = document.querySelector("#stageCopy");
  if (metrics.totalReturn > 0.2 && metrics.maxDrawdown > -0.22) {
    title.textContent = "趋势强势，适合继续跟踪业绩兑现";
    copy.textContent = `${company.name} 近一年收益表现较强，回撤相对可控。建议进一步补充营收增速、毛利率、客户结构、海外收入占比和机构持仓变化。`;
  } else if (metrics.maxDrawdown < -0.32) {
    title.textContent = "回撤压力较大，优先确认基本面拐点";
    copy.textContent = `${company.name} 近一年波动和回撤较高。建议关注订单能见度、产能利用率、价格压力、现金流和估值分位是否出现修复。`;
  } else {
    title.textContent = "区间震荡，等待成交和盈利信号共振";
    copy.textContent = `${company.name} 当前更像是估值与景气预期的拉锯。建议增加 PE/PB 分位、ROE、净利润增速、北向资金和行业指数相对强弱。`;
  }
}

function drawChart(rows) {
  if (!rows.length) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth * ratio;
  const height = canvas.clientHeight * ratio;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  const padding = 48 * ratio;
  const prices = rows.map((row) => row.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  ctx.strokeStyle = "#2a2d46";
  ctx.lineWidth = 1 * ratio;
  ctx.font = `${12 * ratio}px Consolas`;
  ctx.fillStyle = "#777b91";
  for (let i = 0; i <= 4; i += 1) {
    const y = padding + ((height - padding * 2) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
    ctx.fillText((max - (range * i) / 4).toFixed(2), 8 * ratio, y + 4 * ratio);
  }

  const points = rows.map((row, index) => ({
    x: padding + ((width - padding * 2) * index) / (rows.length - 1),
    y: padding + ((max - row.close) / range) * (height - padding * 2)
  }));
  const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
  gradient.addColorStop(0, "rgba(32, 225, 139, 0.26)");
  gradient.addColorStop(1, "rgba(32, 225, 139, 0)");

  ctx.beginPath();
  points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
  ctx.strokeStyle = "#20e18b";
  ctx.lineWidth = 3 * ratio;
  ctx.stroke();
  ctx.lineTo(width - padding, height - padding);
  ctx.lineTo(padding, height - padding);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 5 * ratio, 0, Math.PI * 2);
  ctx.fillStyle = "#ffdf20";
  ctx.fill();
}

function makeSampleRows(code) {
  const seed = code.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const rows = [];
  let close = 18 + (seed % 45);
  const today = new Date();
  for (let i = 252; i >= 0; i -= 1) {
    const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const drift = Math.sin((252 - i + seed) / 18) * 0.012 + ((seed % 7) - 3) * 0.0009;
    const shock = Math.sin((252 - i + seed) / 5) * 0.009;
    const pct = drift + shock;
    close = Math.max(3, close * (1 + pct));
    rows.push({ date: formatDate(date), close: Number(close.toFixed(2)), pct: pct * 100, amount: 1.5 + (seed % 9) * 0.4 + Math.abs(pct) * 120, volume: 100000 + seed * 100 });
  }
  return rows;
}

function selectedCompany() {
  return companies.find((company) => company.code === select.value) || companies[0];
}

function formatPercent(value) { return `${(value * 100).toFixed(1)}%`; }
function formatDate(date) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join(""); }
function setStatus(text) { document.querySelector("#dataStatus").textContent = text; }
function updateClock() { document.querySelector("#clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }); }

