// LAYER 3 — DESKTOP PLUGIN (the face)
//
// End-to-end loop:
//   GUI button → prompt → suki-team-skill → mcp_suki_* tools → data/store.db
//   → gateway `tool.complete` event → REAL DATA rendered back in this pane.
//
// The pane subscribes to gateway tool events, captures the structured results
// of every `mcp_suki_*` call and renders them as live cards (supplier grades,
// POs to chase, cost impact). A pipeline strip lights up GUI → Skill → MCP →
// Data as each stage happens, so the integration is visible in the demo.
//
// Install: ~/.hermes/desktop-plugins/suki-panel/plugin.js (folder == id).
// Loader rules: only '@hermes/plugin-sdk', 'react', 'react/jsx-runtime' import;
// no JSX syntax; theme variables only (no hardcoded colors).

import { host, useValue, atom, Button, Badge, StatusDot, Separator, PANES_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const PLUGIN_ID = 'suki-panel'
const SKILL = 'suki-team-skill'
const MCP_PREFIX = 'mcp_suki_'

const ACTIONS = [
  {
    key: 'report',
    label: 'Supplier reliability report',
    hint: 'Ranks suppliers by lateness and short deliveries',
    prompt: `Use the ${SKILL} skill to give me the supplier reliability report: rank all suppliers, highlight the worst, and tell me what to do.`
  },
  {
    key: 'chase',
    label: 'POs to chase today',
    hint: 'Open orders from late suppliers that will arrive too late',
    prompt: `Use the ${SKILL} skill: which open purchase orders from unreliable suppliers should we chase today? Call find_at_risk_open_orders and show only the urgent ones.`
  },
  {
    key: 'cost',
    label: 'What is this costing us?',
    hint: 'Peso and unit impact of the worst supplier',
    prompt: `Use the ${SKILL} skill: find the worst supplier, show its scorecard and estimate what its unreliability costs us (call estimate_supplier_cost). Suggest a better alternative.`
  }
]

// ── state ────────────────────────────────────────────────────────────────────
const $stage = atom('idle') // idle | sent | skill | mcp | done
const $trace = atom([]) // [{ tool, status: 'running' | 'ok', at }]
const $data = atom({ ranking: null, scorecard: null, atRisk: null, cost: null, updatedAt: null })

let storage = null

function setData(patch) {
  const next = { ...$data.get(), ...patch, updatedAt: new Date().toISOString() }
  $data.set(next)
  try { storage?.set('data', next) } catch {}
}

function pushTrace(tool, status) {
  const rest = $trace.get().filter((t) => t.tool !== tool)
  $trace.set([{ tool, status, at: Date.now() }, ...rest].slice(0, 8))
}

// ── MCP result parsing ───────────────────────────────────────────────────────
// Hermes MCP results: {"result": "<text>", "structuredContent": {"result": ...}}.
// Lists arrive as structuredContent; dicts may arrive only as JSON text.
function parseResult(raw) {
  let r = raw
  if (typeof r === 'string') {
    try { r = JSON.parse(r) } catch { return null }
  }
  if (!r || typeof r !== 'object') return null
  if (r.structuredContent) {
    const sc = r.structuredContent
    return sc.result !== undefined ? sc.result : sc
  }
  if (typeof r.result === 'string') {
    const s = r.result.trim()
    try { return JSON.parse(s) } catch {}
    try { return JSON.parse('[' + s.replace(/}\s*\n\s*{/g, '},{') + ']') } catch {}
    return null
  }
  return r.result !== undefined ? r.result : r
}

const shortName = (name) => String(name || '').replace(MCP_PREFIX, '')

function onToolStart(ev) {
  const p = ev?.payload || {}
  const name = String(p.name || '')
  if (name === 'skill_view' && JSON.stringify(p.args || {}).includes(SKILL)) {
    if ($stage.get() !== 'mcp') $stage.set('skill')
    pushTrace(`skill · ${SKILL}`, 'ok')
  } else if (name.startsWith(MCP_PREFIX)) {
    $stage.set('mcp')
    pushTrace(shortName(name), 'running')
  }
}

function onToolComplete(ev) {
  const p = ev?.payload || {}
  const name = String(p.name || '')
  if (!name.startsWith(MCP_PREFIX)) return
  const tool = shortName(name)
  pushTrace(tool, 'ok')
  $stage.set('done')
  const value = parseResult(p.result)
  if (value == null) return
  if (tool === 'rank_supplier_reliability' && Array.isArray(value)) setData({ ranking: value })
  else if (tool === 'find_at_risk_open_orders' && Array.isArray(value)) setData({ atRisk: value })
  else if (tool === 'estimate_supplier_cost' && typeof value === 'object') setData({ cost: value })
  else if (tool === 'get_supplier_scorecard' && typeof value === 'object') setData({ scorecard: value })
}

function send(prompt) {
  const ok = host.composer.submit(null, prompt)
  if (!ok) {
    host.notify({ kind: 'info', message: 'Open or focus a chat first, then click again.' })
    return
  }
  $stage.set('sent')
  $trace.set([])
}

// ── formatting ───────────────────────────────────────────────────────────────
const peso = (n) => (n == null ? '—' : '₱' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 0 }))
const num = (n, d = 1) => (n == null ? '—' : Number(n).toFixed(d))
const gradeVariant = (g) => {
  const letter = String(g || '').trim()[0]
  if (letter === 'D') return 'destructive'
  if (letter === 'C') return 'warn'
  if (letter === 'A' || letter === 'B') return 'success'
  return 'muted'
}

