// 보고서 본문 파서 — 원본 ui.js:26-144 formatReportBody를 React JSX로 이식.
// (dangerouslySetInnerHTML 대신 안전한 요소 트리 생성.)
// 문법: [라벨] / ■ 강조(+들여쓴 설명, [코드] 접두 분리) / • 불릿 / "n." 번호목록 / 일반 문단.
import type { ReactNode } from "react";

const labelRe = /^\[(.+)\]$/;
const numRe = /^(\d+)\.\s+(.+)$/;
const bulletRe = /^•\s+(.+)$/;
const accentRe = /^■\s+(.+)$/;
const codePrefixRe = /^\[([^\]]+)\]\s*(.*)$/;

function isBlockStart(s: string): boolean {
  return labelRe.test(s) || numRe.test(s) || bulletRe.test(s) || accentRe.test(s);
}

export function ReportBody({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === "") {
      i++;
      continue;
    }

    // [라벨] 소제목
    const lm = t.match(labelRe);
    if (lm) {
      blocks.push(
        <div
          key={key++}
          className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
        >
          {lm[1]}
        </div>,
      );
      i++;
      continue;
    }

    // ■ 강조 헤딩 (+ 들여쓴 설명)
    const am = t.match(accentRe);
    if (am) {
      const heading = am[1];
      i++;
      const descLines: string[] = [];
      while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
        descLines.push(lines[i].trim());
        i++;
      }
      const desc = descLines.join(" ");
      const codeMatch = heading.match(codePrefixRe);
      blocks.push(
        <div
          key={key++}
          className={`mb-3 border-l-2 pl-3 ${codeMatch ? "border-primary/50" : "border-border"}`}
        >
          {codeMatch ? (
            <div className="mb-1 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] font-semibold text-primary">{codeMatch[1]}</span>
              <span className="text-[13px] font-semibold text-foreground">{codeMatch[2]}</span>
            </div>
          ) : (
            <div className="mb-1 text-[13px] font-semibold text-foreground">{heading}</div>
          )}
          {desc && <p className="text-[13px] leading-relaxed text-muted-foreground">{desc}</p>}
        </div>,
      );
      continue;
    }

    // • 불릿 목록
    if (bulletRe.test(t)) {
      const items: string[] = [];
      while (i < lines.length) {
        const ln = lines[i].trim();
        if (ln === "") {
          i++;
          continue;
        }
        const m = ln.match(bulletRe);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push(
        <ul
          key={key++}
          className="mb-3 list-disc space-y-1 pl-5 text-[13px] text-foreground/80 marker:text-muted-foreground"
        >
          {items.map((it, j) => (
            <li key={j} className="leading-relaxed">
              {it}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // "n." 번호 목록(공백 줄/멀티라인 연속 허용)
    if (numRe.test(t)) {
      const items: { n: string; body: string }[] = [];
      while (i < lines.length) {
        const ln = lines[i].trim();
        if (ln === "") {
          i++;
          continue;
        }
        const m = ln.match(numRe);
        if (!m) break;
        let body = m[2];
        i++;
        while (i < lines.length) {
          const next = lines[i].trim();
          if (next === "" || isBlockStart(next)) break;
          body += " " + next;
          i++;
        }
        items.push({ n: m[1], body });
      }
      blocks.push(
        <ol key={key++} className="mb-3 space-y-2.5">
          {items.map((it, j) => (
            <li key={j} className="flex gap-3 text-[13px] leading-relaxed text-foreground/80">
              <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-semibold tabular-nums text-primary">
                {it.n}
              </span>
              <span className="flex-1">{it.body}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // 일반 문단(공백/블록 시작 전까지 수집)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const ln = lines[i].trim();
      if (ln === "" || isBlockStart(ln)) break;
      paraLines.push(ln);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(
        <p key={key++} className="mb-3 text-[13px] leading-relaxed text-foreground/80">
          {paraLines.join(" ")}
        </p>,
      );
    }
  }

  return <>{blocks}</>;
}
