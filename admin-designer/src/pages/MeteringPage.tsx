import { useEffect, useState } from "react";
import {
  Card,
  Text,
  Dropdown,
  Option,
  Field,
  Spinner,
  MessageBar,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  makeStyles,
} from "@fluentui/react-components";
import { api, Metering, Tenant } from "../api";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "760px" },
  stats: { display: "flex", gap: "16px" },
  stat: { padding: "16px", flexGrow: 1, textAlign: "center" },
});

export function MeteringPage() {
  const styles = useStyles();
  const [customers, setCustomers] = useState<Tenant[]>([]);
  const [orgId, setOrgId] = useState("");
  const [data, setData] = useState<Metering | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .listCustomers()
      .then((c) => {
        setCustomers(c);
        if (c.length) setOrgId(c[0].org_id);
      })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    setErr("");
    api
      .metering(orgId)
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [orgId]);

  return (
    <div className={styles.wrap}>
      <Field label="Customer">
        <Dropdown
          value={customers.find((c) => c.org_id === orgId)?.name || ""}
          selectedOptions={[orgId]}
          onOptionSelect={(_, d) => setOrgId(d.optionValue || "")}
        >
          {customers.map((c) => (
            <Option key={c.org_id} value={c.org_id}>
              {c.name}
            </Option>
          ))}
        </Dropdown>
      </Field>

      {loading && <Spinner label="Loading…" />}
      {err && <MessageBar intent="error">{err}</MessageBar>}

      {data && (
        <>
          <div className={styles.stats}>
            <Card className={styles.stat}>
              <Text size={700} weight="bold">
                {data.calls}
              </Text>
              <div>
                <Text size={200}>total calls</Text>
              </div>
            </Card>
            <Card className={styles.stat}>
              <Text size={700} weight="bold">
                {data.total_tokens.toLocaleString()}
              </Text>
              <div>
                <Text size={200}>total tokens</Text>
              </div>
            </Card>
          </div>

          <Card>
            <Text weight="semibold">Usage by instance</Text>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Instance</TableHeaderCell>
                  <TableHeaderCell>Calls</TableHeaderCell>
                  <TableHeaderCell>Tokens</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(data.by_instance).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell>
                      <code>{k}</code>
                    </TableCell>
                    <TableCell>{v.calls}</TableCell>
                    <TableCell>{v.tokens.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {Object.keys(data.by_instance).length === 0 && (
                  <TableRow>
                    <TableCell>No usage yet</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
