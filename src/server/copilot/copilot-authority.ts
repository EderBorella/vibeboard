import type { ChatScope, Credential, CredentialStore } from '../auth/credentials.js';

// The chat copilot's credential, and its lifetime.
//
// AUTHORITY LIVES HERE, NOT IN THE BROWSER. The button that turns this on is a boolean in the UI, and
// it has to be: a closed tab must not be what expires a credential, or the token outlives the
// conversation it belonged to and sits in the store until the process restarts. And turning the button
// off cannot un-tell a model that already holds the token — turns resume with `--resume`, so the only
// thing that makes "off" mean off is revoking it server-side.
//
// Keyed to the CHAT, so `expireRun(chatId)` retires it with no second index: a chat is not a run, but
// it is the same shape — one identifier, one credential, one ending.
//
// NOT ROTATED MID-CONVERSATION, deliberately. Every earlier turn's token is still in the model's
// context, so after a rotation it holds two and may reach for the stale one; "please use the newest"
// is prompt compliance guarding a security boundary, which is the weak kind. Mint once, expire once.
export class CopilotAuthority {
  #credential: Credential | undefined;
  // What it was minted FOR. Both halves are checked on every use, because either changing means the
  // conversation this credential belonged to is over.
  #chat: string | undefined;
  #project: string | undefined;

  // Told whenever the credential appears or goes away, so every open tab's button matches reality.
  // Without it a lazy revoke left `authorised` true in the UI while the credential was gone, and the
  // next press turned OFF something the user believed they were turning off already. The scope rides
  // along because the button must not read "Authorised" over a grant that is more than that.
  #announce: (enabled: boolean, scope: ChatScope | undefined) => void = () => {};

  constructor(private readonly credentials: CredentialStore) {}

  onChange(fn: (enabled: boolean, scope: ChatScope | undefined) => void): void {
    this.#announce = fn;
  }

  get enabled(): boolean {
    return this.#credential !== undefined;
  }

  // Which of the two a conversation holds: `assist` from the Authorise button, `repair` from Fix board.
  get scope(): ChatScope | undefined {
    return this.#credential?.scope as ChatScope | undefined;
  }

  // What every tab is told, from the three places that tell it — the change hook, a new socket, and the
  // Authorise route. One shape, so none of them can announce a repair as a plain authorisation. `repair` is
  // present only when true: an older client reading `authorised` alone still reads the truth.
  get announcement(): { type: 'copilot:authority'; authorised: boolean; repair?: true } {
    return {
      type: 'copilot:authority',
      authorised: this.enabled,
      ...(this.scope === 'repair' ? { repair: true as const } : {}),
    };
  }

  // Which chat holds it, for the UI — never the token itself, which the browser has no use for and
  // which would then exist in a place the page could read.
  get chat(): string | undefined {
    return this.#chat;
  }

  // ONE SLOT FOR BOTH SCOPES, and that is the point: re-authorising replaces rather than accumulates, because
  // two live credentials for one copilot is one nobody can revoke by name — and a `repair` grant sitting
  // beside an `assist` one would be exactly that. Handed back so the caller that minted it can end it.
  authorise(chat: string, project: string, scope: ChatScope = 'assist'): Credential {
    this.revoke();
    const credential = this.credentials.mintChat(chat, project, scope);
    this.#credential = credential;
    this.#chat = chat;
    this.#project = project;
    this.#announce(true, scope);
    return credential;
  }

  revoke(): void {
    const had = this.#credential !== undefined;
    if (this.#chat) this.credentials.expireRun(this.#chat);
    this.#credential = undefined;
    this.#chat = undefined;
    this.#project = undefined;
    if (had) this.#announce(false, undefined);
  }

  // THE END OF ONE GRANT, AND ONLY THAT ONE. Fix board's turn calls this when it settles (decision 88), and
  // it must not take down whatever is held by then: a person may have switched conversation and pressed the
  // button again while the first turn was still unwinding from its cancel, and a revoke keyed to "whatever is
  // current" would end the second repair on the first one's way out. Matched by token, which nothing else
  // can share.
  release(credential: Credential): void {
    if (this.#credential?.token === credential.token) this.revoke();
    // And from the store regardless: a replaced credential is already gone, and this makes that a fact
    // rather than a property of `authorise`.
    else this.credentials.expireToken(credential.token);
  }

  // Called by every path that changes which conversation or project is open — opening a chat, starting
  // a new one, deleting one, opening another project.
  //
  // EAGERLY, rather than leaving it to `forTurn`. Lazy revocation only fires when a turn is SENT, so
  // authorising in one chat and switching away without sending left the credential live in the store
  // indefinitely; and because `currentId` reloads the newest chat from disk, reopening the original
  // project handed the same credential back with no re-authorisation. That is verbatim the failure
  // `expireScope` was added for — "it came back to life when the original project was reopened".
  endedIfChanged(chat: string | undefined, project: string | undefined): void {
    if (!this.#credential) return;
    if (this.#chat === chat && this.#project === project) return;
    this.revoke();
  }

  // The credential for THIS turn, or nothing — and the check is the expiry.
  //
  // A new chat or a different project means the conversation it was minted for is over, so it is
  // revoked here rather than merely withheld. Doing it lazily at the point of use is what makes the
  // rule impossible to forget: every path that changes chat or project is covered by construction,
  // including ones nobody has written yet.
  forTurn(chat: string, project: string): Credential | undefined {
    if (!this.#credential) return undefined;
    if (this.#chat === chat && this.#project === project) return this.#credential;
    this.revoke();
    return undefined;
  }
}
