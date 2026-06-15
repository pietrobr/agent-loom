import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { authEnabled, ensureSignedIn } from "./auth";

async function bootstrap() {
  // In production (Entra ID configured) sign in and cache an API token before
  // rendering. In dev mode this is a no-op and the demo login button is used.
  if (authEnabled()) {
    try {
      await ensureSignedIn();
    } catch (e) {
      console.error("sign-in failed", e);
    }
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <FluentProvider theme={webLightTheme}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </FluentProvider>
    </React.StrictMode>
  );
}

bootstrap();
