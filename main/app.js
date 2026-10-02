let products = []
let categories = []
let chatHistory = []
const cart = new Map(readCart())
let activeCategory = 'All picks'
let searchTerm = ''
let toastTimer
let chatPending = false
let activeBranchId = ''

const productGrid = document.querySelector('#product-grid')
const categoryList = document.querySelector('#category-list')
const basketItems = document.querySelector('#basket-items')
const basketEmpty = document.querySelector('#basket-empty')
const basketSummary = document.querySelector('#basket-summary')
const cartCount = document.querySelector('#cart-count')
const resultsCount = document.querySelector('#results-count')
const toast = document.querySelector('#toast')
const branchSelect = document.querySelector('#branch-select')
const chatPanel = document.querySelector('#chat-panel')
const chatToggle = document.querySelector('#chat-toggle')
const chatInput = document.querySelector('#chat-input')
const chatSend = document.querySelector('#chat-send')
const chatMessages = document.querySelector('#chat-messages')
const chatStatus = document.querySelector('#chat-status')
const chatStatusDot = document.querySelector('#chat-status-dot')

const peso = (amount) => `₱${amount.toLocaleString('en-PH')}`

function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem('suki-cart') || '[]')
    return Array.isArray(stored)
      ? stored.filter((entry) => Array.isArray(entry) && entry.length === 2 && Number.isInteger(entry[1]) && entry[1] > 0)
      : []
  } catch {
    return []
  }
}

function saveCart() {
  try { localStorage.setItem('suki-cart', JSON.stringify([...cart])) } catch {}
}

function productImage(category) {
  const normalized = String(category || '').toLowerCase()
  if (/produce|fruit|vegetable/.test(normalized)) return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=80'
  if (/dairy|egg/.test(normalized)) return 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=700&q=80'
  if (/meat|seafood|fish/.test(normalized)) return 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=700&q=80'
  if (/bakery|bread/.test(normalized)) return 'https://images.unsplash.com/photo-1585478259715-876acc5be8eb?auto=format&fit=crop&w=700&q=80'
  if (/beverage|coffee|drink/.test(normalized)) return 'https://images.unsplash.com/photo-1559525839-b184a4d698c7?auto=format&fit=crop&w=700&q=80'
  return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=80'
}

async function loadCatalog(branchId = '') {
  const query = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ''
  const response = await fetch(`/api/catalog${query}`)
  if (!response.ok) throw new Error('The Suki Mart catalog is unavailable.')
  const catalog = await response.json()

  if (!Array.isArray(catalog.branches) || !catalog.branches.length || !Array.isArray(catalog.products) || !catalog.products.length || !catalog.selected_branch) {
    throw new Error('The catalog is missing branch or product data.')
  }
  const hasIncompleteBranch = catalog.branches.some((branch) => !branch || branch.id == null || !branch.name || !branch.city)
  const selectedBranchExists = catalog.branches.some((branch) => String(branch.id) === String(catalog.selected_branch.id))
  if (hasIncompleteBranch || !selectedBranchExists) throw new Error('The catalog contains incomplete branch data.')
  const hasIncompleteProduct = catalog.products.some((product) =>
    !product || product.id == null || !product.name || !product.category || !product.unit ||
    typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price < 0 ||
    !Number.isInteger(product.stock) || product.stock < 0
  )
  if (hasIncompleteProduct) throw new Error('Some catalog products are missing required details.')

  products = catalog.products
  let previousBranch = ''
  try { previousBranch = localStorage.getItem('suki-branch') || '' } catch {}
  const preferredBranch = branchId || previousBranch
  const selectedId = catalog.branches.some((branch) => String(branch.id) === String(preferredBranch))
    ? String(preferredBranch)
    : String(catalog.selected_branch.id)
  activeBranchId = selectedId
  branchSelect.innerHTML = catalog.branches.map((branch) =>
    `<option value="${branch.id}">${branch.name}, ${branch.city}</option>`
  ).join('')
  branchSelect.value = selectedId
  try { localStorage.setItem('suki-branch', selectedId) } catch {}

  categories = ['All picks', ...new Set(products.map((product) => product.category).filter(Boolean))]
  if (!categories.includes(activeCategory)) activeCategory = 'All picks'
  renderCategories()
  renderProducts()
  renderBasket()
}

function renderCategories() {
  categoryList.innerHTML = categories.map((category) => `
    <button class="category-chip" type="button" data-category="${category}" aria-pressed="${activeCategory === category}">${category}</button>
  `).join('')
}

