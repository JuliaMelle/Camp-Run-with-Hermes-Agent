// LAYER 3 — DESKTOP PLUGIN (the face)
//
// Supplier Watch pane for Hermes Desktop. Buttons send prompts into the chat,
// where Hermes loads the supplier-watch skill and calls the Suki MCP tools.
//
// Install (the folder name MUST equal the `id` below):
//   macOS/Linux:  ~/.hermes/desktop-plugins/supplier-watch/plugin.js
//   Windows:      %USERPROFILE%\\.hermes\\desktop-plugins\\supplier-watch\\plugin.js
// Then in Hermes Desktop: Ctrl/Cmd+K → "Reload desktop plugins", and enable it
// in Capabilities → Plugins if needed.
//
// Rules of the disk-plugin loader:
//   * Only these imports resolve: '@hermes/plugin-sdk', 'react', 'react/jsx-runtime'.
//   * The file is NOT compiled — use jsx()/jsxs() calls, not <JSX/> syntax.
//   * No hardcoded colors — use theme variables like var(--ui-text-tertiary).

import { host, useValue, Button, PANES_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const PLUGIN_ID = 'supplier-watch'

const ACTIONS = [
  {
    label: 'Analyze Supplier Risk',
    hint: 'Identify historically unreliable suppliers and investigate current operational impact.',
    prompt: 'Use the supplier-watch skill. Call find_chronically_late_suppliers first, then investigate the highest-priority supplier with get_supplier_scorecard, find_at_risk_open_orders, and get_supplier_inventory_impact. Explain the most urgent operational risk and recommend no more than three actions.'
  },
  {
    label: 'Check Overdue POs',
    hint: 'Find unresolved purchase orders that are past their expected delivery date.',
    prompt: 'Use the supplier-watch skill to call get_overdue_purchase_orders with stale_before set to a recent sandbox cutoff, excluding stale April–June bookkeeping records. Then use find_at_risk_open_orders to identify the unresolved POs that require attention.'
  },
  {
    label: 'Find Inventory at Risk',
    hint: 'Find products and branches threatened by delayed supplier deliveries.',
    prompt: 'Use the supplier-watch skill. Call find_chronically_late_suppliers, then get_supplier_inventory_impact for the identified unreliable suppliers. Report the affected branches and products, days of stock, stockout status, and estimated revenue exposure. Do not claim a stockout is certain.'
  }
]

function send(prompt) {
  const ok = host.composer.submit(null, prompt)
  if (!ok) {
    host.notify({ kind: 'info', message: 'Open or focus a chat first, then click again.' })
  }
}

function ActionRow({ action, disabled }) {
  return jsxs('div', {
    className: 'flex flex-col gap-1 rounded-md border border-(--ui-stroke-secondary) p-2',
    children: [
      jsx(Button, {
        disabled,
        onClick: () => send(action.prompt),
        children: action.label
      }),
      jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: action.hint })
    ]
  })
}

function SupplierWatchPanel() {
  const busy = useValue(host.state.busy)
  return jsxs('div', {
    className: 'flex h-full flex-col gap-3 overflow-auto p-3 text-sm',
    children: [
      jsxs('div', {
        children: [
          jsx('div', { className: 'font-medium', children: 'Supplier Watch' }),
          jsx('div', {
            className: 'text-xs text-(--ui-text-tertiary)',
            children: busy
              ? 'Hermes is analyzing supplier risk…'
              : 'Identify unreliable suppliers before delays become stockouts.'
          })
        ]
      }),
      ...ACTIONS.map((action) => jsx(ActionRow, { action, disabled: busy }, action.label))
    ]
  })
}

export default {
  id: PLUGIN_ID,
  name: 'Supplier Watch',
  register(ctx) {
    ctx.register({
      id: 'pane',
      area: PANES_AREA,
      title: 'Supplier Watch',
      data: { placement: 'right', width: '300px' },
      render: () => jsx(SupplierWatchPanel, {})
    })
    ctx.register({
      id: 'run-first',
      area: PALETTE_AREA,
      data: {
        id: `${PLUGIN_ID}.run`,
        label: `Supplier Watch: ${ACTIONS[0].label}`,
        keywords: ['suki', 'supplier', 'purchase order', 'inventory', 'risk'],
        run: () => send(ACTIONS[0].prompt)
      }
    })
  }
}
