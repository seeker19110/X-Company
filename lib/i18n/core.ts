// Lõi bộ dịch không gắn tệp JSON nào (để client.ts nạp riêng phần của mình mà không kéo chuỗi chỉ-server).
export interface MessageTree {
  readonly [key: string]: string | MessageTree;
}

/** Mọi đường dẫn khoá dạng `a.b.c` dẫn tới một chuỗi lá. */
export type MessageKeys<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : MessageKeys<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageParams = Readonly<Record<string, string | number>>;

/** Làm phẳng cây thông điệp → bảng `a.b.c` → chuỗi. */
export function flattenMessages(tree: MessageTree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix === "" ? k : `${prefix}.${k}`;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flattenMessages(v, key)) out.set(kk, vv);
  }
  return out;
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Nội suy `{ten}`; thiếu tham số = ném lỗi (không để "{ten}" lọt lên giao diện). */
export function interpolate(key: string, template: string, params: MessageParams = {}): string {
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`i18n: khoá "${key}" thiếu tham số "${name}"`);
    return String(v);
  });
}

/** Bộ dịch trên một bảng thông điệp bất kỳ (test dùng bảng nhỏ; ứng dụng dùng `t` bên dưới). */
export function createTranslator<M extends MessageTree>(messages: M) {
  const flat = flattenMessages(messages);
  return (key: MessageKeys<M>, params?: MessageParams): string => {
    const template = flat.get(key);
    if (template === undefined) throw new Error(`i18n: thiếu khoá "${key}"`);
    return interpolate(key, template, params);
  };
}

/** Gộp sâu hai cây thông điệp (vi.json + vi.server.json); cùng một khoá lá ở cả hai = lỗi. */
export function mergeMessages(a: MessageTree, b: MessageTree, prefix = ""): MessageTree {
  const out: Record<string, string | MessageTree> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    const key = prefix === "" ? k : `${prefix}.${k}`;
    if (cur === undefined) out[k] = v;
    else if (typeof cur !== "string" && typeof v !== "string") out[k] = mergeMessages(cur, v, key);
    else throw new Error(`i18n: khoá "${key}" trùng giữa các tệp thông điệp`);
  }
  return out;
}
