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
  recuperando: false, // sin sesión, en la pantalla "Recuperar contraseña"
  rol: null, // 'pendiente' | 'empleado' | 'admin' del usuario con sesión
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
    // Un enlace que ya no sirve lleva directo a pedir uno nuevo
    irARecuperar(
      enlace.error === 'otp_expired'
        ? 'Ese enlace ya no sirve: caducó, ya se usó o pediste otro correo después. Pide uno nuevo aquí.'
        : 'No se pudo usar el enlace del correo. Pide uno nuevo aquí.',
    )
  }
  // Quien llega desde una invitación o desde "olvidé mi contraseña" debe crear una
  estado.creandoClave = enlace.tipo === 'invite' || enlace.tipo === 'recovery'
  const { data } = await supabase.auth.getSession()
  mostrarSesion(data.session)
  supabase.auth.onAuthStateChange((evento, session) => {
    if (evento === 'PASSWORD_RECOVERY') estado.creandoClave = true
    // Fuera del callback: consultar Supabase dentro de él puede bloquear la sesión
    setTimeout(() => mostrarSesion(session), 0)
  })
}

const PANTALLAS = ['login', 'recuperar', 'nueva-clave', 'pendiente', 'app']
let sesionActiva // undefined hasta la primera llamada, para que siempre se pinte una pantalla
let turnoSesion = 0

async function obtenerRol(usuarioId) {
  const { data, error } = await supabase.from('perfiles').select('rol').eq('id', usuarioId).maybeSingle()
  if (error) toast('No se pudo verificar tu cuenta', 'error')
  return data?.rol ?? 'pendiente'
}

async function mostrarSesion(session, { forzar = false } = {}) {
  const turno = ++turnoSesion
  if (session) estado.recuperando = false
  let pantalla = estado.recuperando ? 'recuperar' : 'login'
  let rol = null
  if (session && estado.creandoClave) pantalla = 'nueva-clave'
  else if (session) {
    rol = await obtenerRol(session.user.id)
    if (turno !== turnoSesion) return // llegó otro cambio de sesión mientras tanto
    pantalla = rol === 'empleado' || rol === 'admin' ? 'app' : 'pendiente'
  }

  const clave = `${session?.user?.id ?? null}:${pantalla}:${rol}`
  if (clave === sesionActiva && !forzar) return
  sesionActiva = clave
  estado.rol = rol
  for (const p of PANTALLAS) $(`#${p}`).classList.toggle('hidden', p !== pantalla)

  if (pantalla === 'nueva-clave') {
    $('#nueva-clave-email').textContent = session.user.email
  } else if (pantalla === 'pendiente') {
    $('#pendiente-email').textContent = session.user.email
  } else if (pantalla === 'app') {
    $('#user-email').textContent = session.user.email
    $('#tab-personal').classList.toggle('hidden', rol !== 'admin')
    irAVista('venta')
    cargarProductos()
    if (rol === 'admin') cargarPersonal()
  } else if (pantalla === 'login') {
    estado.carrito.clear()
    mostrarAcceso('entrar')
  }
}

function mostrarAcceso(modo) {
  document.querySelectorAll('.segmento [data-acceso]').forEach((b) => b.classList.toggle('active', b.dataset.acceso === modo))
  $('#login-form').classList.toggle('hidden', modo !== 'entrar')
  $('#registro-form').classList.toggle('hidden', modo !== 'registro')
  $('#registro-listo').classList.toggle('hidden', modo !== 'listo')
  $('.segmento').classList.toggle('hidden', modo === 'listo')
}

$('#login').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-acceso]')
  if (btn) mostrarAcceso(btn.dataset.acceso)
})

$('#recuperar').addEventListener('click', (e) => {
  if (!e.target.closest('[data-acceso="entrar"]')) return
  estado.recuperando = false
  mostrarSesion(null, { forzar: true })
})

