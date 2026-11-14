grant delete on table public.contact_messages to authenticated;

drop policy if exists "Admins delete contact messages" on public.contact_messages;
create policy "Admins delete contact messages"
    on public.contact_messages for delete to authenticated
    using (public.is_admin());
