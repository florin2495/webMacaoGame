"use client";

import { type ReactNode, useState } from "react";
import { HAND_SIZES, JOKER_DRAWS, MACAO_PENALTIES, type Rules, type StopMode, stopMode, stopModeRules, updateRules } from "@/lib/rules";
import { Button, Card, Toggle } from "./ui";

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

/** One collapsible section of the rules menu; the closed row shows the current choice. */
function Group({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <details className="group/sec border-t border-zinc-200 dark:border-zinc-800">
      {/* Block summary with an inner flex row: iOS Safari does not lay out <summary> itself as flex. */}
      <summary className="block min-h-11 cursor-pointer list-none py-2 text-left">
        <span className="flex items-start gap-2">
          <span className="mt-1 w-3 shrink-0 text-[10px] text-zinc-400 transition-transform group-open/sec:rotate-90">▶</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{title}</span>
            <span className="block truncate text-xs text-zinc-500">{summary}</span>
          </span>
        </span>
      </summary>
      <div className="flex flex-col gap-2 pb-3 text-left">{children}</div>
    </details>
  );
}

const rankName = (r: string) => (r === "A" ? "As" : r);
const onOff = (v: boolean) => (v ? "da" : "nu");

const nums = (list: readonly number[], unit: (n: number) => string): Option<number>[] => list.map((n) => ({ value: n, label: unit(n) }));
const cards = (n: number) => `${n} ${n === 1 ? "carte" : "cărți"}`;

/**
 * House rules of the room. The host edits a local draft in the lobby (no request per tick) and sends it with
 * "Salvează regulile" (that resets everyone's "ready"); the others see the saved rules read-only.
 */