$('#registro-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = new FormData(e.target)
  const nombre = form.get('nombre').trim()
  const email = form.get('email').trim()
  const password = form.get('password')
  $('#registro-error').textContent = ''
  if (!nombre) return ($('#registro-error').textContent = 'Escribe tu nombre')
  if (password !== form.get('password2')) return ($('#registro-error').textContent = 'Las contraseñas no coinciden')

  const boton = e.target.querySelector('[type=submit]')
  boton.disabled = true
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nombre }, emailRedirectTo: location.origin + location.pathname },
  })
  boton.disabled = false
  if (error) {
    $('#registro-error').textContent = /registered|exists/i.test(error.message)
      ? 'Ese correo ya tiene cuenta. Usa "Entrar".'
      : /password/i.test(error.message)
        ? 'La contraseña es muy débil. Usa al menos 6 caracteres.'
        : 'No se pudo crear la cuenta. Intenta en un momento.'
    return
  }
  e.target.reset()
  // Si Supabase pide confirmar el correo, todavía no hay sesión
  if (!data.session) {
    $('#registro-email').textContent = email
    mostrarAcceso('listo')
  }
})

$('#pendiente-revisar').addEventListener('click', async () => {
  const { data } = await supabase.auth.getSession()
  await mostrarSesion(data.session, { forzar: true })
  if (estado.rol === 'pendiente') toast('Tu cuenta sigue pendiente de aprobación')
})
$('#pendiente-salir').addEventListener('click', () => supabase.auth.signOut())

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

// ---------- Recuperar contraseña ----------

// Supabase manda pocos correos por hora y cada correo nuevo invalida el enlace del
// anterior, así que se espera un minuto entre envíos y nunca se mandan dos a la vez.
const ESPERA_REENVIO = 60
let enviandoRecuperacion = false
let reenvioDisponibleEn = 0

function irARecuperar(mensaje = '') {
  const email = $('#login-form [name=email]').value.trim()
  if (email) $('#recuperar-form [name=email]').value = email
  $('#recuperar-error').textContent = mensaje
  estado.recuperando = true
  mostrarSesion(null, { forzar: true })
  $('#recuperar-form [name=email]').focus()
}

function actualizarBotonRecuperar() {
  const boton = $('#recuperar-form [type=submit]')
  const faltan = Math.ceil((reenvioDisponibleEn - Date.now()) / 1000)
  if (enviandoRecuperacion) {
    boton.disabled = true
    boton.textContent = 'Enviando…'
  } else if (faltan > 0) {
    boton.disabled = true
    boton.textContent = `Reenviar en ${faltan} s`
    setTimeout(actualizarBotonRecuperar, 1000)
  } else {
    boton.disabled = false
    boton.textContent = reenvioDisponibleEn ? 'Reenviar enlace' : 'Enviar enlace'
  }
}

$('#olvide').addEventListener('click', () => irARecuperar())

$('#recuperar-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  if (enviandoRecuperacion || Date.now() < reenvioDisponibleEn) return
  const email = new FormData(e.target).get('email').trim()
  $('#recuperar-error').textContent = ''
  enviandoRecuperacion = true
  actualizarBotonRecuperar()
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })
  enviandoRecuperacion = false
  if (error) {
    $('#recuperar-error').textContent =
      error.status === 429
        ? 'Se alcanzó el límite de correos por hora. Espera unos minutos y vuelve a intentarlo.'
        : 'No se pudo enviar el correo. Revisa el correo e intenta de nuevo.'
    actualizarBotonRecuperar()
    return
  }
  reenvioDisponibleEn = Date.now() + ESPERA_REENVIO * 1000
  actualizarBotonRecuperar()
  $('#recuperar-email').textContent = email
  $('#recuperar-enviado').classList.remove('hidden')
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
  estado.recuperando = false
  toast('Contraseña guardada')
  mostrarSesion({ user: data.user })
})

$('#logout').addEventListener('click', () => supabase.auth.signOut())

// ---------- Navegación ----------

