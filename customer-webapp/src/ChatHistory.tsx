import { useState, type DragEvent } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, mergeClasses,
  Field, Input, Select, Spinner, makeStyles, tokens,
} from "@fluentui/react-components";
import { Add20Regular, FolderAdd20Regular, MoreHorizontal20Regular, Pin16Filled } from "@fluentui/react-icons";
import type { ChatFolder, ConversationChanges, ConversationSummary } from "./api";

const useStyles = makeStyles({
  sidebar: {
    width: "min(245px, 42vw)", flexShrink: 0, boxSizing: "border-box", padding: "14px 10px",
    overflowY: "auto", borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  toolbar: { display: "flex", gap: "4px", flexWrap: "wrap" },
  heading: { margin: "14px 8px 8px", fontSize: tokens.fontSizeBase300 },
  row: { display: "flex", alignItems: "center", gap: "2px", marginBottom: "4px" },
  draggable: { cursor: "grab", "& button:first-child": { cursor: "grab" } },
  title: { flex: "1 1 0", minWidth: 0, justifyContent: "flex-start", textAlign: "left", overflowWrap: "anywhere" },
  note: { margin: "8px", color: tokens.colorNeutralForeground3 },
  folder: { marginBottom: "6px" },
  summary: { padding: "5px 8px", cursor: "pointer", overflowWrap: "anywhere" },
  dropTarget: { borderRadius: tokens.borderRadiusMedium },
  dropActive: {
    backgroundColor: tokens.colorBrandBackground2,
    outline: `2px solid ${tokens.colorBrandStroke1}`,
    outlineOffset: "-2px",
  },
  fields: { display: "grid", gap: "12px" },
});

const CHAT_DRAG_TYPE = "application/x-agentloom-chat";

interface Props {
  chats: ConversationSummary[];
  folders: ChatFolder[];
  activeId?: string;
  loading: boolean;
  error: string;
  disabled: boolean;
  onNewChat: () => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onCreateFolder: (name: string) => Promise<void>;
  onUpdate: (id: string, changes: ConversationChanges) => Promise<void>;
}

export function ChatHistory({
  chats, folders, activeId, loading, error, disabled, onNewChat, onOpen, onRetry, onCreateFolder, onUpdate,
}: Props) {
  const styles = useStyles();
  const [dialog, setDialog] = useState<"folder" | ConversationSummary>();
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draggedId, setDraggedId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string | null>();
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState("");
  const creatingFolder = dialog === "folder";
  const pinnedChats = chats.filter((chat) => chat.pinned);
  const recent = chats.filter((chat) => !chat.pinned && !chat.folder_id);
  const draggedChat = chats.find((chat) => chat.conversation_id === draggedId);
  const canDrag = !disabled && !dialog && !moving;

  function clearDrag() {
    setDraggedId(undefined);
    setDropTarget(undefined);
  }

  function dropZone(target: string | null, className?: string) {
    const accepts = canDrag && draggedChat && (draggedChat.folder_id || null) !== target;
    function dragOver(event: DragEvent) {
      if (!accepts || !event.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(target);
    }
    return {
      className: mergeClasses(className, styles.dropTarget, accepts && dropTarget === target && styles.dropActive),
      onDragEnter: dragOver,
      onDragOver: dragOver,
      onDragLeave: (event: DragEvent) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
          setDropTarget((current) => current === target ? undefined : current);
        }
      },
      onDrop: async (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return;
        event.preventDefault();
        const id = event.dataTransfer.getData(CHAT_DRAG_TYPE);
        clearDrag();
        if (!accepts || id !== draggedChat.conversation_id) return;
        setMoving(true);
        setMoveError("");
        try {
          await onUpdate(id, { folder_id: target });
        } catch (e) {
          setMoveError(e instanceof Error ? e.message : "Could not move this chat.");
        } finally {
          setMoving(false);
        }
      },
    };
  }

  function edit(target: "folder" | ConversationSummary) {
    setName(target === "folder" ? "" : target.title || "Untitled chat");
    setFolderId(target === "folder" ? "" : target.folder_id || "");
    setPinned(target !== "folder" && !!target.pinned);
    setSaveError("");
    setDialog(target);
  }

  async function save() {
    if (!dialog || !name.trim() || saving || disabled) return;
    setSaving(true);
    setSaveError("");
    try {
      if (dialog === "folder") {
        await onCreateFolder(name.trim());
      } else {
        const changes: ConversationChanges = {};
        if (name.trim() !== dialog.title) changes.title = name.trim();
        if (pinned !== !!dialog.pinned) changes.pinned = pinned;
        if ((folderId || null) !== (dialog.folder_id || null)) changes.folder_id = folderId || null;
        if (Object.keys(changes).length) await onUpdate(dialog.conversation_id, changes);
      }
      setDialog(undefined);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save your changes.");
    } finally {
      setSaving(false);
    }
  }

  function row(chat: ConversationSummary) {
    const title = chat.title || "Untitled chat";
    return (
      <div key={chat.conversation_id} className={mergeClasses(styles.row, canDrag && styles.draggable)}
        draggable={canDrag}
        onDragStart={(event) => {
          if (!canDrag) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData(CHAT_DRAG_TYPE, chat.conversation_id);
          event.dataTransfer.effectAllowed = "move";
          setMoveError("");
          setDraggedId(chat.conversation_id);
        }}
        onDragEnd={clearDrag}>
        <Button className={styles.title} appearance={chat.conversation_id === activeId ? "secondary" : "subtle"}
          aria-current={chat.conversation_id === activeId || undefined}
          icon={chat.pinned ? <Pin16Filled /> : undefined}
          disabled={disabled} onClick={() => onOpen(chat.conversation_id)}>
          {title}
        </Button>
        <Button appearance="subtle" size="small" icon={<MoreHorizontal20Regular />}
          disabled={disabled} aria-label={`Manage ${title}`} onClick={() => edit(chat)} />
      </div>
    );
  }

  return (
    <aside className={styles.sidebar} aria-label="Chat history">
      <div className={styles.toolbar}>
        <Button size="small" icon={<Add20Regular />} disabled={disabled} onClick={onNewChat}>New chat</Button>
        <Button size="small" appearance="subtle" icon={<FolderAdd20Regular />} disabled={disabled}
          onClick={() => edit("folder")}>New folder</Button>
      </div>
      {error && (
        <div className={styles.note}>
          <div role="alert">{error}</div>
          <Button size="small" onClick={onRetry}>Retry</Button>
        </div>
      )}
      {moveError && <p className={styles.note} role="alert">{moveError}</p>}
      {loading && !chats.length && <Spinner size="tiny" label="Loading chats" />}
      {!!pinnedChats.length && <><h2 className={styles.heading}>Pinned</h2>{pinnedChats.map(row)}</>}
      {!!folders.length && (
        <>
          <h2 className={styles.heading}>Folders</h2>
          {folders.map((folder) => {
            const members = chats.filter((chat) => chat.folder_id === folder.folder_id);
            return (
              <details key={folder.folder_id} className={styles.folder}>
                <summary {...dropZone(folder.folder_id, styles.summary)}>{folder.name} ({members.length})</summary>
                {members.length ? members.map(row) : <p className={styles.note}>No chats in this folder.</p>}
              </details>
            );
          })}
        </>
      )}
      <h2 {...dropZone(null, styles.heading)}>Recent chats</h2>
      {draggedChat?.folder_id && <p className={styles.note}>Drop on Recent chats to remove from its folder.</p>}
      {!loading && !error && !chats.length && <p className={styles.note}>No saved chats yet.</p>}
      {recent.map(row)}
      <Dialog open={!!dialog} onOpenChange={(_, data) => { if (!data.open && !saving) setDialog(undefined); }}>
        <DialogSurface>
          <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <DialogBody>
              <DialogTitle>{creatingFolder ? "New folder" : "Manage chat"}</DialogTitle>
              <DialogContent className={styles.fields}>
                <Field label={creatingFolder ? "Folder name" : "Chat name"} required>
                  <Input value={name} maxLength={100} onChange={(_, data) => setName(data.value)} disabled={saving} />
                </Field>
                {!creatingFolder && (
                  <>
                    <Field label="Folder">
                      <Select value={folderId} onChange={(_, data) => setFolderId(data.value)} disabled={saving}>
                        <option value="">No folder</option>
                        {folders.map((folder) => <option key={folder.folder_id} value={folder.folder_id}>{folder.name}</option>)}
                      </Select>
                    </Field>
                    <label><input type="checkbox" checked={pinned} disabled={saving}
                      onChange={(event) => setPinned(event.target.checked)} /> Pin this chat</label>
                  </>
                )}
                {saveError && <div role="alert">{saveError}</div>}
              </DialogContent>
              <DialogActions>
                <Button type="button" disabled={saving} onClick={() => setDialog(undefined)}>Cancel</Button>
                <Button type="submit" appearance="primary" disabled={!name.trim() || saving || disabled}>
                  {saving ? "Saving..." : creatingFolder ? "Create folder" : "Save"}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </aside>
  );
}
