import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  Text,
  Input,
  Label,
  Dropdown,
  Option,
  Avatar,
  Spinner,
  Badge,
  MessageBar,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Filled,
  Dismiss20Regular,
  Search20Regular,
  PersonAccounts24Regular,
} from "@fluentui/react-icons";
import { api, Tenant, DirectoryUser } from "../api";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "1100px" },
  head: { display: "flex", flexDirection: "column", gap: "4px" },
  pickRow: { display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" },
  cols: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" },
  card: { padding: "12px", display: "flex", flexDirection: "column", gap: "10px" },
  searchRow: { display: "flex", gap: "8px", alignItems: "center" },
  list: { display: "flex", flexDirection: "column", gap: "6px", maxHeight: "60vh", overflowY: "auto" },
  userRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  userMeta: { display: "flex", flexDirection: "column", minWidth: 0 },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  grow: { flexGrow: 1, minWidth: 0 },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    padding: "32px 16px",
    color: tokens.colorNeutralForeground3,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
  },
});

function displayName(u: DirectoryUser): string {
  return (
    u.display_name ||
    [u.given_name, u.surname].filter(Boolean).join(" ") ||
    u.upn ||
    u.mail ||
    u.id
  );
}
function subtitle(u: DirectoryUser): string {
  return u.upn || u.mail || "";
}

export function UsersPage() {
  const styles = useStyles();
  const [customers, setCustomers] = useState<Tenant[]>([]);
  const [orgId, setOrgId] = useState<string>("");

  const [members, setMembers] = useState<DirectoryUser[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [nextSkip, setNextSkip] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [busyId, setBusyId] = useState<string>("");
  const [err, setErr] = useState("");

  const memberIds = new Set(members.map((m) => m.id));
  const selected = customers.find((c) => c.org_id === orgId);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listCustomers();
        setCustomers(list);
        if (list.length) setOrgId(list[0].org_id);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
    searchUsers(true, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (orgId) loadMembers(orgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function loadMembers(org: string) {
    setLoadingMembers(true);
    setErr("");
    try {
      setMembers(await api.listGroupMembers(org));
    } catch (e: any) {
      setMembers([]);
      setErr(e.message);
    } finally {
      setLoadingMembers(false);
    }
  }

  async function searchUsers(reset: boolean, search?: string) {
    setLoadingUsers(true);
    setErr("");
    try {
      const term = search !== undefined ? search : searchInput;
      const page = await api.listCiamUsers({
        search: term || undefined,
        skipToken: reset ? undefined : nextSkip || undefined,
        limit: 25,
      });
      if (page.error) setErr(page.error);
      setUsers((prev) => (reset ? page.users : [...prev, ...page.users]));
      setNextSkip(page.next_skip_token ?? null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function onAdd(u: DirectoryUser) {
    if (!orgId) return;
    setBusyId(u.id);
    setErr("");
    try {
      await api.addGroupMember(orgId, u.id);
      setMembers((prev) => (prev.some((m) => m.id === u.id) ? prev : [...prev, u]));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId("");
    }
  }

  async function onRemove(u: DirectoryUser) {
    if (!orgId) return;
    setBusyId(u.id);
    setErr("");
    try {
      await api.removeGroupMember(orgId, u.id);
      setMembers((prev) => prev.filter((m) => m.id !== u.id));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <Text size={600} weight="semibold">
          Users
        </Text>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          Browse users in the customers (Entra External ID) directory and add or remove them
          from a customer's access group. Membership of a customer's group is what grants a
          user access to that customer's app.
        </Text>
      </div>

      <div className={styles.pickRow}>
        <div>
          <Label>Customer</Label>
          <Dropdown
            value={selected?.name || ""}
            selectedOptions={orgId ? [orgId] : []}
            onOptionSelect={(_, d) => setOrgId(d.optionValue || "")}
            placeholder="Select a customer"
          >
            {customers.map((c) => (
              <Option key={c.org_id} value={c.org_id}>
                {c.name}
              </Option>
            ))}
          </Dropdown>
        </div>
      </div>

      {err && <MessageBar intent="error">{err}</MessageBar>}

      <div className={styles.cols}>
        {/* Directory users */}
        <Card className={styles.card}>
          <CardHeader header={<Text weight="semibold">Directory users</Text>} />
          <form
            className={styles.searchRow}
            onSubmit={(e) => {
              e.preventDefault();
              searchUsers(true);
            }}
          >
            <Input
              className={styles.grow}
              placeholder="Search by name, email or UPN…"
              value={searchInput}
              contentBefore={<Search20Regular />}
              onChange={(_, d) => setSearchInput(d.value)}
            />
            <Button type="submit" appearance="primary" disabled={loadingUsers}>
              Search
            </Button>
            {searchInput && (
              <Button
                appearance="subtle"
                onClick={() => {
                  setSearchInput("");
                  searchUsers(true, "");
                }}
              >
                Clear
              </Button>
            )}
          </form>

          {users.length === 0 && !loadingUsers ? (
            <div className={styles.empty}>
              <PersonAccounts24Regular />
              <Text size={200}>No users found.</Text>
            </div>
          ) : (
            <div className={styles.list}>
              {users.map((u) => {
                const isMember = memberIds.has(u.id);
                return (
                  <div key={u.id} className={styles.userRow}>
                    <Avatar size={28} color="colorful" name={displayName(u)} />
                    <div className={`${styles.userMeta} ${styles.grow}`}>
                      <Text className={styles.ellipsis} size={300} weight="semibold">
                        {displayName(u)}
                      </Text>
                      <Text className={styles.ellipsis} size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        {subtitle(u)}
                      </Text>
                    </div>
                    {isMember ? (
                      <Badge appearance="tint" color="success">
                        Member
                      </Badge>
                    ) : (
                      <Button
                        size="small"
                        appearance="primary"
                        icon={<Add20Filled />}
                        disabled={!orgId || busyId === u.id}
                        onClick={() => onAdd(u)}
                      >
                        Add
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className={styles.searchRow}>
            {loadingUsers && <Spinner size="tiny" />}
            {nextSkip && !loadingUsers && (
              <Button appearance="subtle" onClick={() => searchUsers(false)}>
                Load more
              </Button>
            )}
          </div>
        </Card>

        {/* Group members */}
        <Card className={styles.card}>
          <CardHeader
            header={
              <Text weight="semibold">
                Group members{selected ? ` · ${selected.name}` : ""}
              </Text>
            }
            description={
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {members.length} user{members.length === 1 ? "" : "s"}
              </Text>
            }
          />
          {loadingMembers ? (
            <Spinner size="tiny" />
          ) : members.length === 0 ? (
            <div className={styles.empty}>
              <PersonAccounts24Regular />
              <Text size={200}>No members yet. Add users from the directory.</Text>
            </div>
          ) : (
            <div className={styles.list}>
              {members.map((u) => (
                <div key={u.id} className={styles.userRow}>
                  <Avatar size={28} color="colorful" name={displayName(u)} />
                  <div className={`${styles.userMeta} ${styles.grow}`}>
                    <Text className={styles.ellipsis} size={300} weight="semibold">
                      {displayName(u)}
                    </Text>
                    <Text className={styles.ellipsis} size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      {subtitle(u)}
                    </Text>
                  </div>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<Dismiss20Regular />}
                    disabled={busyId === u.id}
                    onClick={() => onRemove(u)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
