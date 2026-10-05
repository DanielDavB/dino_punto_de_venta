# 🦖 DinoTacos · Punto de venta

Punto de venta sencillo para el restaurante DinoTacos, conectado a su propio proyecto de Supabase (`dinotacos`, ref `vkiixgxhmqdzibylnxyy`).

## Qué hace

- **Venta**: tocas productos del menú para agregarlos a la orden, ajustas cantidades con − / +, quitas productos con ✕, eliges método de pago y cobras.
- **Productos**: agregas productos al menú (nombre, precio, categoría) y los eliminas.
- **Ventas del día**: lista de las ventas de hoy con su detalle y el total vendido.

## Cómo correrlo

```bash
npm install
cp .env.example .env   # ya trae la URL y la clave pública del proyecto
npm run dev
```

Abre http://localhost:5173. Para publicarlo, `npm run build` genera la carpeta `dist/`, que puedes subir a Netlify, Vercel o cualquier hosting estático (configura ahí las mismas variables de `.env`).

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