function renderProducts() {
  const visible = products.filter((product) => {
    const matchesCategory = activeCategory === 'All picks' || product.category === activeCategory
    const matchesSearch = `${product.name} ${product.detail} ${product.category}`.toLowerCase().includes(searchTerm)
    return matchesCategory && matchesSearch
  })

  resultsCount.textContent = searchTerm
    ? `${visible.length} ${visible.length === 1 ? 'market find' : 'market finds'} for “${searchTerm}”`
    : `${visible.length} good things, picked for you`

  productGrid.innerHTML = visible.length ? visible.map((product, index) => `
    <article class="product-card" style="animation-delay:${Math.min(index * 35, 210)}ms">
      <div class="product-image-wrap">
        <img class="product-image" src="${productImage(product.category)}" alt="${product.name}" loading="lazy">
        <span class="product-tag">${product.stock > 0 ? product.category : 'Out of stock'}</span>
        <button class="add-button" type="button" data-add="${product.id}" aria-label="Add ${product.name} to basket" ${product.stock <= (cart.get(product.id) || 0) ? 'disabled' : ''}>+</button>
      </div>
      <div class="product-meta">
        <p class="product-name">${product.name}</p>
        <p class="product-detail">${product.stock > 0 ? `${product.stock} ${product.unit} in stock` : 'Currently unavailable'}</p>
        <div class="product-price-row"><span class="product-price">${peso(product.price)}</span><span class="product-unit">/${product.unit}</span></div>
      </div>
    </article>
  `).join('') : '<p class="no-results">No market finds match that search. Try another name or category.</p>'
}

function renderBasket() {
  const entries = [...cart.entries()]
    .map(([id, quantity]) => ({ product: products.find((item) => item.id === id), quantity }))
    .filter((entry) => entry.product)
  const itemCount = entries.reduce((sum, entry) => sum + entry.quantity, 0)
  const subtotal = entries.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0)
  const delivery = subtotal === 0 || subtotal >= 1000 ? 0 : 49

  cartCount.textContent = itemCount
  basketEmpty.hidden = entries.length > 0
  basketSummary.hidden = entries.length === 0
  basketItems.innerHTML = entries.map(({ product, quantity }) => `
    <div class="basket-item">
      <img src="${productImage(product.category)}" alt="" loading="lazy">
      <div>
        <p class="basket-item-name">${product.name}</p>
        <p class="basket-item-price">${peso(product.price * quantity)}</p>
        ${quantity > product.stock ? `<p class="basket-item-stock">Only ${product.stock} available at this branch</p>` : ''}
      </div>
      <div class="quantity-control" aria-label="Quantity for ${product.name}">
        <button type="button" data-change="${product.id}" data-delta="-1" aria-label="Remove one ${product.name}">−</button>
        <span>${quantity}</span>
        <button type="button" data-change="${product.id}" data-delta="1" aria-label="Add one ${product.name}" ${quantity >= product.stock ? 'disabled' : ''}>+</button>
      </div>
    </div>
  `).join('')

  document.querySelector('#subtotal').textContent = peso(subtotal)
  document.querySelector('#delivery-fee').textContent = delivery === 0 && subtotal >= 1000 ? 'FREE' : peso(delivery)
  document.querySelector('#total').textContent = peso(subtotal + delivery)
  document.querySelector('.delivery-note').innerHTML = subtotal >= 1000
    ? '<span aria-hidden="true">✳</span> Your delivery is on us. Nice one!'
    : `<span aria-hidden="true">✳</span> Add ${peso(Math.max(0, 1000 - subtotal))} more for free delivery`
}

function showToast(message) {
  toast.textContent = message
  toast.classList.add('is-visible')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600)
}

function setChatStatus(message, connected = false) {
  chatStatus.textContent = message
  chatStatusDot.classList.toggle('is-connected', connected)
}

function appendChatMessage(role, content, className = '') {
  const message = document.createElement('div')
  message.className = `chat-message chat-message-${role}${className ? ` ${className}` : ''}`
  message.textContent = content
  chatMessages.append(message)
  chatMessages.scrollTop = chatMessages.scrollHeight
  return message
}

async function checkChatStatus() {
  try {
    const response = await fetch('/api/status')
    if (!response.ok) throw new Error('Bridge unavailable')
    const status = await response.json()
    const offline = status.mode === 'deployed' ? 'Hermes offline' : 'Hermes CLI not found'
    setChatStatus(status.hermes_available ? 'Hermes ready' : offline, status.hermes_available)
  } catch {
    setChatStatus('Open http://127.0.0.1:8765 to connect local chat')
  }
}

