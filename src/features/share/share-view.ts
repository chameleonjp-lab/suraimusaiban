import type { ResultSession } from "../../domain/types";
import { cardDescription, renderCard, type CardKind } from "./card";
import { resultShare } from "./x-share";
export async function shareCard(
  blob: Blob,
  text: string,
): Promise<"shared" | "cancelled" | "fallback"> {
  try {
    const file = new File([blob], "slime-trial.png", { type: "image/png" });
    if (
      typeof navigator.canShare !== "function" ||
      typeof navigator.share !== "function" ||
      !navigator.canShare({ files: [file] })
    )
      return "fallback";
    await navigator.share({ files: [file], text });
    return "shared";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError"
      ? "cancelled"
      : "fallback";
  }
}
function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
}
export function mountShare(
  container: HTMLElement,
  session: ResultSession,
  gameUrl: string,
): () => void {
  let disposed = false,
    blob: Blob | null = null,
    url: string | null = null,
    generation = 0;
  const title = node("h2", "今回の結果を、画像で持ち帰る");
  title.className = "section-heading";
  const intro = node(
    "p",
    "この結果は画面を離れると閉じます。3種類の画像を保存できます。",
  );
  const select = node("select");
  select.setAttribute("aria-label", "保存する画像");
  for (const [value, label] of [
    ["personality", "人物傾向"],
    ["comparison", "全体との比較"],
    ["verdict", "判決の記録"],
  ]) {
    const option = node("option", label);
    option.value = value;
    select.append(option);
  }
  select.style.minHeight = "44px";
  select.style.maxWidth = "100%";
  const preview = node("img");
  preview.style.cssText =
    "display:none;width:100%;max-width:360px;height:auto;margin:1rem auto;border:1px solid #d5cedd;border-radius:10px";
  const note = node("p", "画像を準備しています。");
  note.setAttribute("role", "status");
  note.setAttribute("aria-live", "polite");
  const save = node("a", "PNG画像を保存");
  save.className = "primary-button";
  save.download = "slime-trial-personality.png";
  save.style.display = "none";
  const share = node("button", "端末で画像を共有");
  share.type = "button";
  share.className = "secondary-button";
  share.disabled = true;
  const copy = node("button", "投稿文をコピー");
  copy.type = "button";
  copy.className = "secondary-button";
  const retry = node("button", "画像生成を再試行");
  retry.type = "button";
  retry.className = "secondary-button";
  retry.hidden = true;
  const post = resultShare(session.individual);
  const postText = `${post.text}\n${post.url}`;
  const manualText = node("textarea", postText);
  manualText.value = postText;
  manualText.readOnly = true;
  manualText.setAttribute("aria-label", "コピー用の投稿文");
  manualText.hidden = true;
  manualText.style.width = "100%";
  const help = node(
    "p",
    "画像は保存してX側で添付できます。投稿文のリンクに画像は自動添付されません。投稿はXで確認して確定してください。",
  );
  const actions = node("div");
  actions.style.cssText =
    "display:flex;flex-wrap:wrap;gap:.6rem;align-items:center";
  actions.append(save, share, copy, retry);
  container.replaceChildren(
    title,
    intro,
    select,
    preview,
    note,
    actions,
    manualText,
    help,
  );
  const generate = async () => {
    const ticket = ++generation;
    blob = null;
    share.disabled = true;
    save.removeAttribute("href");
    save.style.display = "none";
    retry.hidden = true;
    preview.style.display = "none";
    note.textContent = "画像を準備しています。";
    try {
      const kind = select.value as CardKind;
      const output = await renderCard(kind, session, gameUrl);
      if (disposed || ticket !== generation) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(output);
      blob = output;
      preview.src = url;
      preview.alt = cardDescription(kind, session);
      preview.style.display = "block";
      save.href = url;
      save.download = `slime-trial-${kind}.png`;
      save.style.display = "inline-flex";
      share.disabled = false;
      note.textContent = "画像を確認して、保存または共有してください。";
    } catch {
      if (!disposed && ticket === generation) {
        note.textContent =
          "画像を作成できませんでした。もう一度お試しください。";
        retry.hidden = false;
      }
    }
  };
  const onShare = async () => {
    if (!blob) return;
    const result = await shareCard(blob, postText);
    if (disposed) return;
    note.textContent =
      result === "shared"
        ? "共有画面へ渡しました。"
        : result === "cancelled"
          ? "共有を取り消しました。画像と結果はそのままです。"
          : "端末で画像を共有できません。PNG画像を保存し、投稿文をコピーして添付してください。";
  };
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(postText);
      if (!disposed) note.textContent = "投稿文をコピーしました。";
    } catch {
      if (disposed) return;
      manualText.hidden = false;
      manualText.focus();
      manualText.select();
      note.textContent =
        "コピーできませんでした。下の投稿文を選択してコピーできます。";
    }
  };
  const onSave = () => {
    note.textContent =
      "画像を開いて保存できます。端末によっては長押しで画像を保存してください。";
  };
  select.addEventListener("change", generate);
  retry.addEventListener("click", generate);
  share.addEventListener("click", onShare);
  copy.addEventListener("click", onCopy);
  save.addEventListener("click", onSave);
  void generate();
  return () => {
    disposed = true;
    generation++;
    select.removeEventListener("change", generate);
    retry.removeEventListener("click", generate);
    share.removeEventListener("click", onShare);
    copy.removeEventListener("click", onCopy);
    save.removeEventListener("click", onSave);
    preview.removeAttribute("src");
    if (url) URL.revokeObjectURL(url);
    blob = null;
    container.replaceChildren();
  };
}
