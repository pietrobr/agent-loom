import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { App } from "./App";
import { authEnabled, ensureSignedIn } from "./auth";
async function bootstrap() {
    // In production (Entra External ID configured) sign in and cache an API token
    // before rendering. In dev mode this is a no-op and the demo switcher is used.
    if (authEnabled()) {
        try {
            await ensureSignedIn();
        }
        catch (e) {
            console.error("sign-in failed", e);
        }
    }
    ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(FluentProvider, { theme: webLightTheme, children: _jsx(App, {}) }) }));
}
bootstrap();