const MUTED = 'text-xs text-(--ui-text-tertiary)'
const SUB = 'text-[0.65rem] text-(--ui-text-quaternary)'
const CARD = 'flex flex-col gap-2 rounded-md border border-(--ui-stroke-secondary) p-2'

// ── components ───────────────────────────────────────────────────────────────
const STAGES = [['sent', 'GUI'], ['skill', 'Skill'], ['mcp', 'MCP'], ['done', 'Data']]

function Pipeline() {
  const stage = useValue($stage)
  const busy = useValue(host.state.busy)
  const idx = STAGES.findIndex(([k]) => k === stage)
  return jsx('div', {
    className: 'flex items-center gap-1 text-[0.7rem]',
    children: STAGES.map(([k, label], i) => {
      const reached = idx >= 0 && i <= idx
      const tone = !reached ? 'muted' : i === idx && busy && stage !== 'done' ? 'warn' : 'good'
      return jsxs('div', {
        className: 'flex items-center gap-1',
        children: [
          jsx(StatusDot, { tone }),
          jsx('span', { className: reached ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-quaternary)', children: label }),
          i < STAGES.length - 1 ? jsx('span', { className: 'text-(--ui-text-quaternary)', children: '→' }) : null
        ]
      }, k)
    })
  })
}

function Trace() {
  const trace = useValue($trace)
  if (!trace.length) return null
  return jsx('div', {
    className: 'flex flex-col gap-0.5 font-mono text-[0.65rem] text-(--ui-text-tertiary)',
    children: trace.map((t) => jsx('div', { children: `${t.status === 'running' ? '⋯' : '✓'} ${t.tool}` }, t.tool))
  })
}

function CardHeader({ title, right }) {
  return jsxs('div', {
    className: 'flex items-center justify-between gap-2',
    children: [jsx('div', { className: 'font-medium', children: title }), right]
  })
}

function RankingCard({ rows }) {
  const shown = rows.filter((r) => r.grade).slice(0, 6)
  return jsxs('div', {
    className: CARD,
    children: [
      jsx(CardHeader, { title: 'Supplier reliability', right: jsx('span', { className: MUTED, children: `${rows.length} suppliers` }) }),
      ...shown.map((r) =>
        jsxs('div', {
          className: 'flex items-center justify-between gap-2 text-xs',
          children: [
            jsxs('div', {
              className: 'min-w-0',
              children: [
                jsx('div', { className: 'truncate', children: r.supplier }),
                jsx('div', {
                  className: SUB,
                  children: `${num(r.avg_days_late)}d late avg · ${num(r.pct_pos_late, 0)}% late · fill ${num(r.fill_rate_pct, 0)}% · ${r.open_pos ?? 0} open`
                })
              ]
            }),
            jsx(Badge, { variant: gradeVariant(r.grade), children: String(r.grade).split(' ')[0] })
          ]
        }, r.supplier_id)
      )
    ]
  })
}

function AtRiskCard({ rows }) {
  const high = rows.filter((r) => r.urgency === 'HIGH')
  const shown = (high.length ? high : rows).slice(0, 6)
  return jsxs('div', {
    className: CARD,
    children: [
      jsx(CardHeader, {
        title: 'Chase today',
        right: jsx(Badge, { variant: high.length ? 'destructive' : 'muted', children: `${high.length} HIGH` })
      }),
      ...shown.map((r) =>
        jsxs('div', {
          className: 'flex flex-col text-xs',
          children: [
            jsxs('div', {
              className: 'flex justify-between gap-2',
              children: [
                jsx('span', { className: 'font-mono', children: r.po_number }),
                jsx('span', { className: MUTED, children: `${r.branch} · ${peso(r.po_value_php)}` })
              ]
            }),
            jsx('div', {
              className: SUB,
              children: `${r.product} — ${num(r.days_of_cover)}d cover vs ~${num(r.likely_days_until_arrival)}d to arrive · ${r.supplier}`
            })
          ]
        }, r.po_number)
      )
    ]
  })
}

function CostCard({ cost, ranking, scorecard }) {
  const sid = cost.supplier_id
  const name =
    ranking?.find((r) => r.supplier_id === sid)?.supplier ||
    scorecard?.supplier?.name ||
    (typeof scorecard?.supplier === 'string' ? scorecard.supplier : null) ||
    `Supplier #${sid}`
  const stat = (label, value) =>
    jsxs('div', {
      className: 'flex flex-col',
      children: [
        jsx('span', { className: 'text-base font-semibold text-(--ui-accent)', children: value }),
        jsx('span', { className: 'text-[0.65rem] text-(--ui-text-tertiary)', children: label })
      ]
    }, label)
  return jsxs('div', {
    className: CARD,
    children: [
      jsx(CardHeader, { title: `Cost impact · ${name}` }),
      jsxs('div', {
        className: 'grid grid-cols-2 gap-2',
        children: [
          stat('missing stock value', peso(cost.missing_value_php)),
          stat('total days late', num(cost.total_days_late, 0)),
          stat('late POs', cost.late_pos ?? '—'),
          stat('missing units', cost.missing_units ?? '—')
        ]
      })
    ]
  })
}

function Results() {
  const d = useValue($data)
  if (!d.ranking && !d.atRisk && !d.cost) {
    return jsx('div', { className: MUTED, children: 'No data yet — run an action. Results from the Suki MCP tools appear here live.' })
  }
  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      d.ranking ? jsx(RankingCard, { rows: d.ranking }) : null,
      d.atRisk ? jsx(AtRiskCard, { rows: d.atRisk }) : null,
      d.cost ? jsx(CostCard, { cost: d.cost, ranking: d.ranking, scorecard: d.scorecard }) : null,
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsx('span', {
            className: 'text-[0.6rem] text-(--ui-text-quaternary)',
            children: `suki MCP → store.db · ${d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString() : '—'}`
          }),
          jsx(Button, {
            size: 'sm',
            variant: 'ghost',
            onClick: () => setData({ ranking: null, scorecard: null, atRisk: null, cost: null }),
            children: 'Clear'
          })
        ]
      })
    ]
  })
}

