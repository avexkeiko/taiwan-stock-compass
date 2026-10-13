const TWSE = "https://www.twse.com.tw";
const TPEX = "https://www.tpex.org.tw";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120, s-maxage=120" }
  });
}
function monthDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}01`;
}
function rocMonthDate(d) {
  return `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, "0")}/01`;
}
function parseNum(v) {
  if (v === undefined || v === null || v === "" || v === "--" || v === "－" || v === "—") return null;
  const n = Number(String(v).replace(/,/g, "").replace(/股/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
function rowsToObjects(fields, data) {
  return (data || []).map(row => Object.fromEntries((fields || []).map((f, i) => [String(f).trim(), row[i]])));
}
async function fetchJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "Taiwan-Stock-Compass/2.1", accept: "application/json,text/plain,*/*" } });
  if (!r.ok) throw new Error(`資料來源回應 ${r.status}`);
  return r.json();
}
async function stockMonthTWSE(code, date) {
  return fetchJson(`${TWSE}/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(code)}`);
}
async function t86(date) {
  return fetchJson(`${TWSE}/fund/T86?response=json&date=${date}&selectType=ALLBUT0999`);
}
function extractTables(payload) {
  const tables = Array.isArray(payload?.tables) ? payload.tables : [];
  const all = [{ fields: payload?.fields, data: payload?.data }, ...tables];
  return all.filter(t => Array.isArray(t?.data) && Array.isArray(t?.fields));
}
function normalizeDate(value) {
  const s = String(value || "").trim();
  const m = s.match(/(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!m) return s;
  let y = Number(m[1]); if (y < 1911) y += 1911;
  return `${y}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[3])).padStart(2, "0")}`;
}
function firstValue(row, names) {
  for (const key of names) if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  const keys = Object.keys(row);
  for (const key of keys) if (names.some(n => key.includes(n))) return row[key];
  return null;
}
function normalizeQuoteRows(payload) {
  const tables = extractTables(payload);
  const rows = tables.flatMap(t => rowsToObjects(t.fields, t.data));
  return rows.map(r => ({
    date: normalizeDate(firstValue(r, ["日期", "資料日期", "交易日期", "Date"])),
    volume: parseNum(firstValue(r, ["成交股數", "成交量", "成交股數(股)", "Volume"])),
    close: parseNum(firstValue(r, ["收盤價", "收盤", "Close"])),
    high: parseNum(firstValue(r, ["最高價", "最高", "High"])),
    low: parseNum(firstValue(r, ["最低價", "最低", "Low"]))
  })).filter(r => r.close !== null && r.date);
}
async function stockMonthTPEX(code, date) {
  const dateCandidates = [monthDate(date), rocMonthDate(date)];
  const urls = dateCandidates.map(d => `${TPEX}/www/zh-tw/afterTrading/tradingStock?code=${encodeURIComponent(code)}&date=${encodeURIComponent(d)}&id=&response=json`);
  let lastError;
  for (const url of urls) {
    try {
      const payload = await fetchJson(url);
      const rows = normalizeQuoteRows(payload);
      if (rows.length) return { payload, rows };
      lastError = new Error(payload?.message || payload?.stat || "櫃買中心沒有回傳可辨識的歷史行情資料");
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error("無法取得上櫃歷史行情");
}
function instRows(payload) {
  if (!payload?.data || !payload?.fields) return [];
  return rowsToObjects(payload.fields, payload.data);
}
function pick(obj, names) {
  for (const n of names) if (Object.prototype.hasOwnProperty.call(obj, n)) return obj[n];
  return null;
}
function institutionFor(rows, code) {
  const row = rows.find(r => String(pick(r, ["證券代號", "股票代號", "Code"]) || "").trim() === code);
  if (!row) return null;
  const foreign = parseNum(pick(row, ["外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數"]));
  const trust = parseNum(pick(row, ["投信買賣超股數"]));
  const dealer = parseNum(pick(row, ["自營商買賣超股數"]));
  if (foreign === null && trust === null && dealer === null) return null;
  return { foreign: foreign || 0, trust: trust || 0, dealer: dealer || 0, total: (foreign || 0) + (trust || 0) + (dealer || 0) };
}
function topInstitutions(rows) {
  return rows.map(r => {
    const code = String(pick(r, ["證券代號", "股票代號"]) || "").trim();
    const name = String(pick(r, ["證券名稱", "股票名稱"]) || "").trim();
    const foreign = parseNum(pick(r, ["外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數"])) || 0;
    const trust = parseNum(pick(r, ["投信買賣超股數"])) || 0;
    const dealer = parseNum(pick(r, ["自營商買賣超股數"])) || 0;
    return { code, name, net: foreign + trust + dealer };
  }).filter(r => /^\d{4,6}$/.test(r.code) && r.name);
}
function calculateSignal(series, instCandidates) {
  const closes = series.map(x => x.close);
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, closes.length);
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
  const latest = series[series.length - 1];
  const instTotal = instCandidates.reduce((a, b) => a + b.total, 0);
  let signal = { label: "盤整觀察", cls: "neutral", instText: instCandidates.length ? "近3日法人資料已取得" : "此市場法人資料未提供", tip: "觀察 MA5、MA20 與成交量變化。" };
  if (instCandidates.length && ma5 > ma20 && latest.close >= ma5 && instTotal > 0) signal = { label: "偏多參考", cls: "bull", instText: "近3日合計偏淨買", tip: "留意是否守住 MA5，以及量能是否異常放大。" };
  else if (instCandidates.length && ma5 < ma20 && latest.close < ma5 && instTotal < 0) signal = { label: "偏空參考", cls: "bear", instText: "近3日合計偏淨賣", tip: "留意 MA5/MA20 壓力與跌幅擴大風險。" };
  return { ma5, ma20, signal };
}
async function getTWSE(code, months) {
  const payloads = await Promise.all(months.map(d => stockMonthTWSE(code, monthDate(d))));
  const series = payloads.flatMap(p => (p?.data || []).map((row, i) => ({
    date: normalizeDate(row[0]), volume: parseNum(row[1]), close: parseNum(row[6]), high: parseNum(row[4]), low: parseNum(row[5])
  })).filter(r => r.close !== null));
  if (!series.length) throw new Error("找不到上市歷史行情");
  return { series, payloads, market: "上市市場", source: "TWSE 證交所公開資料" };
}
async function getTPEX(code, months) {
  const results = await Promise.all(months.map(d => stockMonthTPEX(code, d)));
  const series = results.flatMap(r => r.rows);
  if (!series.length) throw new Error("櫃買中心沒有回傳可辨識的上櫃歷史行情");
  return { series, payloads: results.map(r => r.payload), market: "上櫃市場", source: "TPEx 櫃買中心公開資料" };
}
export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const code = (url.searchParams.get("code") || "").trim();
    if (!/^\d{4,6}$/.test(code)) return json({ ok: false, error: "股票代號格式不正確。" }, 400);
    const now = new Date();
    const months = Array.from({ length: 3 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1));
    let marketData;
    let twseError;
    try { marketData = await getTWSE(code, months); } catch (e) { twseError = e; }
    if (!marketData) {
      try { marketData = await getTPEX(code, months); }
      catch (e) { return json({ ok: false, error: `查無此代號的上市或上櫃歷史行情。上市查詢：${twseError?.message || "無資料"}；上櫃查詢：${e?.message || "無資料"}。請確認代號，或稍後再試。` }, 404); }
    }
    const series = marketData.series.sort((a, b) => a.date.localeCompare(b.date));
    const latest = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    const { ma5, ma20, signal: initialSignal } = calculateSignal(series, []);
    let instCandidates = [];
    if (marketData.market === "上市市場") {
      for (const row of series.slice(-10).reverse()) {
        const dateDigits = row.date.replace(/\//g, "");
        const y = Number(dateDigits.slice(0, 4));
        const md = dateDigits.slice(4);
        if (!y || md.length < 4) continue;
        try {
          const p = await t86(`${y}${md.slice(0, 2)}01`);
          const rows = instRows(p);
          const inst = institutionFor(rows, code);
          if (inst) instCandidates.push({ date: row.date, ...inst, rawRows: rows });
        } catch (_) {}
        if (instCandidates.length >= 3) break;
      }
    }
    const latestInstRows = instCandidates[0]?.rawRows || [];
    const ranking = topInstitutions(latestInstRows);
    const topBuy = [...ranking].sort((a, b) => b.net - a.net).slice(0, 5);
    const topSell = [...ranking].sort((a, b) => a.net - b.net).slice(0, 5);
    const name = marketData.payloads.find(p => p?.title)?.title?.match(/[\u4e00-\u9fff]{2,}/)?.[0] || code;
    const change = prev ? latest.close - prev.close : 0;
    const changePct = prev?.close ? change / prev.close * 100 : 0;
    const { signal } = calculateSignal(series, instCandidates);
    if (marketData.market === "上櫃市場") signal.instText = "上櫃法人明細尚未接入，請以均線與價格觀察";
    const last7 = series.slice(-7), last30 = series.slice(-30);
    return json({
      ok: true, code, name, market: marketData.market, date: latest.date, close: latest.close,
      prevClose: prev?.close ?? null, change, changePct, volume: latest.volume, ma5, ma20,
      high7: Math.max(...last7.map(x => x.high ?? x.close)), low7: Math.min(...last7.map(x => x.low ?? x.close)),
      high30: Math.max(...last30.map(x => x.high ?? x.close)), low30: Math.min(...last30.map(x => x.low ?? x.close)),
      institutions: instCandidates.map(({ rawRows, ...r }) => r), topBuy, topSell, signal,
      source: marketData.source,
      notice: marketData.market === "上櫃市場" ? "已支援上櫃價格、成交量、均線及高低點；上櫃三大法人明細與排行尚未接入。" : ""
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "資料查詢失敗。" }, 502);
  }
}
