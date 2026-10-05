import { supabase, enlace } from './supabase.js'

const $ = (sel) => document.querySelector(sel)
const dinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const escapar = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const estado = {
  productos: [],
  carrito: new Map(), // producto_id -> { producto, cantidad }
  categoria: 'Todas',
  creandoClave: false, // sesión abierta desde un enlace de invitación o recuperación
  editando: null, // id del producto que se está editando en la tabla
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
  if (enlace.error) {
    $('#login-error').textContent =
      enlace.error === 'otp_expired'
        ? 'El enlace del correo ya caducó o ya se usó. Pide uno nuevo.'
        : 'No se pudo usar el enlace del correo. Pide uno nuevo.'
  }
  // Quien llega desde una invitación o desde "olvidé mi contraseña" debe crear una
  estado.creandoClave = enlace.tipo === 'invite' || enlace.tipo === 'recovery'
  const { data } = await supabase.auth.getSession()
  mostrarSesion(data.session)
  supabase.auth.onAuthStateChange((evento, session) => {
    if (evento === 'PASSWORD_RECOVERY') estado.creandoClave = true
    mostrarSesion(session)
  })
}

let sesionActiva // undefined hasta la primera llamada, para que siempre se pinte una pantalla
function mostrarSesion(session) {
  const usuario = session?.user?.id ?? null
  const pantalla = !session ? 'login' : estado.creandoClave ? 'nueva-clave' : 'app'
  if (`${usuario}:${pantalla}` === sesionActiva) return
  sesionActiva = `${usuario}:${pantalla}`
  $('#login').classList.toggle('hidden', pantalla !== 'login')
  $('#nueva-clave').classList.toggle('hidden', pantalla !== 'nueva-clave')
  $('#app').classList.toggle('hidden', pantalla !== 'app')
  if (pantalla === 'nueva-clave') {
    $('#nueva-clave-email').textContent = session.user.email
  } else if (pantalla === 'app') {
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

$('#olvide').addEventListener('click', async () => {
  const email = $('#login-form [name=email]').value.trim()
  if (!email) return ($('#login-error').textContent = 'Escribe tu correo y vuelve a tocar "¿Olvidaste tu contraseña?"')
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })
  if (error) return ($('#login-error').textContent = 'No se pudo enviar el correo. Intenta en un momento.')
  $('#login-error').textContent = ''
  toast('Te enviamos un correo para crear una contraseña nueva')
})

$('#nueva-clave-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = new FormData(e.target)
  const password = form.get('password')
  $('#nueva-clave-error').textContent = ''
  if (password !== form.get('password2')) return ($('#nueva-clave-error').textContent = 'Las contraseñas no coinciden')

  const { data, error } = await supabase.auth.updateUser({ password })
  if (error) return ($('#nueva-clave-error').textContent = 'No se pudo guardar la contraseña. Usa al menos 6 caracteres.')
  e.target.reset()
  estado.creandoClave = false
  toast('Contraseña guardada')
  mostrarSesion({ user: data.user })
})

$('#logout').addEventListener('click', () => supabase.auth.signOut())

// ---------- Navegación ----------

