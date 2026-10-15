-- Esquema completo del punto de venta DinoTacos.
-- Aplicado al proyecto ysnuuvnhyxoqgsdmtpoe. Para recrearlo en otro proyecto basta con este archivo.

-- ============ Tablas ============

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
  metodo_pago text not null default 'efectivo' check (metodo_pago in ('efectivo', 'tarjeta', 'transferencia')),
  -- Con cuánto pagó el cliente en efectivo; el cambio se calcula solo
  pago_con numeric(10,2) check (pago_con >= 0),
  cambio numeric(10,2) generated always as (pago_con - total) stored,
  creado_por uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  -- Cancelación: la venta no se borra, queda marcada con quién, cuándo y por qué
  cancelada_at timestamptz,
  cancelada_por uuid references auth.users(id),
  motivo_cancelacion text,
  constraint pago_con_alcanza check (pago_con is null or pago_con >= total),
  constraint cancelacion_completa check (
    (cancelada_at is null and cancelada_por is null and motivo_cancelacion is null)
    or (cancelada_at is not null and char_length(trim(motivo_cancelacion)) > 0)
  )
);

-- Guarda nombre y precio del momento: borrar o editar un producto no altera el historial
create table public.venta_items (
  id bigint generated always as identity primary key,
  venta_id bigint not null references public.ventas(id) on delete cascade,
  producto_id bigint references public.productos(id) on delete set null,
  nombre text not null,
  precio numeric(10,2) not null,
  cantidad integer not null check (cantidad > 0),
  subtotal numeric(10,2) generated always as (precio * cantidad) stored
);

-- Rol de cada cuenta: 'pendiente' hasta que un admin la apruebe
create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text,
  rol text not null default 'pendiente' check (rol in ('pendiente', 'empleado', 'admin')),
  created_at timestamptz not null default now()
);

-- Un corte de caja por día; rehacerlo lo reemplaza
create table public.cortes_caja (
  id bigint generated always as identity primary key,
  dia date not null unique,
  zona_horaria text not null,
  num_ventas integer not null,
  total_ventas numeric(10,2) not null,
  ventas_efectivo numeric(10,2) not null,
  ventas_tarjeta numeric(10,2) not null,
  ventas_transferencia numeric(10,2) not null,
  fondo_inicial numeric(10,2) not null default 0 check (fondo_inicial >= 0),
  efectivo_esperado numeric(10,2) not null,
  efectivo_contado numeric(10,2) not null check (efectivo_contado >= 0),
  diferencia numeric(10,2) generated always as (efectivo_contado - efectivo_esperado) stored,
  notas text,
  creado_por uuid references auth.users(id) default auth.uid(),
  creado_por_email text,
  created_at timestamptz not null default now()
);

create index venta_items_venta_id_idx on public.venta_items(venta_id);
create index venta_items_producto_id_idx on public.venta_items(producto_id);
create index ventas_creado_por_idx on public.ventas(creado_por);
create index ventas_cancelada_por_idx on public.ventas(cancelada_por);
create index ventas_created_at_idx on public.ventas(created_at desc);
create index cortes_caja_creado_por_idx on public.cortes_caja(creado_por);

-- ============ Quién es personal y quién es admin ============

create function public.es_personal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol in ('empleado', 'admin'))
$$;

create function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin')
$$;

revoke execute on function public.es_personal() from public, anon;
revoke execute on function public.es_admin() from public, anon;
grant execute on function public.es_personal() to authenticated;
grant execute on function public.es_admin() to authenticated;

-- Cada usuario nuevo recibe un perfil: pendiente si se registró solo, empleado si fue invitado
create function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, email, nombre, rol)
  values (new.id, new.email, nullif(trim(new.raw_user_meta_data->>'nombre'), ''),
          case when new.invited_at is not null then 'empleado' else 'pendiente' end);
  return new;
end;
$$;

revoke execute on function public.crear_perfil() from public, anon, authenticated;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- ============ Permisos (Row Level Security) ============

alter table public.productos enable row level security;
alter table public.ventas enable row level security;
alter table public.venta_items enable row level security;
alter table public.perfiles enable row level security;
alter table public.cortes_caja enable row level security;

create policy "personal lee productos" on public.productos for select to authenticated using ((select public.es_personal()));
create policy "personal crea productos" on public.productos for insert to authenticated with check ((select public.es_personal()));
create policy "personal edita productos" on public.productos for update to authenticated using ((select public.es_personal())) with check ((select public.es_personal()));
create policy "personal elimina productos" on public.productos for delete to authenticated using ((select public.es_personal()));

-- Ventas, items y cortes solo se leen; se escriben únicamente con las funciones de abajo
create policy "personal lee ventas" on public.ventas for select to authenticated using ((select public.es_personal()));
create policy "personal lee items" on public.venta_items for select to authenticated using ((select public.es_personal()));
create policy "personal lee cortes" on public.cortes_caja for select to authenticated using ((select public.es_personal()));

