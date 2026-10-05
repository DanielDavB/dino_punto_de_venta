-- Registro abierto con aprobación: cualquiera puede crear cuenta, pero solo el
-- personal aprobado (rol 'empleado' o 'admin') puede ver y modificar datos.

create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text,
  rol text not null default 'pendiente' check (rol in ('pendiente', 'empleado', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.perfiles enable row level security;

-- Funciones de apoyo para las políticas (security definer para poder leer perfiles sin recursión)
create or replace function public.es_personal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol in ('empleado', 'admin'))
$$;

create or replace function public.es_admin()
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

-- Cada usuario nuevo de Auth recibe un perfil (pendiente si se registró solo)
create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Las invitaciones solo se mandan desde el panel de Supabase, así que esas cuentas ya vienen aprobadas
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

-- Los usuarios que ya existían conservan su acceso; el dueño es administrador
insert into public.perfiles (id, email, rol)
select id, email, case when email = 'danieldavilabarrios@gmail.com' then 'admin' else 'empleado' end
from auth.users
on conflict (id) do nothing;

-- Perfiles: cada quien ve el suyo; el admin ve todos y cambia el rol de los demás
create policy "ver mi perfil o todos si soy admin" on public.perfiles
  for select to authenticated using (id = (select auth.uid()) or (select public.es_admin()));
create policy "admin cambia rol de otros" on public.perfiles
  for update to authenticated
  using ((select public.es_admin()) and id <> (select auth.uid()))
  with check ((select public.es_admin()) and id <> (select auth.uid()));

-- Datos del negocio: ahora solo personal aprobado
alter policy "personal lee productos" on public.productos using ((select public.es_personal()));
alter policy "personal crea productos" on public.productos with check ((select public.es_personal()));
alter policy "personal edita productos" on public.productos using ((select public.es_personal())) with check ((select public.es_personal()));
alter policy "personal elimina productos" on public.productos using ((select public.es_personal()));
alter policy "personal lee ventas" on public.ventas using ((select public.es_personal()));
alter policy "personal lee items" on public.venta_items using ((select public.es_personal()));

-- registrar_venta también exige personal aprobado
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
