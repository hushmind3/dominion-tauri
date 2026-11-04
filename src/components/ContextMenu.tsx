import { useEffect, useState } from "react";

type Ctx = {
  x: number;
  y: number;
  text: string;
  editable: boolean;
  link: string;
  code: string;
  message: string;
};

export function ContextMenu() {
  const [ctx, setCtx] = useState<Ctx | null>(null);

  useEffect(() => {
    const onContext = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const editable = Boolean(
        target.closest("input, textarea, [contenteditable='true']"),
      );
      const selection = String(window.getSelection?.() || "").trim();
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      const pre = target.closest("pre") as HTMLElement | null;
      const msg = target.closest("[data-message]") as HTMLElement | null;
      setCtx({
        x: event.clientX,
        y: event.clientY,
        text: selection,
        editable,
        link: anchor?.href || "",
        code: pre?.innerText || "",
        message: msg?.innerText || "",
      });
    };
    const close = () => setCtx(null);
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  if (!ctx) return null;

  const write = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCtx(null);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && "value" in el) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        const setter = Object.getOwnPropertyDescriptor(
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(el, el.value.slice(0, start) + text + el.value.slice(end));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.selectionStart = el.selectionEnd = start + text.length;
      }
    } catch {
      /* webview may block clipboard reads */
    }
    setCtx(null);
  };

  const open = (url: string) => {
    window.open(url, "_blank", "noopener");
    setCtx(null);
  };

  const item =
    "block w-full whitespace-nowrap rounded-md px-3 py-1.5 text-left text-[12px] text-[#3A342D] hover:bg-[#F7F2EA]";

  const rows: Array<{ label: string; run: () => void }> = [];
  if (ctx.editable) rows.push({ label: "붙여넣기", run: () => void paste() });
  if (ctx.text) {
    rows.push({ label: "복사", run: () => void write(ctx.text) });
    rows.push({
      label: "Google로 번역",
      run: () =>
        open("https://translate.google.com/?sl=auto&tl=ko&text=" + encodeURIComponent(ctx.text.slice(0, 1800))),
    });
    rows.push({
      label: "검색",
      run: () => open("https://www.google.com/search?q=" + encodeURIComponent(ctx.text.slice(0, 400))),
    });
  }
  if (!ctx.text) {
    if (ctx.code) rows.push({ label: "코드 복사", run: () => void write(ctx.code) });
    if (ctx.message) rows.push({ label: "메시지 전체 복사", run: () => void write(ctx.message) });
    if (ctx.link) {
      rows.push({ label: "링크 열기", run: () => open(ctx.link) });
      rows.push({ label: "링크 주소 복사", run: () => void write(ctx.link) });
    }
  }
  rows.push({ label: "새로고침", run: () => window.location.reload() });

  return (
    <div
      className="fixed z-[9999] min-w-[170px] rounded-xl border border-[#E7E0D5] bg-white p-1 text-[#3A342D] shadow-xl"
      style={{
        left: Math.min(ctx.x, window.innerWidth - 200),
        top: Math.min(ctx.y, window.innerHeight - 40 - rows.length * 30),
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {rows.map((row) => (
        <button key={row.label} type="button" className={item} onClick={row.run}>
          {row.label}
        </button>
      ))}
    </div>
  );
}