function irAVista(vista) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === vista))
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${vista}`))
  if (vista === 'ventas') {
    cargarVentas(claveDia(new Date()))
    cargarDiasRecientes()
  }
  if (vista === 'personal') cargarPersonal()
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => irAVista(tab.dataset.view)))

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
  $('#ultima-venta').classList.add('hidden')
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
  actualizarCambio()
}

// Con cuánto paga el cliente (solo efectivo). Vacío = no se calcula cambio.
function pagoCon() {
  if ($('#metodo').value !== 'efectivo') return null
  const valor = $('#pago-con').value.trim()
  return valor === '' ? null : Number(valor)
}

function actualizarCambio() {
  const total = totalCarrito()
  const pago = pagoCon()
  const cambio = $('#cambio')
  $('#pago-efectivo').classList.toggle('hidden', $('#metodo').value !== 'efectivo')
  cambio.className = ''
  if (pago === null || estado.carrito.size === 0) cambio.textContent = '—'
  else if (pago < total) {
    cambio.textContent = `Faltan ${dinero.format(total - pago)}`
    cambio.className = 'falta'
  } else {
    cambio.textContent = dinero.format(pago - total)
    cambio.className = 'ok'
  }
  $('#cobrar').disabled = estado.carrito.size === 0 || (pago !== null && pago < total)
}

$('#metodo').addEventListener('change', actualizarCambio)
$('#pago-con').addEventListener('input', actualizarCambio)
$('#billetes').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-billete]')
  if (!btn) return
  $('#pago-con').value = btn.dataset.billete === 'exacto' ? totalCarrito() : btn.dataset.billete
  actualizarCambio()
})

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
  const total = totalCarrito()
  const pago = pagoCon()
  const { data: ventaId, error } = await supabase.rpc('registrar_venta', { items, metodo: $('#metodo').value, pago_con: pago })
  if (error) {
    actualizarCambio()
    return toast(`No se pudo registrar la venta: ${error.message}`, 'error')
  }
  toast(`Venta #${ventaId} registrada · ${dinero.format(total)}`)
  // El cambio queda a la vista hasta que se empiece la siguiente orden
  $('#ultima-venta').innerHTML =
    pago === null
      ? `Venta #${ventaId} registrada · ${dinero.format(total)}`
      : `Venta #${ventaId} · pagó con ${dinero.format(pago)}<br />Cambio: <strong>${dinero.format(pago - total)}</strong>`
  $('#ultima-venta').classList.remove('hidden')
  $('#pago-con').value = ''
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
    .select('id, total, metodo_pago, pago_con, cambio, created_at, cancelada_at, motivo_cancelacion, venta_items(nombre, cantidad, subtotal)')
    .gte('created_at', desdeClave(dia).toISOString())
    .lt('created_at', desdeClave(sumarDias(dia, 1)).toISOString())
    .order('created_at', { ascending: false })
  if (error) return toast('No se pudieron cargar las ventas', 'error')
  // Evitar pintar una respuesta vieja si se cambió de día mientras cargaba
  if ($('#ventas-fecha').value !== dia) return

  // Las canceladas se muestran pero no cuentan en los totales
  const validas = data.filter((v) => !v.cancelada_at)
  const canceladas = data.length - validas.length
  const total = validas.reduce((s, v) => s + Number(v.total), 0)
  const porMetodo = {}
  for (const v of validas) porMetodo[v.metodo_pago] = (porMetodo[v.metodo_pago] ?? 0) + Number(v.total)
  $('#resumen').innerHTML = `
    <span>${validas.length} ${validas.length === 1 ? 'venta' : 'ventas'}</span>
    <strong>${dinero.format(total)}</strong>
    ${Object.entries(porMetodo)
      .map(([m, t]) => `<span class="tag">${escapar(m)} ${dinero.format(t)}</span>`)
      .join('')}
    ${canceladas ? `<span class="tag tag-cancelada">${canceladas} ${canceladas === 1 ? 'cancelada' : 'canceladas'}</span>` : ''}`
  pintarCorte(dia, porMetodo.efectivo ?? 0)
  $('#ventas-lista').innerHTML = data.length
    ? data
        .map(
          (v) => `<li class="${v.cancelada_at ? 'cancelada' : ''}">
            <div class="venta-top">
              <strong>#${v.id}</strong>
              <span class="muted">${new Date(v.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
              <span class="tag">${escapar(v.metodo_pago)}</span>
              ${v.cancelada_at ? '<span class="tag tag-cancelada">Cancelada</span>' : ''}
              <strong class="right venta-total">${dinero.format(Number(v.total))}</strong>
              ${estado.rol === 'admin' && !v.cancelada_at ? `<button class="btn danger small" data-cancelar="${v.id}">Cancelar</button>` : ''}
            </div>
            <small class="muted">${v.venta_items.map((i) => `${i.cantidad}× ${escapar(i.nombre)}`).join(', ')}${
              v.pago_con !== null ? ` · pagó con ${dinero.format(Number(v.pago_con))}, cambio ${dinero.format(Number(v.cambio))}` : ''
            }</small>
            ${v.cancelada_at ? `<small class="motivo">Motivo: ${escapar(v.motivo_cancelacion)}</small>` : ''}
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
    .is('cancelada_at', null)
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
$('#ventas-lista').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-cancelar]')
  if (!btn) return
  const motivo = prompt(`¿Por qué se cancela la venta #${btn.dataset.cancelar}?`)
  if (motivo === null) return
  if (!motivo.trim()) return toast('Escribe el motivo para cancelar la venta', 'error')
  btn.disabled = true
  const { error } = await supabase.rpc('cancelar_venta', { venta_id: Number(btn.dataset.cancelar), motivo })
  if (error) {
    btn.disabled = false
    return toast(`No se pudo cancelar: ${error.message}`, 'error')
  }
  toast(`Venta #${btn.dataset.cancelar} cancelada`)
  cargarVentas()
  cargarDiasRecientes()
})

