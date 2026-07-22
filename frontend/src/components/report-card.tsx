import { Scale } from "lucide-react";
import type { Turn } from "@/lib/api";
import { TurnMarkdown } from "@/components/turn-markdown";

function ReportList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{title}</p>
      <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-base leading-relaxed">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// The debate's ending: rendered on the session page and the public share
// page. Falls back to plain markdown when the judge's JSON didn't parse.
export function ReportCard({ turn }: { turn: Turn }) {
  const report = turn.verdict;
  const structured =
    report &&
    ((report.agreements?.length ?? 0) > 0 ||
      (report.contentions?.length ?? 0) > 0 ||
      (report.evidence?.length ?? 0) > 0 ||
      (report.cautions?.length ?? 0) > 0);

  return (
    <div className="w-full pl-11">
      <div className="judge-comet rounded-xl border bg-muted/40 px-5 py-4">
        <p className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          <Scale className="h-3.5 w-3.5 shrink-0 text-[#c4b5fd]" />
          Closing report
        </p>

        {structured ? (
          <div className="mt-3 space-y-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Where it landed
              </p>
              <p className="mt-1.5 text-base leading-relaxed">{turn.text}</p>
            </div>
            <ReportList title="Agreed" items={report?.agreements ?? []} />
            <ReportList title="Still contested" items={report?.contentions ?? []} />
            {(report?.evidence?.length ?? 0) > 0 && (
              <div>
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Evidence that mattered
                </p>
                <div className="mt-1.5 space-y-2.5">
                  {report!.evidence!.map((item, i) => (
                    <div key={i}>
                      <p className="text-base leading-relaxed">{item.claim}</p>
                      {item.sources.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {item.sources.map((s, j) => (
                            <a
                              key={j}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="max-w-[220px] truncate rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                            >
                              {s.title || s.url}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ReportList title="Read with caution" items={report?.cautions ?? []} />
          </div>
        ) : (
          <div className="mt-3">
            <TurnMarkdown text={turn.text} />
          </div>
        )}
      </div>
    </div>
  );
}
