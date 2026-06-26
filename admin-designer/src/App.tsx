import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Tab,
  TabList,
  Text,
  Button,
  makeStyles,
  tokens,
  Badge,
  Avatar,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
} from "@fluentui/react-components";
import { useBranding } from "./branding";
import { brandGradient } from "./theme";
import { getToken, devAdminLogin } from "./api";
import { authEnabled, currentUser, signOut, signIn } from "./auth";
import { TemplatesPage } from "./pages/TemplatesPage";
import { CustomersPage } from "./pages/CustomersPage";
import { UsersPage } from "./pages/UsersPage";
import { InstancesPage } from "./pages/InstancesPage";
import { MeteringPage } from "./pages/MeteringPage";
import { CostsPage } from "./pages/CostsPage";
import { TracingPage } from "./pages/TracingPage";
import { InfraPage } from "./pages/InfraPage";

const useStyles = makeStyles({
  shell: { minHeight: "100vh", display: "flex", flexDirection: "column" },
  demoBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "6px 12px",
    backgroundColor: "#053B5E",
    color: "#EAFBFF",
    borderBottom: "2px solid #00A8A8",
    fontSize: "12px",
    fontWeight: 600,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 24px",
    color: "#fff",
  },
  logo: { height: "32px", width: "32px" },
  spacer: { flexGrow: 1 },
  body: { padding: "24px", flexGrow: 1, backgroundColor: tokens.colorNeutralBackground2 },
  tokenRow: { display: "flex", gap: "8px", alignItems: "center" },
});

export function App() {
  const styles = useStyles();
  const branding = useBranding();
  const loc = useLocation();
  const navigate = useNavigate();
  const [signedOut, setSignedOut] = useState(false);

  // Keep the browser tab title in sync with the configured brand.
  useEffect(() => {
    document.title = `${branding.PRODUCT_NAME} · SaaS Admin Console`;
  }, [branding.PRODUCT_NAME]);

  const tabValue = loc.pathname.startsWith("/customers")
    ? "/customers"
    : loc.pathname.startsWith("/users")
    ? "/users"
    : loc.pathname.startsWith("/instances")
    ? "/instances"
    : loc.pathname.startsWith("/metering")
    ? "/metering"
    : loc.pathname.startsWith("/tracing")
    ? "/tracing"
    : loc.pathname.startsWith("/costs")
    ? "/costs"
    : loc.pathname.startsWith("/infra")
    ? "/infra"
    : "/";

  const prod = authEnabled();
  const user = prod ? currentUser() : null;
  const userLabel = user?.username || user?.name || "";

  async function doSignOut() {
    try {
      await signOut();
    } finally {
      setSignedOut(true);
    }
  }

  // After signing out, show a calm goodbye screen instead of the login mask.
  if (signedOut) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          textAlign: "center",
          padding: 24,
        }}
      >
        <img src={branding.LOGO_URL} alt="logo" style={{ height: 48, marginBottom: 4 }} />
        <Text size={600} weight="semibold">You've been signed out</Text>
        <Text size={300} style={{ color: tokens.colorNeutralForeground3, maxWidth: 420 }}>
          It's now safe to close this tab.
        </Text>
        <Button appearance="primary" style={{ marginTop: 8 }} onClick={() => signIn()}>
          Sign in again
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {!prod && (
        <div className={styles.demoBanner}>
          ⚠️ DEMO MODE — admin sign-in is simulated (dev tokens). In production this uses Microsoft Entra ID.
        </div>
      )}
      <header className={styles.header} style={{ background: brandGradient(branding.PRIMARY_COLOR) }}>
        <img src={branding.LOGO_URL} className={styles.logo} alt="logo" />
        <Text weight="bold" size={500}>
          {branding.PRODUCT_NAME} · SaaS Admin Console
        </Text>
        <Badge appearance="tint" color="informative" title="App version (major.minor.build)">
          v{__APP_VERSION__}
        </Badge>
        <div className={styles.spacer} />
        <div className={styles.tokenRow}>
          {prod ? (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button appearance="transparent" style={{ color: "#fff" }}>
                  <Avatar size={24} color="colorful" name={user?.name || userLabel} />
                  <span style={{ marginInlineStart: 8 }}>{userLabel}</span>
                </Button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={() => doSignOut()}>Sign out</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          ) : (
            <>
              <Button
                size="small"
                appearance="primary"
                onClick={async () => {
                  try {
                    await devAdminLogin();
                    location.reload();
                  } catch (e: any) {
                    alert(e.message);
                  }
                }}
              >
                Demo admin login
              </Button>
              {getToken() ? (
                <Badge color="success" appearance="filled">
                  authed
                </Badge>
              ) : (
                <Badge color="warning" appearance="filled">
                  no token
                </Badge>
              )}
            </>
          )}
        </div>
      </header>

      <TabList
        selectedValue={tabValue}
        style={{ paddingInline: 16 }}
        onTabSelect={(_, d) => navigate(String(d.value))}
      >
        <Tab value="/">Templates</Tab>
        <Tab value="/customers">Customers</Tab>
        <Tab
          value="/users"
          disabled={!prod}
          title={prod ? "Manage customer users" : "Available only in production (Entra External ID)"}
        >
          Users
        </Tab>
        <Tab value="/instances">Instances</Tab>
        <Tab value="/metering">Metering</Tab>
        <Tab value="/tracing">Tracing</Tab>
        <Tab value="/costs">Costs</Tab>
        <Tab value="/infra">Infra</Tab>
      </TabList>

      <main className={styles.body}>
        <Routes>
          <Route path="/" element={<TemplatesPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/instances" element={<InstancesPage />} />
          <Route path="/metering" element={<MeteringPage />} />
          <Route path="/tracing" element={<TracingPage />} />
          <Route path="/costs" element={<CostsPage />} />
          <Route path="/infra" element={<InfraPage />} />
        </Routes>
      </main>
    </div>
  );
}