// ---------- Corte de caja ----------

const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone
let corteDia = { dia: null, efectivo: 0 } // día que muestra la tarjeta y sus ventas en efectivo

async function pintarCorte(dia, efectivo) {
  corteDia = { dia, efectivo }
  $('#corte-titulo').textContent = `Corte de caja de ${nombreDia(dia)}`
  $('#corte-efectivo').textContent = dinero.format(efectivo)
  const form = $('#corte-form')
  const { data: corte, error } = await supabase.from('cortes_caja').select('*').eq('dia', dia).maybeSingle()
  if (error) return toast('No se pudo cargar el corte de caja', 'error')
  if (corteDia.dia !== dia) return // se cambió de día mientras cargaba

  const aviso = $('#corte-guardado')
  if (corte) {
    const dif = Number(corte.diferencia)
    const cambiaron = Math.round(Number(corte.ventas_efectivo) * 100) !== Math.round(efectivo * 100)
    aviso.innerHTML = `<p>✅ Corte guardado por ${escapar(corte.creado_por_email ?? 'alguien')} a las ${new Date(corte.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}:
      contado ${dinero.format(Number(corte.efectivo_contado))} de ${dinero.format(Number(corte.efectivo_esperado))} esperados
      (${dif === 0 ? 'cuadra' : dif < 0 ? `faltan ${dinero.format(-dif)}` : `sobran ${dinero.format(dif)}`}).</p>
      ${corte.notas ? `<p class="muted">Notas: ${escapar(corte.notas)}</p>` : ''}
      ${cambiaron ? '<p><strong>Las ventas en efectivo cambiaron después del corte. Vuelve a contar y rehazlo.</strong></p>' : ''}`
    aviso.classList.toggle('alerta', cambiaron || dif !== 0)
    aviso.classList.remove('hidden')
    form.fondo.value = Number(corte.fondo_inicial)
    form.contado.value = Number(corte.efectivo_contado)
    form.notas.value = corte.notas ?? ''
    $('#corte-guardar').textContent = 'Rehacer corte'
  } else {
    aviso.classList.add('hidden')
    form.reset()
    $('#corte-guardar').textContent = 'Guardar corte'
  }
  calcularCorte()
}

