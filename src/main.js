import { supabase } from './supabase.js'

const $ = (sel) => document.querySelector(sel)
const dinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const escapar = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const estado = {
  productos: [],
  carrito: new Map(), // producto_id -> { producto, cantidad }
  categoria: 'Todas',
}

function toast(msg, tipo = 'ok') {
  const el = $('#toast')
  el.textContent = msg
  el.className = `toast show ${tipo}`
  clearTimeout(toast.t)
  toast.t = setTimeout(() => (el.className = 'toast'), 2500)
}

// ---------- Sesión ----------

async function iniciar() {
  const { data } = await supabase.auth.getSession()
  mostrarSesion(data.session)
  supabase.auth.onAuthStateChange((_evento, session) => mostrarSesion(session))
}

let sesionActiva // undefined hasta la primera llamada, para que siempre se pinte una pantalla
function mostrarSesion(session) {
  const usuario = session?.user?.id ?? null
  if (usuario === sesionActiva) return
  sesionActiva = usuario
  $('#login').classList.toggle('hidden', !!session)
  $('#app').classList.toggle('hidden', !session)
  if (session) {
    $('#user-email').textContent = session.user.email
    cargarProductos()
  } else {
    estado.carrito.clear()
  }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = new FormData(e.target)
  $('#login-error').textContent = ''
  const { error } = await supabase.auth.signInWithPassword({
    email: form.get('email'),
    password: form.get('password'),
  })
  if (error) $('#login-error').textContent = 'Correo o contraseña incorrectos'
})

$('#logout').addEventListener('click', () => supabase.auth.signOut())

// ---------- Navegación ----------

document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab))
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'))
    $(`#view-${tab.dataset.view}`).classList.remove('hidden')
    if (tab.dataset.view === 'ventas') cargarVentas()
  }),
)

// ---------- Productos ----------

async function cargarProductos() {
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, precio, categoria')
    .eq('activo', true)
    .order('categoria')
    .order('nombre')
  if (error) return toast('No se pudieron cargar los productos', 'error')
  estado.productos = data.map((p) => ({ ...p, precio: Number(p.precio) }))

  // Quitar del carrito productos que ya no existen
  for (const id of estado.carrito.keys()) {
    if (!estado.productos.some((p) => p.id === id)) estado.carrito.delete(id)
  }
  renderMenu()
  renderProductos()
  renderCarrito()
}

function categorias() {
  return [...new Set(estado.productos.map((p) => p.categoria))]
}

function renderMenu() {
  const cats = ['Todas', ...categorias()]
  if (!cats.includes(estado.categoria)) estado.categoria = 'Todas'
  $('#categorias').innerHTML = cats
    .map((c) => `<button class="chip ${c === estado.categoria ? 'active' : ''}" data-cat="${escapar(c)}">${escapar(c)}</button>`)
    .join('')

  const visibles = estado.productos.filter((p) => estado.categoria === 'Todas' || p.categoria === estado.categoria)
  $('#menu-grid').innerHTML = visibles.length
    ? visibles
        .map(
          (p) => `<button class="item" data-id="${p.id}">
            <span class="item-nombre">${escapar(p.nombre)}</span>
            <span class="item-precio">${dinero.format(p.precio)}</span>
          </button>`,
        )
        .join('')
    : '<p class="muted">No hay productos. Agrégalos en la pestaña "Productos".</p>'
}

$('#categorias').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip')
  if (!chip) return
  estado.categoria = chip.dataset.cat
  renderMenu()
})

$('#menu-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.item')
  if (!btn) return
  const producto = estado.productos.find((p) => p.id === Number(btn.dataset.id))
  const linea = estado.carrito.get(producto.id)
  if (linea) linea.cantidad++
  else estado.carrito.set(producto.id, { producto, cantidad: 1 })
  renderCarrito()
})

