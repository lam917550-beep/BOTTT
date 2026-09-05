export type CallbackAction =
  | { type: "help"; op: "next" | "prev" | "home"; page: number }
  | { type: "help-cat"; category: string }
  | { type: "lang"; locale: string }
  | { type: "games"; page: number }
  | { type: "menu"; target: string }
  | { type: "invalid"; raw: string };

const HELP = /^help:(next|prev|home)(?::(\d+))?$/;
const HELP_CAT = /^help:cat:([a-z]{2,12})$/;
const LANG = /^lang:([a-z]{2})$/;
const GAMES = /^games:page:(\d+)$/;
const MENU = /^menu:(ai|game|pet|rank|quest|profile|lang|help)$/;

export function parseCallback(data: string | undefined): CallbackAction {
  if (!data || data.length > 64) return { type: "invalid", raw: data ?? "" };
  const help = HELP.exec(data);
  if (help) {
    const op = help[1] as "next" | "prev" | "home";
    const page = Number(help[2] ?? "1");
    if (!Number.isInteger(page) || page < 1 || page > 999) return { type: "invalid", raw: data };
    return { type: "help", op, page };
  }
  const cat = HELP_CAT.exec(data);
  if (cat?.[1]) return { type: "help-cat", category: cat[1] };
  const lang = LANG.exec(data);
  if (lang?.[1]) return { type: "lang", locale: lang[1] };
  const games = GAMES.exec(data);
  if (games?.[1]) {
    const page = Number(games[1]);
    if (!Number.isInteger(page) || page < 1) return { type: "invalid", raw: data };
    return { type: "games", page };
  }
  const menu = MENU.exec(data);
  if (menu?.[1]) return { type: "menu", target: menu[1] };
  return { type: "invalid", raw: data };
}

export function helpKeyboard(page: number, total: number) {
  const prev = Math.max(1, page - 1);
  const next = Math.min(total, page + 1);
  return {
    inline_keyboard: [
      [
        { text: "◀️", callback_data: `help:prev:${prev}` },
        { text: `▶️ ${page}/${total}`, callback_data: `help:next:${next}` },
      ],
      [{ text: "🏠", callback_data: "help:home" }],
      [
        { text: "core", callback_data: "help:cat:core" },
        { text: "game", callback_data: "help:cat:game" },
        { text: "ai", callback_data: "help:cat:ai" },
        { text: "util", callback_data: "help:cat:util" },
      ],
    ],
  };
}
