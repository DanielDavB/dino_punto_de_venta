-- Esquema del punto de venta DinoTacos (ya aplicado al proyecto vkiixgxhmqdzibylnxyy)

create table public.productos (
  id bigint generated always as identity primary key,
  nombre text not null check (char_length(trim(nombre)) > 0),
  precio numeric(10,2) not null check (precio >= 0),
  categoria text not null default 'General',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.ventas (
  id bigint generated always as identity primary key,
  total numeric(10,2) not null check (total >= 0),
  metodo_pago text not null default 'efectivo' check (metodo_pago in ('efectivo','tarjeta','transferencia')),
  creado_por uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.venta_items (
  id bigint generated always as identity primary key,
  venta_id bigint not null references public.ventas(id) on delete cascade,
  producto_id bigint references public.productos(id) on delete set null,
  nombre text not null,
  precio numeric(10,2) not null,
  cantidad integer not null check (cantidad > 0),
  subtotal numeric(10,2) generated always as (precio * cantidad) stored
);

create index venta_items_venta_id_idx on public.venta_items(venta_id);
create index venta_items_producto_id_idx on public.venta_items(producto_id);
create index ventas_creado_por_idx on public.ventas(creado_por);
create index ventas_created_at_idx on public.ventas(created_at desc);

alter table public.productos enable row level security;
alter table public.ventas enable row level security;
alter table public.venta_items enable row level security;

-- Solo personal autenticado puede operar el punto de venta
create policy "personal lee productos" on public.productos for select to authenticated using (true);
create policy "personal crea productos" on public.productos for insert to authenticated with check (true);
create policy "personal edita productos" on public.productos for update to authenticated using (true) with check (true);
create policy "personal elimina productos" on public.productos for delete to authenticated using (true);

create policy "personal lee ventas" on public.ventas for select to authenticated using (true);
create policy "personal lee items" on public.venta_items for select to authenticated using (true);

-- Registra una venta de forma atómica. Los precios se toman de la tabla productos,
-- así el cliente no puede mandar un total alterado. Es la única vía para crear ventas.
create or replace function public.registrar_venta(items jsonb, metodo text default 'efectivo')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venta_id bigint;
  v_total numeric(10,2);
  v_validos int;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  select count(*), sum(p.precio * (i->>'cantidad')::int)
    into v_validos, v_total
  from jsonb_array_elements(items) i
  join public.productos p on p.id = (i->>'producto_id')::bigint and p.activo
  where (i->>'cantidad')::int > 0;

  if v_validos <> jsonb_array_length(items) then
    raise exception 'Algún producto no existe, no está activo o tiene cantidad inválida';
  end if;

  insert into public.ventas (total, metodo_pago, creado_por)
  values (v_total, metodo, auth.uid())
  returning id into v_venta_id;

  insert into public.venta_items (venta_id, producto_id, nombre, precio, cantidad)
  select v_venta_id, p.id, p.nombre, p.precio, (i->>'cantidad')::int
  from jsonb_array_elements(items) i
  join public.productos p on p.id = (i->>'producto_id')::bigint;

  return v_venta_id;
end;
$$;

revoke execute on function public.registrar_venta(jsonb, text) from public, anon;
grant execute on function public.registrar_venta(jsonb, text) to authenticated;

-- Menú inicial de ejemplo
insert into public.productos (nombre, precio, categoria) values
  ('Taco de pastor', 22, 'Tacos'),
  ('Taco de asada', 25, 'Tacos'),
  ('Taco de suadero', 22, 'Tacos'),
  ('Gringa', 55, 'Especialidades'),
  ('Quesadilla', 40, 'Especialidades'),
  ('Agua fresca', 25, 'Bebidas'),
  ('Refresco', 30, 'Bebidas');
