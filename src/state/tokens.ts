/**
 * Request generations. Each channel remembers its latest request; a response is applied only
 * while it is still the latest, so quickly moving between worktrees, commits or files shows
 * only the last choice.
 */
export type Channel = "workspace" | "history" | "changes" | "page";

export interface Tokens {
  next(channel: Channel): number;
  current(channel: Channel, token: number): boolean;
}

export function createTokens(): Tokens {
  const latest: Record<Channel, number> = {
    workspace: 0,
    history: 0,
    changes: 0,
    page: 0,
  };
  let counter = 0;
  return {
    next(channel) {
      counter += 1;
      latest[channel] = counter;
      return counter;
    },
    current(channel, token) {
      return latest[channel] === token;
    },
  };
}
