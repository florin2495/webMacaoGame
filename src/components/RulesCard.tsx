"use client";

import { describeRules, type Rules } from "@/lib/rules";
import { Card } from "./ui";

/** The room's house rules in plain words, collapsed by default; shown above "Setări" on every room screen. */
export function RulesCard({ rules }: { rules: Rules }) {
  return (
    <Card className="py-2" data-testid="rules-card">
      <details className="group/rc">
        <summary className="block min-h-10 cursor-pointer list-none py-1 text-left">
          <span className="flex items-center gap-2 font-bold">
            <span className="w-3 shrink-0 text-xs transition-transform group-open/rc:rotate-90">▶</span>
            Regulile camerei
          </span>
        </summary>
        <ol className="list-decimal space-y-1 pb-2 pl-9 pt-1 text-left text-sm text-zinc-600 dark:text-zinc-400">
          <li>Pui o carte de aceeași culoare (inimă, romb, treflă, frunză) sau același număr cu cea de sus, ori tragi una din pachet.</li>
          {describeRules(rules).map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>Cine nu termină primul adună la scor cărțile rămase în mână.</li>
        </ol>
      </details>
    </Card>
  );
}
