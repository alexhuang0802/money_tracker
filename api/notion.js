// api/notion.js - Vercel Serverless Function
// 從 Notion 讀取所有財務資料：每月總覽、收入、支出、股票資產

const DB_IDS = {
  monthly:  '1e68718e66c1812bba5afa237e96a35c', // ❤️❤️基金（月總覽）
  income:   '1e98718e66c180b2a312cb0604f73a40', // Income (single view)
  expenses: '1e68718e66c181738363f2ca6f70d685', // Expenses
  stocks:   '32b8718e66c180938d50f77a579056a6', // 股票資產
  purchases:'6fd959736dc0430fb49ef200e37531b6', // 買進記錄
};

async function queryDB(token, dbId) {
  const all = [];
  let cursor = undefined;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion API ${res.status}: ${err}`);
    }
    const data = await res.json();
    all.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return all;
}

function getText(prop) {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('');
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('');
  return '';
}

function getNum(prop) {
  if (!prop) return 0;
  if (prop.type === 'number') return prop.number ?? 0;
  if (prop.type === 'rollup') return prop.rollup?.number ?? 0;
  if (prop.type === 'formula') {
    if (prop.formula?.type === 'number') return prop.formula.number ?? 0;
    if (prop.formula?.type === 'string') {
      const n = parseFloat((prop.formula.string || '').replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? 0 : n;
    }
  }
  return 0;
}

function getSelect(prop) {
  if (!prop || prop.type !== 'select') return '';
  return prop.select?.name ?? '';
}

function getDate(prop) {
  if (!prop || prop.type !== 'date' || !prop.date) return '';
  return prop.date.start ?? '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: '未設定 NOTION_TOKEN' });

  try {
    // 並行查詢所有資料庫（個別容錯）
    const errors = {};
    async function safeQuery(name, id) {
      try { return await queryDB(token, id); }
      catch (e) { errors[name] = e.message; return []; }
    }
    const [monthlyRaw, incomeRaw, expensesRaw, stocksRaw, purchasesRaw] = await Promise.all([
      safeQuery('monthly', DB_IDS.monthly),
      safeQuery('income', DB_IDS.income),
      safeQuery('expenses', DB_IDS.expenses),
      safeQuery('stocks', DB_IDS.stocks),
      safeQuery('purchases', DB_IDS.purchases),
    ]);

    // 整理每月總覽
    const monthly = monthlyRaw.map(p => ({
      name: getText(p.properties['Name']),
      totalIncome: getNum(p.properties['Total Mothly Income']),
      totalExpenses: getNum(p.properties['Total Monthly Expenses']),
      monthlyNet: getNum(p.properties['Monthly Net']),
      goal: getNum(p.properties['Goal']),
    })).sort((a, b) => a.name.localeCompare(b.name));

    // 整理收入
    const income = incomeRaw.map(p => ({
      source: getText(p.properties['Source']),
      amount: getNum(p.properties['Amount']),
      tag: getSelect(p.properties['Tags']),
      date: getDate(p.properties['Date']) || getDate(p.properties['Date ']) || getDate(p.properties['Date 1']),
    }));

    // 整理支出
    const expenses = expensesRaw.map(p => ({
      source: getText(p.properties['Source']),
      amount: getNum(p.properties['Amount']),
      tag: getSelect(p.properties['Tags']),
      date: getDate(p.properties['Date']) || getDate(p.properties['Date ']) || getDate(p.properties['日期']),
    }));

    // 整理股票資產
    const stocks = stocksRaw.map(p => {
      const market = getText(p.properties['市場']) || '台股';
      const exchangeRate = getNum(p.properties['匯率']) || 1;
      const price = getNum(p.properties['股價']);
      const held = getNum(p.properties['持有股數']);
      const totalCost = getNum(p.properties['💸 總成本']);
      const marketValue = getNum(p.properties['市值']);
      const profitPct = getNum(p.properties['📈 損益%']);
      const profitAmt = getNum(p.properties['📊 損益金額']);
      const avgCost = getNum(p.properties['📐 平均成本']);
      const divAmount = getNum(p.properties['💵 除息金額']);
      const lastDivDate = getDate(p.properties['📅 最後除息日']);

      return {
        name: getText(p.properties['股票名稱']),
        price, held, market, exchangeRate, totalCost,
        marketValue, profitPct, profitAmt, avgCost,
        divAmount, lastDivDate,
      };
    });

    // 整理買進記錄
    const purchases = purchasesRaw.map(p => ({
      record: getText(p.properties['買進記錄']),
      shares: getNum(p.properties['買進股數']),
      price: getNum(p.properties['買進價格']),
      date: getDate(p.properties['買進日期']),
      exchangeRate: getNum(p.properties['匯率']),
      costTWD: getNum(p.properties['台幣成本']),
    })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return res.status(200).json({
      monthly, income, expenses, stocks, purchases,
      errors: Object.keys(errors).length ? errors : undefined,
      fetchedAt: new Date().toISOString(),
    });

  } catch (e) {
    return res.status(500).json({ error: '伺服器錯誤', detail: e.message });
  }
}
