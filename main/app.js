const products = [
  { id: 'lakatan', name: 'Lakatan bananas', detail: 'Locally grown · 1 bunch', category: 'Produce', price: 89, tag: 'Local pick', image: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=700&q=80' },
  { id: 'tomatoes', name: 'Heirloom tomatoes', detail: 'Ripe & ready · 500 g', category: 'Produce', price: 125, tag: 'Just picked', image: 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=700&q=80' },
  { id: 'avocado', name: 'Creamy avocado', detail: 'Ripe this week · 2 pcs', category: 'Produce', price: 115, tag: '', image: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=700&q=80' },
  { id: 'eggs', name: 'Free-range eggs', detail: 'Happy hens · 6 pcs', category: 'Dairy & eggs', price: 108, tag: 'Farm fresh', image: 'https://images.unsplash.com/photo-1506976785307-8732e854ad03?auto=format&fit=crop&w=700&q=80' },
  { id: 'milk', name: 'Fresh whole milk', detail: 'Creamy & local · 1 L', category: 'Dairy & eggs', price: 98, tag: '', image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=700&q=80' },
  { id: 'salmon', name: 'Atlantic salmon', detail: 'Responsibly sourced · 250 g', category: 'Meat & seafood', price: 289, tag: 'Catch of the day', image: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=700&q=80' },
  { id: 'greens', name: 'Garden salad mix', detail: 'Washed & ready · 150 g', category: 'Produce', price: 79, tag: '', image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=700&q=80' },
  { id: 'bread', name: 'Sourdough loaf', detail: 'Baked this morning · 1 loaf', category: 'Bakery', price: 145, tag: 'Small batch', image: 'https://images.unsplash.com/photo-1585478259715-876acc5be8eb?auto=format&fit=crop&w=700&q=80' },
  { id: 'coffee', name: 'Batangas coffee beans', detail: 'Medium roast · 250 g', category: 'Pantry', price: 235, tag: 'Local maker', image: 'https://images.unsplash.com/photo-1559525839-b184a4d698c7?auto=format&fit=crop&w=700&q=80' }
]

const categories = ['All picks', 'Produce', 'Dairy & eggs', 'Meat & seafood', 'Bakery', 'Pantry']
const cart = new Map()
let activeCategory = 'All picks'
let searchTerm = ''
let toastTimer

const productGrid = document.querySelector('#product-grid')
const categoryList = document.querySelector('#category-list')
const basketItems = document.querySelector('#basket-items')
const basketEmpty = document.querySelector('#basket-empty')
const basketSummary = document.querySelector('#basket-summary')
const cartCount = document.querySelector('#cart-count')
const resultsCount = document.querySelector('#results-count')
const toast = document.querySelector('#toast')

const peso = (amount) => `₱${amount.toLocaleString('en-PH')}`

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
        <img class="product-image" src="${product.image}" alt="${product.name}" loading="lazy">
        ${product.tag ? `<span class="product-tag">${product.tag}</span>` : ''}
        <button class="add-button" type="button" data-add="${product.id}" aria-label="Add ${product.name} to basket">+</button>
      </div>
      <div class="product-meta">
        <p class="product-name">${product.name}</p>
        <p class="product-detail">${product.detail}</p>
        <div class="product-price-row"><span class="product-price">${peso(product.price)}</span><span class="product-unit">/${product.detail.split('·').at(-1).trim()}</span></div>
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
      <img src="${product.image}" alt="" loading="lazy">
      <div>
        <p class="basket-item-name">${product.name}</p>
        <p class="basket-item-price">${peso(product.price * quantity)}</p>
      </div>
      <div class="quantity-control" aria-label="Quantity for ${product.name}">
        <button type="button" data-change="${product.id}" data-delta="-1" aria-label="Remove one ${product.name}">−</button>
        <span>${quantity}</span>
        <button type="button" data-change="${product.id}" data-delta="1" aria-label="Add one ${product.name}">+</button>
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
  cart.set(product.id, (cart.get(product.id) || 0) + 1)
  renderBasket()
  showToast(`${product.name} added to your basket`)
})

basketItems.addEventListener('click', (event) => {
  const button = event.target.closest('[data-change]')
  if (!button) return
  const id = button.dataset.change
  const nextQuantity = (cart.get(id) || 0) + Number(button.dataset.delta)
  if (nextQuantity > 0) cart.set(id, nextQuantity)
  else cart.delete(id)
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
  const branch = document.querySelector('#branch-select').value
  showToast(`Checkout preview ready for ${branch}. Your basket is saved here.`)
})

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault()
    document.querySelector('#search-input').focus()
  }
})

renderCategories()
renderProducts()
renderBasket()