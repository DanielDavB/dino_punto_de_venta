-- Cambio en efectivo, cancelación de ventas y corte de caja

-- 1) Con cuánto pagó el cliente en efectivo; el cambio se calcula solo
alter table public.ventas
  add column pago_con numeric(10,2) check (pago_con >= 0),
  add column cambio numeric(10,2) generated always as (pago_con - total) stored,
  -- 2) Cancelación: la venta no se borra, queda marcada con quién, cuándo y por qué
  add column cancelada_at timestamptz,
  add column cancelada_por uuid references auth.users(id),
  add column motivo_cancelacion text,
  add constraint pago_con_alcanza check (pago_con is null or pago_con >= total),
  add constraint cancelacion_completa check (
    (cancelada_at is null and cancelada_por is null and motivo_cancelacion is null)
    or (cancelada_at is not null and char_length(trim(motivo_cancelacion)) > 0)
  );

create index ventas_cancelada_por_idx on public.ventas(cancelada_por);

-- registrar_venta con pago_con. Se agrega junto a la versión de 2 parámetros (sin borrarla)
-- para que la app ya publicada siga funcionando; pago_con es obligatorio (puede ser null)
-- para que PostgREST no confunda una con otra.
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

-- 3) Corte de caja: uno por día; rehacerlo lo reemplaza
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

create index cortes_caja_creado_por_idx on public.cortes_caja(creado_por);

alter table public.cortes_caja enable row level security;
create policy "personal lee cortes" on public.cortes_caja for select to authenticated using ((select public.es_personal()));

-- Los totales se calculan aquí, no en el navegador. Las ventas canceladas no cuentan.
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
