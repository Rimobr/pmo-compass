-- As funções da autonomia do time não são para quem não está logado (mesma regra do endurecimento do banco)
revoke all on function public.team_policy(text), public.team_can_touch_item(text, text), public.team_item_exists(text, text), public.backlog_items_member_guard() from public, anon;
grant execute on function public.team_policy(text), public.team_can_touch_item(text, text), public.team_item_exists(text, text) to authenticated, service_role;
