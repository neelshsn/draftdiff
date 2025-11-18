import {
    ColumnDef,
    SortingState,
    createSolidTable,
    getCoreRowModel,
    getSortedRowModel,
} from "@tanstack/solid-table";
import Papa, { ParseResult } from "papaparse";
import {
    Component,
    For,
    Show,
    createMemo,
    createResource,
    createSignal,
} from "solid-js";
import { format } from "date-fns";
import { Panel, PanelHeader } from "../../common/Panel";
import { Table } from "../../common/Table";
import { LoadingIcon } from "../../icons/LoadingIcon";
import { cn } from "../../../utils/style";

const devCsvPath =
    typeof __DATA_VIZ_DEV_CSV__ !== "undefined"
        ? __DATA_VIZ_DEV_CSV__.replace(/\\/g, "/")
        : undefined;
const isNodeDev =
    typeof process !== "undefined" &&
    process?.env?.NODE_ENV !== "production";
const isDevEnvironment = Boolean(import.meta.env?.DEV ?? isNodeDev);

const CSV_URL =
    isDevEnvironment && devCsvPath
        ? `/@fs/${encodeURI(devCsvPath)}`
        : "/data/2025.csv";

type CsvRow = {
    gameid?: string;
    participantid?: string;
    date?: string;
    league?: string;
    split?: string;
    playoffs?: number | string;
    patch?: string;
    side?: string;
    position?: string;
    playername?: string;
    playerid?: string;
    teamname?: string;
    champion?: string;
    result?: number | string;
    kills?: number | string;
    deaths?: number | string;
    assists?: number | string;
    gamelength?: number | string;
};

type DataRow = {
    id: string;
    gameId: string;
    date: string | null;
    timestamp: number | null;
    league: string;
    split: string;
    patch: string;
    playoffs: boolean;
    side: string;
    position: string;
    playerName: string;
    playerId: string;
    teamName: string;
    champion: string;
    result: "Win" | "Loss";
    kills: number;
    deaths: number;
    assists: number;
    kda: number;
    gameLength: number;
};

type DatasetStats = {
    entryCount: number;
    uniqueGames: number;
    uniquePlayers: number;
    uniqueChampions: number;
    averageDuration: number;
    averageKills: number;
    averageKda: number;
    winRate: number;
};

const defaultStats: DatasetStats = {
    entryCount: 0,
    uniqueGames: 0,
    uniquePlayers: 0,
    uniqueChampions: 0,
    averageDuration: 0,
    averageKills: 0,
    averageKda: 0,
    winRate: 0,
};

const parseCsv = async () =>
    new Promise<DataRow[]>((resolve, reject) => {
        const rows: DataRow[] = [];

        const toDataRow = (row: CsvRow): DataRow | undefined => {
            if (!row.gameid || !row.participantid) return undefined;

            const id = `${row.gameid}-${row.participantid}`;
            const rawDate = row.date ? String(row.date).replace(" ", "T") : null;
            const date = rawDate ? `${rawDate}Z` : null;
            const timestamp = date ? new Date(date).getTime() : null;
            const kills = Number(row.kills ?? 0);
            const deaths = Number(row.deaths ?? 0);
            const assists = Number(row.assists ?? 0);
            const kda = deaths === 0 ? kills + assists : (kills + assists) / deaths;

            return {
                id,
                gameId: String(row.gameid),
                date,
                timestamp: Number.isFinite(timestamp) ? timestamp : null,
                league: row.league ? String(row.league) : "",
                split: row.split ? String(row.split) : "",
                patch: row.patch ? String(row.patch) : "",
                playoffs: row.playoffs === 1 || row.playoffs === "1",
                side: row.side ? String(row.side) : "",
                position: row.position ? String(row.position) : "",
                playerName: row.playername ? String(row.playername) : "",
                playerId: row.playerid ? String(row.playerid) : "",
                teamName: row.teamname ? String(row.teamname) : "",
                champion: row.champion ? String(row.champion) : "",
                result: row.result === 1 || row.result === "1" ? "Win" : "Loss",
                kills,
                deaths,
                assists,
                kda,
                gameLength: Number(row.gamelength ?? 0),
            };
        };

        Papa.parse<CsvRow>(CSV_URL, {
            download: true,
            header: true,
            worker: false,
            skipEmptyLines: true,
            chunk: (result: ParseResult<CsvRow>) => {
                for (const row of result.data) {
                    const mapped = toDataRow(row);
                    if (mapped) rows.push(mapped);
                }
            },
            complete: () => resolve(rows),
            error: (error: Error) => reject(error),
        });
    });