function calcularCorte() {
  const form = $('#corte-form')
  const esperado = Number(form.fondo.value || 0) + corteDia.efectivo
  $('#corte-esperado').textContent = dinero.format(esperado)
  const el = $('#corte-diferencia')
  if (form.contado.value === '') {
    el.textContent = '—'
    el.className = ''
    return
  }
  const dif = Math.round((Number(form.contado.value) - esperado) * 100) / 100
  el.textContent = dif === 0 ? 'Cuadra' : dif < 0 ? `Faltan ${dinero.format(-dif)}` : `Sobran ${dinero.format(dif)}`
  el.className = dif === 0 ? 'cuadra' : dif < 0 ? 'falta' : 'sobra'
}

$('#corte-form').addEventListener('input', calcularCorte)

$('#corte-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const boton = $('#corte-guardar')
  boton.disabled = true
  const { data: corte, error } = await supabase.rpc('registrar_corte', {
    dia: corteDia.dia,
    zona: zonaHoraria,
    efectivo_contado: Number(form.contado.value),
    fondo_inicial: Number(form.fondo.value || 0),
    notas: form.notas.value,
  })
  boton.disabled = false
  if (error) return toast(`No se pudo guardar el corte: ${error.message}`, 'error')
  const dif = Number(corte.diferencia)
  toast(dif === 0 ? 'Corte guardado: la caja cuadra' : `Corte guardado: ${dif < 0 ? 'faltan' : 'sobran'} ${dinero.format(Math.abs(dif))}`, dif < 0 ? 'error' : 'ok')
  pintarCorte(corteDia.dia, corteDia.efectivo)
})

$('#dias-lista').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dia]')
  if (btn) cargarVentas(btn.dataset.dia)
})

// ---------- Personal (solo administradores) ----------

const ROLES = { pendiente: 'Pendiente', empleado: 'Empleado', admin: 'Administrador' }

async function cargarPersonal() {
  const { data, error } = await supabase
    .from('perfiles')
    .select('id, email, nombre, rol, created_at')
    .order('created_at', { ascending: false })
  if (error) return toast('No se pudo cargar el personal', 'error')
  const { data: sesion } = await supabase.auth.getSession()
  const yo = sesion.session?.user.id
  // Pendientes primero
  data.sort((a, b) => (a.rol === 'pendiente' ? 0 : 1) - (b.rol === 'pendiente' ? 0 : 1))

  const pendientes = data.filter((p) => p.rol === 'pendiente').length
  $('#tab-personal').textContent = pendientes ? `Personal (${pendientes})` : 'Personal'

  const acciones = (p) => {
    if (p.id === yo) return '<span class="muted">(tú)</span>'
    if (p.rol === 'pendiente') return `<button class="btn primary small" data-rol="empleado" data-id="${p.id}">Aprobar</button>`
    if (p.rol === 'empleado')
      return `<button class="btn ghost small" data-rol="admin" data-id="${p.id}">Hacer admin</button>
              <button class="btn danger small" data-rol="pendiente" data-id="${p.id}">Quitar acceso</button>`
    return `<button class="btn ghost small" data-rol="empleado" data-id="${p.id}">Quitar admin</button>`
  }
  $('#personal-tbody').innerHTML = data
    .map(
      (p) => `<tr>
        <td>${escapar(p.nombre ?? '—')}</td>
        <td>${escapar(p.email)}</td>
        <td><span class="tag ${p.rol === 'pendiente' ? 'tag-pendiente' : ''}">${ROLES[p.rol]}</span></td>
        <td class="right acciones">${acciones(p)}</td>
      </tr>`,
    )
    .join('')
}

$('#personal-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-rol]')
  if (!btn) return
  const { id, rol } = btn.dataset
  if (rol === 'pendiente' && !confirm('¿Quitarle el acceso a esta persona?')) return
  btn.disabled = true
  // .select() devuelve las filas cambiadas; vacío significa que RLS no lo permitió
  const { data, error } = await supabase.from('perfiles').update({ rol }).eq('id', id).select('email')
  if (error || !data.length) {
    btn.disabled = false
    return toast('No se pudo cambiar el acceso', 'error')
  }
  toast(rol === 'pendiente' ? `Se quitó el acceso a ${data[0].email}` : `${data[0].email} ahora es ${ROLES[rol].toLowerCase()}`)
  cargarPersonal()
})

iniciar()
