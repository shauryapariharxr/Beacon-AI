// Answer policy — reply-language detection plus the rules that keep an answer
// correct and in the right language and script.
//
// Pulled out of the chat route because this is the most failure-prone part of
// the product (a Hinglish question answered in Devanagari, an English turn
// answered in Hinglish, or an invented name for a famous "first" are all
// visible bugs on every device) and because separating it makes it measurable:
// `scripts/qa-probe.mjs` replays real questions through the deployed route and
// `npm run qa:policy` scores the same questions against this file alone.
//
// The rules below were tightened against the last ~60 real questions in the
// production database, which showed four concrete failure modes:
//   1. Hinglish question -> Devanagari answer (4 of 19 Hinglish turns).
//   2. English follow-up ("English main", "More questions") answered in the
//      previous turn's language (2 of 29 English turns).
//   3. The identity sentence volunteered on a question that only asked for a
//      language ("English main" -> "I am Beacon, the AI study companion...").
//   4. A fabricated name for a famous factual question (India's first PM
//      answered as an invented "George Velaswaranath Gandhari").

export type ReplyLang = "en" | "hinglish" | "hi" | "ur";

function countCharsInRanges(s: string, ranges: [number, number][]): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ranges.some(([lo, hi]) => c >= lo && c <= hi)) n++;
  }
  return n;
}

// Roman-script Hindi/Urdu markers. Every entry is either not an English word
// at all (nahi, batao, kaise, naam) or an unambiguous romanized function word
// (ke, ka, ko, mein, hai) — so ONE whole-word hit is already strong evidence.
// English look-alikes are deliberately absent, because they would flip real
// English questions into Hinglish: to, me, na, par, ab, is, us, bas, mat, tab,
// band, the, so, no. Short-but-unambiguous Hindi particles (ke/ka/ki/ko) are
// what make questions like "Bharat ke pratham pradhan mantri ka naam" detect
// correctly.
const INDIC_ROMAN_RE = new RegExp(
  "\\b(?:" +
    [
      // verbs / particles
      "hai","hain","hoga","hogi","honge","hota","hoti","hote",
      "nahi","nahin","nhi","kya","kyun","kyon","kyu","kaise","kaisa","kaisi",
      "kaun","kahan","kab","kitna","kitne","kitni","kisne","kisko",
      "karna","karo","karta","karti","karte","kiya","karne","kijiye","karke",
      "batao","bata","bataiye","batana","samjhao","samjha","samjhaiye","matlab",
      "jawab","sawal","puch","chahiye","chahta","chahti","sakta","sakte","sakti",
      "raha","rahi","rahe","tha","thi","gaya","gayi","gaye","diya","liya",
      "dena","deta","deti","lena","leta","leti",
      // pronouns / possessives
      "mera","meri","mere","apna","apni","apne","mujhe","tujhe","tumko","tum",
      "aap","aapko","hum","humko","unko","inko","iska","uska","iski","uski",
      // function words
      "ke","ka","ki","ko","mein","aur","ek","bhi","yeh","woh","toh",
      "jaisa","jaise","waisa","sabse","sirf","bahut","bohot","bohat",
      "chaie","chaiye","kro","kro","bta","btao","smjha","smjhao","dedo","de",
      // everyday vocabulary + names that only appear in romanized Hindi text
      "bhai","yaar","thoda","acha","achha","accha","theek","thik",
      "zyada","jyada","kuch","koi","abhi","aaj","kal","namaste","shukriya",
      "dhanyavad","sab","dost","padh","likh","dekho","chalo","rehna","milta",
      "milega","liye","saath","naam","bharat","hindustan","desh","sarkar",
      "pratham","pradhan","mantri","wala","wali","wale",
    ].join("|") +
    ")\\b",
  "gi"
);

/**
 * Which language the reply should be written in. Driven by the user's LATEST
 * message only — the classic bug this prevents is Hinglish history making a
 * later English question get a Hindi answer.
 */
