import {
    ColumnDef,
    createSolidTable,
    getCoreRowModel,
    getSortedRowModel,
    Row,
    SortingState,
} from "@tanstack/solid-table";
import { useDraft } from "../../contexts/DraftContext";
import { Role, displayNameByRole } from "@draftgap/core/src/models/Role";
import { Team } from "@draftgap/core/src/models/Team";
import type { StrategySuggestion } from "../../contexts/DraftSuggestionsContext";
import { Table } from "../common/Table";
import ChampionCell from "../common/ChampionCell";
import { RoleCell } from "../common/RoleCell";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "solid-heroicons";
import { noSymbol as noSymbolOutline } from "solid-heroicons/outline";
import {
    bolt,
    exclamationTriangle,
    fire,
    noSymbol as noSymbolSolid,
    shieldCheck,
    sparkles,
    trophy,
} from "solid-heroicons/solid";
import { createMustSelectToast, createRiskyPickToast } from "../../utils/toast";
import { useUser } from "../../contexts/UserContext";
import { useDraftSuggestions } from "../../contexts/DraftSuggestionsContext";
import { useDataset } from "../../contexts/DatasetContext";
import { useDraftFilters } from "../../contexts/DraftFiltersContext";
import { championName } from "../../utils/i18n";
import { formatWinrate, formatWinrateDelta } from "../../utils/tiers";
import { ratingToWinrate } from "@draftgap/core/src/rating/ratings";
import { tooltip } from "../../directives/tooltip";
import { cn } from "../../utils/style";
import { summarizeHighlight } from "../../utils/highlights";
import { MIN_BLIND_PICK_RATE } from "../../constants/draft";
import type { ProHighlight } from "@draftgap/core/src/models/dataset/ChampionRoleData";
tooltip;

