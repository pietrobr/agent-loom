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
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Filled,
  Dismiss20Regular,
  Search20Regular,
  PersonAccounts24Regular,
  PersonAdd20Regular,
  Copy20Regular,
} from "@fluentui/react-icons";
import { api, Tenant, DirectoryUser } from "../api";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "1100px" },
  head: { display: "flex", flexDirection: "column", gap: "4px" },
  titleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  formGrid: { display: "flex", flexDirection: "column", gap: "10px", minWidth: "360px" },
  recapRow: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  recapValue: {
    fontFamily: "monospace",
    background: tokens.colorNeutralBackground3,
    padding: "2px 6px",
    borderRadius: "4px",
    userSelect: "all",
  },
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

// UPN local part: ASCII, lowercase, alphanumeric only.
function slug(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => {});
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

  // New-user form state.
  const [newOpen, setNewOpen] = useState(false);
  const [nGiven, setNGiven] = useState("");
  const [nSurname, setNSurname] = useState("");
  const [nCompany, setNCompany] = useState("");
  const [nGroup, setNGroup] = useState("");
  const [domain, setDomain] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ upn: string; password: string; added_to?: string | null } | null>(
    null
  );
  const upnLocal = [slug(nGiven), slug(nSurname)].filter(Boolean).join(".");
  const upnPreview = upnLocal && domain ? `${upnLocal}@${domain}` : "";

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
    api.getCiamDomain().then((d) => setDomain(d.domain)).catch(() => {});
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

  function openNewUser() {
    setNGiven("");
    setNSurname("");
    setNCompany("");
    setNGroup(orgId || "");
    setNewOpen(true);
  }

  async function onCreateUser() {
    if (!upnPreview) {
      setErr("Enter a first and/or last name (the UPN is built from them).");
      return;
    }
    setCreating(true);
    setErr("");
    try {
      const res = await api.createCiamUser({
        given_name: nGiven.trim() || undefined,
        surname: nSurname.trim() || undefined,
        company: nCompany.trim() || undefined,
        org_id: nGroup || undefined,
      });
      setCreated({ upn: res.user.upn || upnPreview, password: res.temp_password, added_to: res.added_to });
      setNewOpen(false);
      // Reflect the new user in the lists.
      searchUsers(true);
      if (res.added_to && res.added_to === orgId) loadMembers(orgId);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <Text size={600} weight="semibold">
            Users
          </Text>
          <Button appearance="primary" icon={<PersonAdd20Regular />} onClick={openNewUser}>
            New user
          </Button>
        </div>
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

      {created && (
        <MessageBar intent="success">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
            <Text size={300} weight="semibold">
              User created{created.added_to ? ` and added to ${created.added_to}` : ""}. Share these
              credentials securely — the password is shown once and must be changed at first sign-in.
            </Text>
            <div className={styles.recapRow}>
              <Text size={200} style={{ minWidth: 76 }}>
                UPN
              </Text>
              <code className={styles.recapValue}>{created.upn}</code>
              <Button
                size="small"
                appearance="subtle"
                icon={<Copy20Regular />}
                onClick={() => copyText(created.upn)}
              >
                Copy
              </Button>
            </div>
            <div className={styles.recapRow}>
              <Text size={200} style={{ minWidth: 76 }}>
                Password
              </Text>
              <code className={styles.recapValue}>{created.password}</code>
              <Button
                size="small"
                appearance="subtle"
                icon={<Copy20Regular />}
                onClick={() => copyText(created.password)}
              >
                Copy
              </Button>
            </div>
            <div>
              <Button size="small" appearance="subtle" onClick={() => setCreated(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </MessageBar>
      )}

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

      <Dialog open={newOpen} onOpenChange={(_, d) => setNewOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>New user</DialogTitle>
            <DialogContent>
              <div className={styles.formGrid}>
                <div>
                  <Label>First name</Label>
                  <Input className={styles.grow} value={nGiven} onChange={(_, d) => setNGiven(d.value)} />
                </div>
                <div>
                  <Label>Last name</Label>
                  <Input className={styles.grow} value={nSurname} onChange={(_, d) => setNSurname(d.value)} />
                </div>
                <div>
                  <Label>User principal name (UPN) — auto-generated</Label>
                  <Input
                    className={styles.grow}
                    readOnly
                    disabled
                    value={upnPreview || "(enter first / last name)"}
                  />
                </div>
                <div>
                  <Label>Company</Label>
                  <Input className={styles.grow} value={nCompany} onChange={(_, d) => setNCompany(d.value)} />
                </div>
                <div>
                  <Label>Add to customer group (optional)</Label>
                  <Dropdown
                    value={customers.find((c) => c.org_id === nGroup)?.name || ""}
                    selectedOptions={nGroup ? [nGroup] : []}
                    onOptionSelect={(_, d) => setNGroup(d.optionValue || "")}
                    placeholder="No group"
                  >
                    <Option value="">No group</Option>
                    {customers.map((c) => (
                      <Option key={c.org_id} value={c.org_id}>
                        {c.name}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" disabled={creating}>
                  Cancel
                </Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={creating || !upnPreview}
                onClick={onCreateUser}
              >
                {creating ? "Creating…" : "Create"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
