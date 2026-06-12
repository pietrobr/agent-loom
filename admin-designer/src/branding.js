import { useEffect, useState } from "react";
const DEFAULTS = {
    PRODUCT_NAME: "AgentLoom",
    PRODUCT_TAGLINE: "Weave agents for every customer",
    PRIMARY_COLOR: "#5B5FC7",
    LOGO_URL: "/logo.svg",
};
/** Loads /branding.json (served from public/), with env overrides. */
export function useBranding() {
    const [b, setB] = useState(DEFAULTS);
    useEffect(() => {
        fetch("/branding.json")
            .then((r) => (r.ok ? r.json() : {}))
            .then((j) => {
            const env = import.meta.env || {};
            setB({
                PRODUCT_NAME: env.VITE_PRODUCT_NAME || j.PRODUCT_NAME || DEFAULTS.PRODUCT_NAME,
                PRODUCT_TAGLINE: env.VITE_PRODUCT_TAGLINE || j.PRODUCT_TAGLINE || DEFAULTS.PRODUCT_TAGLINE,
                PRIMARY_COLOR: env.VITE_PRIMARY_COLOR || j.PRIMARY_COLOR || DEFAULTS.PRIMARY_COLOR,
                LOGO_URL: env.VITE_LOGO_URL || j.LOGO_URL || DEFAULTS.LOGO_URL,
            });
        })
            .catch(() => setB(DEFAULTS));
    }, []);
    return b;
}
