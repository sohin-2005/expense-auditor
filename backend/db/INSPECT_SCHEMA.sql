-- Run this FIRST in the Supabase SQL editor and send me the output.
-- It reports what your tables actually contain, so the migration can be
-- matched to reality instead of to an assumption about it.
select table_name,
       string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) as columns
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('profiles', 'policies', 'expenses', 'claims', 'travel_plans')
 group by table_name
 order by table_name;
