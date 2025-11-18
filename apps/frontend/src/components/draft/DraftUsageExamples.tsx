import { For, Show, createMemo } from "solid-js";
import { useDraft } from "../../contexts/DraftContext";
import { useDraftSuggestions } from "../../contexts/DraftSuggestionsContext";
import { summarizeHighlight } from "../../utils/highlights";
import { RoleIcon } from "../icons/roles/RoleIcon";
import ChampionCell from "../common/ChampionCell";
import { displayNameByRole, Role } from "@draftgap/core/src/models/Role";
import { Team } from "@draftgap/core/src/models/Team";
import { cn } from "../../utils/style";

type ExampleRow = {
    role: Role;
    championKey: string;
    label: "pattern" | "matchup";
    summary: ReturnType<typeof summarizeHighlight>;
};

const MAX_EXAMPLES = 6;

export function DraftUsageExamples() {
    const { selection } = useDraft();
    const { allySuggestions, opponentSuggestions } = useDraftSuggestions();

    const rows = createMemo<ExampleRow[]>(() => {
        const team: Team = selection.team ?? "ally";
        const source =
            team === "opponent" ? opponentSuggestions() : allySuggestions();

        const seen = new Set<string>();
        const collected: ExampleRow[] = [];

        for (const suggestion of source) {
            if (collected.length >= MAX_EXAMPLES) break;

            const synergyRef = suggestion.proSynergyRefs.find(
                (ref) => ref.highlights.length > 0
            );
            if (synergyRef) {
                const summary = summarizeHighlight(synergyRef.highlights[0]);
                const key = summary.url ?? `${summary.title}-${suggestion.championKey}-synergy`;
                if (!seen.has(key)) {
                    seen.add(key);
                    collected.push({
                        role: suggestion.role,
                        championKey: suggestion.championKey,
                        label: "pattern",
                        summary,
                    });
                }
            }

            if (collected.length >= MAX_EXAMPLES) break;

            const matchupRef = suggestion.proMatchupRefs.find(
                (ref) => ref.highlights.length > 0
            );
            if (matchupRef) {
                const summary = summarizeHighlight(matchupRef.highlights[0]);
                const key = summary.url ?? `${summary.title}-${suggestion.championKey}-matchup`;
                if (!seen.has(key)) {
                    seen.add(key);
                    collected.push({
                        role: suggestion.role,
                        championKey: suggestion.championKey,
                        label: "matchup",
                        summary,
                    });
                }
            }
        }

        return collected.slice(0, MAX_EXAMPLES);
    });

    return (
        <section class="bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4">
            <div class="flex items-center justify-between">
                <span class="text-xs uppercase tracking-wide text-neutral-400">
                    Exemples de drafts pro
                </span>
                <span class="text-[11px] uppercase text-neutral-500">
                    {selection.team ?? "ally"} focus
                </span>
            </div>
            <Show
                when={rows().length > 0}
                fallback={
                    <div class="text-xs text-neutral-500">
                        Aucune mise en situation pro disponible pour cette configuration.
                    </div>
                }
            >
                <div class="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    <For each={rows()}>
                        {(row) => (
                            <article class="flex flex-col gap-3 rounded-lg border border-neutral-800/50 bg-neutral-950/70 px-3 py-3">
                                <div class="flex items-center gap-2">
                                    <RoleIcon role={row.role} class="h-4 w-4 text-neutral-400" />
                                    <ChampionCell
                                        championKey={row.championKey}
                                        nameMaxLength={16}
                                    />
                                    <span class="ml-auto text-[11px] uppercase text-neutral-500">
                                        {displayNameByRole[row.role]}
                                    </span>
                                </div>
                                <div class="flex flex-col gap-1 text-[11px] text-neutral-300">
                                    <span
                                        class={cn(
                                            "text-[10px] uppercase tracking-wide",
                                            row.label === "pattern"
                                                ? "text-sky-300"
                                                : "text-amber-300"
                                        )}
                                    >
                                        {row.label === "pattern"
                                            ? "Pattern pro"
                                            : "Matchup pro"}
                                    </span>
                                    <span class="font-semibold text-neutral-100">
                                        {row.summary.resultLabel} - {row.summary.title}
                                    </span>
                                    <Show when={row.summary.subtitle}>
                                        {(subtitle) => (
                                            <span class="text-neutral-500">
                                                {subtitle()}
                                            </span>
                                        )}
                                    </Show>
                                    <Show when={row.summary.players}>
                                        {(players) => (
                                            <span class="text-neutral-400">
                                                {players()}
                                            </span>
                                        )}
                                    </Show>
                                    <Show when={row.summary.opponents}>
                                        {(opponents) => (
                                            <span class="italic text-neutral-500">
                                                Opp: {opponents()}
                                            </span>
                                        )}
                                    </Show>
                                </div>
                                <Show when={row.summary.url}>
                                    {(url) => (
                                        <a
                                            class="text-[11px] uppercase text-primary-300 underline underline-offset-2 hover:text-primary-200"
                                            href={url()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            Voir le highlight
                                        </a>
                                    )}
                                </Show>
                            </article>
                        )}
                    </For>
                </div>
            </Show>
        </section>
    );
}

export default DraftUsageExamples;
