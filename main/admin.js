// Admin view: reads live Suki data from the web bridge (mcp-server/web_bridge.py),
// which calls the same tools Hermes uses over MCP.
// Local: the web bridge on :8766. Deployed (Vercel): same-origin /api/admin.
const BRIDGE = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8766' : ''
const $ = (selector) => document.querySelector(selector)
const peso = (amount) => `₱${Math.round(amount).toLocaleString('en-PH')}`
const esc = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function bars(target, rows, max, format, className = '') {
  $(target).innerHTML = rows.map((row) => `
    <div class="row ${row.flag ? 'flag' : ''} ${className}" title="${esc(row.label)}: ${esc(format(row.value))}">
      <div class="name">${esc(row.label)}</div>
      <div class="track"><div class="bar-fill" style="width:${Math.max(0, row.value / max * 100)}%"></div></div>
      <div class="val">${esc(format(row.value))}</div>
    </div>`).join('')
}

function table(headers, rows) {
  return `<tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>` +
    rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
}

function renderDecision(d) {
  let detail = ''
  if (d.action === 'Reorder now') {
    detail = `<div class="tw"><table>${table(
      ['Branch', 'Product', 'Stock now', 'Days of stock', 'Order qty', 'Order cost', 'Sales at risk'],
      d.items.map((r) => [esc(r.branch), esc(r.product),
        r.on_hand <= 0 ? '<span class="pill out">Out</span>' : r.on_hand,
        r.days_of_stock, r.order_qty ?? '', r.order_cost_php != null ? peso(r.order_cost_php) : '', peso(r.revenue_exposure_php)]))}</table></div>`
  } else if (d.action.startsWith('Chase')) {
    detail = `<div class="tw"><table>${table(
      ['PO', 'Supplier', 'Branch', 'Product', 'Days of stock', 'Likely arrival'],
      d.items.map((r) => [esc(r.po_number), esc(r.supplier), esc(r.branch), esc(r.product),
        r.days_of_cover, `in ${r.likely_days_until_arrival} days`]))}</table></div>`
  } else {
    const c = d.contact
    const alt = d.alternatives?.length
      ? `Better supplier in the same category: <b>${esc(d.alternatives[0].supplier)}</b> (${d.alternatives[0].avg_days_late} days late on average, ${d.alternatives[0].fill_rate_pct}% filled).`
      : 'No better-rated supplier exists in this category. Ask for a corrective plan and a fill-rate target instead of switching.'
    detail = `<p class="contact">Contact: ${esc(c.contact_person)} · ${esc(c.phone)} · ${esc(c.email)} · ${esc(c.payment_terms)}</p><p class="alt">${alt}</p>`
  }
  return `<article class="decision p${d.priority}"><div class="rank">${d.priority}</div><div class="body">
    <h3>${esc(d.action)}</h3><p class="why">${esc(d.why)}</p>${detail}</div></article>`
}

function render(data) {
  const { ranking, impact, open_orders: open, decisions } = data
  const s = impact.summary
  const unprotected = decisions.decisions.find((d) => d.action === 'Reorder now')
  const late = ranking.filter((r) => r.avg_days_late >= 2)

  $('#lede').textContent = late.length
    ? `${late.map((r) => r.supplier).join(' and ')} ${late.length === 1 ? 'is' : 'are'} the supplier${late.length === 1 ? '' : 's'} behind the shortages. The actions below are ordered by urgency.`
    : 'No supplier is chronically late right now.'
  $('#decisions').innerHTML = decisions.decisions.map(renderDecision).join('')

  const slots = s.already_stocked_out + s.will_stock_out_before_restock
  $('#tiles').innerHTML = [
    ['hot', `${late.length} of ${ranking.length}`, 'suppliers chronically late'],
    ['hot', peso(s.total_revenue_exposure_php), 'estimated sales at risk'],
    ['hot', s.already_stocked_out, 'shelf slots empty now'],
    ['', s.will_stock_out_before_restock, 'more will run out before restock'],
    ['hot', unprotected ? unprotected.count : 0, 'at-risk slots with no open order']
  ].map(([cls, n, label]) => `<div class="tile ${cls}"><b>${esc(n)}</b><span>${esc(label)}</span></div>`).join('')

  bars('#late', ranking.slice(0, 8).map((r) => ({ label: r.supplier, value: r.avg_days_late, flag: r.avg_days_late >= 2 })),
    Math.max(1, ranking[0].avg_days_late), (v) => `${v.toFixed(1)} d`)
  bars('#branch', impact.by_branch.map((b) => ({ label: b.branch, value: b.revenue_exposure_php })),
    Math.max(1, impact.by_branch[0]?.revenue_exposure_php || 1), peso, 'exp')
  $('#open').innerHTML = table(['PO', 'Supplier', 'Branch', 'Product', 'Days of stock', 'Likely arrival', 'Urgency'],
    open.map((r) => [esc(r.po_number), esc(r.supplier), esc(r.branch), esc(r.product), r.days_of_cover ?? '',
      `in ${r.likely_days_until_arrival} days`,
      `<span class="pill ${r.urgency === 'HIGH' ? 'high' : 'normal'}">${r.urgency}</span>`]))
}

async function load() {
  $('#status').textContent = 'Loading…'
  try {
    const response = await fetch(`${BRIDGE}/api/admin`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    render(await response.json())
    $('#offline').hidden = true
    $('#status').textContent = `Live from Suki data · sandbox date 30 Sep 2026`
  } catch (error) {
    $('#offline').hidden = false
    $('#status').textContent = 'Offline'
  }
}

$('#refresh').addEventListener('click', load)
load()