const formatDuration = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "-";
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
};

const formatNumber = (value: number, fractionDigits = 1) =>
    Number.isFinite(value) ? value.toFixed(fractionDigits) : "-";

export const DataVisualizerView: Component = () => {
    const [dataset] = createResource(parseCsv);
    const [searchTerm, setSearchTerm] = createSignal("");
    const [leagueFilter, setLeagueFilter] = createSignal("all");
    const [positionFilter, setPositionFilter] = createSignal("all");
    const [resultFilter, setResultFilter] = createSignal("all");
    const [sorting, setSorting] = createSignal<SortingState>([
        { id: "timestamp", desc: true },
    ]);

    const leagues = createMemo(() => {
        const data = dataset();
        if (!data) return [] as string[];
        return Array.from(
            new Set(data.map((row) => row.league).filter((league) => league))
        ).sort();
    });

    const positions = createMemo(() => {
        const data = dataset();
        if (!data) return [] as string[];
        return Array.from(
            new Set(data.map((row) => row.position).filter((pos) => pos))
        ).sort();
    });

    const filteredData = createMemo(() => {
        const data = dataset();
        if (!data) return [] as DataRow[];

        const term = searchTerm().trim().toLowerCase();
        const league = leagueFilter();
        const position = positionFilter();
        const result = resultFilter();

        return data.filter((row) => {
            if (term) {
                const haystack = [
                    row.playerName,
                    row.teamName,
                    row.champion,
                    row.league,
                    row.gameId,
                ]
                    .join(" ")
                    .toLowerCase();
                if (!haystack.includes(term)) return false;
            }

            if (league !== "all" && row.league !== league) return false;
            if (position !== "all" && row.position !== position) return false;
            if (result !== "all" && row.result !== result) return false;

            return true;
        });
    });

    const stats = createMemo(() => {
        const data = filteredData();
        if (!data.length) return defaultStats;

        const uniqueGames = new Set(data.map((row) => row.gameId)).size;
        const uniquePlayers = new Set(data.map((row) => row.playerId || row.playerName)).size;
        const uniqueChampions = new Set(data.map((row) => row.champion)).size;

        const totalDuration = data.reduce((acc, row) => acc + row.gameLength, 0);
        const totalKills = data.reduce((acc, row) => acc + row.kills, 0);
        const totalKda = data.reduce((acc, row) => acc + row.kda, 0);
        const wins = data.reduce((acc, row) => acc + (row.result === "Win" ? 1 : 0), 0);

        return {
            entryCount: data.length,
            uniqueGames,
            uniquePlayers,
            uniqueChampions,
            averageDuration: totalDuration / data.length,
            averageKills: totalKills / data.length,
            averageKda: totalKda / data.length,
            winRate: wins / data.length,
        } satisfies DatasetStats;
    });

    const columns: ColumnDef<DataRow>[] = [
        {
            accessorKey: "timestamp",
            header: () => "Date",
            cell: (info) => {
                const date = info.row.original.date;
                return date ? format(new Date(date), "yyyy-MM-dd HH:mm") : "-";
            },
            sortingFn: (a, b, columnId) => {
                const aValue = a.getValue<number | null>(columnId) ?? 0;
                const bValue = b.getValue<number | null>(columnId) ?? 0;
                return aValue - bValue;
            },
        },
        {
            accessorKey: "league",
            header: () => "League",
            cell: (info) => info.getValue<string>() || "-",
        },
        {
            accessorKey: "teamName",
            header: () => "Team",
            cell: (info) => info.getValue<string>() || "-",
        },
        {
            accessorKey: "playerName",
            header: () => "Player",
            cell: (info) => info.getValue<string>() || "-",
        },
        {
            accessorKey: "position",
            header: () => "Pos",
            cell: (info) => info.getValue<string>()?.toUpperCase() || "-",
        },
        {
            accessorKey: "champion",
            header: () => "Champion",
            cell: (info) => info.getValue<string>() || "-",
        },
        {
            accessorKey: "result",
            header: () => "Result",
            cell: (info) => (
                <span
                    class={cn(
                        "font-semibold",
                        info.getValue<string>() === "Win"
                            ? "text-emerald-400"
                            : "text-red-400"
                    )}
                >
                    {info.getValue<string>()}
                </span>
            ),
        },
        {
            accessorKey: "kills",
            header: () => "K",
            cell: (info) => info.getValue<number>() ?? 0,
        },
        {
            accessorKey: "deaths",
            header: () => "D",
            cell: (info) => info.getValue<number>() ?? 0,
        },
        {
            accessorKey: "assists",
            header: () => "A",
            cell: (info) => info.getValue<number>() ?? 0,
        },
        {
            accessorKey: "kda",
            header: () => "KDA",
            cell: (info) => formatNumber(info.getValue<number>() ?? 0, 2),
        },
        {
            accessorKey: "gameLength",
            header: () => "Game Length",
            cell: (info) => formatDuration(info.getValue<number>() ?? 0),
        },
    ];

    const table = createSolidTable({
        get data() {
            return filteredData();
        },
        get columns() {
            return columns;
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

    return (
        <div class="flex h-full flex-col gap-4">
            <Panel>
                <PanelHeader>Statistiques (filtre appliqué)</PanelHeader>
                <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatItem label="Entrées" value={stats().entryCount.toLocaleString()} />
                    <StatItem label="Matchs uniques" value={stats().uniqueGames.toLocaleString()} />
                    <StatItem label="Joueurs uniques" value={stats().uniquePlayers.toLocaleString()} />
                    <StatItem label="Champions uniques" value={stats().uniqueChampions.toLocaleString()} />
                    <StatItem
                        label="Durée moyenne"
                        value={formatDuration(stats().averageDuration)}
                    />
                    <StatItem
                        label="Kills moyens"
                        value={formatNumber(stats().averageKills, 2)}
                    />
                    <StatItem
                        label="KDA moyen"
                        value={formatNumber(stats().averageKda, 2)}
                    />
                    <StatItem
                        label="Win rate"
                        value={`${formatNumber(stats().winRate * 100, 1)}%`}
                    />
                </div>
            </Panel>

            <Panel>
                <PanelHeader>Filtres</PanelHeader>
                <div class="flex flex-col gap-4 lg:flex-row">
                    <div class="flex-1">
                        <label class="mb-1 block text-xs font-semibold uppercase text-neutral-400">
                            Recherche
                        </label>
                        <input
                            class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm uppercase tracking-wide text-neutral-100 placeholder:text-neutral-500"
                            placeholder="Joueur, équipe, champion, ligue..."
                            value={searchTerm()}
                            onInput={(event) =>
                                setSearchTerm(event.currentTarget.value)
                            }
                        />
                    </div>
                    <div class="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <FilterSelect
                            label="Ligue"
                            value={leagueFilter()}
                            onChange={setLeagueFilter}
                            options={leagues()}
                            placeholder="Toutes"
                        />
                        <FilterSelect
                            label="Position"
                            value={positionFilter()}
                            onChange={setPositionFilter}
                            options={positions()}
                            placeholder="Toutes"
                        />
                        <FilterSelect
                            label="Résultat"
                            value={resultFilter()}
                            onChange={setResultFilter}
                            options={["Win", "Loss"]}
                            placeholder="Tous"
                        />
                    </div>
                </div>
            </Panel>

            <Panel class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <PanelHeader>Tableau des performances</PanelHeader>
                <div class="flex min-h-0 flex-1">
                    <Show when={!dataset.loading} fallback={<LoadingState />}>
                        <Show
                            when={dataset.error}
                            fallback={<Table table={table} class="flex-1" />}
                        >
                            <ErrorState />
                        </Show>
                    </Show>
                </div>
            </Panel>
        </div>
    );
};

type FilterSelectProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: readonly string[];
    placeholder: string;
};

const FilterSelect: Component<FilterSelectProps> = (props) => {
    return (
        <label class="flex flex-col gap-1 text-xs font-semibold uppercase text-neutral-400">
            {props.label}
            <select
                class="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm uppercase tracking-wide text-neutral-100"
                value={props.value}
                onChange={(event) => props.onChange(event.currentTarget.value)}
            >
                <option value="all">{props.placeholder}</option>
                <For each={props.options}>
                    {(option) => (
                        <option value={option}>{option || "-"}</option>
                    )}
                </For>
            </select>
        </label>
    );
};

type StatItemProps = {
    label: string;
    value: string;
};

const StatItem: Component<StatItemProps> = (props) => (
    <div class="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {props.label}
        </p>
        <p class="text-2xl font-semibold text-neutral-100">{props.value}</p>
    </div>
);

const LoadingState: Component = () => (
    <div class="flex h-full w-full items-center justify-center">
        <LoadingIcon class="h-10 w-10 animate-spin text-neutral-300" />
    </div>
);

const ErrorState: Component = () => (
    <div class="flex h-full w-full items-center justify-center text-center text-sm uppercase tracking-wide text-red-400">
        Échec du chargement du fichier 2025.csv
    </div>
);
