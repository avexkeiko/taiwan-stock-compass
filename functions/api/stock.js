const TWSE = "https://www.twse.com.tw";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120, s-maxage=120"
    }
  });
}

function taiwanDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}${m}01`;
}

function parseNum(v) {
  if (v === undefined || v === null || v === "" || v === "--") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function rowsToObjects(fields, data) {
  return (data || []).map(row => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { "user-agent": "Taiwan-Stock-Compass/2.0" }
  });
  if (!r.ok) throw new Error(`資料來源回應 ${r.status}`);
  return r.json();
}

async function stockMonth(code, date) {
  const url = `${TWSE}/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(code)}`;
  return fetchJson(url);
}

async function t86(date) {
  const url = `${TWSE}/fund/T86?response=json&date=${date}&selectType=ALLBUT0999`;
  return fetchJson(url);
}

function stockRows(payload) {
  if (!payload?.data || !payload?.fields) return [];
  return rowsToObjects(payload.fields, payload.data).map(r => ({
    date: r["日期"],
    volume: parseNum(r["成交股數"]),
    close: parseNum(r["收盤價"]),
    high: parseNum(r["最高價"]),
    low: parseNum(r["最低價"])
  })).filter(r => r.close !== null);
}

function instRows(payload) {
  if (!payload?.data || !payload?.fields) return [];
  const fields = payload.fields;
  return rowsToObjects(fields, payload.data);
}

function pick(obj, names) {
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(obj, n)) return obj[n];
  }
  return null;
}

function institutionFor(rows, code) {
  const row = rows.find(r => String(pick(r, ["證券代號", "股票代號", "Code"]) || "").trim() === code);
  if (!row) return null;
  // Current TWSE T86 layout: foreign, investment trust, dealer columns.
  const foreign = parseNum(pick(row, ["外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數"]));
  const trust = parseNum(pick(row, ["投信買賣超股數"]));
  const dealer = parseNum(pick(row, ["自營商買賣超股數"]));
  if (foreign === null && trust === null && dealer === null) return null;
  return {
    foreign: foreign || 0,
    trust: trust || 0,
    dealer: dealer || 0,
    total: (foreign || 0) + (trust || 0) + (dealer || 0)
  };
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

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const code = (url.searchParams.get("code") || "").trim();
    if (!/^\d{4,6}$/.test(code)) return json({ ok: false, error: "股票代號格式不正確。" }, 400);

    const now = new Date();
    const months = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(taiwanDate(d));
    }

    const payloads = await Promise.all(months.map(d => stockMonth(code, d)));
    const series = payloads.flatMap(stockRows).sort((a, b) => a.date.localeCompare(b.date));
    if (!series.length) return json({ ok: false, error: "找不到此股票的 TWSE 歷史資料，請確認代號是否為上市股票。" }, 404);

    const latest = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    const closes = series.map(x => x.close);
    const ma5 = closes.slice(-5).reduce((a,b)=>a+b,0) / Math.min(5, closes.length);
    const ma20 = closes.slice(-20).reduce((a,b)=>a+b,0) / Math.min(20, closes.length);
    const last7 = series.slice(-7);
    const last30 = series.slice(-30);

    const instCandidates = [];
    for (const row of series.slice(-10).reverse()) {
      const dateDigits = row.date.replace(/\//g, "");
      const y = Number(dateDigits.slice(0,3)) + 1911;
      const md = dateDigits.slice(3);
      const iso = `${y}${md}01`;
      try {
        const p = await t86(iso);
        const inst = institutionFor(p.data ? instRows(p) : [], code);
        if (inst) instCandidates.push({ date: row.date, ...inst, rawRows: instRows(p) });
      } catch (_) {}
      if (instCandidates.length >= 3) break;
    }

    const latestInstRows = instCandidates[0]?.rawRows || [];
    const ranking = topInstitutions(latestInstRows);
    const topBuy = [...ranking].sort((a,b)=>b.net-a.net).slice(0,5);
    const topSell = [...ranking].sort((a,b)=>a.net-b.net).slice(0,5);

    const name = payloads.find(p => p?.title)?.title?.match(/[\u4e00-\u9fff]{2,}/)?.[0] || code;
    const change = prev ? latest.close - prev.close : 0;
    const changePct = prev?.close ? change / prev.close * 100 : 0;
    const instTotal = instCandidates.reduce((a,b)=>a+b.total,0);

    let signal = { label: "盤整觀察", cls: "neutral", instText: "法人資料不足", tip: "觀察 MA5、MA20 與成交量變化。" };
    if (ma5 > ma20 && latest.close >= ma5 && instTotal > 0) {
      signal = { label: "偏多參考", cls: "bull", instText: "近3日合計偏淨買", tip: "留意是否守住 MA5，以及量能是否異常放大。" };
    } else if (ma5 < ma20 && latest.close < ma5 && instTotal < 0) {
      signal = { label: "偏空參考", cls: "bear", instText: "近3日合計偏淨賣", tip: "留意 MA5/MA20 壓力與跌幅擴大風險。" };
    }

    return json({
      ok: true,
      code,
      name,
      market: "集中市場",
      date: latest.date,
      close: latest.close,
      prevClose: prev?.close ?? null,
      change,
      changePct,
      volume: latest.volume,
      ma5,
      ma20,
      high7: Math.max(...last7.map(x=>x.high ?? x.close)),
      low7: Math.min(...last7.map(x=>x.low ?? x.close)),
      high30: Math.max(...last30.map(x=>x.high ?? x.close)),
      low30: Math.min(...last30.map(x=>x.low ?? x.close)),
      institutions: instCandidates.map(({rawRows, ...r}) => r),
      topBuy,
      topSell,
      signal,
      source: "TWSE public data"
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "資料查詢失敗。" }, 502);
  }
}