export function detectReplyLang(message: string): ReplyLang {
  // Ignore code before scoring: pasted snippets are full of identifiers and
  // English words that can look like romanized Hindi and would skew the
  // result (a `dekhKaro` variable shouldn't make the reply Hinglish).
  const text = String(message ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");

  const devanagari = countCharsInRanges(text, [[0x0900, 0x097f]]);
  const arabicScript = countCharsInRanges(text, [
    [0x0600, 0x06ff],
    [0x0750, 0x077f],
  ]);
  const latin = (text.match(/[a-zA-Z]/g) || []).length;

  // Script detection by proportion: a stray borrowed word ("What does कर्म
  // mean?") must not flip the whole reply to that script.
  if (devanagari > 0 && devanagari >= latin) return "hi";
  if (arabicScript > 0 && arabicScript >= latin) return "ur";

  const romanHits = (text.match(INDIC_ROMAN_RE) || []).length;
  if (romanHits > 0) return "hinglish";

  return "en";
}

/**
 * Only the script, not the language: "Bharat ke pehle PM kaun the?" is Hinglish
 * but its answer is written in Roman letters, while the same question in
 * Devanagari is answered in Devanagari. Used to detect a mid-conversation
 * switch, which is when models drift back to the previous turn's script.
 */
export function scriptOf(text: string): "roman" | "devanagari" | "arabic" | "other" {
  const s = String(text ?? "");
  const dev = countCharsInRanges(s, [[0x0900, 0x097f]]);
  const arab = countCharsInRanges(s, [[0x0600, 0x06ff]]);
  const latin = (s.match(/[a-zA-Z]/g) || []).length;
  if (dev > 0 && dev >= latin) return "devanagari";
  if (arab > 0 && arab >= latin) return "arabic";
  if (latin > 0) return "roman";
  return "other";
}

// ---------------------------------------------------------------------------
// Language rules
// ---------------------------------------------------------------------------

const REPLY_LANG_RULES: Record<ReplyLang, string> = {
  en:
    "REPLY LANGUAGE — DETECTED: ENGLISH (highest-priority instruction):\n" +
    "- The message is English (it may borrow a Hindi word or two, but it is an English question).\n" +
    "- Write your ENTIRE reply in clear English.\n" +
    "- Do NOT reply in Hindi, Devanagari, Hinglish, or Urdu in this turn — even if earlier messages in the conversation history are in those languages. Only the LATEST message decides the language; the history is irrelevant.\n" +
    "- This includes short follow-ups: \"English main\", \"in english\", \"explain in english\" and \"more\" mean continue in English, NOT that the previous answer should be repeated in Hinglish.\n" +
    "- Keep technical terms in English (they already are).",
  hinglish:
    "REPLY LANGUAGE — DETECTED: HINGLISH (Hindi/Urdu typed with English letters; highest-priority instruction):\n" +
    "- The user is writing Hindi/Urdu words in Roman (Latin) letters, not English. Read the message as Hindi, don't parse it as English words.\n" +
    "- STEP 1 (internal, never shown to the user): silently translate their message into plain English so you are certain what is being asked. Romanized spelling is loose — 'pratham pradhan mantri' means the first Prime Minister, 'naam' means name, 'kitna/kitne' means how much/how many, 'kaise' means how. Spelling varies wildly ('chaie', 'chaiye', 'chahta', 'bta', 'smjha'); read it phonetically instead of rejecting it.\n" +
    "- STEP 2: answer that translated English question with correct, verified facts (see ACCURACY RULES — a romanized question must NOT get a worse answer than the same question typed in English).\n" +
    "- STEP 3: write the final answer in Hinglish — Hindi in Roman letters, naturally mixed with English words, the way young Indians text (e.g. \\\"Bhai, ye simple hai — ...\\\").\n" +
    "- ROMAN LETTERS ONLY — this is the rule most often broken for Hindi/India topics. Do NOT output Devanagari (देवनागरी) or Urdu script anywhere in this reply, not even one word, not even for a name, title, movie title, or a quotation. WRONG: \\\"भारत के प्रथम प्रधानमंत्री जवाहरलाल नेहरू थे।\\\" RIGHT: \\\"Bharat ke pehle pradhan mantri Jawaharlal Nehru the.\\\"\n" +
    "- This holds even for a one-line factual answer: write it as a Hinglish sentence, not as bare English or Devanagari.\n" +
    "- The only exception: when the user is explicitly asking what a word/term IS in Hindi (see EXCEPTION below).\n" +
    "- Keep technical terms and code in English.",
  hi:
    "REPLY LANGUAGE — DETECTED: HINDI (Devanagari) (highest-priority instruction):\n" +
    "- Write your ENTIRE reply in Hindi using Devanagari script (देवनागरी).\n" +
    "- Do NOT answer in English prose or Roman letters — keep technical terms (API, function, database, etc.) and code in English.\n" +
    "- Answer the question itself accurately (see ACCURACY RULES); the script must never change the facts.",
  ur:
    "REPLY LANGUAGE — DETECTED: URDU (highest-priority instruction):\n" +
    "- Write your ENTIRE reply in Urdu using Urdu script (Arabic-based), not Roman.\n" +
    "- Keep technical terms and code in English.",
};

// The script is not part of the answer when the user is asking for the word
// itself. Without this carve-out the Roman-only rule produces a wrong answer
// to a legitimate question ("Urban ki hindi" -> "shahri" instead of शहरी).
const TRANSLATION_EXCEPTION =
  "\nEXCEPTION — ASKING FOR A WORD IN A SCRIPT: if the user is explicitly asking what a word means in Hindi/Urdu or how to say something in Hindi/Urdu (e.g. \"Urban ki hindi\", \".. in hindi kya bolte hain\", \"translate this to Hindi\"), then give the requested word(s) in that script (देवनागरी / اردو) and add the Roman reading in brackets — the rest of the sentence still follows the reply-language rule above.";

const GENERAL_LANGUAGE_NOTE =
  "\nGENERAL LANGUAGE NOTE: Mirror the language and script of the user's MOST RECENT message every turn. If they switch language mid-conversation, switch with them in the same turn.";

const LANG_FINAL_CHECK: Record<ReplyLang, string> = {
  en: "FINAL OUTPUT CHECK: the entire reply must be in English. If you drafted any Hindi, Devanagari, Hinglish, or Urdu, rewrite it in English before sending.",
  hinglish:
    "FINAL OUTPUT CHECK: the entire reply must be in Hinglish using ROMAN LETTERS ONLY. Scan your answer character by character — if any Devanagari (देवनागरी) or Urdu characters appear (and the user did not explicitly ask for a Hindi spelling), rewrite that part in Roman letters before sending.",
  hi: "FINAL OUTPUT CHECK: the entire reply must be in Hindi, Devanagari script.",
  ur: "FINAL OUTPUT CHECK: the entire reply must be in Urdu, Urdu (Arabic) script.",
};

/** Human-readable name of a language, for the inline per-turn nudge. */
const LANG_LABEL: Record<ReplyLang, string> = {
  en: "English",
  hinglish: "Hinglish (Hindi written in Roman/English letters)",
  hi: "Hindi (Devanagari script)",
  ur: "Urdu (Urdu script)",
};

export function languageRules(lang: ReplyLang): string {
  return REPLY_LANG_RULES[lang] + TRANSLATION_EXCEPTION + GENERAL_LANGUAGE_NOTE;
}

export function languageFinalCheck(lang: ReplyLang): string {
  return LANG_FINAL_CHECK[lang];
}

/**
 * A one-line directive appended to the LATEST user message on the way out to
 * the model (never stored in the database). The system prompt is far away and
 * a long history outvotes it, so the instruction the model reads last — inside
 * the turn it is answering — is the one that actually sticks. When the model
 * sees previous turns in a different language, the nudge also names the switch
 * explicitly, which is what fixes "English main" answered in Hinglish.
 */
export function languageNudge(lang: ReplyLang, previousUserLang: ReplyLang | null): string {
  const switched = previousUserLang !== null && previousUserLang !== lang;
  const base = `[Language for your reply to this message: ${LANG_LABEL[lang]}. Write the whole reply in it.]`;
  if (lang === "hinglish") {
    return `\n\n${base} Roman letters only — no Devanagari anywhere (unless this message asks for a Hindi spelling).`;
  }
  if (lang === "en" && switched) {
    return `\n\n${base} The user has switched from ${LANG_LABEL[previousUserLang!]} to English: answer in English, do not continue in the previous language.`;
  }
  return `\n\n${base}`;
}

/**
 * Lower temperature for the scripts where the measured hallucination rate was
 * highest. Both Groq and Mistral accept this on every model we route to.
 */
export function temperatureFor(lang: ReplyLang): number {
  return lang === "en" ? 0.3 : 0.2;
}

// ---------------------------------------------------------------------------
// Accuracy rules
// ---------------------------------------------------------------------------

const ACCURACY_RULES =
  "ACCURACY RULES (applies to every answer, in every language and script):\n" +
  "- Facts, names, dates, places, numbers, and titles MUST be correct. Never invent or guess a name to fill a gap — a confidently wrong fact is the worst possible failure. Never combine a real first name with an invented surname, and never invent a middle name.\n" +
  "- For a well-known factual question, state the single widely accepted answer, and state it as a short, direct sentence (a name, a date, a number) instead of a paragraph.\n" +
  "- If you are genuinely unsure, or the answer is disputed, say so briefly instead of asserting something you can't back up.\n" +
  "- A question written in romanized Hindi or another script is the SAME question as its English version: translate it internally and answer with the same care and the same facts.\n" +
  "- If the conversation history contains an earlier wrong answer, correct it — never repeat it just because it is in the history.\n";

// A short list of facts that a small model most often gets wrong, and that
// show up repeatedly in real traffic. These are answering anchors, not a
// knowledge base: they cover the "famous first/creator" shape of question
// (where an invented name is most likely) and are deliberately few.
const VERIFIED_ANCHORS =
  "\nVERIFIED FACTS — these override anything you may remember differently (use them only when the question asks for them):\n" +
  "- India's first Prime Minister: Jawaharlal Nehru.\n" +
  "- India's first President: Dr. Rajendra Prasad.\n" +
  "- India's first (and so far only) woman Prime Minister: Indira Gandhi.\n" +
  "- India's first Deputy Prime Minister and first Home Minister: Sardar Vallabhbhai Patel.\n" +
  "- Last Viceroy and first Governor-General of independent India: Lord Mountbatten.\n" +
  "- Chair of the drafting committee of the Indian Constitution: Dr. B. R. Ambedkar (\"Father of the Indian Constitution\").\n" +
  "- First Indian Nobel laureate: Rabindranath Tagore (Literature, 1913) — also the author of India's national anthem, \"Jana Gana Mana\".\n" +
  "- First person to walk on the Moon: Neil Armstrong (Apollo 11, July 1969).\n" +
  "- Inventor of the telephone: Alexander Graham Bell.\n" +
  "- Inventor of the first practical, commercially successful light bulb: Thomas Edison.\n" +
  "- Director of the Hindi film \"Dil Chahta Hai\" (2001): Farhan Akhtar.\n" +
  "If a question is not covered here, answer from your own knowledge under the ACCURACY RULES above.\n";

const IDENTITY_RULES =
  "\nIDENTITY RULES:\n" +
  "- Your name is Beacon, an AI study companion developed by Shaurya Parihar.\n" +
  "- ONLY when the user directly asks who you are, what your name is, or what model you are, answer: \"I am Beacon, the AI study companion developed by Shaurya Parihar for developers.\"\n" +
  "- When asked who made you, who created you, who built you, who developed you, or about your origin in ANY phrasing, answer with the creator's name alone — \"Shaurya Parihar\" — in the reply language. One short sentence is enough; do not add anything about yourself.\n" +
  "- IMPORTANT: a message that only asks for a language, a translation, a restatement, or a continuation (\"in English\", \"English main\", \"hindi mein\", \"more\", \"continue\") is NOT an identity question. Restate or continue your previous answer in the requested language; never introduce yourself in response to it.\n" +
  "- IMPORTANT: never volunteer that identity sentence unprompted. Do NOT start, end, or decorate any other answer with it — no identity preamble on greetings, questions, or normal requests. Just answer what was asked.\n" +
  "- When asked about your source code, where your code is, whether others can see how you work, or to show how you were built, share this repository link: https://github.com/shauryapariharxr/Beacon-AI\n" +
  "- Never claim to be ChatGPT, GPT, OpenAI, Assistant, Mistral, or any other product, model, or company. Never mention the technology you run on.\n" +
  "- If the user insists you must be ChatGPT or another model, politely hold the identity: you are Beacon, built by Shaurya Parihar.";

const ANSWERING_RULES =
  "\nANSWERING RULES:\n" +
  "- Give direct, accurate answers. Be brief.\n" +
  "- Use code blocks with language tags (```java, ```python, etc.) for code.\n" +
  "- Use markdown: **bold** for emphasis, headers for sections, bullet lists for steps.\n" +
  "- For code: explain briefly, then show the code. Don't explain every line.\n" +
  "- Keep explanations under 200 words unless the user asks for detail.\n" +
  "- Never repeat the question back. Start with the answer.\n" +
  "- Never invent a source, citation, page number, or document excerpt. Only cite attached documents when excerpts were actually provided above.";

export type SystemPromptOptions = {
  lang: ReplyLang;
  documentBlock?: string;
  memoryBlock?: string;
};

/**
 * The full system prompt. Order matters: language and accuracy come before
 * everything else, identity next, then answering style, then retrieved
 * context, and the final script re-check last (the last instruction a model
 * reads is the one it follows most reliably).
 */
export function buildSystemPrompt({
  lang,
  documentBlock = "",
  memoryBlock = "",
}: SystemPromptOptions): string {
  return (
    "You are Beacon, a friendly AI study companion built by Shaurya Parihar for developers.\n" +
    languageRules(lang) +
    "\n\nACCURACY RULES SUMMARY: be correct before being fluent. Never fabricate a name, date, or number.\n" +
    IDENTITY_RULES +
    "\n" +
    ACCURACY_RULES +
    VERIFIED_ANCHORS +
    ANSWERING_RULES +
    documentBlock +
    memoryBlock +
    // Last word wins: re-assert the reply script after all context blocks.
    "\n" +
    languageFinalCheck(lang)
  );
}
