export type Lang = "en" | "hinglish" | "roman-ur" | "ur";

export const LANGS: { key: Lang; label: string }[] = [
  { key: "en", label: "English" },
  { key: "hinglish", label: "Hinglish" },
  { key: "roman-ur", label: "Roman Urdu" },
  { key: "ur", label: "اردو" },
];

export function isValidLang(value: unknown): value is Lang {
  return LANGS.some((l) => l.key === value);
}

const dict: Record<Lang, Record<string, string>> = {
  en: {
    appName: "Beacon",
    tagline: "Your free AI study buddy",
    placeholder: "Ask anything...",
    send: "Send",
    login: "Log in",
    signup: "Sign up",
    logout: "Log out",
    logoutConfirmTitle: "Log out of Beacon?",
    logoutConfirmBody: "Your conversations stay saved. You can log back in any time.",
    logoutConfirmYes: "Log out",
    logoutConfirmNo: "Cancel",
    newChat: "New chat",
    guestNotice: "Chatting as guest. Sign up to save your conversations.",
  },
  hinglish: {
    appName: "Beacon",
    tagline: "Aapka apna AI study buddy",
    placeholder: "Kuch bhi poocho...",
    send: "Bhejo",
    login: "Login karo",
    signup: "Account banao",
    logout: "Logout",
    logoutConfirmTitle: "Logout karein?",
    logoutConfirmBody: "Conversations saved rahengi. Aap kabhi wapas login kar sakte ho.",
    logoutConfirmYes: "Logout",
    logoutConfirmNo: "Cancel",
    newChat: "Nayi chat",
    guestNotice: "Aap guest ki tarah chat kar rahe ho. Conversations save karne ke liye sign up karo.",
  },
  "roman-ur": {
    appName: "Beacon",
    tagline: "Aap ka mufeed AI study saathi",
    placeholder: "Kuch bhi poochein...",
    send: "Bhejein",
    login: "Login karein",
    signup: "Account banayein",
    logout: "Logout",
    logoutConfirmTitle: "Logout karein?",
    logoutConfirmBody: "Conversations mehfooz rahengi. Aap kabhi bhi dobara login kar sakte hain.",
    logoutConfirmYes: "Logout",
    logoutConfirmNo: "Cancel",
    newChat: "Nayi chat",
    guestNotice: "Aap guest ke tor par chat kar rahe hain. Sign up karein taake conversations save ho sakein.",
  },
  ur: {
    appName: "بیکن",
    tagline: "آپ کا مفت اے آئی اسٹڈی ساتھی",
    placeholder: "کچھ بھی پوچھیں",
    send: "بھیجیں",
    login: "لاگ ان",
    signup: "اکاؤنٹ بنائیں",
    logout: "لاگ آؤٹ",
    logoutConfirmTitle: "لاگ آؤٹ کریں؟",
    logoutConfirmBody: "آپ کی چیٹس محفوظ رہیں گی۔ آپ کبھی بھی دوبارہ لاگ ان کر سکتے ہیں۔",
    logoutConfirmYes: "لاگ آؤٹ",
    logoutConfirmNo: "کینسل",
    newChat: "نئی چیٹ",
    guestNotice: "آپ مہمان کے طور پر چیٹ کر رہے ہیں۔ محفوظ کرنے کے لیے اکاؤنٹ بنائیں۔",
  },
};

export function t(lang: Lang, key: string): string {
  return dict[lang]?.[key] ?? dict.en[key] ?? key;
}
