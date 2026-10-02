/** Deterministic courtesy replies (DS023 "Chat turn"): host text, never model output. The templates live in ./turn.mjs. */
import {standaloneReply} from './turn.mjs';

/** The reply for the kinds of the signals, in `language` ('en' or 'ro'). */
export const courtesyReply = (signals, language = 'en') => standaloneReply(signals, language);
