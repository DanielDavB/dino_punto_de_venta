import { supabase, enlace } from './supabase.js'

const $ = (sel) => document.querySelector(sel)
const dinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const billete = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
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
    irAHoy()
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

// ---------- Ventana de cobro ----------

const cobro = {
  metodo: 'efectivo',
  total: 0,
  enviando: false,
}

// Sugerencias de pago: exacto y los billetes/redondeos que alcanzan para el total
function sugerenciasPago(total) {
  const opciones = new Set()
  for (const paso of [10, 50, 100]) opciones.add(Math.ceil(total / paso) * paso)
  for (const billete of [200, 500, 1000]) if (billete >= total) opciones.add(billete)
  opciones.delete(total)
  return [...opciones].filter((v) => v > total).sort((a, b) => a - b).slice(0, 4)
}

function pagoCobro() {
  const valor = $('#cobro-pago').value.trim()
  return valor === '' ? null : Number(valor)
}

function elegirMetodo(metodo) {
  cobro.metodo = metodo
  document.querySelectorAll('#cobro [data-metodo]').forEach((b) => {
    b.classList.toggle('active', b.dataset.metodo === metodo)
    b.setAttribute('aria-checked', b.dataset.metodo === metodo)
  })
  $('#cobro-efectivo').classList.toggle('hidden', metodo !== 'efectivo')
  actualizarCobro()
  if (metodo === 'efectivo') $('#cobro-pago').focus()
}

// Se recalcula con cada tecla: muestra el cambio exacto o cuánto falta
function actualizarCobro() {
  const pago = pagoCobro()
  const cambio = $('#cobro-cambio')
  const etiqueta = $('#cobro-cambio-etiqueta')
  cambio.className = ''
  let listo = true
  if (cobro.metodo === 'efectivo') {
    if (pago === null) {
      etiqueta.textContent = 'Cambio'
      cambio.textContent = '—'
      listo = false
    } else if (pago < cobro.total) {
      etiqueta.textContent = 'Faltan'
      cambio.textContent = dinero.format(cobro.total - pago)
      cambio.className = 'falta'
      listo = false
    } else {
      etiqueta.textContent = 'Cambio'
      cambio.textContent = dinero.format(pago - cobro.total)
      cambio.className = 'ok'
    }
  }
  $('#cobro-confirmar').disabled = !listo || cobro.enviando
}

function abrirCobro() {
  if (estado.carrito.size === 0) return
  cobro.total = totalCarrito()
  cobro.enviando = false
  $('#cobro-items').innerHTML = [...estado.carrito.values()]
    .map(
      ({ producto: p, cantidad }) => `<li>
        <span>${cantidad}× ${escapar(p.nombre)}</span>
        <span>${dinero.format(p.precio * cantidad)}</span>
      </li>`,
    )
    .join('')
  $('#cobro-total').textContent = dinero.format(cobro.total)
  $('#cobro-billetes').innerHTML = [
    `<button type="button" class="chip" data-pago="${cobro.total}">Exacto</button>`,
    ...sugerenciasPago(cobro.total).map((v) => `<button type="button" class="chip" data-pago="${v}">${billete.format(v)}</button>`),
  ].join('')
  $('#cobro-pago').value = ''
  $('#cobro-error').textContent = ''
  $('#cobro-form').classList.remove('hidden')
  $('#cobro-listo').classList.add('hidden')
  $('#cobro').showModal()
  elegirMetodo('efectivo')
}

function cerrarCobro() {
  if (!cobro.enviando) $('#cobro').close()
}

$('#cobrar').addEventListener('click', abrirCobro)
$('#cobro-cancelar').addEventListener('click', cerrarCobro)
$('#cobro-nueva').addEventListener('click', cerrarCobro)
$('#cobro').addEventListener('cancel', (e) => {
  // Esc: no cerrar mientras se registra la venta
  if (cobro.enviando) e.preventDefault()
})
$('#cobro-pago').addEventListener('input', actualizarCobro)
$('#cobro').addEventListener('click', (e) => {
  const metodo = e.target.closest('[data-metodo]')
  if (metodo) return elegirMetodo(metodo.dataset.metodo)
  const sugerencia = e.target.closest('[data-pago]')
  if (sugerencia) {
    $('#cobro-pago').value = sugerencia.dataset.pago
    actualizarCobro()
    $('#cobro-pago').focus()
  }
})

