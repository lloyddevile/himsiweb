alter table public.activity_registration_private_settings
    drop constraint if exists activity_registration_private_settings_whatsapp_group_link_check;

alter table public.activity_registration_private_settings
    add constraint activity_registration_private_settings_whatsapp_group_link_check
    check (
        whatsapp_group_link is null
        or whatsapp_group_link ~* '^https://(chat\.whatsapp\.com/[A-Za-z0-9_-]+|discord\.gg/[A-Za-z0-9_-]+|discord\.com/invite/[A-Za-z0-9_-]+|(t\.me|telegram\.me)/([A-Za-z][A-Za-z0-9_]{4,31}|[+][A-Za-z0-9_-]+|joinchat/[A-Za-z0-9_-]+))([?#][^[:space:]]*)?$'
    );
