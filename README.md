# 🐷 Wealth Planner — Alex & Tiffany

財富目標預估網站，自動同步 Notion 股票資產資料庫。

## 功能
- 自動從 Notion 讀取最新股價和持股數量
- 股票成長 × 配息再投入 × 複利計算
- STRC 每月配息流入現金流
- 支援新增股票自動出現在網站上

## 部署步驟

### 1. Fork 這個 Repo 到你的 GitHub

### 2. 取得 Notion API Token
1. 前往 https://www.notion.so/my-integrations
2. 點「New integration」建立一個 integration
3. 複製 **Internal Integration Token**（開頭是 `secret_...`）
4. 在你的 Notion 股票資產資料庫頁面 → 右上角「...」→「Connect to」→ 選你剛建立的 integration

### 3. 部署到 Vercel
1. 前往 https://vercel.com，用 GitHub 帳號登入
2. 點「New Project」→ 選這個 Repo
3. 在 **Environment Variables** 加入：
   - Key: `NOTION_TOKEN`
   - Value: 你的 Notion Integration Token（`secret_...`）
4. 點「Deploy」

### 4. 完成！
部署完成後 Vercel 會給你一個網址（例如 `your-app.vercel.app`），每次打開就會自動同步最新的 Notion 資料。

## 本地開發
```bash
npm install -g vercel
vercel dev
```

## 注意事項
- 如果 Notion 新增了股票，打開網站會自動出現新卡片
- 成長率、配息率、每月投入金額需要手動調整（不存在 Notion 裡）
- STRC 的成長率預設為 0%（特別股不成長）
