import { useState } from "react";
import { useApp } from "../../state/context";
import type { Confirmation, Prompt } from "../../state/types";
import { Modal } from "../../ui/Modal";

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

/** Where a new worktree goes: next to the project, or a folder picked in the native dialog. */
function WorktreeFolder() {
  const parent = useApp((s) => s.worktreeParent);
  const choose = useApp((s) => s.chooseWorktreeParent);
  return (
    <div className="prompt-folder">
      <span className="muted small-text">In</span>
      <span className="truncate prompt-folder-path" title={parent?.path}>
        {parent ? parent.path : "The folder that contains the project"}
      </span>
      <button
        type="button"
        className="button small"
        onClick={() => void choose()}
      >
        Choose Folder…
      </button>
    </div>
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
          {prompt.kind === "addWorktree" ? <WorktreeFolder /> : null}
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
  return (
    <>
      {confirmation ? <ConfirmDialog confirmation={confirmation} /> : null}
      {prompt ? <PromptDialog key={prompt.title} prompt={prompt} /> : null}
    </>
  );
}
