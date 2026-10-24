/**
 * ===========================================================================
 * SHARE CODES — the twelve characters that stand in for a 1MB file
 * ===========================================================================
 *
 * A league file is 0.6-1.1MB of JSON. Sharing one today means being your own
 * file host: download it, upload it to Discord, the other person downloads it
 * and uploads it again. A share code replaces all four steps with one string
 * somebody can read down a voice channel.
 *
 * WHAT A CODE IS, AND WHAT IT IS NOT
 *
 * THE CODE IS THE ACCESS CONTROL. There is no gallery, no directory and no
 * listing anywhere in this app, by decision: a browsable index of leagues
 * strangers wrote is a moderation obligation and a takedown target. So the
 * only way to a published league is to be told its code, which makes the
 * code's unguessability the whole of the security model and the reason for
 * every choice below.
 *
 * IT IS "ANYONE WITH THE LINK", NOT A SECRET. A code travels in a URL. It
 * lands in Discord's message history, in browser history, in the `Referer`
 * header of anything the recipient clicks next, and in any proxy log between
 * them and here. Nothing in this module can change that, so nothing in this
 * module or the copy around it claims privacy: a code is a thing you hand out,
 * and a publisher who wants it to stop working deletes it (lib/publication.ts).
 *
 * THE ALPHABET IS CROCKFORD BASE32 — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. The
 * four letters it drops are the four that cost you a support conversation:
 * I and L read as 1, O reads as 0, and U is dropped so a random draw cannot
 * spell something the owner has to apologise for. Decoding accepts the
 * confusions rather than refusing them (I/l -> 1, O/o -> 0), so a code typed
 * off a photograph still resolves; see `normalizeShareCode`.
 *
 * TEN SYMBOLS, WHICH IS FIFTY BITS. Eight symbols is forty bits — about 1.1e12
 * — and that is inside reach of a distributed guesser even behind a rate
 * limiter, because the attacker is not trying to hit ONE code, they are trying
 * to hit ANY of them, and the odds scale with how many exist. Fifty bits is
 * 1.1e15: at the hourly ceiling this app enforces per address
 * (lib/costLimit.ts, CODE_LOOKUP) a single attacker gets through roughly five
 * hundred thousand guesses a year, which against even a million published
 * codes is a one-in-two-billion chance of landing on one of them.
 *
 * NEVER DERIVED FROM A DATABASE ID, never sequential, never a hash of
 * anything. Every symbol comes from `crypto.randomBytes`, so there is no
 * ordering to extrapolate from and no earlier code that tells you anything
 * about a later one. (The verification probe generates 100,000 and measures
 * exactly that.)
 *
 * STORED CANONICAL, SHOWN GROUPED. The database holds ten upper-case symbols
 * and nothing else, so lookup is an equality test on a unique column. The UI
 * shows `7K2P-X9MT-4B`, because a run of ten characters is read wrong and a
 * run of four is not, and the hyphens are stripped again on the way in.
 * ===========================================================================
 */
import { randomBytes } from 'crypto';

/**
 * Crockford base32: the digits, then the letters with I, L, O and U removed.
 * Exactly 32 symbols, which is what makes one symbol exactly five bits.
 */
export const SHARE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Symbols in a code. Ten, for the reason argued in the header. */
export const SHARE_CODE_LENGTH = 10;

/** 10 symbols x log2(32) = 50 bits. Stated once, so no screen can invent it. */
export const SHARE_CODE_BITS = SHARE_CODE_LENGTH * 5;

/** How the code is written down for a person: 4-4-2. */
const GROUP_SIZE = 4;

/**
 * A fresh code.
 *
 * `byte & 31` is exactly uniform over the alphabet and needs no rejection
 * loop, because 256 is eight whole copies of 32 — the modulo bias that makes
 * `% n` wrong for most n does not exist for a power of two that divides 256.
 * Written as a mask rather than `% 32` so that stays obvious.
 */
export function generateShareCode(): string {
  const bytes = randomBytes(SHARE_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < SHARE_CODE_LENGTH; i += 1) out += SHARE_CODE_ALPHABET[bytes[i] & 31];
  return out;
}

/**
 * Whatever a person pasted -> the canonical ten symbols, or null.
 *
 * Accepts the full URL, the grouped form, lower case, and the three Crockford
 * confusions. Returns null for anything that is not a code, and the caller
 * answers a null exactly as it answers a code nobody published — a parse
 * refusal that read differently from a lookup miss would tell an attacker
 * which of their guesses were well-formed.
 *
 * `U` is NOT mapped to V. Crockford's own decoder treats it as an error and so
 * does this: V is in the alphabet, so mapping U onto it would silently turn
 * one typed code into a different real one.
 */
export function normalizeShareCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Bounded before any per-character work: a megabyte of "x" is not a code.
  if (raw.length > 256) return null;

  // Take the last path segment, so a pasted `https://host/l/7K2P-X9MT-4B` and
  // a typed `7K2P-X9MT-4B` are the same input. Query and fragment go too.
  const tail = raw.trim().split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';

  let out = '';
  for (const ch of tail.toUpperCase()) {
    if (ch === '-' || ch === ' ' || ch === '_') continue;
    const mapped = ch === 'I' || ch === 'L' ? '1' : ch === 'O' ? '0' : ch;
    if (!SHARE_CODE_ALPHABET.includes(mapped)) return null;
    out += mapped;
    if (out.length > SHARE_CODE_LENGTH) return null;
  }
  return out.length === SHARE_CODE_LENGTH ? out : null;
}

/** The code as it is shown and read aloud: `7K2P-X9MT-4B`. */
export function formatShareCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += GROUP_SIZE) groups.push(code.slice(i, i + GROUP_SIZE));
  return groups.join('-');
}
