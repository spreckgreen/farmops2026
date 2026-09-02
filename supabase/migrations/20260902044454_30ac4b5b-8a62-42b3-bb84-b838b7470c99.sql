revoke all on function public.has_electrical_read(uuid) from public;
revoke all on function public.has_electrical_field_write(uuid) from public;
grant execute on function public.has_electrical_read(uuid) to authenticated, service_role;
grant execute on function public.has_electrical_field_write(uuid) to authenticated, service_role;