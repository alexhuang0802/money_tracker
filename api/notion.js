// api/notion.js - Vercel Serverless Function
// 代理 Notion API 請求，解決瀏覽器 CORS 問題
// 環境變數：NOTION_TOKEN（在 Vercel 後台設定）

const NOTION_DB_ID = '32b8718e-66c1-8038-8ebb-000beee610f8';

// 股票 page ID 對應表（從你的 Notion 資料庫）
const STOCK_PAGES = {
  '0050': '32b8718e-66c1-805d-ac4f-dd38686c76d2',
  '0056': '32b8718e-66c1-8018-b218-ea094ef50682',
  'STRC': '32b8718e-66c1-8026-b6c6-d97e953c4c22',
  '川湖':  '32b8718e-66c1-805c-b6da-e1be6080f703',
};

export default async function handler(req, res) {
  // 允許跨域
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return res.status(500).json({ error: '未設定 NOTION_TOKEN 環境變數' });
  }

  try {
    // 查詢資料庫，取得所有股票的最新資料
    const dbRes = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 20 }),
      }
    );

    if (!dbRes.ok) {
      const err = await dbRes.text();
      return res.status(dbRes.status).json({ error: 'Notion API 錯誤', detail: err });
    }

    const data = await dbRes.json();

    // 整理每支股票的資料
    const stocks = data.results.map(page => {
      const props = page.properties;

      // 取得持股數量（從 rollup）
      let held = 0;
      if (props['持有股數']?.rollup?.number != null) {
        held = props['持有股數'].rollup.number;
      }

      // 取得股價
      const price = props['股價']?.number ?? 0;

      // 取得市場
      const market = props['市場']?.rich_text?.[0]?.plain_text ?? '台股';

      // 取得股票名稱
      const name = props['股票名稱']?.title?.[0]?.plain_text ?? '';

      // 取得匯率
      const exchangeRate = props['匯率']?.number ?? 1;

      // 取得總成本（rollup）
      const totalCost = props['💸 總成本']?.rollup?.number ?? 0;

      return {
        pageId: page.id,
        name,
        price,
        held,
        market,
        exchangeRate,
        totalCost,
        initVal: price * held * exchangeRate,
        lastUpdated: page.last_edited_time,
      };
    });

    return res.status(200).json({
      stocks,
      fetchedAt: new Date().toISOString(),
    });

  } catch (e) {
    return res.status(500).json({ error: '伺服器錯誤', detail: e.message });
  }
}