export function RulesPanel({
  rules: saved,
  editable,
  busy,
  onSave,
}: {
  rules: Rules;
  editable: boolean;
  busy: boolean;
  onSave: (rules: Rules) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Rules | null>(null);
  const rules = editable && draft ? draft : saved;
  const dirty = editable && draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const off = !editable || busy;
  const set = <K extends keyof Rules>(key: K) => (value: Rules[K]) =>
    setDraft(updateRules(rules, { [key]: value } as Partial<Rules>));

  return (
    <Card className="py-2" data-testid="rules-panel">
      <details className="group/rules">
        <summary className="block min-h-11 cursor-pointer list-none py-1 text-left">
          <span className="flex items-start gap-2">
            <span className="mt-1 w-3 shrink-0 text-xs transition-transform group-open/rules:rotate-90">▶</span>
            <span className="min-w-0">
              <span className="block font-bold">Alege regulile</span>
              <span className="block text-xs text-zinc-500">
                {dirty ? "modificări nesalvate" : editable ? "apasă ca să le schimbi" : "le alege host-ul"}
              </span>
            </span>
          </span>
        </summary>
        <div className="flex flex-col pb-1 pt-1 text-left">
          {editable && <p className="pb-2 text-xs text-zinc-500">Alegi tot ce vrei, apoi „Salvează regulile”. Salvarea resetează „gata” la toți.</p>}

          <Group title="Împărțire" summary={`${cards(rules.handSize)}, ${rules.jokers ? "cu jokeri" : "fără jokeri"}`}>
            <Choice testId="rule-handSize" label="Cărți de jucător" value={rules.handSize} options={nums(HAND_SIZES, cards)} disabled={off} onChange={set("handSize")} />
            <Toggle label="Cu jokeri (negru și colorat)" checked={rules.jokers} disabled={off} onChange={set("jokers")} />
          </Group>

          <Group title="2 și 3" summary={`${rules.twoThreeOn === "any" ? "peste orice" : rules.twoThreeOn === "color" ? "roșu/negru" : "pe culoare"}, 2↔3 ${onOff(rules.mixTwoThree)}`}>
            <Choice<Rules["twoThreeOn"]>
              testId="rule-twoThreeOn"
              label="2 și 3 se pun"
              value={rules.twoThreeOn}
              options={[
                { value: "suit", label: "pe aceeași culoare sau același număr" },
                { value: "color", label: "roșu pe roșu, negru pe negru (sau același număr)" },
                { value: "any", label: "peste orice carte" },
              ]}
              disabled={off}
              onChange={set("twoThreeOn")}
            />
            <Toggle label="Peste 2 poți da 3 și peste 3 poți da 2" hint="Altfel peste 2 doar 2, peste 3 doar 3." checked={rules.mixTwoThree} disabled={off} onChange={set("mixTwoThree")} />
          </Group>

          {rules.jokers && (
            <Group title="Jokeri" summary={`+${rules.jokerBlackDraw} / +${rules.jokerRedDraw}, ${rules.jokerOn === "any" ? "peste orice" : "roșu/negru"}`}>
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
              <Toggle label="Peste joker se poate da orice" hint="Altfel doar roșu pe jokerul colorat, negru pe cel negru." checked={rules.anyOnJoker} disabled={off} onChange={set("anyOnJoker")} />
            </Group>
          )}

          <Group title="Stop" summary={rules.stopRank === "none" ? "fără" : `${rankName(rules.stopRank)}, ${{ any: "peste orice", penalty: "peste orice doar când ai de luat", match: "doar pe culoare" }[stopMode(rules)]}`}>
            <Choice<Rules["stopRank"]>
              testId="rule-stopRank"
              label="Cartea de stop (anulează cărțile de luat)"
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
                <Choice<StopMode>
                  testId="rule-stopMode"
                  label={`Unde se pune ${rankName(rules.stopRank)}`}
                  value={stopMode(rules)}
                  options={[
                    { value: "penalty", label: "peste orice culoare când ai de luat, altfel doar pe culoarea lui" },
                    { value: "match", label: "doar pe culoarea lui (sau pe alt " + rankName(rules.stopRank) + "), mereu" },
                    { value: "any", label: "peste orice carte, mereu" },
                  ]}
                  disabled={off}
                  onChange={(m) => setDraft(updateRules(rules, stopModeRules(m)))}
                />
                {rules.skipRank !== "none" && (
                  <Toggle
                    label={`${rankName(rules.stopRank)} oprește și „stai o tură”`}
                    hint={`Când ți se dă ${rankName(rules.skipRank)}, poți răspunde cu ${rankName(rules.stopRank)} și nu stai.`}
                    checked={rules.stopCancelsSkip}
                    disabled={off}
                    onChange={set("stopCancelsSkip")}
                  />
                )}
              </>
            )}
          </Group>

          <Group title="Stai o tură" summary={rules.skipRank === "none" ? "fără" : `${rankName(rules.skipRank)}, ${rules.skipOnAnything ? "peste orice" : "doar pe culoare"}${rules.skipStack ? ", se adună" : ""}`}>
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
                <Choice<"any" | "match">
                  testId="rule-skipOn"
                  label={`Unde se pune ${rankName(rules.skipRank)}`}
                  value={rules.skipOnAnything ? "any" : "match"}
                  options={[
                    { value: "match", label: `doar pe culoarea lui (sau pe alt ${rankName(rules.skipRank)})` },
                    { value: "any", label: "peste orice carte (nu când ai de luat)" },
                  ]}
                  disabled={off}
                  onChange={(v) => set("skipOnAnything")(v === "any")}
                />
                <Toggle label="Se dă mai departe (turele se adună)" hint={`Peste el pui tot ${rules.skipRank === "A" ? "As" : "4"}.`} checked={rules.skipStack} disabled={off} onChange={set("skipStack")} />
              </>
            )}
          </Group>

          <Group title="Schimbă culoarea" summary={rules.changeRank === "none" ? "fără" : `${rankName(rules.changeRank)}, ${rules.changeOnAnything ? "peste orice" : "doar pe culoare"}`}>
            <Choice<Rules["changeRank"]>
              testId="rule-changeRank"
              label="Cartea care schimbă culoarea"
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
              <Choice<"any" | "match">
                testId="rule-changeOn"
                label={`Unde se pune ${rankName(rules.changeRank)}`}
                value={rules.changeOnAnything ? "any" : "match"}
                options={[
                  { value: "any", label: "peste orice carte (nu când ai de luat)" },
                  { value: "match", label: `doar pe culoarea lui (sau pe alt ${rankName(rules.changeRank)})` },
                ]}
                disabled={off}
                onChange={(v) => set("changeOnAnything")(v === "any")}
              />
            )}
          </Group>

          <Group title="Joc și Macao" summary={`${rules.macao ? `Macao +${rules.macaoPenalty}` : "fără Macao"}, ${rules.roundEnd === "first" ? "până iese primul" : "până rămâne unul"}`}>
            <Toggle label="Mai multe cărți la fel deodată" hint="Ex. doi de 9; doi de 2 = iei 4. Cu ultimele două la fel termini fără „Macao”." checked={rules.multiPlay} disabled={off} onChange={set("multiPlay")} />
            <Toggle label="Poți pune imediat cartea trasă" hint="Dacă se potrivește. Altfel tura trece." checked={rules.playAfterDraw} disabled={off} onChange={set("playAfterDraw")} />
            <Toggle label="Poți termina cu o carte specială" hint="Speciale: 2, 3, joker, stop, stai o tură, schimbă culoarea." checked={rules.finishOnSpecial} disabled={off} onChange={set("finishOnSpecial")} />
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
          {editable && (
            <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <Button
                disabled={!dirty || busy}
                data-testid="save-rules"
                onClick={() => {
                  if (draft) void onSave(draft);
                }}
              >
                {busy ? "Se salvează…" : "Salvează regulile"}
              </Button>
              <Button variant="secondary" disabled={!dirty || busy} onClick={() => setDraft(null)}>
                Renunță
              </Button>
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}
