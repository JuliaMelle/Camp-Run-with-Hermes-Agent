// Admin chat: talks to the local Hermes agent through chat_server.py's /api/chat
// (same endpoint the storefront uses). Hermes answers with the Suki MCP tools.
// Must be opened from the chat server (http://127.0.0.1:8765/admin.html) or the
// deployed site, because /api/chat only accepts same-origin requests.
;(() => {
  const el = (id) => document.getElementById(id)
  const panel = el('chat-panel')
  const toggle = el('chat-toggle')
  const closeBtn = el('chat-close')
  const clearBtn = el('chat-clear')
  const log = el('chat-messages')
  const form = el('chat-form')
  const input = el('chat-input')
  const send = el('chat-send')
  const status = el('chat-status')
  const statusDot = el('chat-status-dot')
  const launcherDot = el('chat-launcher-dot')
  const welcome = log.querySelector('.chat-welcome')

  const STORE_KEY = 'suki-admin-chat'
  const MAX_TURNS = 12
  let history = []
  let pending = false

  const esc = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  // Small, safe markdown subset (escape first): headings, bold, code, bullets, tables.
  function inline(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  }
  function markdown(source) {
    const lines = String(source).replace(/\r/g, '').split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        const head = cells(line)
        i += 2
        const body = []
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]))
        out.push(`<div class="chat-table"><table><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr>${
          body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`)
        continue
      }
      if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line)
        const items = []
        while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
          items.push(`<li>${inline(lines[i++].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))}</li>`)
        }
        out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
        continue
      }
      const heading = line.match(/^#{1,4}\s+(.*)$/)
      if (heading) out.push(`<h4>${inline(heading[1])}</h4>`)
      else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) out.push('<hr>')
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`)
      i++
    }
    return out.join('')
  }

  function setStatus(text, connected = false) {
    status.textContent = text
    statusDot.classList.toggle('is-connected', connected)
    launcherDot.classList.toggle('is-offline', !connected)
  }

  function append(role, content, className = '') {
    const node = document.createElement('div')
    node.className = `chat-message chat-message-${role}${className ? ` ${className}` : ''}`
    if (role === 'assistant' && !className) node.innerHTML = markdown(content)
    else node.textContent = content
    log.append(node)
    log.scrollTop = log.scrollHeight
    return node
  }

  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(history)) } catch {}
  }

  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]')
      if (Array.isArray(saved) && saved.length) {
        history = saved.slice(-MAX_TURNS)
        welcome.hidden = true
        history.forEach((m) => append(m.role, m.content))
      }
    } catch {}
  }

  async function checkStatus() {
    try {
      const response = await fetch('/api/status')
      if (!response.ok) throw new Error()
      const data = await response.json()
      setStatus(data.hermes_available ? 'Hermes ready' : 'Hermes CLI not found', !!data.hermes_available)
    } catch {
      setStatus('Open http://127.0.0.1:8765/admin.html to chat')
    }
  }

  function setOpen(open) {
    panel.hidden = !open
    toggle.hidden = open
    toggle.setAttribute('aria-expanded', String(open))
    if (open) input.focus()
  }

  async function ask(value) {
    const content = value.trim()
    if (!content || pending) return
    welcome.hidden = true
    append('user', content)
    input.value = ''
    input.style.height = 'auto'
    pending = true
    send.disabled = true
    const started = Date.now()
    const waiting = append('assistant', 'Suki is checking the data…', 'is-pending')
    const timer = setInterval(() => {
      waiting.textContent = `Suki is checking the data… ${Math.round((Date.now() - started) / 1000)}s`
    }, 1000)
    const messages = [...history, { role: 'user', content }].slice(-MAX_TURNS)
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          context: { branch: 'Admin dashboard (all branches, procurement / operations view)', cart: [] }
        })
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || `Hermes could not answer (HTTP ${response.status}).`)
      waiting.remove()
      append('assistant', result.reply)
      history = [...messages, { role: 'assistant', content: result.reply }].slice(-MAX_TURNS)
      save()
      setStatus('Hermes ready', true)
    } catch (error) {
      waiting.remove()
      const offline = error instanceof TypeError
      append('assistant', offline
        ? 'Could not reach the chat server. Run: python main/chat_server.py, then open http://127.0.0.1:8765/admin.html'
        : error.message, 'is-error')
      setStatus('Connection issue')
    } finally {
      clearInterval(timer)
      pending = false
      send.disabled = !input.value.trim()
      input.focus()
    }
  }

  toggle.addEventListener('click', () => setOpen(true))
  closeBtn.addEventListener('click', () => setOpen(false))
  clearBtn.addEventListener('click', () => {
    if (pending) return
    history = []
    save()
    log.querySelectorAll('.chat-message').forEach((n) => n.remove())
    welcome.hidden = false
  })
  log.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]')
    if (button) ask(button.dataset.prompt)
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    ask(input.value)
  })
  input.addEventListener('input', () => {
    send.disabled = pending || !input.value.trim()
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      form.requestSubmit()
    }
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false)
  })

  restore()
  checkStatus()
})()
