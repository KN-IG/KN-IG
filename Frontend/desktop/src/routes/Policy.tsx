// Policy 페이지 — 에이전트별 정책 편집기.
//
// 좌측에서 에이전트를 고르고, 우측에서 감시 경로(watch)·차단 대상(protect)을
// 추가/삭제/수정한다. 저장하면 미배포(PENDING) 상태가 되고, 배포하면 적용(APPLIED)된다.
// policyProvider(mock) 경유 — 직접 fetch 금지. 백엔드 /api/policy 신설 시 provider 한 줄만 교체.
import { useEffect, useMemo, useState } from "react";
import { FolderTree, Plus, Save, ShieldBan, Trash2, Undo2, UploadCloud } from "lucide-react";
import { policyProvider } from "@/api/providers/policyProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  AgentPolicy,
  DeploymentStatus,
  ProtectKind,
  ProtectRule,
  WatchMode,
  WatchRule,
} from "@/types/contracts";

const STATUS: Record<DeploymentStatus, { label: string; cls: string }> = {
  APPLIED: { label: "적용됨", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  PENDING: { label: "미배포", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  FAILED: { label: "실패", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" },
};

const WATCH_MODE_LABEL: Record<WatchMode, string> = {
  recursive: "하위 포함",
  single: "단일",
  mount: "마운트 전체",
};
const PROTECT_KIND_LABEL: Record<ProtectKind, string> = {
  file: "파일",
  dir: "디렉토리",
};

let localSeq = 0;
const newId = (p: string) => `${p}-new-${(localSeq += 1)}`;

// 정책 → 편집 초안(깊은 복사). 비교/되돌리기 기준으로도 쓴다.
function toDraft(p: AgentPolicy) {
  return {
    watch: p.watch.map((w) => ({ ...w })),
    protect: p.protect.map((r) => ({ ...r })),
  };
}

interface Draft {
  watch: WatchRule[];
  protect: ProtectRule[];
}

export default function Policy() {
  const [policies, setPolicies] = useState<AgentPolicy[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<Draft>({ watch: [], protect: [] });
  const [original, setOriginal] = useState<Draft>({ watch: [], protect: [] });
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 최초 로드.
  useEffect(() => {
    let alive = true;
    void policyProvider.list().then((d) => {
      if (!alive) return;
      setPolicies(d);
      if (d.length > 0) selectAgent(d[0]);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectAgent(p: AgentPolicy) {
    setSelectedId(p.agentId);
    const d = toDraft(p);
    setDraft(d);
    setOriginal(toDraft(p));
  }

  const selected = policies?.find((p) => p.agentId === selectedId) ?? null;

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(original),
    [draft, original],
  );
  const hasEmptyPath = useMemo(
    () =>
      draft.watch.some((w) => !w.path.trim()) ||
      draft.protect.some((r) => !r.path.trim()),
    [draft],
  );

  // ── 행 편집 ──
  const addWatch = () =>
    setDraft((d) => ({ ...d, watch: [...d.watch, { id: newId("w"), path: "", mode: "recursive" }] }));
  const updateWatch = (id: string, patch: Partial<WatchRule>) =>
    setDraft((d) => ({ ...d, watch: d.watch.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  const removeWatch = (id: string) =>
    setDraft((d) => ({ ...d, watch: d.watch.filter((w) => w.id !== id) }));

  const addProtect = () =>
    setDraft((d) => ({ ...d, protect: [...d.protect, { id: newId("p"), path: "", kind: "file" }] }));
  const updateProtect = (id: string, patch: Partial<ProtectRule>) =>
    setDraft((d) => ({ ...d, protect: d.protect.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeProtect = (id: string) =>
    setDraft((d) => ({ ...d, protect: d.protect.filter((r) => r.id !== id) }));

  // ── 저장/배포 ──
  function applyUpdated(updated: AgentPolicy) {
    setPolicies((prev) => (prev ?? []).map((p) => (p.agentId === updated.agentId ? updated : p)));
  }

  async function handleSave() {
    if (!selected || !dirty || hasEmptyPath) return;
    setBusy(true);
    try {
      const trimmed: Draft = {
        watch: draft.watch.map((w) => ({ ...w, path: w.path.trim() })),
        protect: draft.protect.map((r) => ({ ...r, path: r.path.trim() })),
      };
      const updated = await policyProvider.save(selected.agentId, trimmed);
      applyUpdated(updated);
      setDraft(toDraft(updated));
      setOriginal(toDraft(updated));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeploy() {
    if (!selected) return;
    setBusy(true);
    setConfirmOpen(false);
    try {
      const updated = await policyProvider.deploy(selected.agentId);
      applyUpdated(updated);
    } finally {
      setBusy(false);
    }
  }

  function handleRevert() {
    setDraft({
      watch: original.watch.map((w) => ({ ...w })),
      protect: original.protect.map((r) => ({ ...r })),
    });
  }

  if (!policies) {
    return (
      <div className="grid grid-cols-[260px_1fr] gap-6">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      {/* 좌측: 에이전트 목록 */}
      <Card className="glass-surface h-fit border-0">
        <CardHeader>
          <CardTitle className="text-base">에이전트</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {policies.map((p) => {
            const active = p.agentId === selectedId;
            const s = STATUS[p.status];
            return (
              <button
                key={p.agentId}
                onClick={() => selectAgent(p)}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10"
                    : "border-border/60 hover:bg-accent",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{p.agent}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", s.cls)}>
                    {s.label}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  감시 {p.watch.length} · 차단 {p.protect.length}
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* 우측: 편집기 */}
      <Card className="glass-surface border-0">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div className="flex flex-col gap-0.5">
            <CardTitle className="text-base">
              {selected ? `${selected.agent} 정책` : "정책"}
            </CardTitle>
            {selected && (
              <span className="text-xs text-muted-foreground">
                최종 저장 {selected.updatedAt} ·{" "}
                <span className="text-foreground/70">{STATUS[selected.status].label}</span>
                {dirty && <span className="ml-1 text-amber-600 dark:text-amber-400">· 변경됨</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleRevert} disabled={!dirty || busy}>
              <Undo2 />
              되돌리기
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!dirty || hasEmptyPath || busy}>
              <Save />
              저장
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={busy || dirty}
              title={dirty ? "저장 후 배포할 수 있습니다" : "에이전트에 정책을 배포합니다"}
            >
              <UploadCloud />
              배포
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {!selected ? (
            <div className="py-12 text-center text-muted-foreground">
              왼쪽에서 에이전트를 선택하세요.
            </div>
          ) : (
            <>
              {/* 감시 경로 */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FolderTree className="size-4 text-primary" />
                    감시 경로
                    <span className="font-normal text-muted-foreground">({draft.watch.length})</span>
                  </h3>
                  <Button variant="ghost" size="sm" onClick={addWatch}>
                    <Plus />
                    경로 추가
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  무결성 변경을 감지할 디렉토리·파일입니다. (inotify/fanotify)
                </p>
                {draft.watch.length === 0 ? (
                  <EmptyRow text="감시 경로가 없습니다. ‘경로 추가’로 등록하세요." />
                ) : (
                  <div className="flex flex-col gap-2">
                    {draft.watch.map((w) => (
                      <div key={w.id} className="flex items-center gap-2">
                        <Input
                          value={w.path}
                          onChange={(e) => updateWatch(w.id, { path: e.target.value })}
                          placeholder="/var/www/html"
                          className={cn("h-9 flex-1 font-mono text-sm", !w.path.trim() && "border-rose-400")}
                        />
                        <Select
                          value={w.mode}
                          onValueChange={(v) => updateWatch(w.id, { mode: v as WatchMode })}
                        >
                          <SelectTrigger className="h-9 w-32 shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(WATCH_MODE_LABEL) as WatchMode[]).map((m) => (
                              <SelectItem key={m} value={m}>
                                {WATCH_MODE_LABEL[m]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-rose-500"
                          onClick={() => removeWatch(w.id)}
                          aria-label="감시 경로 삭제"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 차단 대상 */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ShieldBan className="size-4 text-rose-500" />
                    차단 대상
                    <span className="font-normal text-muted-foreground">({draft.protect.length})</span>
                  </h3>
                  <Button variant="ghost" size="sm" onClick={addProtect}>
                    <Plus />
                    대상 추가
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  변경·삭제를 실시간으로 차단(block)할 파일·디렉토리입니다.
                </p>
                {draft.protect.length === 0 ? (
                  <EmptyRow text="차단 대상이 없습니다. ‘대상 추가’로 등록하세요." />
                ) : (
                  <div className="flex flex-col gap-2">
                    {draft.protect.map((r) => (
                      <div key={r.id} className="flex items-center gap-2">
                        <Input
                          value={r.path}
                          onChange={(e) => updateProtect(r.id, { path: e.target.value })}
                          placeholder="/etc/ig_monitor/ig.conf"
                          className={cn("h-9 flex-1 font-mono text-sm", !r.path.trim() && "border-rose-400")}
                        />
                        <Select
                          value={r.kind}
                          onValueChange={(v) => updateProtect(r.id, { kind: v as ProtectKind })}
                        >
                          <SelectTrigger className="h-9 w-32 shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(PROTECT_KIND_LABEL) as ProtectKind[]).map((k) => (
                              <SelectItem key={k} value={k}>
                                {PROTECT_KIND_LABEL[k]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-rose-500"
                          onClick={() => removeProtect(r.id)}
                          aria-label="차단 대상 삭제"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {hasEmptyPath && (
                <p className="text-xs text-rose-500">빈 경로가 있습니다. 경로를 입력하거나 행을 삭제하세요.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 배포 확인 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>정책을 배포할까요?</DialogTitle>
            <DialogDescription>
              {selected?.agent} 에이전트에 현재 저장된 정책을 적용합니다. 감시 경로{" "}
              {selected?.watch.length ?? 0}건, 차단 대상 {selected?.protect.length ?? 0}건이 반영됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              취소
            </Button>
            <Button onClick={handleDeploy} disabled={busy}>
              <UploadCloud />
              배포
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 py-6 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