function renderProductos() {
  $('#lista-categorias').innerHTML = categorias().map((c) => `<option value="${escapar(c)}">`).join('')
  $('#productos-tbody').innerHTML = estado.productos.length
    ? estado.productos
        .map(
          (p) => `<tr>
            <td>${escapar(p.nombre)}</td>
            <td><span class="tag">${escapar(p.categoria)}</span></td>
            <td>${dinero.format(p.precio)}</td>
            <td class="right"><button class="btn danger small" data-eliminar="${p.id}">Eliminar</button></td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="muted">Aún no hay productos.</td></tr>'
}

$('#producto-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const datos = new FormData(form)
  const nombre = datos.get('nombre').trim()
  const precio = Number(datos.get('precio'))
  const categoria = datos.get('categoria').trim() || 'General'
  if (!nombre || !(precio >= 0)) return toast('Revisa el nombre y el precio', 'error')

  const { error } = await supabase.from('productos').insert({ nombre, precio, categoria })
  if (error) return toast('No se pudo agregar el producto', 'error')
  form.reset()
  toast(`"${nombre}" agregado`)
  cargarProductos()
})

$('#productos-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-eliminar]')
  if (!btn) return
  const id = Number(btn.dataset.eliminar)
  const producto = estado.productos.find((p) => p.id === id)
  if (!confirm(`¿Eliminar "${producto.nombre}" del menú?`)) return

  const { error } = await supabase.from('productos').delete().eq('id', id)
  if (error) return toast('No se pudo eliminar el producto', 'error')
  toast(`"${producto.nombre}" eliminado`)
  cargarProductos()
})

// ---------- Carrito ----------

function totalCarrito() {
  let total = 0
  for (const { producto, cantidad } of estado.carrito.values()) total += producto.precio * cantidad
  return total
}

function renderCarrito() {
  const lineas = [...estado.carrito.values()]
  $('#carrito').innerHTML = lineas.length
    ? lineas
        .map(
          ({ producto: p, cantidad }) => `<li data-id="${p.id}">
            <div class="linea-info">
              <span>${escapar(p.nombre)}</span>
              <small class="muted">${dinero.format(p.precio)} c/u</small>
            </div>
            <div class="cantidad">
              <button class="btn small" data-accion="menos" aria-label="Quitar uno">−</button>
              <span>${cantidad}</span>
              <button class="btn small" data-accion="mas" aria-label="Agregar uno">+</button>
            </div>
            <strong>${dinero.format(p.precio * cantidad)}</strong>
            <button class="btn ghost small" data-accion="quitar" aria-label="Eliminar de la orden">✕</button>
          </li>`,
        )
        .join('')
    : '<li class="vacio muted">Toca un producto para agregarlo</li>'
  $('#total').textContent = dinero.format(totalCarrito())
  $('#cobrar').disabled = lineas.length === 0
}

$('#carrito').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-accion]')
  if (!btn) return
  const id = Number(btn.closest('li').dataset.id)
  const linea = estado.carrito.get(id)
  if (btn.dataset.accion === 'mas') linea.cantidad++
  if (btn.dataset.accion === 'menos') linea.cantidad--
  if (btn.dataset.accion === 'quitar' || linea.cantidad <= 0) estado.carrito.delete(id)
  renderCarrito()
})

$('#vaciar').addEventListener('click', () => {
  estado.carrito.clear()
  renderCarrito()
})

$('#cobrar').addEventListener('click', async () => {
  if (estado.carrito.size === 0) return
  const btn = $('#cobrar')
  btn.disabled = true
  const items = [...estado.carrito.values()].map(({ producto, cantidad }) => ({ producto_id: producto.id, cantidad }))
  const { data: ventaId, error } = await supabase.rpc('registrar_venta', { items, metodo: $('#metodo').value })
  if (error) {
    btn.disabled = false
    return toast(`No se pudo registrar la venta: ${error.message}`, 'error')
  }
  toast(`Venta #${ventaId} registrada · ${dinero.format(totalCarrito())}`)
  estado.carrito.clear()
  renderCarrito()
})

// ---------- Ventas del día ----------

async function cargarVentas() {
  const inicioDelDia = new Date()
  inicioDelDia.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('ventas')
    .select('id, total, metodo_pago, created_at, venta_items(nombre, cantidad, subtotal)')
    .gte('created_at', inicioDelDia.toISOString())
    .order('created_at', { ascending: false })
  if (error) return toast('No se pudieron cargar las ventas', 'error')

  const total = data.reduce((s, v) => s + Number(v.total), 0)
  $('#resumen').innerHTML = `<span>${data.length} ventas</span><strong>${dinero.format(total)}</strong>`
  $('#ventas-lista').innerHTML = data.length
    ? data
        .map(
          (v) => `<li>
            <div class="venta-top">
              <strong>#${v.id}</strong>
              <span class="muted">${new Date(v.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
              <span class="tag">${escapar(v.metodo_pago)}</span>
              <strong class="right">${dinero.format(Number(v.total))}</strong>
            </div>
            <small class="muted">${v.venta_items.map((i) => `${i.cantidad}× ${escapar(i.nombre)}`).join(', ')}</small>
          </li>`,
        )
        .join('')
    : '<li class="muted">Todavía no hay ventas hoy.</li>'
}

iniciar()
