import { useEffect, useState } from "react";
import {
  Button, Card, Field, Select, Spinner, Table, TableBody, TableCell, TableHeader,
  TableHeaderCell, TableRow, makeStyles, tokens,
} from "@fluentui/react-components";
import { api, type FeedbackDetail, type FeedbackRating, type FeedbackRow, type Instance, type Tenant } from "../api";

const useStyles = makeStyles({
  filters: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: "12px", marginBottom: "16px" },
  table: { overflowX: "auto" },
  detail: { marginTop: "16px", padding: "16px" },
  content: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: tokens.colorNeutralForeground1 },
});

function useFeedbackRequest<T>(load: (signal: AbortSignal) => Promise<T> | undefined, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    const request = load(controller.signal);
    setLoading(!!request);
    request?.then(
      (value) => { if (!controller.signal.aborted) setData(value); },
      (e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load feedback.");
      },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, deps);
  return { data, error, loading };
}

export function FeedbackPage() {
  const styles = useStyles();
  const [orgId, setOrgId] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [rating, setRating] = useState<FeedbackRating | "">("");
  const [turnId, setTurnId] = useState("");
  const [revision, setRevision] = useState(0);
  const customers = useFeedbackRequest<Tenant[]>((signal) => api.listCustomers(signal), [revision]);
  const assistants = useFeedbackRequest<Instance[]>((signal) => orgId ? api.listInstances(orgId, signal) : undefined, [orgId, revision]);
  const rows = useFeedbackRequest<FeedbackRow[]>((signal) => orgId ? api.listFeedback(orgId, instanceId, rating, signal) : undefined,
    [orgId, instanceId, rating, revision]);
  const detail = useFeedbackRequest<FeedbackDetail>((signal) => orgId && turnId ? api.getFeedback(orgId, turnId, signal) : undefined,
    [orgId, turnId, revision]);

  return (
    <section aria-label="Feedback">
      <h1>Feedback</h1>
      <p>Review the latest 50 matching ratings and comments for a customer.</p>
      <div className={styles.filters}>
        <Field label="Customer">
          <Select value={orgId} onChange={(_, data) => {
            setOrgId(data.value);
            setInstanceId("");
            setTurnId("");
          }}>
            <option value="">Select a customer</option>
            {customers.data?.map((customer) => <option key={customer.org_id} value={customer.org_id}>{customer.name}</option>)}
          </Select>
        </Field>
        <Field label="Assistant">
          <Select value={instanceId} disabled={!orgId} onChange={(_, data) => {
            setInstanceId(data.value);
            setTurnId("");
          }}>
            <option value="">All assistants</option>
            {assistants.data?.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.display_name}</option>)}
          </Select>
        </Field>
        <Field label="Rating">
          <Select value={rating} onChange={(_, data) => {
            setRating(data.value === "up" || data.value === "down" ? data.value : "");
            setTurnId("");
          }}>
            <option value="">All ratings</option>
            <option value="up">Helpful</option>
            <option value="down">Not helpful</option>
          </Select>
        </Field>
        <Button onClick={() => setRevision((value) => value + 1)}>Refresh</Button>
      </div>
      {[customers.error, assistants.error, rows.error, detail.error].filter(Boolean).map((error, index) => (
        <p key={index} role="alert">{error}</p>
      ))}
      {(customers.loading || rows.loading) && <Spinner size="small" label="Loading feedback" />}
      {!!rows.data?.length && (
        <div className={styles.table}>
          <Table aria-label="Customer feedback">
            <TableHeader><TableRow>
              <TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Assistant</TableHeaderCell>
              <TableHeaderCell>Rating</TableHeaderCell><TableHeaderCell>Comment</TableHeaderCell>
              <TableHeaderCell>Details</TableHeaderCell>
            </TableRow></TableHeader>
            <TableBody>{rows.data.map((row) => (
              <TableRow key={row.turn_id}>
                <TableCell>{new Date(row.feedback.submitted_at).toLocaleString()}</TableCell>
                <TableCell>{assistants.data?.find((assistant) => assistant.id === row.instance_id)?.display_name || row.instance_id}</TableCell>
                <TableCell>{row.feedback.rating === "up" ? "Helpful" : "Not helpful"}</TableCell>
                <TableCell className={styles.content}>{row.feedback.comment || "No comment"}</TableCell>
                <TableCell><Button onClick={() => setTurnId(row.turn_id)}>View answer</Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
      )}
      {rows.data?.length === 0 && <p>No feedback matches these filters.</p>}
      {detail.loading && <Spinner size="small" label="Loading answer" />}
      {detail.data && turnId && (
        <Card className={styles.detail}>
          <h2>Reviewed answer</h2>
          <p className={styles.content}>{detail.data.feedback.comment || "No comment"}</p>
          <p className={styles.content}>{detail.data.answer}</p>
          <h3>Cited sources</h3>
          {detail.data.sources.length ? detail.data.sources.map((source) => (
            <details key={source.number}>
              <summary>[{source.number}] {source.title}</summary>
              <p>{source.source}</p>
              <blockquote className={styles.content}>{source.content}</blockquote>
            </details>
          )) : <p>No sources were cited.</p>}
          <Button onClick={() => setTurnId("")}>Close details</Button>
        </Card>
      )}
    </section>
  );
}
