const envFlag = (value: string | undefined, defaultValue: boolean): boolean => {
    if (value === undefined) return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
};

// Kill switch: set NEXT_PUBLIC_ENABLE_JCS_INTEGRATION=false to disable JCS UI/features quickly.
export const ENABLE_JCS_INTEGRATION = envFlag(process.env.NEXT_PUBLIC_ENABLE_JCS_INTEGRATION, true);

// Strict stale cleanup is intentionally off by default.
export const ENABLE_JCS_STRICT_STALE_CLEANUP = envFlag(
    process.env.NEXT_PUBLIC_JCS_ALLOW_AUTO_CLEAR_STALE,
    false
);
