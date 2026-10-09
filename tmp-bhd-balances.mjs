import "dotenv/config"
import pg from "pg"

const url = new URL(process.env.DATABASE_URL)
url.searchParams.delete("sslmode")
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
})
await client.connect()
const accounts = await client.query(`
  SELECT i.name AS institution, a.name AS account, a.type, a.balance::text, a.currency
  FROM fin_accounts a
  JOIN fin_institutions i ON i.id = a.institution_id
  WHERE i.name ILIKE '%bhd%'
`)
const cards = await client.query(`
  SELECT i.name AS institution, c.name AS card, c.type, b.balance::text, b.credit_limit::text AS credit_limit, b.currency
  FROM fin_card_balances b
  JOIN fin_cards c ON c.id = b.card_id
  JOIN fin_institutions i ON i.id = c.institution_id
  WHERE i.name ILIKE '%bhd%'
`)
const loans = await client.query(`
  SELECT COALESCE(i.name, l.lender_name) AS institution, l.lender_name, l.current_balance::text, l.currency, l.is_active
  FROM fin_loans l
  LEFT JOIN fin_institutions i ON i.id = l.institution_id
  WHERE i.name ILIKE '%bhd%' OR l.lender_name ILIKE '%bhd%'
`)
console.log(JSON.stringify({ accounts: accounts.rows, cards: cards.rows, loans: loans.rows }, null, 2))
await client.end()