function setChatOpen(open) {
  chatPanel.hidden = !open
  chatToggle.setAttribute('aria-expanded', String(open))
  chatToggle.hidden = open
  if (open) chatInput.focus()
}

async function sendChatMessage(value) {
  const content = value.trim()
  if (!content || chatPending) return

  appendChatMessage('user', content)
  chatInput.value = ''
  chatInput.style.height = 'auto'
  chatPending = true
  chatSend.disabled = true
  const pending = appendChatMessage('assistant', 'Suki is checking…', 'is-pending')

  const branch = branchSelect.selectedOptions[0]?.textContent || 'Unknown branch'
  const cartContext = [...cart.entries()].map(([id, quantity]) => {
    const product = products.find((item) => String(item.id) === String(id))
    return product ? { name: product.name, quantity, unit_price: product.price } : null
  }).filter(Boolean)
  const messages = [...chatHistory, { role: 'user', content }].slice(-12)

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context: { branch, cart: cartContext } })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Hermes could not answer right now.')
    pending.remove()
    appendChatMessage('assistant', result.reply)
    chatHistory = [...messages, { role: 'assistant', content: result.reply }].slice(-12)
    setChatStatus('Hermes ready', true)
  } catch (error) {
    pending.remove()
    appendChatMessage('assistant', error.message || 'Could not reach Hermes. Start the local Suki chat server and try again.', 'is-error')
    setChatStatus('Connection issue')
  } finally {
    chatPending = false
    chatSend.disabled = !chatInput.value.trim()
    chatInput.focus()
  }
}

categoryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]')
  if (!button) return
  activeCategory = button.dataset.category
  renderCategories()
  renderProducts()
})

productGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-add]')
  if (!button) return
  const product = products.find((item) => item.id === button.dataset.add)
  if (!product) return
  const quantity = cart.get(product.id) || 0
  if (quantity >= product.stock) {
    showToast(`Only ${product.stock} available at this branch`)
    return
  }
  cart.set(product.id, quantity + 1)
  saveCart()
  renderBasket()
  showToast(`${product.name} added to your basket`)
})

basketItems.addEventListener('click', (event) => {
  const button = event.target.closest('[data-change]')
  if (!button) return
  const id = button.dataset.change
  const nextQuantity = (cart.get(id) || 0) + Number(button.dataset.delta)
  const product = products.find((item) => String(item.id) === String(id))
  if (nextQuantity > 0 && product && nextQuantity <= product.stock) cart.set(id, nextQuantity)
  else if (nextQuantity > 0 && product) return
  else cart.delete(id)
  saveCart()
  renderBasket()
})

document.querySelector('#search-form').addEventListener('submit', (event) => event.preventDefault())
document.querySelector('#search-input').addEventListener('input', (event) => {
  searchTerm = event.target.value.trim().toLowerCase()
  renderProducts()
})

document.querySelector('#clear-filters').addEventListener('click', () => {
  activeCategory = 'All picks'
  searchTerm = ''
  document.querySelector('#search-input').value = ''
  renderCategories()
  renderProducts()
})

document.querySelector('#checkout-button').addEventListener('click', () => {
  const branch = branchSelect.selectedOptions[0]?.textContent || 'your branch'
  showToast(`Checkout preview ready for ${branch}. Your basket is saved here.`)
})

branchSelect.addEventListener('change', async () => {
  activeCategory = 'All picks'
  try {
    await loadCatalog(branchSelect.value)
  } catch {
    branchSelect.value = activeBranchId
    showToast('Could not load inventory for that branch.')
  }
})

document.querySelector('#chat-toggle').addEventListener('click', () => setChatOpen(true))
document.querySelector('#chat-close').addEventListener('click', () => setChatOpen(false))
document.querySelector('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault()
  sendChatMessage(chatInput.value)
})

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto'
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 112)}px`
  chatSend.disabled = !chatInput.value.trim() || chatPending
})

chatMessages.addEventListener('click', (event) => {
  const suggestion = event.target.closest('[data-prompt]')
  if (suggestion) sendChatMessage(suggestion.dataset.prompt)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !chatPanel.hidden) {
    setChatOpen(false)
    chatToggle.focus()
  }
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault()
    document.querySelector('#search-input').focus()
  }
})

loadCatalog().catch(() => {
  resultsCount.textContent = 'Catalog service unavailable'
  productGrid.innerHTML = '<p class="no-results">Run <code>python main/chat_server.py</code>, then open <a href="http://127.0.0.1:8765/">http://127.0.0.1:8765/</a> to load the catalog and connect local chat.</p>'
}).finally(() => {
  productGrid.setAttribute('aria-busy', 'false')
})
renderBasket()
checkChatStatus()