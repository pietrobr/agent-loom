import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Tab,
  TabList,
  Text,
  Button,
  makeStyles,
  tokens,
  Badge,
} from "@fluentui/react-components";
import { useBranding } from "./branding";
import { brandGradient } from "./theme";
import { getToken, clearToken, devAdminLogin } from "./api";
import { TemplatesPage } from "./pages/TemplatesPage";
import { CustomersPage } from "./pages/CustomersPage";
import { InstancesPage } from "./pages/InstancesPage";
import { MeteringPage } from "./pages/MeteringPage";

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

  const tabValue = loc.pathname.startsWith("/customers")
    ? "/customers"
    : loc.pathname.startsWith("/instances")
    ? "/instances"
    : loc.pathname.startsWith("/metering")
    ? "/metering"
    : "/";

  return (
    <div className={styles.shell}>
      <div className={styles.demoBanner}>
        ⚠️ DEMO MODE — admin sign-in is simulated (dev tokens). In production this uses Microsoft Entra ID.
      </div>
      <header className={styles.header} style={{ background: brandGradient(branding.PRIMARY_COLOR) }}>
        <img src={branding.LOGO_URL} className={styles.logo} alt="logo" />
        <Text weight="bold" size={500}>
          {branding.PRODUCT_NAME} · SaaS Admin Console
        </Text>
        <div className={styles.spacer} />
        <div className={styles.tokenRow}>
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
          {getToken() && (
            <Button
              size="small"
              appearance="transparent"
              style={{ color: "#fff" }}
              onClick={() => {
                clearToken();
                location.reload();
              }}
            >
              clear
            </Button>
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
        <Tab value="/instances">Instances</Tab>
        <Tab value="/metering">Metering</Tab>
      </TabList>

      <main className={styles.body}>
        <Routes>
          <Route path="/" element={<TemplatesPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/instances" element={<InstancesPage />} />
          <Route path="/metering" element={<MeteringPage />} />
        </Routes>
      </main>
    </div>
  );
}
