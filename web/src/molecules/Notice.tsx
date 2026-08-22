import type { AriaRole, ReactNode } from 'react';

// THE TINTED NOTICE, WHICH WAS TWELVE HAND-WRITTEN CLASS PAIRS. `.vb-notice vb-notice-bad` and its two
// siblings were spelled out at twelve call sites — the same failure `Text` was built to end, one
// primitive along: a class pair applied by hand is a decision nobody can find and a tone nobody can
// count. Five surface classes drew this box before that (`.vb-error-box`, `.settings-warn`,
// `.control-disclaimer`, `.sandbox-state` and the `.sandbox-ok`/`.sandbox-off` pair); the rules merged in
// Phase 13 and the CALL SITES merge here.
//
// THREE TONES AND THE INK IS PART OF THE TONE. `bad` is danger ink because a refusal IS the answer to
// what you just did; `warn` and `ok` are prose ink because they are conditions you can read and act on.
// NOT the five-name state vocabulary: a notice is a sentence about what just happened, not a state
// something is IN, and `--warn` and `--danger` are deliberately different values in marshmallow.
interface Props {
  tone: 'bad' | 'warn' | 'ok';
  // `p` where the notice really is a paragraph of the document — six of the twelve are. `div` where it
  // wraps its own markup, which is what a `<p>` may not legally do.
  as?: 'div' | 'p';
  // Layout only, as on every atom: where the notice sits, never how it is set.
  className?: string;
  // `alert` on the one notice that appears in response to nothing the reader did.
  role?: AriaRole;
  testId?: string;
  children?: ReactNode;
}

export function Notice({ tone, as = 'div', className, role, testId, children }: Props) {
  const Tag = as;
  return (
    <Tag
      className={['vb-notice', `vb-notice-${tone}`, className].filter(Boolean).join(' ')}
      role={role}
      data-testid={testId}
    >
      {children}
    </Tag>
  );
}
