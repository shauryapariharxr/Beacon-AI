export type Lang = "en" | "roman-ur" | "ur";

export const LANGS: { key: Lang; label: string }[] = [
  { key: "en", label: "English" },
  { key: "roman-ur", label: "Roman Urdu" },
  { key: "ur", label: "اردو" },
];

const dict: Record<Lang, Record<string, string>> = {
  en: {
    appName: "BeaconAI",
    tagline: "Your free AI study buddy",
    placeholder: "Ask me anything about your studies...",
    send: "Send",
    login: "Log in",
    signup: "Sign up",
    logout: "Log out",
    newChat: "New chat",
    guestNotice: "Chatting as guest. Sign up to save your conversations.",
  },
  "roman-ur": {
    appName: "My AI Tutor",
    tagline: "Aap ka mufeed AI study saathi",
    placeholder: "Apni study ke baare mein kuch bhi poochein...",
    send: "Bhejein",
    login: "Login karein",
    signup: "Account banayein",
    logout: "Logout",
    newChat: "Nayi chat",
    guestNotice: "Aap guest ke tor par chat kar rahe hain. Sign up karein taake conversations save ho sakein.",
  },
  ur: {
    appName: "میرا اے آئی ٹیوٹر",
    tagline: "آپ کا مفت اے آئی اسٹڈی ساتھی",
    placeholder: "اپنی پڑھائی کے بارے میں کچھ بھی پوچھیں",
    send: "بھیجیں",
    login: "لاگ ان",
    signup: "اکاؤنٹ بنائیں",
    logout: "لاگ آؤٹ",
    newChat: "نئی چیٹ",
    guestNotice: "آپ مہمان کے طور پر چیٹ کر رہے ہیں۔ محفوظ کرنے کے لیے اکاؤنٹ بنائیں۔",
  },
};

export function t(lang: Lang, key: string): string {
  return dict[lang]?.[key] ?? dict.en[key] ?? key;
}