$('#cobro-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  if ($('#cobro-confirmar').disabled) return
  const pago = cobro.metodo === 'efectivo' ? pagoCobro() : null
  const items = [...estado.carrito.values()].map(({ producto, cantidad }) => ({ producto_id: producto.id, cantidad }))
  cobro.enviando = true
  $('#cobro-error').textContent = ''
  $('#cobro-confirmar').textContent = 'Registrando…'
  actualizarCobro()
  const { data: ventaId, error } = await supabase.rpc('registrar_venta', { items, metodo: cobro.metodo, pago_con: pago })
  cobro.enviando = false
  $('#cobro-confirmar').textContent = 'Confirmar cobro'
  actualizarCobro()
  if (error) return ($('#cobro-error').textContent = `No se pudo registrar la venta: ${error.message}`)

  // Pantalla final: lo importante es cuánto cambio entregar
  $('#cobro-listo-titulo').textContent = `Venta #${ventaId} registrada`
  $('#cobro-listo-cambio').innerHTML =
    pago === null
      ? `<span>Total cobrado</span><strong>${dinero.format(cobro.total)}</strong>`
      : `<span>Entrega de cambio</span><strong>${dinero.format(pago - cobro.total)}</strong>
         <small class="muted">Pagó con ${dinero.format(pago)} · total ${dinero.format(cobro.total)}</small>`
  $('#cobro-form').classList.add('hidden')
  $('#cobro-listo').classList.remove('hidden')
  $('#cobro-nueva').focus()
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
// Para listas: 'Hoy', 'Ayer' o 'Lun 12 oct'
const nombreDiaCorto = (clave) => {
  const nombre = nombreDia(clave)
  if (nombre === 'hoy' || nombre === 'ayer') return nombre
  const fecha = desdeClave(clave)
  const semana = fecha.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '')
  const mes = fecha.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')
  return `${semana} ${fecha.getDate()} ${mes}`
}