-- Cada quien ve su perfil; el admin ve todos y cambia el rol de los demás (nunca el propio)
create policy "ver mi perfil o todos si soy admin" on public.perfiles
  for select to authenticated using (id = (select auth.uid()) or (select public.es_admin()));
create policy "admin cambia rol de otros" on public.perfiles
  for update to authenticated
  using ((select public.es_admin()) and id <> (select auth.uid()))
  with check ((select public.es_admin()) and id <> (select auth.uid()));

-- ============ Funciones del punto de venta ============

-- Registra una venta de forma atómica. Los precios salen de la tabla productos, así el
-- navegador no puede mandar un total alterado. pago_con solo aplica a efectivo (puede ser null).
create function public.registrar_venta(items jsonb, metodo text, pago_con numeric)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venta_id bigint;
  v_total numeric(10,2);
  v_validos int;
  v_pago_con numeric(10,2) := case when metodo = 'efectivo' then pago_con end;
begin
  if not public.es_personal() then
    raise exception 'No autorizado';
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
  if v_pago_con is not null and v_pago_con < v_total then
    raise exception 'El pago no alcanza para el total';
  end if;

  insert into public.ventas (total, metodo_pago, pago_con, creado_por)
  values (v_total, metodo, v_pago_con, auth.uid())
  returning id into v_venta_id;

  insert into public.venta_items (venta_id, producto_id, nombre, precio, cantidad)
  select v_venta_id, p.id, p.nombre, p.precio, (i->>'cantidad')::int
  from jsonb_array_elements(items) i
  join public.productos p on p.id = (i->>'producto_id')::bigint;

  return v_venta_id;
end;
$$;

revoke execute on function public.registrar_venta(jsonb, text, numeric) from public, anon;
grant execute on function public.registrar_venta(jsonb, text, numeric) to authenticated;

-- Solo un administrador cancela, y siempre con motivo
create function public.cancelar_venta(venta_id bigint, motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cancelar ventas';
  end if;
  if motivo is null or char_length(trim(motivo)) = 0 then
    raise exception 'Escribe el motivo de la cancelación';
  end if;

  update public.ventas
     set cancelada_at = now(), cancelada_por = auth.uid(), motivo_cancelacion = trim(motivo)
   where id = venta_id and cancelada_at is null;
  if not found then
    raise exception 'La venta no existe o ya estaba cancelada';
  end if;
end;
$$;

revoke execute on function public.cancelar_venta(bigint, text) from public, anon;
grant execute on function public.cancelar_venta(bigint, text) to authenticated;

-- Corte de caja: los totales se calculan aquí, no en el navegador. Las canceladas no cuentan.
create function public.registrar_corte(dia date, zona text, efectivo_contado numeric, fondo_inicial numeric default 0, notas text default null)
returns public.cortes_caja
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cortes_caja;
begin
  if not public.es_personal() then
    raise exception 'No autorizado';
  end if;
  if efectivo_contado is null or efectivo_contado < 0 or coalesce(fondo_inicial, 0) < 0 then
    raise exception 'Cantidades inválidas';
  end if;
  perform now() at time zone zona; -- falla si la zona horaria no existe

  insert into public.cortes_caja as c (
    dia, zona_horaria, num_ventas, total_ventas, ventas_efectivo, ventas_tarjeta, ventas_transferencia,
    fondo_inicial, efectivo_esperado, efectivo_contado, notas, creado_por, creado_por_email, created_at)
  select registrar_corte.dia, zona, count(*), coalesce(sum(total), 0),
         coalesce(sum(total) filter (where metodo_pago = 'efectivo'), 0),
         coalesce(sum(total) filter (where metodo_pago = 'tarjeta'), 0),
         coalesce(sum(total) filter (where metodo_pago = 'transferencia'), 0),
         coalesce(fondo_inicial, 0),
         coalesce(fondo_inicial, 0) + coalesce(sum(total) filter (where metodo_pago = 'efectivo'), 0),
         efectivo_contado, nullif(trim(notas), ''), auth.uid(),
         (select email from auth.users where id = auth.uid()), now()
  from public.ventas
  where cancelada_at is null
    and (created_at at time zone zona)::date = registrar_corte.dia
  on conflict on constraint cortes_caja_dia_key do update set
    zona_horaria = excluded.zona_horaria, num_ventas = excluded.num_ventas, total_ventas = excluded.total_ventas,
    ventas_efectivo = excluded.ventas_efectivo, ventas_tarjeta = excluded.ventas_tarjeta,
    ventas_transferencia = excluded.ventas_transferencia, fondo_inicial = excluded.fondo_inicial,
    efectivo_esperado = excluded.efectivo_esperado, efectivo_contado = excluded.efectivo_contado,
    notas = excluded.notas, creado_por = excluded.creado_por, creado_por_email = excluded.creado_por_email,
    created_at = excluded.created_at
  returning c.* into v;

  return v;
end;
$$;

revoke execute on function public.registrar_corte(date, text, numeric, numeric, text) from public, anon;
grant execute on function public.registrar_corte(date, text, numeric, numeric, text) to authenticated;
