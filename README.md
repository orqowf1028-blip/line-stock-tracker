# 取得公開網址：照這 4 步做

這一包可直接部署到 Cloudflare。首頁開啟時會要求閱讀密碼；預設密碼為 `8888`。登入 Email 只用於跨裝置同步「我的註記」。

> 注意：這是寫在靜態 HTML 裡的簡易門鎖，密碼可被檢視原始碼的人找到；若要真正限制特定成員，請改用 Cloudflare Access。

## 0725 版本重點

- 個股頁支援 6 個月、1 年、3 年、5 年日 K，顯示 SMA5／SMA10／SMA20、成交量 MA5／MA10 與升降箭頭。
- 點選任一交易日可查看開高低收、成交量及當日分析師買進／加碼／賣出／出場訊號。
- 外資、投信、融資與融資使用率改為每日資料，與 K 線使用相同 44 個交易日日期軸。
- 集保持股結構維持官方週資料，散戶／大戶門檻可自訂。
- 首頁新增近三個月分析師買進筆數、可核算勝率、操作風格、近期代表作與配置建議。

## 1. 建立 Supabase（註記雲端同步）

1. 開啟 https://supabase.com/dashboard ，以 Email 或 Google 建立帳號後，建立一個新 Project。
2. Project 建好後，進入 **SQL Editor**，開啟此資料夾的 `schema.sql`，完整複製貼上並按 Run。
3. 到 **Project Settings → API**，複製 **Project URL** 與 **anon public key**。
4. 用記事本開啟 `app-config.js`，貼入兩個值並儲存：

```js
window.LINE_TRACKER_CONFIG = {
  supabaseUrl: '貼上 Project URL',
  supabaseAnonKey: '貼上 anon public key',
};
```

只能填 anon public key；絕對不要填 service_role key。

## 2. 取得 Cloudflare 公開網址

1. 開啟 https://dash.cloudflare.com/ ，建立或登入帳號。
2. 左側選 **Workers & Pages** → **Create application** → **Get started** → **Drag and drop your files**。
3. Project name 可填 `line-stock-tracker`（若被使用，換一個英文名稱）。
4. 將**這個資料夾內的檔案**重新壓縮成 ZIP 後拖入，或直接拖整個資料夾。請確認 ZIP 最外層立刻看得到 `index.html`、`app-config.js`、`_worker.js`，不要多包一層資料夾。
5. 按 **Deploy site**。畫面會顯示 `https://你的名稱.pages.dev`，這就是公開網址。

## 3. 讓「我的註記」可跨裝置同步

回到 Supabase：**Authentication → URL Configuration**。

1. **Site URL** 填剛取得的 `https://你的名稱.pages.dev`。
2. 在 **Redirect URLs** 新增同一個網址，結尾加 `/`。
3. 儲存。

接著開公開網址，在右上角輸入你的 Email，按「登入同步」，到信箱按登入連結。此後可在任何手機或電腦的 Chrome 使用同一 Email，同步你的註記。

## 4. 每次 LINE.txt 更新

請 Codex 用 `$line-stock-tracker` 更新資料後，取得新的部署包。在 Cloudflare 的同一個 Pages Project 按 **Create a new deployment**，重新上傳新版 ZIP。你的雲端註記不會被覆蓋。

## 公開範圍

表格訊號、價格與市場摘要全部公開；不要放不適合公開的內容。註記存放在 Supabase，資料庫規則限制每一個登入帳號只能讀寫自己的註記。
