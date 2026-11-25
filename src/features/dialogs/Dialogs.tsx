import { useState } from "react";
import { useApp } from "../../state/context";
import type { Confirmation, Prompt } from "../../state/types";
import { Modal } from "../../ui/Modal";
import { NewWorktreeDialog } from "../worktrees/NewWorktreeDialog";
import { RemoveWorktreeDialog } from "../worktrees/RemoveWorktreeDialog";

function ConfirmDialog({ confirmation }: { confirmation: Confirmation }) {
  const run = useApp((s) => s.runConfirmation);
  const dismiss = useApp((s) => s.dismissConfirmation);
  return (
    <Modal label={confirmation.title} onClose={dismiss}>
      <div className="dialog-body">
        <h2>{confirmation.title}</h2>
        <p>{confirmation.message}</p>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button"
          onClick={dismiss}
          data-autofocus
        >
          Cancel
        </button>
        <button
          type="button"
          className={`button primary${confirmation.destructive ? " danger" : ""}`}
          onClick={run}
        >
          {confirmation.confirm}
        </button>
      </div>
    </Modal>
  );
}

function PromptDialog({ prompt }: { prompt: Prompt }) {
  const submit = useApp((s) => s.submitPrompt);
  const dismiss = useApp((s) => s.dismissPrompt);
  const [text, setText] = useState(prompt.initial);
  const optional = prompt.kind === "stash" || prompt.kind === "mergeMessage";
  const disabled = !optional && text.trim().length === 0;
  return (
    <Modal
      label={prompt.title}
      onClose={dismiss}
      className={prompt.multiline ? "wide" : undefined}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) submit(text);
        }}
      >
        <div className="dialog-body">
          <h2>{prompt.title}</h2>
          {prompt.message ? <p>{prompt.message}</p> : null}
          {prompt.multiline ? (
            <textarea
              className="textarea"
              rows={6}
              value={text}
              placeholder={prompt.placeholder}
              aria-label={prompt.placeholder}
              onChange={(event) => setText(event.target.value)}
            />
          ) : (
            <input
              className="input"
              value={text}
              placeholder={prompt.placeholder}
              aria-label={prompt.placeholder}
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={dismiss}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={disabled}>
            {prompt.confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Dialogs() {
  const confirmation = useApp((s) => s.confirmation);
  const prompt = useApp((s) => s.prompt);
  const newWorktree = useApp((s) => s.newWorktree);
  const removal = useApp((s) => s.removal);
  return (
    <>
      {newWorktree ? <NewWorktreeDialog start={newWorktree.reference} /> : null}
      {removal ? (
        <RemoveWorktreeDialog
          key={removal.round}
          tree={removal.tree}
          preview={removal.preview}
        />
      ) : null}
      {confirmation ? <ConfirmDialog confirmation={confirmation} /> : null}
      {prompt ? <PromptDialog key={prompt.title} prompt={prompt} /> : null}
    </>
  );
}
