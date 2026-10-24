do $$
declare
  canonical_function oid := to_regprocedure('public.hold_slots(integer, date, integer[])');
  existing_function record;
begin
  if canonical_function is null then
    raise exception 'EXPECTED_HOLD_SLOTS_FUNCTION_MISSING';
  end if;

  for existing_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'hold_slots'
      and p.prokind = 'f'
      and p.oid <> canonical_function
  loop
    execute format('drop function %s', existing_function.signature);
  end loop;

  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'hold_slots'
      and p.prokind = 'f'
  ) <> 1 then
    raise exception 'HOLD_SLOTS_OVERLOAD_REMAINS';
  end if;
end
$$;

revoke all on function public.hold_slots(integer, date, integer[]) from public;
grant execute on function public.hold_slots(integer, date, integer[]) to anon, authenticated;
notify pgrst, 'reload schema';
