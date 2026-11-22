"use client";

import type { ReactNode } from "react";
import { HAND_SIZES, JOKER_DRAWS, MACAO_PENALTIES, type Rules } from "@/lib/rules";
import { Card, Toggle } from "./ui";

type Option<T> = { value: T; label: string };

function Choice<T extends string | number>({
  label,
  hint,
  value,
  options,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  hint?: string;
  value: T;
  options: Option<T>[];
  disabled: boolean;
  onChange: (v: T) => void;
  testId: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${disabled ? "opacity-70" : ""}`}>
      <span className="font-medium">{label}</span>
      <select
        data-testid={testId}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
        className="min-h-10 rounded-lg border border-zinc-300 bg-white px-2 text-base text-zinc-900 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <legend className="pr-2 text-xs font-bold uppercase tracking-wide text-zinc-500">{title}</legend>
      {children}
    </fieldset>
  );
}

const nums = (list: readonly number[], unit: (n: number) => string): Option<number>[] => list.map((n) => ({ value: n, label: unit(n) }));
const cards = (n: number) => `${n} ${n === 1 ? "carte" : "cărți"}`;

/**
 * House rules of the room. The host edits them in the lobby (each change is saved at once and resets
 * everyone's "ready"); the others see them read-only.
 */
export function RulesPanel({
  rules,
  editable,
  busy,
  onChange,
}: {
  rules: Rules;
  editable: boolean;
  busy: boolean;
  onChange: (patch: Partial<Rules>) => void;
}) {
  const off = !editable || busy;
  const set = <K extends keyof Rules>(key: K) => (value: Rules[K]) => onChange({ [key]: value } as Partial<Rules>);

  return (
    <Card className="py-2" data-testid="rules-panel">
      <details className="group" open={editable}>
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-bold">
            <span className="text-xs transition-transform group-open:rotate-90">▶</span>
            Regulile camerei
          </span>
          <span className="text-xs text-zinc-500">{editable ? "le alegi tu" : "le alege host-ul"}</span>
        </summary>
        <div className="flex flex-col gap-3 pb-2 pt-1">
          {editable && <p className="text-xs text-zinc-500">Orice schimbare resetează „gata” la toți.</p>}

          <Group title="Împărțire">
            <Choice testId="rule-handSize" label="Cărți de jucător" value={rules.handSize} options={nums(HAND_SIZES, cards)} disabled={off} onChange={set("handSize")} />
            <Toggle label="Cu jokeri (negru și colorat)" checked={rules.jokers} disabled={off} onChange={set("jokers")} />
          </Group>

          <Group title="2 și 3 (iei cărți)">
            <Choice<Rules["twoThreeOn"]>
              testId="rule-twoThreeOn"
              label="2 și 3 se pun"
              value={rules.twoThreeOn}
              options={[
                { value: "suit", label: "pe aceeași suită sau același număr" },
                { value: "color", label: "pe aceeași culoare (roșu / negru)" },
                { value: "any", label: "peste orice carte" },
              ]}
              disabled={off}
              onChange={set("twoThreeOn")}
            />
            <Toggle label="Peste 2 poți da 3 și peste 3 poți da 2" hint="Altfel peste 2 doar 2, peste 3 doar 3." checked={rules.mixTwoThree} disabled={off} onChange={set("mixTwoThree")} />
          </Group>

          {rules.jokers && (
            <Group title="Jokeri">
              <div className="grid grid-cols-2 gap-2">
                <Choice testId="rule-jokerBlackDraw" label="Joker negru: iei" value={rules.jokerBlackDraw} options={nums(JOKER_DRAWS, cards)} disabled={off} onChange={set("jokerBlackDraw")} />
                <Choice testId="rule-jokerRedDraw" label="Joker colorat: iei" value={rules.jokerRedDraw} options={nums(JOKER_DRAWS, cards)} disabled={off} onChange={set("jokerRedDraw")} />
              </div>
              <Choice<Rules["jokerOn"]>
                testId="rule-jokerOn"
                label="Jokerul se pune"
                value={rules.jokerOn}
                options={[
                  { value: "any", label: "peste orice carte" },
                  { value: "color", label: "colorat pe roșu (♥♦), negru pe negru (♠♣)" },
                ]}
                disabled={off}
                onChange={set("jokerOn")}
              />
              <Toggle label="Jokerul se adună cu 2 și 3" hint="Joker peste 2 / 3 și 2 / 3 peste joker." checked={rules.jokerStack} disabled={off} onChange={set("jokerStack")} />
              <Toggle label="Peste joker se poate da orice" hint="Altfel doar culoarea jokerului." checked={rules.anyOnJoker} disabled={off} onChange={set("anyOnJoker")} />
            </Group>
          )}

          <Group title="Stop (anulează cărțile de luat)">
            <Choice<Rules["stopRank"]>
              testId="rule-stopRank"
              label="Cartea de stop"
              value={rules.stopRank}
              options={[
                { value: "4", label: "4" },
                { value: "A", label: "As" },
                { value: "none", label: "fără stop" },
              ]}
              disabled={off}
              onChange={set("stopRank")}
            />
            {rules.stopRank !== "none" && (
              <>
                <Toggle label="Stopul de orice suită oprește" hint="Altfel doar de suita cărții de sus." checked={rules.stopAnySuit} disabled={off} onChange={set("stopAnySuit")} />
                <Toggle label="Stopul se poate pune peste orice" hint="Când nu ai de luat; altfel doar pe suită / număr." checked={rules.stopOnAnything} disabled={off} onChange={set("stopOnAnything")} />
              </>
            )}
          </Group>

          <Group title="Stai o tură">
            <Choice<Rules["skipRank"]>
              testId="rule-skipRank"
              label="Cartea de stat o tură"
              value={rules.skipRank}
              options={[
                { value: "A", label: "As" },
                { value: "4", label: "4" },
                { value: "none", label: "fără" },
              ]}
              disabled={off}
              onChange={set("skipRank")}
            />
            {rules.skipRank !== "none" && (
              <>
                <Toggle label="Se poate pune peste orice" hint="Altfel doar pe suită / număr." checked={rules.skipOnAnything} disabled={off} onChange={set("skipOnAnything")} />
                <Toggle label="Se dă mai departe (turele se adună)" hint={`Peste el pui tot ${rules.skipRank === "A" ? "As" : "4"}.`} checked={rules.skipStack} disabled={off} onChange={set("skipStack")} />
                {rules.stopRank !== "none" && (
                  <Toggle label="Statul o tură se poate opri cu stop" checked={rules.stopCancelsSkip} disabled={off} onChange={set("stopCancelsSkip")} />
                )}
              </>
            )}
          </Group>

          <Group title="Schimbă suita">
            <Choice<Rules["changeRank"]>
              testId="rule-changeRank"
              label="Cartea care schimbă suita"
              value={rules.changeRank}
              options={[
                { value: "7", label: "7" },
                { value: "J", label: "Valet (J)" },
                { value: "none", label: "fără" },
              ]}
              disabled={off}
              onChange={set("changeRank")}
            />
            {rules.changeRank !== "none" && (
              <Toggle label="Se poate pune peste orice" hint="Niciodată când ai cărți de luat." checked={rules.changeOnAnything} disabled={off} onChange={set("changeOnAnything")} />
            )}
          </Group>

          <Group title="Joc">
            <Toggle label="Mai multe cărți la fel deodată" hint="Ex. doi de 9; doi de 2 = iei 4. Cu ultimele două la fel termini fără „Macao”." checked={rules.multiPlay} disabled={off} onChange={set("multiPlay")} />
            <Toggle label="Poți pune imediat cartea trasă" hint="Dacă se potrivește. Altfel tura trece." checked={rules.playAfterDraw} disabled={off} onChange={set("playAfterDraw")} />
            <Toggle label="Poți termina cu o carte specială" checked={rules.finishOnSpecial} disabled={off} onChange={set("finishOnSpecial")} />
            <Toggle label="„Macao” și contra-Macao" hint="Cine rămâne cu o carte fără să zică „Macao” poate fi prins." checked={rules.macao} disabled={off} onChange={set("macao")} />
            {rules.macao && (
              <Choice testId="rule-macaoPenalty" label="Prins fără „Macao”: iei" value={rules.macaoPenalty} options={nums(MACAO_PENALTIES, cards)} disabled={off} onChange={set("macaoPenalty")} />
            )}
            <Choice<Rules["roundEnd"]>
              testId="rule-roundEnd"
              label="Sfârșitul rundei"
              value={rules.roundEnd}
              options={[
                { value: "first", label: "când primul rămâne fără cărți" },
                { value: "last", label: "se joacă până rămâne unul cu cărți" },
              ]}
              disabled={off}
              onChange={set("roundEnd")}
            />
          </Group>
        </div>
      </details>
    </Card>
  );
}