document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab))
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'))
    $(`#view-${tab.dataset.view}`).classList.remove('hidden')
    if (tab.dataset.view === 'ventas') {
      cargarVentas(claveDia(new Date()))
      cargarDiasRecientes()
    }
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

  // Quitar del carrito productos que ya no existen y actualizar los editados
  for (const [id, linea] of estado.carrito) {
    const producto = estado.productos.find((p) => p.id === id)
    if (producto) linea.producto = producto
    else estado.carrito.delete(id)
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
        .map((p) =>
          p.id === estado.editando
            ? `<tr class="editando" data-id="${p.id}">
            <td><input name="nombre" value="${escapar(p.nombre)}" required maxlength="80" aria-label="Nombre" /></td>
            <td><input name="categoria" value="${escapar(p.categoria)}" list="lista-categorias" maxlength="40" aria-label="Categoría" /></td>
            <td><input name="precio" type="number" min="0" step="0.5" value="${p.precio}" required aria-label="Precio" /></td>
            <td class="right acciones">
              <button class="btn primary small" data-guardar="${p.id}">Guardar</button>
              <button class="btn ghost small" data-cancelar>Cancelar</button>
            </td>
          </tr>`
            : `<tr>
            <td>${escapar(p.nombre)}</td>
            <td><span class="tag">${escapar(p.categoria)}</span></td>
            <td>${dinero.format(p.precio)}</td>
            <td class="right acciones">
              <button class="btn ghost small" data-editar="${p.id}">Editar</button>
              <button class="btn danger small" data-eliminar="${p.id}">Eliminar</button>
            </td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="muted">Aún no hay productos.</td></tr>'
  $('#productos-tbody [name=nombre]')?.focus()
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

async function guardarEdicion(fila) {
  const id = Number(fila.dataset.id)
  const nombre = fila.querySelector('[name=nombre]').value.trim()
  const precioTexto = fila.querySelector('[name=precio]').value
  const precio = Number(precioTexto)
  const categoria = fila.querySelector('[name=categoria]').value.trim() || 'General'
  if (!nombre || precioTexto === '' || !(precio >= 0)) return toast('Revisa el nombre y el precio', 'error')

  const { error } = await supabase.from('productos').update({ nombre, precio, categoria }).eq('id', id)
  if (error) return toast('No se pudo guardar el producto', 'error')
  estado.editando = null
  toast(`"${nombre}" actualizado`)
  cargarProductos()
}

$('#productos-tbody').addEventListener('click', async (e) => {
  const editar = e.target.closest('[data-editar]')
  if (editar) {
    estado.editando = Number(editar.dataset.editar)
    return renderProductos()
  }
  if (e.target.closest('[data-cancelar]')) {
    estado.editando = null
    return renderProductos()
  }
  const guardar = e.target.closest('[data-guardar]')
  if (guardar) return guardarEdicion(guardar.closest('tr'))

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

// Enter guarda y Escape cancela mientras se edita una fila
$('#productos-tbody').addEventListener('keydown', (e) => {
  const fila = e.target.closest('tr.editando')
  if (!fila) return
  if (e.key === 'Enter') {
    e.preventDefault()
    guardarEdicion(fila)
  } else if (e.key === 'Escape') {
    estado.editando = null
    renderProductos()
  }
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

// Fechas en hora local del navegador, como 'YYYY-MM-DD'
const claveDia = (fecha) =>
  `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
const desdeClave = (clave) => {
  const [a, m, d] = clave.split('-').map(Number)
  return new Date(a, m - 1, d)
}
const sumarDias = (clave, n) => {
  const fecha = desdeClave(clave)
  fecha.setDate(fecha.getDate() + n)
  return claveDia(fecha)
}
const nombreDia = (clave) => {
  const hoy = claveDia(new Date())
  if (clave === hoy) return 'hoy'
  if (clave === sumarDias(hoy, -1)) return 'ayer'
  return desdeClave(clave).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
const DIAS_RECIENTES = 30

async function cargarVentas(dia = $('#ventas-fecha').value || claveDia(new Date())) {
  const hoy = claveDia(new Date())
  if (dia > hoy) dia = hoy
  $('#ventas-fecha').value = dia
  $('#ventas-fecha').max = hoy
  $('#dia-siguiente').disabled = dia >= hoy
  $('#ventas-titulo').textContent = `Ventas de ${nombreDia(dia)}`
  marcarDiaActivo()

  const { data, error } = await supabase
    .from('ventas')
    .select('id, total, metodo_pago, created_at, venta_items(nombre, cantidad, subtotal)')
    .gte('created_at', desdeClave(dia).toISOString())
    .lt('created_at', desdeClave(sumarDias(dia, 1)).toISOString())
    .order('created_at', { ascending: false })
  if (error) return toast('No se pudieron cargar las ventas', 'error')
  // Evitar pintar una respuesta vieja si se cambió de día mientras cargaba
  if ($('#ventas-fecha').value !== dia) return

  const total = data.reduce((s, v) => s + Number(v.total), 0)
  const porMetodo = {}
  for (const v of data) porMetodo[v.metodo_pago] = (porMetodo[v.metodo_pago] ?? 0) + Number(v.total)
  $('#resumen').innerHTML = `
    <span>${data.length} ${data.length === 1 ? 'venta' : 'ventas'}</span>
    <strong>${dinero.format(total)}</strong>
    ${Object.entries(porMetodo)
      .map(([m, t]) => `<span class="tag">${escapar(m)} ${dinero.format(t)}</span>`)
      .join('')}`
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
    : `<li class="muted">${dia === hoy ? 'Todavía no hay ventas hoy.' : 'No hubo ventas este día.'}</li>`
}

async function cargarDiasRecientes() {
  const desde = sumarDias(claveDia(new Date()), -(DIAS_RECIENTES - 1))
  const { data, error } = await supabase
    .from('ventas')
    .select('total, created_at')
    .gte('created_at', desdeClave(desde).toISOString())
    .order('created_at', { ascending: false })
  if (error) return toast('No se pudo cargar el historial', 'error')

  const dias = new Map() // 'YYYY-MM-DD' -> { ventas, total }, del más reciente al más viejo
  for (const v of data) {
    const clave = claveDia(new Date(v.created_at))
    const d = dias.get(clave) ?? { ventas: 0, total: 0 }
    d.ventas++
    d.total += Number(v.total)
    dias.set(clave, d)
  }
  $('#dias-lista').innerHTML = dias.size
    ? [...dias]
        .map(
          ([clave, d]) => `<li><button class="dia" data-dia="${clave}">
            <span class="dia-nombre">${escapar(nombreDia(clave))}</span>
            <span class="muted">${d.ventas} ${d.ventas === 1 ? 'venta' : 'ventas'}</span>
            <strong>${dinero.format(d.total)}</strong>
          </button></li>`,
        )
        .join('')
    : `<li class="muted">No hay ventas en los últimos ${DIAS_RECIENTES} días.</li>`
  marcarDiaActivo()
}

function marcarDiaActivo() {
  const dia = $('#ventas-fecha').value
  document.querySelectorAll('#dias-lista .dia').forEach((b) => b.classList.toggle('active', b.dataset.dia === dia))
}

$('#ventas-fecha').addEventListener('change', (e) => e.target.value && cargarVentas(e.target.value))
$('#dia-anterior').addEventListener('click', () => cargarVentas(sumarDias($('#ventas-fecha').value, -1)))
$('#dia-siguiente').addEventListener('click', () => cargarVentas(sumarDias($('#ventas-fecha').value, 1)))
$('#ir-hoy').addEventListener('click', () => cargarVentas(claveDia(new Date())))
$('#dias-lista').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dia]')
  if (btn) cargarVentas(btn.dataset.dia)
})

iniciar()
