import { useEffect, useState } from "react";

type Pos = { x: number; y: number; text: string; editable: boolean } | null;

export function ContextMenu() {
  const [pos, setPos] = useState<Pos>(null);

  useEffect(() => {
    const onContext = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      const editable = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable),
      );
      const selection = String(window.getSelection?.() || "").trim();
      setPos({ x: event.clientX, y: event.clientY, text: selection, editable });
    };
    const close = () => setPos(null);
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  if (!pos) return null;

  const copy = async () => {
    const text = pos.text || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setPos(null);
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && "value" in el) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        el.value = el.value.slice(0, start) + text + el.value.slice(end);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch {
      /* clipboard read not permitted in this webview */
    }
    setPos(null);
  };
  const open = (url: string) => {
    window.open(url, "_blank", "noopener");
    setPos(null);
  };

  const item =
    "block w-full whitespace-nowrap rounded-md px-3 py-1.5 text-left text-[12px] text-[#3A342D] hover:bg-[#F7F2EA]";

  return (
    <div
      className="fixed z-[9999] min-w-[160px] rounded-xl border border-[#E7E0D5] bg-white p-1 shadow-xl"
      style={{ left: Math.min(pos.x, window.innerWidth - 180), top: Math.min(pos.y, window.innerHeight - 180) }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {pos.editable && (
        <button type="button" className={item} onClick={() => void paste()}>
          붙여넣기
        </button>
      )}
      {!pos.editable && !pos.text && (
        <button type="button" className={item} onClick={() => { window.location.reload(); }}>
          새로고침
        </button>
      )}
      {pos.text && (
        <>
          <button type="button" className={item} onClick={() => void copy()}>
            복사
          </button>
          <button
            type="button"
            className={item}
            onClick={() =>
              open(
                "https://translate.google.com/?sl=auto&tl=ko&text=" +
                  encodeURIComponent(pos.text.slice(0, 1800)),
              )
            }
          >
            Google로 번역
          </button>
          <button
            type="button"
            className={item}
            onClick={() =>
              open("https://www.google.com/search?q=" + encodeURIComponent(pos.text.slice(0, 400)))
            }
          >
            검색
          </button>
        </>
      )}
    </div>
  );
}
