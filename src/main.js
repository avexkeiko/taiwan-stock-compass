import "./style.css";

const app = document.querySelector("#app");

const state = {
  stock: null,
  loading: false,
  error: "",
  code: "3034",
  buyPrice: 390,
  lots: 1
};

function fmt(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "--";
  return Number(n).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function signClass(n) {
  return Number(n) > 0 ? "up" : Number(n) < 0 ? "down" : "flat";
}

function money(n) {
  return `NT$ ${fmt(n, 2)}`;
}

function render() {
  const s = state.stock;
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div>
          <div class="brand">台股羅盤</div>
          <div class="subtitle">Taiwan Stock Compass · 公開版</div>
        </div>
        <div class="badge">公開資料／技術面參考</div>
      </header>

      <main>
        <section class="search-card">
          <div class="field">
            <label>股票代號</label>
            <input id="code" value="${state.code}" inputmode="numeric" maxlength="6" placeholder="例如 3034" />
          </div>
          <div class="field">
            <label>買進單價</label>
            <input id="buyPrice" value="${state.buyPrice}" type="number" min="0" step="0.01" />
          </div>
          <div class="field">
            <label>張數</label>
            <input id="lots" value="${state.lots}" type="number" min="0.001" step="0.001" />
          </div>
          <button id="searchBtn" class="primary">${state.loading ? "讀取中…" : "查詢股票"}</button>
        </section>

        ${state.error ? `<div class="error">${state.error}</div>` : ""}
        ${s ? stockView(s) : emptyView()}
      </main>

      <footer>
        <span>資料來源：臺灣證券交易所公開資訊</span>
        <span>本工具僅供資訊整理與技術面參考，非買賣建議。</span>
      </footer>
    </div>
  `;

  document.querySelector("#searchBtn")?.addEventListener("click", search);
  document.querySelector("#code")?.addEventListener("keydown", e => {
    if (e.key === "Enter") search();
  });
}

function emptyView() {
  return `
    <section class="welcome">
      <div class="compass">◎</div>
      <h1>輸入股票代號開始</h1>
      <p>例如 2330、3034、2317。查詢後會整理價格、成交量、均線、高低點與最近三個交易日的三大法人資料。</p>
    </section>
  `;
}

function stat(label, value, cls = "") {
  return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value ${cls}">${value}</div></div>`;
}

function stockView(s) {
  const profit = (s.close - Number(state.buyPrice)) * Number(state.lots) * 1000;
  const cost = Number(state.buyPrice) * Number(state.lots) * 1000;
  const profitPct = cost ? profit / cost * 100 : 0;
  const next = s.signal;

  return `
    <section class="stock-head">
      <div>
        <div class="stock-title">${s.name} <span>${s.code}</span></div>
        <div class="asof">資料日期：${s.date || "--"} · ${s.market || "集中市場"}</div>
      </div>
      <div class="price-box ${signClass(s.change)}">
        <div class="current-price">${fmt(s.close, 2)}</div>
        <div>${s.change >= 0 ? "+" : ""}${fmt(s.change, 2)} (${s.changePct >= 0 ? "+" : ""}${fmt(s.changePct, 2)}%)</div>
      </div>
    </section>

    <section class="grid stats">
      ${stat("昨日收盤", fmt(s.prevClose, 2))}
      ${stat("今日成交量", `${fmt(s.volume)} 股`)}
      ${stat("MA5", fmt(s.ma5, 2), s.close >= s.ma5 ? "up" : "down")}
      ${stat("MA20", fmt(s.ma20, 2), s.close >= s.ma20 ? "up" : "down")}
    </section>

    <section class="card">
      <div class="section-title">投資部位</div>
      <div class="grid stats">
        ${stat("投入成本", money(cost))}
        ${stat("目前市值", money(s.close * Number(state.lots) * 1000))}
        ${stat("未實現損益", money(profit), signClass(profit))}
        ${stat("報酬率", `${profitPct >= 0 ? "+" : ""}${fmt(profitPct, 2)}%`, signClass(profitPct))}
      </div>
    </section>

    <section class="card">
      <div class="section-title">高低點技術面 <span class="date">${s.date || ""}</span></div>
      <div class="highlow">
        <div><span>7日高</span><strong>${fmt(s.high7, 2)}</strong></div>
        <div><span>7日低</span><strong>${fmt(s.low7, 2)}</strong></div>
        <div><span>30日高</span><strong>${fmt(s.high30, 2)}</strong></div>
        <div><span>30日低</span><strong>${fmt(s.low30, 2)}</strong></div>
      </div>
    </section>

    <section class="card">
      <div class="section-title">最近 3 個交易日｜三大法人</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>日期</th><th>外資</th><th>投信</th><th>自營商</th><th>合計</th></tr></thead>
          <tbody>
            ${s.institutions.map(r => `
              <tr>
                <td>${r.date}</td>
                <td class="${signClass(r.foreign)}">${signed(r.foreign)}</td>
                <td class="${signClass(r.trust)}">${signed(r.trust)}</td>
                <td class="${signClass(r.dealer)}">${signed(r.dealer)}</td>
                <td class="${signClass(r.total)}">${signed(r.total)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="note">單位：股。TWSE 公開資料可能因盤後處理而更新。</div>
    </section>

    <section class="card signal ${next.cls}">
      <div class="section-title">隔日走勢參考</div>
      <div class="signal-main">${next.label}</div>
      <div class="signal-grid">
        <div><b>MA 趨勢</b><span>MA5 ${s.ma5 >= s.ma20 ? "在 MA20 之上" : "在 MA20 之下"}</span></div>
        <div><b>收盤與 MA5</b><span>${fmt((s.close / s.ma5 - 1) * 100, 2)}%</span></div>
        <div><b>近3日法人</b><span>${next.instText}</span></div>
        <div><b>觀察重點</b><span>${next.tip}</span></div>
      </div>
    </section>

    <section class="card ranking">
      <div class="section-title">最新交易日｜三大法人淨買賣排行</div>
      <div class="rank-grid">
        <div><h3>淨買超 Top 5</h3>${s.topBuy.map((r,i)=>rankRow(i+1,r)).join("")}</div>
        <div><h3>淨賣超 Top 5</h3>${s.topSell.map((r,i)=>rankRow(i+1,r)).join("")}</div>
      </div>
      <div class="note">排行以公開資料計算；若交易所當日資料尚未完整更新，畫面會標示資料狀態。</div>
    </section>
  `;
}

function signed(n) {
  return `${n >= 0 ? "+" : ""}${fmt(n)}`
}

function rankRow(i, r) {
  return `<div class="rank-row"><span>${i}</span><b>${r.code} ${r.name}</b><strong class="${signClass(r.net)}">${signed(r.net)}</strong></div>`;
}

async function search() {
  state.code = document.querySelector("#code")?.value.trim() || "";
  state.buyPrice = Number(document.querySelector("#buyPrice")?.value || 0);
  state.lots = Number(document.querySelector("#lots")?.value || 0);
  state.error = "";

  if (!/^\d{4,6}$/.test(state.code)) {
    state.error = "請輸入 4～6 碼股票代號。";
    render();
    return;
  }

  state.loading = true;
  render();

  try {
    const res = await fetch(`/api/stock?code=${encodeURIComponent(state.code)}`, {
      headers: { Accept: "application/json" }
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "查詢失敗");
    state.stock = data;
  } catch (e) {
    state.stock = null;
    state.error = e.message || "查詢失敗，請稍後再試。";
  } finally {
    state.loading = false;
    render();
  }
}

render();