export default function DraftTable() {
    const { dataset } = useDataset();
    const {
        selection,
        pickChampion,
        select,
        bans,
        ownedChampions,
        toggleBan,
        allyTeam,
        opponentTeam,
    } = useDraft();
    const { search, roleFilter, bannedOnlyFilter, setBannedOnlyFilter } =
        useDraftFilters();
    const { allySuggestions, opponentSuggestions } = useDraftSuggestions();
    const { config } = useUser();

    const suggestions = (): StrategySuggestion[] =>
        selection.team === "opponent"
            ? opponentSuggestions()
            : allySuggestions();

    const ownsChampion = (championKey: string) =>
        // If we don't have owned champions, we are not logged in, so we own all champions.
        ownedChampions().size === 0 || ownedChampions().has(championKey);

    const championLabel = (championKey: string) => {
        const data = dataset()?.championData[championKey];
        return data ? championName(data, config) : championKey;
    };

    const renderHighlightSummary = (highlights: ProHighlight[]) => {
        if (!highlights.length) return null;
        const summary = summarizeHighlight(highlights[0]);
        return (
            <div class="text-[10px] text-neutral-500 leading-tight">
                <div>
                    {summary.resultLabel} · {summary.title}
                </div>
                {summary.subtitle && <div>{summary.subtitle}</div>}
                {summary.players && <div>{summary.players}</div>}
                {summary.opponents && (
                    <div class="italic">{`Opp: ${summary.opponents}`}</div>
                )}
            </div>
        );
    };

    const filteredSuggestions = (): StrategySuggestion[] => {
        let filtered = suggestions();
        if (!dataset()) {
            return filtered;
        }

        if (search()) {
            const str = search()
                .replaceAll(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "")
                .toLowerCase();
            filtered = filtered.filter((s) => {
                const champion = dataset()!.championData[s.championKey];
                return (
                    champion.name
                        .replaceAll(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "")
                        .toLowerCase()
                        .includes(str) ||
                    championName(champion, config)
                        .replaceAll(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "")
                        .toLowerCase()
                        .includes(str)
                );
            });
        }

        if (roleFilter() !== undefined) {
            filtered = filtered.filter((s) => s.role === roleFilter());
        }

        if (bannedOnlyFilter()) {
            filtered = filtered.filter((s) => bans.includes(s.championKey));
        } else if (
            config.banPlacement === "bottom" ||
            config.banPlacement === "hidden"
        ) {
            filtered = [...filtered].sort((a, b) => {
                const aBanned = bans.includes(a.championKey);
                const bBanned = bans.includes(b.championKey);
                if (aBanned && !bBanned) {
                    return 1;
                } else if (!aBanned && bBanned) {
                    return -1;
                }
                return 0;
            });
        }

        if (config.unownedPlacement === "hidden") {
            filtered = filtered.filter((s) => ownsChampion(s.championKey));
        } else if (config.unownedPlacement === "bottom") {
            filtered = [...filtered].sort((a, b) => {
                const aUnowned = !ownsChampion(a.championKey);
                const bUnowned = !ownsChampion(b.championKey);
                if (aUnowned && !bUnowned) {
                    return 1;
                } else if (!aUnowned && bUnowned) {
                    return -1;
                } else {
                    return 0;
                }
            });
        }

        return filtered;
    };

    const getTeamPicks = (team: Team) =>
        team === "ally" ? allyTeam : opponentTeam;

    const isRoleLockedForTeam = (team: Team, role: Role | undefined) => {
        if (role === undefined) {
            return false;
        }

        return getTeamPicks(team).some(
            (pick) => pick.role === role && pick.championKey !== undefined
        );
    };

    const isBanned = (championKey: string) => bans.includes(championKey);

    const shouldWarnRiskyPick = (suggestion: StrategySuggestion) => {
        const team = selection.team;
        if (!team) {
            return false;
        }

        const opposingTeamKey: Team = team === "ally" ? "opponent" : "ally";

        if (isRoleLockedForTeam(team, suggestion.role)) {
            return false;
        }
        if (isRoleLockedForTeam(opposingTeamKey, suggestion.role)) {
            return false;
        }

        const hasReliableData =
            suggestion.reliabilityWeight >= 0.55 || suggestion.reliability >= 0.5;
        const blindSafe =
            suggestion.blindSafety >= 0.6 ||
            suggestion.pickRate >= MIN_BLIND_PICK_RATE;
        const volatilityControlled = suggestion.sigma <= 0.035;
        const counterHeadroom =
            suggestion.counterRisk <= 0.45 || suggestion.effectiveMu >= 0.012;

        return (
            !(hasReliableData || blindSafe || volatilityControlled) &&
            !counterHeadroom
        );
    };


    const reasonIconByType: Record<
        StrategySuggestion["reasons"][number]["type"],
        typeof sparkles
    > = {
        synergy: sparkles,
        counter: bolt,
        meta: fire,
        performance: trophy,
        reliability: shieldCheck,
        risk: exclamationTriangle,
    };

    const reasonClassBySeverity: Record<
        StrategySuggestion["reasons"][number]["severity"],
        string
    > = {
        positive: "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30",
        negative: "bg-amber-500/20 text-amber-200 border border-amber-400/30",
        info: "bg-sky-500/15 text-sky-200 border border-sky-400/30",
    };

    const describeReasonValue = (
        reason: StrategySuggestion["reasons"][number]
    ) => {
        if (reason.value === undefined) {
            return "";
        }
        switch (reason.type) {
            case "meta":
            case "risk": {
                const delta = ratingToWinrate(reason.value) - 0.5;
                return formatWinrateDelta(delta);
            }
            case "reliability":
                return `${Math.round(reason.value * 100)}%`;
            case "performance":
            case "synergy":
            case "counter":
                return formatWinrateDelta(reason.value);
            default:
                return "";
        }
    };

    const renderReasonIcons = (suggestion: StrategySuggestion) => {
        if (!suggestion.reasons.length) {
            return null;
        }
        return (
            <div class="flex flex-wrap gap-1">
                <For each={suggestion.reasons.slice(0, 5)}>
                    {(reason) => {
                        const icon = reasonIconByType[reason.type] ?? sparkles;
                        const valueLabel = describeReasonValue(reason);
                        return (
                            <span
                                class={cn(
                                    "p-1 rounded-full transition-all duration-150 hover:scale-110",
                                    reasonClassBySeverity[reason.severity] ??
                                        "bg-neutral-700 text-neutral-200"
                                )}
                                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                // @ts-ignore
                                use:tooltip={{
                                    content: valueLabel
                                        ? `${reason.label} (${valueLabel})`
                                        : reason.label,
                                }}
                            >
                                <Icon path={icon} class="w-4 h-4" />
                            </span>
                        );
                    }}
                </For>
            </div>
        );
    };

    const renderChampionCell = (suggestion: StrategySuggestion) => {
        const waiting = suggestion.gated;
        const safe = !waiting && (suggestion.blindSafety >= 0.6 || suggestion.pickRate >= MIN_BLIND_PICK_RATE);
        const risky = !waiting && shouldWarnRiskyPick(suggestion);
        const situational = !safe && !risky && !waiting;

        return (
            <div class="flex flex-col gap-2 py-2">
                <div class="flex items-start justify-between gap-3">
                    <ChampionCell championKey={suggestion.championKey} />
                    <div class="flex items-center gap-2 text-[10px] uppercase tracking-wide">
                        <Show when={waiting}>
                            <span class="px-2 py-1 rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/50 shadow-[0_0_10px_rgba(251,191,36,0.35)]">
                                En attente du pick adverse
                            </span>
                        </Show>
                        <Show when={safe}>
                            <span class="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                                Blind safe
                            </span>
                        </Show>
                        <Show when={situational}>
                            <span class="px-2 py-1 rounded-full bg-sky-500/20 text-sky-200 border border-sky-400/40">
                                Situational
                            </span>
                        </Show>
                        <Show when={risky}>
                            <span class="px-2 py-1 rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/50 shadow-[0_0_10px_rgba(251,191,36,0.35)]">
                                Volatil
                            </span>
                        </Show>
                    </div>
                </div>
                <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase text-neutral-400 tracking-wide">
                    <span>{formatWinrate(suggestion.baseWinrate)}</span>
                    <span>{Math.round(suggestion.sampleSize).toLocaleString()} parties</span>
                    <span>{(suggestion.pickRate * 100).toFixed(1)}% pick rate</span>
                    <span>{Math.round(suggestion.reliability * 100)}% fiabilite</span>
                </div>
                {renderReasonIcons(suggestion)}
                <Show when={suggestion.proSynergyRefs.length > 0}>
                    <div class="flex flex-col gap-0.5 text-[11px] text-neutral-300">
                        <span class="uppercase text-neutral-500">
                            Synergies pro
                        </span>
                        <For each={suggestion.proSynergyRefs.slice(0, 2)}>
                            {(ref) => (
                                <div class="flex flex-col gap-0.5">
                                    <span>
                                        {displayNameByRole[ref.partnerRole]} -{" "}
                                        {championLabel(ref.partnerChampionKey)} (
                                        {Math.round(ref.winrate * 100)}% /{" "}
                                        {Math.round(ref.games)}g)
                                    </span>
                                    {renderHighlightSummary(ref.highlights)}
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
                <Show when={suggestion.proMatchupRefs.length > 0}>
                    <div class="flex flex-col gap-0.5 text-[11px] text-neutral-300">
                        <span class="uppercase text-neutral-500">
                            Matchups marquants
                        </span>
                        <For each={suggestion.proMatchupRefs.slice(0, 2)}>
                            {(ref) => (
                                <div class="flex flex-col gap-0.5">
                                    <span>
                                        vs {displayNameByRole[ref.opponentRole]} -{" "}
                                        {championLabel(ref.opponentChampionKey)} (
                                        {Math.round(ref.winrate * 100)}% /{" "}
                                        {Math.round(ref.games)}g)
                                    </span>
                                    {renderHighlightSummary(ref.highlights)}
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
        );
    };

    const renderImpactCell = (suggestion: StrategySuggestion) => {
        const delta = suggestion.teamWinrateDelta;
        const impactLabel = formatWinrateDelta(delta);
        const changeLabel = formatWinrateDelta(Math.abs(delta)).replace(/^\+/, "");
        const positive = delta >= 0;
        return (
            <div class="flex flex-col gap-1 py-2 text-[12px] uppercase leading-tight">
                <span
                    class={cn(
                        "text-sm font-semibold",
                        positive ? "text-emerald-300" : "text-rose-300"
                    )}
                >
                    Impact {impactLabel}
                </span>
                <span class="text-[11px] text-neutral-500">
                    {positive
                        ? `Augmente de ${changeLabel}`
                        : `Reduit de ${changeLabel}`}
                </span>
            </div>
        );
    };

    const columns: () => ColumnDef<StrategySuggestion>[] = () => [
        {
            id: "ban",
            header: () => (
                <button
                    type="button"
                    class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-neutral-800/60 hover:bg-neutral-700 transition"
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    use:tooltip={{
                        content: bannedOnlyFilter()
                            ? "Tout afficher"
                            : "Voir uniquement les bans",
                    }}
                    onClick={() => setBannedOnlyFilter(!bannedOnlyFilter())}
                >
                    <Icon
                        path={bannedOnlyFilter() ? noSymbolSolid : noSymbolOutline}
                        class={cn(
                            "w-5 transition-colors duration-200",
                            bannedOnlyFilter()
                                ? "text-rose-400"
                                : "text-neutral-300"
                        )}
                    />
                </button>
            ),
            accessorFn: (suggestion) => suggestion,
            cell: (info) => {
                const banned = isBanned(info.row.original.championKey);
                return (
                    <div class="flex items-center justify-center">
                        <button
                            type="button"
                            class={cn(
                                "inline-flex items-center justify-center w-8 h-8 rounded-full border transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-rose-400/60",
                                banned
                                    ? "border-rose-400/50 bg-rose-500/10 text-rose-300"
                                    : "border-transparent bg-neutral-800/60 hover:bg-neutral-700 text-neutral-400"
                            )}
                            aria-label={
                                banned
                                    ? "Retirer le ban sur ce champion"
                                    : "Bannir ce champion"
                            }
                            onClick={(event) => {
                                event.stopPropagation();
                                toggleBan(info.row.original.championKey);
                            }}
                        >
                            <Icon
                                path={banned ? noSymbolSolid : noSymbolOutline}
                                class="w-5 h-5"
                            />
                        </button>
                    </div>
                );
            },
            meta: {
                headerClass: "w-16 text-center",
                cellClass: "w-16 text-center",
            },
            enableSorting: false,
        },
        {
            header: "Role",
            accessorFn: (suggestion) => suggestion.role,
            cell: (info) => <RoleCell role={info.getValue<Role>()} />,
            meta: {
                headerClass: "w-20 text-neutral-400",
                cellClass: "align-top pt-4",
            },
            sortDescFirst: false,
        },
        {
            header: "Champion",
            accessorFn: (suggestion) => suggestion.championKey,
            cell: (info) => renderChampionCell(info.row.original),
            sortingFn: (a, b, id) =>
                dataset()!.championData[
                    a.getValue<string>(id)
                ].name.localeCompare(
                    dataset()!.championData[b.getValue<string>(id)].name
                ),
            meta: {
                headerClass: "min-w-[18rem]",
                cellClass: "align-top",
            },
        },
        {
            id: "impact",
            header: "Impact",
            accessorFn: (suggestion) => suggestion.effectiveMu,
            cell: (info) => renderImpactCell(info.row.original),
            sortDescFirst: true,
            meta: {
                headerClass: "w-40 text-neutral-400",
                cellClass: "align-top",
            },
        },
    ];


    const [sorting, setSorting] = createSignal<SortingState>([
        { id: "impact", desc: true },
    ]);
    const table = createSolidTable({
        get data() {
            return filteredSuggestions();
        },
        get columns() {
            return columns();
        },
        state: {
            get sorting() {
                return sorting();
            },
        },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    function pick(row: Row<StrategySuggestion>) {
        if (!selection.team) {
            createMustSelectToast();
            return;
        }

        if (shouldWarnRiskyPick(row.original)) {
            createRiskyPickToast();
        }

        pickChampion(
            selection.team,
            selection.index,
            row.original.championKey,
            row.original.role
        );

        document.getElementById("draftTableSearch")?.focus();
    }

    onMount(() => {
        const draftTable = document.getElementById("draft-table");

        const onKeyDown = (e: KeyboardEvent) => {
            const activeElement = document.activeElement;
            if (
                activeElement?.tagName === "INPUT" &&
                e.key !== "ArrowUp" &&
                e.key !== "ArrowDown"
            ) {
                return;
            }

            const selectFirstRow = () => {
                (
                    draftTable!.querySelector("tbody tr") as HTMLTableRowElement
                )?.focus();
            };

            if (e.key === "ArrowLeft" || e.key === "h") {
                e.preventDefault();
                select("ally");
            } else if (e.key === "ArrowRight" || e.key === "l") {
                e.preventDefault();
                select("opponent");
            } else if (e.key === "ArrowUp" || e.key === "k") {
                e.preventDefault();
                if (!activeElement || activeElement.tagName !== "TR") {
                    selectFirstRow();
                    return;
                }
                const previous =
                    activeElement.previousSibling as HTMLTableRowElement;
                if (previous.tagName === "TR") {
                    previous.focus();
                }
            } else if (e.key === "ArrowDown" || e.key === "j") {
                e.preventDefault();
                if (!activeElement || activeElement.tagName !== "TR") {
                    selectFirstRow();
                    return;
                }
                const next = activeElement.nextSibling as HTMLTableRowElement;
                if (next.tagName === "TR") {
                    next.focus();
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        onCleanup(() => {
            window.removeEventListener("keydown", onKeyDown);
        });
    });

    return (
        <>
            <Table
                table={table}
                onClickRow={pick}
                rowClassName={(r) => {
                    const classes: string[] = [
                        "transition-all duration-200",
                        "bg-gradient-to-r from-neutral-950/90 via-neutral-900/60 to-slate-900/60",
                        "hover:bg-neutral-800/70",
                        "hover:shadow-[0_0_25px_rgba(45,212,191,0.18)]",
                    ];
                    if (isBanned(r.original.championKey)) {
                        classes.push("opacity-40", "grayscale");
                    } else if (!ownsChampion(r.original.championKey)) {
                        classes.push("opacity-40");
                    }
                    if (r.original.gated) {
                        classes.push(
                            "border border-amber-400/40 bg-amber-500/10"
                        );
                    }
                    if (shouldWarnRiskyPick(r.original)) {
                        classes.push("ring-1 ring-amber-400/60 bg-amber-500/10");
                    }
                    return classes.join(" ");
                }}
                id="draft-table"
            />
        </>
    );
}
