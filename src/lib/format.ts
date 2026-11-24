/** Text formatting shared by the views. */

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** ISO 8601 date as "Feb 26, 2026, 6:13 PM"; unparseable input is returned as is. */
export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE_TIME.format(time);
}

/** Splits a commit message into its subject and the body after the first line. */
export function splitMessage(message: string): {
  subject: string;
  body: string;
} {
  const newline = message.indexOf("\n");
  if (newline < 0) return { subject: message, body: "" };
  return {
    subject: message.slice(0, newline),
    body: message.slice(newline + 1).trim(),
  };
}

export function shortHash(hash: string): string {
  return hash.slice(0, 9);
}
