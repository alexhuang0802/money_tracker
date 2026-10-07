// api/bank.js - 女友網銀用的 API（Vercel Serverless Function）
// 密碼在伺服器端驗證，通過才回傳 ❤️❤️基金 的總資產、持股與最近收支。
// 需要環境變數：NOTION_TOKEN、BANK_PASSWORD
import { createHmac, timingSafeEqual } from 'node:crypto';

const DB_IDS = {
  income:   '1e98718e66c180b2a312cb0604f73a40', // Income
  expenses: '1e68718e66c181738363f2ca6f70d685', // Expenses
  stocks:   '32b8718e66c180938d50f77a579056a6', // 股票資產
};
const TEMPLATE_ROWS = new Set(['Acme Inc. Salary', 'Emca Inc. Salary', 'Dividents']);
const SESSION_DAYS = 180;

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
    if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
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
  if (!prop) return null;
  if (prop.type === 'number') return prop.number;
  if (prop.type === 'rollup') return prop.rollup?.number ?? null;
  if (prop.type === 'formula') {
    if (prop.formula?.type === 'number') return prop.formula.number;
    if (prop.formula?.type === 'string') {
      const n = parseFloat((prop.formula.string || '').replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? null : n;
    }
  }
  return null;
}

const getSelect = prop => (prop?.type === 'select' ? prop.select?.name ?? '' : '');
const getDate = (...props) => props.map(p => p?.type === 'date' ? p.date?.start : '').find(Boolean)?.slice(0, 10) || '';

// 登入憑證：到期時間 + HMAC(BANK_PASSWORD)，換密碼後舊憑證自動失效
const sign = (secret, exp) => createHmac('sha256', secret).update(String(exp)).digest('base64url');
function issueSession(secret) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${exp}.${sign(secret, exp)}`;
}
function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function validSession(secret, session) {
  const [exp, sig] = String(session || '').split('.');
  return Number(exp) > Date.now() && !!sig && sameText(sig, sign(secret, exp));
}

async function buildFund(token) {
  const [incomeRaw, expensesRaw, stocksRaw] = await Promise.all([
    queryDB(token, DB_IDS.income), queryDB(token, DB_IDS.expenses), queryDB(token, DB_IDS.stocks),
  ]);

  const income = incomeRaw
    .map(p => p.properties)
    .filter(p => getNum(p['Amount']) != null && !TEMPLATE_ROWS.has(getText(p['Source'])))
    .map(p => ({ date: getDate(p['Date'], p['Date '], p['Date 1']), title: getText(p['Source']), tag: getSelect(p['Tags']), amount: getNum(p['Amount']) }));
  const expenses = expensesRaw
    .map(p => p.properties)
    .filter(p => getNum(p['Amount']) != null)
    .map(p => ({ date: getDate(p['日期'], p['Date'], p['Date ']), title: getText(p['Source']), tag: getSelect(p['Tags']), amount: -getNum(p['Amount']) }));

  const sum = a => a.reduce((s, t) => s + t.amount, 0);
  const cash = { income: sum(income), expense: -sum(expenses) };
  cash.balance = cash.income - cash.expense;

  const stocks = stocksRaw.map(p => p.properties).map(p => {
    const shares = getNum(p['持有股數']) ?? 0, price = getNum(p['股價']) ?? 0, fx = getNum(p['匯率']) || 1;
    return {
      name: getText(p['股票名稱']), market: getText(p['市場']) || '台股', shares, price, fx,
      value: Math.round(shares * price * fx), cost: Math.round(getNum(p['💸 總成本']) ?? 0),
    };
  }).filter(s => s.name && s.shares > 0).sort((a, b) => b.value - a.value);
  const stockValue = stocks.reduce((s, x) => s + x.value, 0);

  // 上一個完整月份（台灣時間）
  const tw = new Date(Date.now() + 8 * 3600e3);
  const prev = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth() - 1, 1));
  const ym = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  const inMonth = a => a.filter(t => t.date.startsWith(ym));

  return {
    updatedAt: new Date().toISOString(), fundName: '❤️❤️基金',
    cash, stocks, stockValue, total: cash.balance + stockValue,
    month: { label: ym.replace('-', '/'), income: sum(inMonth(income)), expense: -sum(inMonth(expenses)) },
    txns: [...income, ...expenses].filter(t => t.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { NOTION_TOKEN, BANK_PASSWORD } = process.env;
  if (!NOTION_TOKEN || !BANK_PASSWORD) return res.status(500).json({ error: '伺服器還沒設定好密碼' });

  const { password, session } = req.body || {};
  let newSession;
  if (password != null) {
    if (!sameText(password, BANK_PASSWORD)) {
      await new Promise(r => setTimeout(r, 800)); // 拖慢連續猜密碼
      return res.status(401).json({ error: 'wrong_password' });
    }
    newSession = issueSession(BANK_PASSWORD);
  } else if (!validSession(BANK_PASSWORD, session)) {
    return res.status(401).json({ error: 'session_expired' });
  }

  try {
    return res.status(200).json({ fund: await buildFund(NOTION_TOKEN), session: newSession });
  } catch (e) {
    return res.status(502).json({ error: 'notion_failed' });
  }
}