const claveMes = (fecha) => `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
const desdeMes = (clave) => {
  const [a, m] = clave.split('-').map(Number)
  return new Date(a, m - 1, 1)
}
const sumarMeses = (clave, n) => {
  const fecha = desdeMes(clave)
  fecha.setMonth(fecha.getMonth() + n)
  return claveMes(fecha)
}
const etiquetaDia = (clave) => {
  const nombre = nombreDia(clave)
  if (nombre === 'hoy' || nombre === 'ayer') return `Ventas de ${nombre}`
  return `Ventas del ${desdeClave(clave).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}`
}
const etiquetaMes = (clave) =>
  clave === claveMes(new Date())
    ? 'Ventas del mes'
    : `Ventas de ${desdeMes(clave).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`

// Supabase devuelve como máximo 1000 filas por consulta: se piden por partes
async function traerTodas(consulta) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999)
    if (error) return { data: null, error }
    filas.push(...data)
    if (data.length < 1000) return { data: filas, error: null }
  }
}

const periodo = () => $('#ventas-periodo').value

function mostrarControlesPeriodo() {
  const mes = periodo() === 'mes'
  $('#ventas-fecha').classList.toggle('hidden', mes)
  $('#ventas-mes').classList.toggle('hidden', !mes)
  $('#corte').classList.toggle('hidden', mes) // el corte es por día
}

function irAHoy() {
  mostrarControlesPeriodo()
  if (periodo() === 'mes') cargarMes(claveMes(new Date()))
  else cargarVentas(claveDia(new Date()))
}

function recargarPeriodo() {
  if (periodo() === 'mes') cargarMes()
  else cargarVentas()
}

async function cargarMes(mes = $('#ventas-mes').value || claveMes(new Date())) {
  const actual = claveMes(new Date())
  if (mes > actual) mes = actual
  $('#ventas-mes').value = mes
  $('#ventas-mes').max = actual
  $('#dia-siguiente').disabled = mes >= actual
  $('#ventas-periodo').options[1].textContent = etiquetaMes(mes)

  const { data, error } = await traerTodas(() =>
    supabase
      .from('ventas')
      .select('total, metodo_pago, created_at, cancelada_at')
      .gte('created_at', desdeMes(mes).toISOString())
      .lt('created_at', desdeMes(sumarMeses(mes, 1)).toISOString())
      .order('created_at', { ascending: false }),
  )
  if (error) return toast('No se pudieron cargar las ventas del mes', 'error')
  if (periodo() !== 'mes' || $('#ventas-mes').value !== mes) return // cambió mientras cargaba

  const validas = data.filter((v) => !v.cancelada_at)
  const canceladas = data.length - validas.length
  const total = validas.reduce((s, v) => s + Number(v.total), 0)
  const porMetodo = {}
  const dias = new Map() // 'YYYY-MM-DD' -> { ventas, total }, del más reciente al más viejo
  for (const v of validas) {
    porMetodo[v.metodo_pago] = (porMetodo[v.metodo_pago] ?? 0) + Number(v.total)
    const clave = claveDia(new Date(v.created_at))
    const d = dias.get(clave) ?? { ventas: 0, total: 0 }
    d.ventas++
    d.total += Number(v.total)
    dias.set(clave, d)
  }
  $('#resumen').innerHTML = `
    <span>${validas.length} ${validas.length === 1 ? 'venta' : 'ventas'}</span>
    <strong>${dinero.format(total)}</strong>
    ${Object.entries(porMetodo)
      .map(([m, t]) => `<span class="tag">${escapar(m)} ${dinero.format(t)}</span>`)
      .join('')}
    ${canceladas ? `<span class="tag tag-cancelada">${canceladas} ${canceladas === 1 ? 'cancelada' : 'canceladas'}</span>` : ''}
    ${dias.size ? `<span class="muted">${dias.size} ${dias.size === 1 ? 'día' : 'días'} con ventas, promedio ${dinero.format(total / dias.size)} por día</span>` : ''}`
  $('#ventas-lista').innerHTML = dias.size
    ? `<li class="mes-dias-titulo muted">Toca un día para ver su detalle</li>` +
      [...dias]
        .map(
          ([clave, d]) => `<li class="mes-dia"><button class="dia" data-dia="${clave}">
            <span class="dia-nombre">${escapar(nombreDiaCorto(clave))}</span>
            <span class="muted">${d.ventas} ${d.ventas === 1 ? 'venta' : 'ventas'}</span>
            <strong>${dinero.format(d.total)}</strong>
          </button></li>`,
        )
        .join('')
    : '<li class="muted">No hubo ventas este mes.</li>'
}

function abrirDia(dia) {
  $('#ventas-periodo').value = 'dia'
  mostrarControlesPeriodo()
  cargarVentas(dia)
}

async function cargarVentas(dia = $('#ventas-fecha').value || claveDia(new Date())) {
  const hoy = claveDia(new Date())
  if (dia > hoy) dia = hoy
  $('#ventas-fecha').value = dia
  $('#ventas-fecha').max = hoy
  $('#dia-siguiente').disabled = dia >= hoy
  $('#ventas-periodo').options[0].textContent = etiquetaDia(dia)
  marcarDiaActivo()

  const { data, error } = await traerTodas(() =>
    supabase
      .from('ventas')
      .select('id, total, metodo_pago, pago_con, cambio, created_at, cancelada_at, motivo_cancelacion, venta_items(nombre, cantidad, subtotal)')
      .gte('created_at', desdeClave(dia).toISOString())
      .lt('created_at', desdeClave(sumarDias(dia, 1)).toISOString())
      .order('created_at', { ascending: false }),
  )
  if (error) return toast('No se pudieron cargar las ventas', 'error')
  // Evitar pintar una respuesta vieja si se cambió de día o de vista mientras cargaba
  if (periodo() !== 'dia' || $('#ventas-fecha').value !== dia) return

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
  const { data, error } = await traerTodas(() =>
    supabase
      .from('ventas')
      .select('total, created_at')
      .is('cancelada_at', null)
      .gte('created_at', desdeClave(desde).toISOString())
      .order('created_at', { ascending: false }),
  )
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
            <span class="dia-nombre">${escapar(nombreDiaCorto(clave))}</span>
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

$('#ventas-periodo').addEventListener('change', () => {
  mostrarControlesPeriodo()
  // Al pasar a "mes" se abre el mes del día que se estaba viendo, y viceversa
  if (periodo() === 'mes') cargarMes(($('#ventas-fecha').value || claveDia(new Date())).slice(0, 7))
  else cargarVentas()
})
$('#ventas-fecha').addEventListener('change', (e) => e.target.value && cargarVentas(e.target.value))
$('#ventas-mes').addEventListener('change', (e) => e.target.value && cargarMes(e.target.value))
function moverPeriodo(n) {
  if (periodo() === 'mes') cargarMes(sumarMeses($('#ventas-mes').value, n))
  else cargarVentas(sumarDias($('#ventas-fecha').value, n))
}
$('#dia-anterior').addEventListener('click', () => moverPeriodo(-1))
$('#dia-siguiente').addEventListener('click', () => moverPeriodo(1))
$('#ir-hoy').addEventListener('click', irAHoy)
$('#ventas-lista').addEventListener('click', (e) => {
  const btn = e.target.closest('.mes-dia [data-dia]')
  if (btn) abrirDia(btn.dataset.dia)
})
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
  recargarPeriodo()
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
  if (btn) abrirDia(btn.dataset.dia)
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
