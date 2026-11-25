import { useState } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Text, Textarea,
} from "@fluentui/react-components";
import { ThumbLike16Regular, ThumbDislike16Regular } from "@fluentui/react-icons";
import { saveAnswerFeedback, type AnswerFeedback, type FeedbackRating } from "./api";

interface Props {
  instanceId: string;
  conversationId: string;
  turnId: string;
  initialFeedback?: AnswerFeedback;
}

export function FeedbackControls({ instanceId, conversationId, turnId, initialFeedback }: Props) {
  const [saved, setSaved] = useState(initialFeedback);
  const [rating, setRating] = useState<FeedbackRating>();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function choose(value: FeedbackRating) {
    setRating(value);
    setComment(saved?.comment || "");
    setError("");
  }

  async function submit() {
    if (!rating || busy) return;
    setBusy(true);
    setError("");
    try {
      setSaved(await saveAnswerFeedback(instanceId, conversationId, turnId, rating, comment.trim()));
      setRating(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your feedback.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Answer feedback">
      <Button size="small" appearance="subtle" icon={<ThumbLike16Regular />} aria-label="Helpful"
        aria-pressed={saved?.rating === "up"} onClick={() => choose("up")} />
      <Button size="small" appearance="subtle" icon={<ThumbDislike16Regular />} aria-label="Not helpful"
        aria-pressed={saved?.rating === "down"} onClick={() => choose("down")} />
      {saved && <Text size={200} role="status">Feedback saved</Text>}
      <Dialog open={!!rating} onOpenChange={(_, data) => { if (!data.open && !busy) setRating(undefined); }}>
        <DialogSurface>
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <DialogBody>
              <DialogTitle>{rating === "up" ? "Helpful answer" : "Report an unhelpful answer"}</DialogTitle>
              <DialogContent>
                <Text>Your rating and comment will be shared with administrators along with this answer and its cited sources.</Text>
                <Field label="Comment (optional)">
                  <Textarea value={comment} maxLength={1000} disabled={busy}
                    onChange={(_, data) => setComment(data.value)} />
                </Field>
                {error && <div role="alert">{error}</div>}
              </DialogContent>
              <DialogActions>
                <Button type="button" disabled={busy} onClick={() => setRating(undefined)}>Cancel</Button>
                <Button type="submit" appearance="primary" disabled={busy}>{busy ? "Sending..." : "Send feedback"}</Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