function SukiPanel() {
  const busy = useValue(host.state.busy)
  return jsxs('div', {
    className: 'flex h-full flex-col gap-3 overflow-auto p-3 text-sm',
    children: [
      jsxs('div', {
        className: 'flex flex-col gap-1',
        children: [
          jsx('div', { className: 'font-medium', children: 'Suki Mart · Supplier Reliability' }),
          jsx(Pipeline, {}),
          jsx('div', { className: MUTED, children: busy ? 'Hermes is working…' : 'Pick an action — live results land below.' })
        ]
      }),
      jsx('div', {
        className: 'flex flex-col gap-1.5',
        children: ACTIONS.map((a) => jsx(Button, { disabled: busy, title: a.hint, onClick: () => send(a.prompt), children: a.label }, a.key))
      }),
      jsx(Trace, {}),
      jsx(Separator, {}),
      jsx(Results, {})
    ]
  })
}

export default {
  id: PLUGIN_ID,
  name: 'Suki Team Panel',
  register(ctx) {
    storage = ctx.storage
    try {
      const saved = ctx.storage.get('data', null)
      if (saved && typeof saved === 'object') $data.set({ ...$data.get(), ...saved })
    } catch {}

    // MCP → GUI: capture real tool results as they stream through the gateway.
    ctx.onEvent('tool.start', onToolStart)
    ctx.onEvent('tool.complete', onToolComplete)

    ctx.register({
      id: 'pane',
      area: PANES_AREA,
      title: 'Suki Panel',
      data: { placement: 'right', width: '320px' },
      render: () => jsx(SukiPanel, {})
    })

    for (const a of ACTIONS) {
      ctx.register({
        id: `run-${a.key}`,
        area: PALETTE_AREA,
        data: {
          id: `${PLUGIN_ID}.${a.key}`,
          label: `Suki: ${a.label}`,
          keywords: ['suki', 'supplier', a.key],
          run: () => send(a.prompt)
        }
      })
    }
  }
}
