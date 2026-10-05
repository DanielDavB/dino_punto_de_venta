# 🦖 DinoTacos · Punto de venta

Punto de venta sencillo para el restaurante DinoTacos, conectado a su propio proyecto de Supabase (`dinotacos`, ref `vkiixgxhmqdzibylnxyy`).

## Qué hace

- **Venta**: tocas productos del menú para agregarlos a la orden, ajustas cantidades con − / +, quitas productos con ✕, eliges método de pago y cobras.
- **Productos**: agregas productos al menú (nombre, precio, categoría) y los eliminas.
- **Ventas del día**: lista de las ventas de hoy con su detalle y el total vendido.

## Cómo correrlo

No necesita compilarse: son archivos estáticos (HTML, CSS y JS) que funcionan tal cual.

- **En línea**: https://danieldavb.github.io/dino_punto_de_venta/ (GitHub Pages con GitHub Actions: cada push que cambia la app se publica solo con `.github/workflows/pages.yml`, y también se puede lanzar a mano desde la pestaña Actions).
- **En tu computadora**: `npm install` y `npm run dev`, luego abre http://localhost:5173.

La URL y la clave publicable de Supabase están en `src/config.js`. La librería de Supabase va incluida en `vendor/supabase.js`; para actualizarla: `npm update @supabase/supabase-js && npm run vendor`.

## Crear usuarios para el personal

Solo usuarios con sesión iniciada pueden ver o modificar datos. Para dar acceso a un empleado:

1. Entra a [Supabase → Authentication → Users](https://supabase.com/dashboard/project/vkiixgxhmqdzibylnxyy/auth/users).
2. **Add user → Create new user**, escribe correo y contraseña, y marca **Auto Confirm User**.

## Base de datos

El esquema está en `supabase/migrations/` (ya aplicado al proyecto):

| Tabla | Para qué |
| --- | --- |
| `productos` | El menú (nombre, precio, categoría) |
| `ventas` | Cada venta cobrada (total, método de pago, quién la hizo) |
| `venta_items` | Productos de cada venta; guarda nombre y precio del momento, así borrar un producto no altera el historial |

Las ventas se registran con la función `registrar_venta`, que toma los precios directamente de la tabla `productos` para que el total no se pueda alterar desde el navegador. Todas las tablas tienen Row Level Security activado.

## Capturas

| Venta | Productos | Ventas del día |
| --- | --- | --- |
| ![Venta](capturas/2-venta.png) | ![Productos](capturas/3-productos.png) | ![Ventas del día](capturas/4-ventas-del-dia.png) |
