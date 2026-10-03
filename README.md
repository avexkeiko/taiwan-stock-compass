# 台股羅盤｜公開部署版

這個版本是給「公開網址」使用的部署專案。

## 架構

- 前端：Vite
- API：Cloudflare Pages Functions
- 台股資料：TWSE 公開資料
- 本機開發：`npm.cmd install` → `npm.cmd run dev`
- 本機預設：`http://localhost:4174/`

Cloudflare Pages Functions 可在 Cloudflare 網路上執行伺服器端程式，不需要自己維護一台常駐伺服器。

## 部署到 Cloudflare Pages

### 方法 A：GitHub + Cloudflare Pages（推薦）

1. 建立一個新的 GitHub repository，例如 `taiwan-stock-compass`
2. 把本專案所有檔案上傳到 repository 根目錄
3. 到 Cloudflare Dashboard → Workers & Pages
4. 建立 Pages 專案並連接 GitHub repository
5. Production branch：`main`
6. Build command：
   `npm run build`
7. Build output directory：
   `dist`
8. Deploy

部署完成後，Cloudflare 會提供一個 `*.pages.dev` 公開網址。

## 本機測試

```text
npm.cmd install
npm.cmd run dev
```

開啟：

```text
http://localhost:4174/
```

注意：若要完整測試 Pages Functions，Cloudflare 官方建議使用 Wrangler 的 Pages 本機環境；一般 Vite dev server 主要用來檢查前端。

## 目前資料範圍

這一版以 TWSE 上市股票為主，使用公開的個股日成交資料與三大法人資料。TWSE 官方網站提供個股日成交資訊與日收盤資料；部分資料可能在交易日盤後持續更新。

## 重要

本工具只做資訊整理與技術面參考，不構成投資或買賣建議。
