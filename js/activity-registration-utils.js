window.hmpssiActivityRegistrationUtils = {
    isValidGroupInviteUrl(value) {
        if (typeof value !== "string" || value !== value.trim()) {
            return false;
        }

        let url;
        try {
            url = new URL(value);
        } catch {
            return false;
        }
        if (url.protocol !== "https:" || url.username || url.password) {
            return false;
        }

        const segments = url.pathname.split("/").filter(Boolean);
        const isInviteCode = (code) => /^[A-Za-z0-9_-]+$/.test(code);
        if (url.hostname === "chat.whatsapp.com" || url.hostname === "discord.gg") {
            return segments.length === 1 && isInviteCode(segments[0]);
        }
        if (url.hostname === "discord.com") {
            return segments.length === 2 && segments[0] === "invite" && isInviteCode(segments[1]);
        }
        if (url.hostname === "t.me" || url.hostname === "telegram.me") {
            if (segments.length === 1) {
                return (
                    /^\+[A-Za-z0-9_-]+$/.test(segments[0]) ||
                    /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(segments[0])
                );
            }
            return segments.length === 2 && segments[0] === "joinchat" && isInviteCode(segments[1]);
        }
        return false;
    },
};
