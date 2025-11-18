// @ts-nocheck
import Papa from "papaparse";
declare const __DATA_VIZ_DEV_CSV__: string;
import {
    Dataset,
    deleteDatasetMatchupSynergyData,
} from "@draftgap/core/src/models/dataset/Dataset";
import {
    ChampionRolePerformance,
    ChampionRoleHighlights,
    ProHighlight,
    defaultChampionRoleData,
} from "@draftgap/core/src/models/dataset/ChampionRoleData";
import { ROLES, Role as RoleId } from "@draftgap/core/src/models/Role";
import type { Role } from "@draftgap/core/src/models/Role";
import {
    roleIdToDraftRole,
    DRAFT_ROLES,
    type DraftRole,
    type PrecomputedDraftMetrics,
} from "@draftgap/core/src/draft/metrics";
import {
    buildDraftMetricsFromRows,
    parsePlayerRecord,
    parseTeamRecord,
    type PlayerRow as AggregationPlayerRow,
    type TeamRow as AggregationTeamRow,
} from "@draftgap/core/src/draft/metric-aggregation";

const devCsvPath =
    typeof __DATA_VIZ_DEV_CSV__ !== "undefined"
        ? __DATA_VIZ_DEV_CSV__.replace(/\\\\/g, "/")
        : undefined;

const isNodeDev =
    typeof process !== "undefined" &&
    process?.env?.NODE_ENV !== "production";
const isDevEnvironment = Boolean(import.meta.env?.DEV ?? isNodeDev);

const CSV_URL =
    isDevEnvironment && devCsvPath
        ? `/@fs/${encodeURI(devCsvPath)}`
        : "/data/2025.csv";

const TIME_BUCKET_LIMITS = [20, 25, 30, 35];
const HIGHLIGHT_LIMIT = 3;

const patchCache = new Map<string, number>();

type TeamAggregateMap = Map<string, Map<RoleId, RoleAggregate>>;
type TeamRosterMap = Map<string, Map<RoleId, Set<string>>>;

let cachedTeamAggregates: TeamAggregateMap = new Map();
let cachedTeamRosters: TeamRosterMap = new Map();
let cachedBaseDataset: Dataset | undefined;
let cachedLatestDate = 0;
let cachedSelectedPatches: string[] = [];
let cachedAvailablePatches: string[] = [];
const cachedTeamDatasets = new Map<
    string,
    {
        current?: Dataset;
        full?: Dataset;
    }
>();

export type ProDatasetResult = {
    dataset: Dataset;
    dataset30Days: Dataset;
    patches: string[];
    metrics: PrecomputedDraftMetrics;
};

export type ProDatasetOptions = {
    patch?: string;
};

const proDatasetCache = new Map<string, Promise<ProDatasetResult>>();

export async function loadProDatasets(
    options: ProDatasetOptions = {}
): Promise<ProDatasetResult> {
    const cacheKey = getProDatasetCacheKey(options);
    let cached = proDatasetCache.get(cacheKey);
    if (!cached) {
        cached = buildProDatasets(options);
        proDatasetCache.set(cacheKey, cached);
    }

    return cached;
}

export function invalidateProDatasets() {
    proDatasetCache.clear();
    cachedTeamAggregates = new Map();
    cachedTeamRosters = new Map();
    cachedBaseDataset = undefined;
    cachedLatestDate = 0;
    cachedSelectedPatches = [];
    cachedAvailablePatches = [];
    cachedTeamDatasets.clear();
}

function getProDatasetCacheKey(options: ProDatasetOptions) {
    return `patch:${options.patch ?? "latest"}`;
}

async function buildProDatasets(
    options: ProDatasetOptions
): Promise<ProDatasetResult> {
    const { patch } = options;
    let baseDataset: Dataset;
    try {
        baseDataset = await fetchBaseDataset();
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to load base dataset for metadata: ${message}`);
    }

    const lookup = createChampionLookup(baseDataset);
    let participantsResult: Awaited<ReturnType<typeof parseCsvParticipants>>;
    try {
        participantsResult = await parseCsvParticipants(lookup);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse 2025.csv: ${message}`);
    }
    const {
        participants,
        playerRows,
        teamRows,
        latestDate: csvLatestDate,
    } = participantsResult;

    if (!participants.length) {
        throw new Error("No participant data found in CSV");
    }

    const targetYear = getYearFromTimestamp(csvLatestDate);
    const participantsForYear =
        targetYear !== undefined
            ? participants.filter(
                  (participant) =>
                      participant.timestamp !== undefined &&
                      getYearFromTimestamp(participant.timestamp) === targetYear
              )
            : participants;

    const scopedParticipants =
        participantsForYear.length > 0
            ? participantsForYear
            : participants;

    if (!scopedParticipants.length) {
        throw new Error("No participant data found in CSV");
    }

    const orderedPatches = extractOrderedPatches(scopedParticipants);
    if (!orderedPatches.length) {
        throw new Error("No patch data found in CSV");
    }

    cachedAvailablePatches = [...orderedPatches];

    const patchesForDataset = resolvePatchSelection(orderedPatches, patch);
    if (!patchesForDataset.length) {
        throw new Error("No patch data found in CSV for selected patch filter");
    }

    const allowedPatches = new Set(patchesForDataset);
    const participantsForPatches = scopedParticipants.filter((participant) =>
        allowedPatches.has(participant.patch)
    );

    if (!participantsForPatches.length) {
        throw new Error("No participant data found in CSV for selected patch filter");
    }

    const playerRowsForPatch = playerRows.filter((row) =>
        allowedPatches.has(row.patch)
    );
    const teamRowsForPatch = teamRows.filter((row) =>
        allowedPatches.has(row.patch)
    );

    const patchWeights = new Map<string, number>();
    for (const patchValue of patchesForDataset) {
        patchWeights.set(patchValue, 1);
    }

    const championRoleHints = new Map<string, DraftRole[]>();
    for (const [championKey, champion] of Object.entries(baseDataset.championData)) {
        const roles: DraftRole[] = [];
        for (const role of ROLES) {
            const roleStats = champion.statsByRole[role];
            if (roleStats?.games && roleStats.games > 0) {
                roles.push(roleIdToDraftRole(role));
            }
        }
        const uniqueRoles =
            roles.length > 0
                ? (Array.from(new Set(roles)) as DraftRole[])
                : [...DRAFT_ROLES];
        championRoleHints.set(championKey, uniqueRoles);
    }

    const aggregates = buildChampionAggregates(
        participantsForPatches,
        patchWeights
    );

    const latestRelevantDate = getLatestTimestamp(
        participantsForPatches,
        csvLatestDate
    );

    // @ts-ignore Legacy aggregate typing retained from dataset pipeline
    const dataset30Days = buildDatasetFromAggregates(
        baseDataset,
        aggregates.global,
        latestRelevantDate,
        patchesForDataset
    );

    const metrics = buildDraftMetricsFromRows(
        playerRowsForPatch,
        teamRowsForPatch,
        {
            patch: patchesForDataset[0] ?? "",
            allChampionKeys: Array.from(championRoleHints.keys()),
            roleHints: championRoleHints,
        }
    );

    const dataset = cloneDataset(dataset30Days);
    deleteDatasetMatchupSynergyData(dataset);

    cachedTeamAggregates = aggregates.byTeam;
    cachedTeamRosters = aggregates.rosters;
    cachedBaseDataset = baseDataset;
    cachedLatestDate = latestRelevantDate;
    cachedSelectedPatches = [...patchesForDataset];
    cachedTeamDatasets.clear();

    return {
        dataset,
        dataset30Days,
        patches: patchesForDataset,
        metrics,
    };
}

function cloneDataset(dataset: Dataset): Dataset {
    if (typeof structuredClone === "function") {
        return structuredClone(dataset);
    }
    return JSON.parse(JSON.stringify(dataset)) as Dataset;
}

function buildTeamDataset(
    teamName: string,
    variant: "current" | "full"
) {
    if (!cachedBaseDataset) return undefined;
    const aggregates = cachedTeamAggregates.get(teamName);
    if (!aggregates) return undefined;

    const cached = cachedTeamDatasets.get(teamName) ?? {};
    if (cached[variant]) {
        return cached[variant];
    }

    // @ts-ignore Legacy aggregate typing retained from dataset pipeline
    const dataset = buildDatasetFromAggregates(
        cachedBaseDataset,
        aggregates,
        cachedLatestDate,
        cachedSelectedPatches
    );

    if (variant === "current") {
        deleteDatasetMatchupSynergyData(dataset);
    }

    cached[variant] = dataset;
    cachedTeamDatasets.set(teamName, cached);

    return dataset;
}

export function getProTeamNames(): string[] {
    return Array.from(cachedTeamAggregates.keys()).sort((a, b) =>
        a.localeCompare(b)
    );
}

export function getProTeamDataset(teamName: string) {
    return buildTeamDataset(teamName, "current");
}

export function getProTeamDataset30Days(teamName: string) {
    return buildTeamDataset(teamName, "full");
}

export function getProTeamRoster(teamName: string) {
    const roster = cachedTeamRosters.get(teamName);
   if (!roster) return undefined;
    const result = new Map<RoleId, string[]>();
    for (const [role, players] of roster) {
        result.set(
            role,
            Array.from(players).sort((a, b) => a.localeCompare(b))
        );
    }
    return result;
}

export function getProAvailablePatches(): string[] {
    return [...cachedAvailablePatches];
}

type Participant = {
    gameId: string;
    championKey: string;
    role: RoleId;
    team: "blue" | "red";
    teamName: string;
    playerName?: string;
    league?: string;
    split?: string;
    year?: number;
    gameNumber?: number;
    patch: string;
    win: boolean;
    gameLengthSeconds: number;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    visionScore: number;
    csPerMinute: number;
    visionScorePerMinute: number;
    url?: string;
    date?: string;
    timestamp?: number;
};

type CsvRow = {
    gameid?: string;
    champion?: string;
    position?: string;
    side?: string;
    patch?: string;
    result?: string | number;
    gamelength?: string | number;
    date?: string;
    kills?: string | number;
    deaths?: string | number;
    assists?: string | number;
    "total cs"?: string | number;
    cspm?: string | number;
    visionscore?: string | number;
    vspm?: string | number;
    url?: string;
    league?: string;
    split?: string;
    year?: string | number;
    playername?: string;
    teamname?: string;
    game?: string | number;
};

type GameMeta = {
    gameId: string;
    patch: string;
    league?: string;
    split?: string;
    year?: number;
    date?: string;
    url?: string;
    blueTeam?: string;
    redTeam?: string;
};

type ChampionLookup = {
    byName: Map<string, { key: string }>;
};

type StatTotals = {
    wins: number;
    games: number;
};

type InternalHighlight = {
    value: ProHighlight;
    score: number;
};

type HighlightMap = Map<RoleId, Map<string, InternalHighlight[]>>;

type RolePerformanceTotals = {
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    visionScore: number;
    minutes: number;
};

type RoleAggregate = {
    games: number;
    wins: number;
    matchup: Map<RoleId, Map<string, StatTotals>>;
    synergy: Map<RoleId, Map<string, StatTotals>>;
    synergyHighlights: HighlightMap;
    matchupHighlights: HighlightMap;
    statsByTime: StatTotals[];
    performance: RolePerformanceTotals;
};

function createRoleAggregate(): RoleAggregate {
    return {
        games: 0,
        wins: 0,
        matchup: new Map(),
        synergy: new Map(),
        synergyHighlights: new Map(),
        matchupHighlights: new Map(),
        statsByTime: Array.from(
            { length: TIME_BUCKET_LIMITS.length + 1 },
            () => ({ games: 0, wins: 0 })
        ),
        performance: {
            kills: 0,
            deaths: 0,
            assists: 0,
            cs: 0,
            visionScore: 0,
            minutes: 0,
        },
    };
}

function buildChampionAggregates(
    participants: Participant[],
    patchWeights: Map<string, number>
) {
    const aggregates = new Map<string, Map<RoleId, RoleAggregate>>();
    const teamAggregates: TeamAggregateMap = new Map();
    const teamRosters: TeamRosterMap = new Map();

    const ensureRoleAggregate = (
        championKey: string,
        role: RoleId
    ): RoleAggregate => {
        let championMap = aggregates.get(championKey);
        if (!championMap) {
            championMap = new Map();
            aggregates.set(championKey, championMap);
        }
        let roleAggregate = championMap.get(role);
        if (!roleAggregate) {
            roleAggregate = createRoleAggregate();
            championMap.set(role, roleAggregate);
        }
        return roleAggregate;
    };

    const ensureTeamRoleAggregate = (
        teamName: string,
        championKey: string,
        role: RoleId
    ): RoleAggregate => {
        let championMap = teamAggregates.get(teamName);
        if (!championMap) {
            championMap = new Map();
            teamAggregates.set(teamName, championMap);
        }
        let roleMap = championMap.get(championKey);
        if (!roleMap) {
            roleMap = new Map();
            championMap.set(championKey, roleMap);
        }
        let aggregate = roleMap.get(role);
        if (!aggregate) {
            aggregate = createRoleAggregate();
            roleMap.set(role, aggregate);
        }
        return aggregate;
    };

    const ensureTeamRoster = (teamName: string, role: RoleId) => {
        let rosterByRole = teamRosters.get(teamName);
        if (!rosterByRole) {
            rosterByRole = new Map();
            teamRosters.set(teamName, rosterByRole);
        }
        let roster = rosterByRole.get(role);
        if (!roster) {
            roster = new Set();
            rosterByRole.set(role, roster);
        }
        return roster;
    };

    const gamesById = new Map<string, Participant[]>();
    for (const participant of participants) {
        const list = gamesById.get(participant.gameId);
        if (list) {
            list.push(participant);
        } else {
            gamesById.set(participant.gameId, [participant]);
        }
    }

    const gameMeta = new Map<string, GameMeta>();
    for (const participant of participants) {
        const existing = gameMeta.get(participant.gameId);
        if (existing) {
            if (!existing.league && participant.league) {
                existing.league = participant.league;
            }
            if (!existing.split && participant.split) {
                existing.split = participant.split;
            }
            if (!existing.year && participant.year) {
                existing.year = participant.year;
            }
            if (!existing.date && participant.date) {
                existing.date = participant.date;
            }
            if (!existing.url && participant.url) {
                existing.url = participant.url;
            }
            if (participant.team === "blue" && !existing.blueTeam) {
                existing.blueTeam = participant.teamName;
            }
            if (participant.team === "red" && !existing.redTeam) {
                existing.redTeam = participant.teamName;
            }
            continue;
        }

        gameMeta.set(participant.gameId, {
            gameId: participant.gameId,
            patch: participant.patch,
            league: participant.league,
            split: participant.split,
            year: participant.year,
            date: participant.date,
            url: participant.url,
            blueTeam: participant.team === "blue" ? participant.teamName : undefined,
            redTeam: participant.team === "red" ? participant.teamName : undefined,
        });
    }

    for (const participant of participants) {
        const weight = patchWeights.get(participant.patch) ?? 1;
        const aggregate = ensureRoleAggregate(
            participant.championKey,
            participant.role
        );
        const teamAggregate = ensureTeamRoleAggregate(
            participant.teamName,
            participant.championKey,
            participant.role
        );
        const bucket = getTimeBucket(participant.gameLengthSeconds);

        const applyAggregateUpdate = (target: RoleAggregate) => {
            target.games += weight;
            if (participant.win) {
                target.wins += weight;
            }
            const performance = target.performance;
            performance.kills += participant.kills * weight;
            performance.deaths += participant.deaths * weight;
            performance.assists += participant.assists * weight;
            performance.cs += participant.cs * weight;
            performance.visionScore += participant.visionScore * weight;
            performance.minutes +=
                (participant.gameLengthSeconds / 60) * weight;
            const bucketStats = target.statsByTime[bucket];
            bucketStats.games += weight;
            if (participant.win) {
                bucketStats.wins += weight;
            }
        };

        applyAggregateUpdate(aggregate);
        applyAggregateUpdate(teamAggregate);

        const trimmedName = participant.playerName?.trim();
        if (trimmedName) {
            ensureTeamRoster(participant.teamName, participant.role).add(
                trimmedName
            );
        }
    }

    for (const gamePlayers of gamesById.values()) {
        if (!gamePlayers.length) continue;
        const meta = gameMeta.get(gamePlayers[0].gameId);
        const patchWeight = patchWeights.get(gamePlayers[0].patch) ?? 1;
        const blueTeam = gamePlayers.filter((p) => p.team === "blue");
        const redTeam = gamePlayers.filter((p) => p.team === "red");

        for (const teamPlayers of [blueTeam, redTeam]) {
            for (let i = 0; i < teamPlayers.length; i++) {
                const playerA = teamPlayers[i];
                const aggregateA = ensureRoleAggregate(
                    playerA.championKey,
                    playerA.role
                );
                const teamAggregateA = ensureTeamRoleAggregate(
                    playerA.teamName,
                    playerA.championKey,
                    playerA.role
                );
                for (let j = 0; j < teamPlayers.length; j++) {
                    if (i === j) continue;
                    const playerB = teamPlayers[j];
                    const synergy = ensureNestedStats(
                        aggregateA.synergy,
                        playerB.role,
                        playerB.championKey
                    );
                    synergy.games += patchWeight;
                    if (playerA.win) {
                        synergy.wins += patchWeight;
                    }

                    const teamSynergy = ensureNestedStats(
                        teamAggregateA.synergy,
                        playerB.role,
                        playerB.championKey
                    );
                    teamSynergy.games += patchWeight;
                    if (playerA.win) {
                        teamSynergy.wins += patchWeight;
                    }

                    const opponents =
                        teamPlayers === blueTeam ? redTeam : blueTeam;
                    const synergyHighlights = ensureHighlightList(
                        aggregateA.synergyHighlights,
                        playerB.role,
                        playerB.championKey
                    );
                    const synergyHighlight = buildSynergyHighlight(
                        meta,
                        playerA,
                        playerB,
                        opponents
                    );
                    const synergyScore = computeHighlightScore(
                        patchWeight,
                        playerA.timestamp ?? playerB.timestamp,
                        playerA.win
                    );
                    addHighlight(
                        synergyHighlights,
                        synergyHighlight,
                        synergyScore
                    );

                    const teamSynergyHighlights = ensureHighlightList(
                        teamAggregateA.synergyHighlights,
                        playerB.role,
                        playerB.championKey
                    );
                    addHighlight(
                        teamSynergyHighlights,
                        synergyHighlight,
                        synergyScore
                    );
                }
            }
        }

        for (const playerA of blueTeam) {
            const aggregateA = ensureRoleAggregate(
                playerA.championKey,
                playerA.role
            );
            const teamAggregateA = ensureTeamRoleAggregate(
                playerA.teamName,
                playerA.championKey,
                playerA.role
            );
            for (const playerB of redTeam) {
                const aggregateB = ensureRoleAggregate(
                    playerB.championKey,
                    playerB.role
                );
                const teamAggregateB = ensureTeamRoleAggregate(
                    playerB.teamName,
                    playerB.championKey,
                    playerB.role
                );

                const matchupAB = ensureNestedStats(
                    aggregateA.matchup,
                    playerB.role,
                    playerB.championKey
                );
                matchupAB.games += patchWeight;
                if (playerA.win) {
                    matchupAB.wins += patchWeight;
                }

                const teamMatchupAB = ensureNestedStats(
                    teamAggregateA.matchup,
                    playerB.role,
                    playerB.championKey
                );
                teamMatchupAB.games += patchWeight;
                if (playerA.win) {
                    teamMatchupAB.wins += patchWeight;
                }

                const matchupBA = ensureNestedStats(
                    aggregateB.matchup,
                    playerA.role,
                    playerA.championKey
                );
                matchupBA.games += patchWeight;
                if (playerB.win) {
                    matchupBA.wins += patchWeight;
                }

                const teamMatchupBA = ensureNestedStats(
                    teamAggregateB.matchup,
                    playerA.role,
                    playerA.championKey
                );
                teamMatchupBA.games += patchWeight;
                if (playerB.win) {
                    teamMatchupBA.wins += patchWeight;
                }

                const matchupHighlightsAB = ensureHighlightList(
                    aggregateA.matchupHighlights,
                    playerB.role,
                    playerB.championKey
                );
                const matchupHighlightAB = buildMatchupHighlight(
                    meta,
                    playerA,
                    playerB
                );
                const matchupScoreAB = computeHighlightScore(
                    patchWeight,
                    playerA.timestamp,
                    playerA.win
                );
                addHighlight(
                    matchupHighlightsAB,
                    matchupHighlightAB,
                    matchupScoreAB
                );

                const matchupHighlightsBA = ensureHighlightList(
                    aggregateB.matchupHighlights,
                    playerA.role,
                    playerA.championKey
                );
                const matchupHighlightBA = buildMatchupHighlight(
                    meta,
                    playerB,
                    playerA
                );
                const matchupScoreBA = computeHighlightScore(
                    patchWeight,
                    playerB.timestamp,
                    playerB.win
                );
                addHighlight(
                    matchupHighlightsBA,
                    matchupHighlightBA,
                    matchupScoreBA
                );

                const teamMatchupHighlightsAB = ensureHighlightList(
                    teamAggregateA.matchupHighlights,
                    playerB.role,
                    playerB.championKey
                );
                addHighlight(
                    teamMatchupHighlightsAB,
                    matchupHighlightAB,
                    matchupScoreAB
                );

                const teamMatchupHighlightsBA = ensureHighlightList(
                    teamAggregateB.matchupHighlights,
                    playerA.role,
                    playerA.championKey
                );
                addHighlight(
                    teamMatchupHighlightsBA,
                    matchupHighlightBA,
                    matchupScoreBA
                );
            }
        }
    }

    return {
        global: aggregates,
        byTeam: teamAggregates,
        rosters: teamRosters,
    };
}

function ensureHighlightList(
    map: HighlightMap,
    role: RoleId,
    championKey: string
) {
    let roleMap = map.get(role);
    if (!roleMap) {
        roleMap = new Map();
        map.set(role, roleMap);
    }
    let list = roleMap.get(championKey);
    if (!list) {
        list = [];
        roleMap.set(championKey, list);
    }
    return list;
}

function computeHighlightScore(
    patchWeight: number,
    timestamp?: number,
    win?: boolean
) {
    const weightScore = patchWeight * 1000;
    const timeScore = timestamp ? timestamp / 1_000_000_000 : 0;
    const resultScore = win === undefined ? 0 : win ? 150 : -60;
    return weightScore + timeScore + resultScore;
}

function createHighlightParticipant(
    participant: Participant
) {
    return {
        role: participant.role as Role,
        playerName: participant.playerName,
    };
}

function findParticipantByRole(
    players: Participant[],
    role: RoleId
) {
    return players.find((player) => player.role === role);
}

function buildSynergyHighlight(
    meta: GameMeta | undefined,
    playerA: Participant,
    playerB: Participant,
    opponentPlayers: Participant[]
): ProHighlight {
    const opponentTeamName =
        playerA.team === "blue"
            ? meta?.redTeam ?? "Red side"
            : meta?.blueTeam ?? "Blue side";
    const opponents: Participant[] = [];
    const opponentForA = findParticipantByRole(opponentPlayers, playerA.role);
    if (opponentForA) {
        opponents.push(opponentForA);
    }
    const opponentForB = findParticipantByRole(opponentPlayers, playerB.role);
    if (opponentForB && opponentForB !== opponentForA) {
        opponents.push(opponentForB);
    }

    return {
        gameId: playerA.gameId,
        patch: meta?.patch ?? playerA.patch,
        league: meta?.league,
        split: meta?.split,
        date: meta?.date,
        team: playerA.teamName,
        opponent: opponentTeamName,
        win: playerA.win,
        players: [
            createHighlightParticipant(playerA),
            createHighlightParticipant(playerB),
        ],
        opponents: opponents.map(createHighlightParticipant),
        url: meta?.url,
    };
}

function buildMatchupHighlight(
    meta: GameMeta | undefined,
    ally: Participant,
    opponent: Participant
): ProHighlight {
    return {
        gameId: ally.gameId,
        patch: meta?.patch ?? ally.patch,
        league: meta?.league,
        split: meta?.split,
        date: meta?.date,
        team: ally.teamName,
        opponent: opponent.teamName,
        win: ally.win,
        players: [createHighlightParticipant(ally)],
        opponents: [createHighlightParticipant(opponent)],
        url: meta?.url,
    };
}

function addHighlight(
    highlights: InternalHighlight[],
    value: ProHighlight,
    score: number,
    limit = HIGHLIGHT_LIMIT
) {
    const existing = highlights.findIndex(
        (entry) => entry.value.gameId === value.gameId
    );
    if (existing !== -1) {
        if (score > highlights[existing].score) {
            highlights[existing] = { value, score };
        }
    } else {
        highlights.push({ value, score });
    }

    highlights.sort((a, b) => b.score - a.score);
    if (highlights.length > limit) {
        highlights.length = limit;
    }
}

function ensureNestedStats(
    container: Map<RoleId, Map<string, StatTotals>>,
    role: RoleId,
    championKey: string
) {
    let roleMap = container.get(role);
    if (!roleMap) {
        roleMap = new Map();
        container.set(role, roleMap);
    }
    let stats = roleMap.get(championKey);
    if (!stats) {
        stats = { games: 0, wins: 0 };
        roleMap.set(championKey, stats);
    }
    return stats;
}

function buildDatasetFromAggregates(
    baseDataset: Dataset,
    aggregates: Map<string, Map<RoleId, RoleAggregate>>,
    latestDate: number,
    patches: string[]
) {
    const dataset = cloneDataset(baseDataset);

    for (const championData of Object.values(dataset.championData)) {
        for (const role of ROLES) {
            championData.statsByRole[role] = defaultChampionRoleData();
        }
    }

    for (const [championKey, roleMap] of aggregates.entries()) {
        const championData = dataset.championData[championKey];
        if (!championData) continue;

        for (const role of ROLES) {
            const aggregate = roleMap.get(role);
            if (!aggregate) continue;
            const roleData = championData.statsByRole[role];
            roleData.games = aggregate.games;
            roleData.wins = aggregate.wins;
            roleData.matchup = convertNestedMap(aggregate.matchup);
            roleData.synergy = convertNestedMap(aggregate.synergy);
            roleData.statsByTime = convertStatsByTime(
                roleData.statsByTime.length,
                aggregate.statsByTime
            );
            roleData.performance = convertPerformance(aggregate);
            roleData.highlights = {
                synergy: convertHighlightMap(aggregate.synergyHighlights),
                matchup: convertHighlightMap(aggregate.matchupHighlights),
            };
        }
    }

    dataset.date = new Date(
        latestDate || Date.now()
    ).toISOString();
    dataset.version = baseDataset.version;
    attachPatchLabel(dataset, patches);

    return dataset;
}

function convertPerformance(aggregate: RoleAggregate): ChampionRolePerformance | undefined {
    const sampleSize = aggregate.games;
    const { kills, deaths, assists, cs, visionScore, minutes } =
        aggregate.performance;

    if (sampleSize <= 0) {
        return undefined;
    }

    const killsPerGame = kills / sampleSize;
    const deathsPerGame = deaths / sampleSize;
    const assistsPerGame = assists / sampleSize;
    const csPerMinute = minutes > 0 ? cs / minutes : 0;
    const visionScorePerMinute = minutes > 0 ? visionScore / minutes : 0;

    return {
        killsPerGame,
        deathsPerGame,
        assistsPerGame,
        csPerMinute,
        visionScorePerMinute,
        sampleSize,
    } satisfies ChampionRolePerformance;
}
function convertStatsByTime(targetLength: number, stats: StatTotals[]) {
    const result: StatTotals[] = [];
    for (let i = 0; i < targetLength; i++) {
        const source = stats[i];
        result.push({
            games: source?.games ?? 0,
            wins: source?.wins ?? 0,
        });
    }
    return result;
}

function convertNestedMap(
    map: Map<RoleId, Map<string, StatTotals>>
) {
    const result = {} as Record<RoleId, Record<string, StatTotals & { championKey: string }>>;
    for (const role of ROLES) {
        const roleMap = map.get(role);
        if (!roleMap || !roleMap.size) continue;
        result[role] = Object.fromEntries(
            Array.from(roleMap.entries()).map(([championKey, stats]) => [
                championKey,
                {
                    championKey,
                    games: stats.games,
                    wins: stats.wins,
                },
            ])
        );
    }
    return result;
}

function convertHighlightMap(map: HighlightMap) {
    const result = {} as ChampionRoleHighlights["synergy"];
    for (const role of ROLES) {
        const roleMap = map.get(role);
        if (!roleMap || !roleMap.size) continue;
        const entries: Record<string, ProHighlight[]> = {};
        for (const [championKey, highlights] of roleMap.entries()) {
            if (!highlights.length) continue;
            entries[championKey] = highlights.map((entry) => entry.value);
        }
        if (Object.keys(entries).length > 0) {
            result[role] = entries;
        }
    }
    return result;
}

function resolvePatchSelection(
    orderedPatches: readonly string[],
    selection?: string
) {
    if (!orderedPatches.length) {
        return [];
    }

    if (!selection || selection === "latest") {
        return orderedPatches.slice(0, 1);
    }

    if (selection === "all") {
        return orderedPatches.slice();
    }

    const normalized = selection.trim();
    if (!normalized) {
        return orderedPatches.slice(0, 1);
    }

    if (orderedPatches.includes(normalized)) {
        return [normalized];
    }

    return orderedPatches.slice(0, 1);
}

function extractOrderedPatches(participants: readonly Participant[]) {
    const patches = new Set<string>();
    for (const participant of participants) {
        const patch = participant.patch?.trim();
        if (!patch) continue;
        patches.add(patch);
    }
    return Array.from(patches).sort((a, b) => getPatchNumeric(b) - getPatchNumeric(a));
}

function getYearFromTimestamp(timestamp?: number) {
    if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
        return undefined;
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }
    return date.getUTCFullYear();
}

function getLatestTimestamp(
    participants: readonly Participant[],
    defaultValue: number
) {
    let latest = defaultValue;
    for (const participant of participants) {
        if (participant.timestamp === undefined) continue;
        if (participant.timestamp > latest) {
            latest = participant.timestamp;
        }
    }
    return latest;
}

function getTimeBucket(gameLengthSeconds: number) {
    const minutes = gameLengthSeconds / 60;
    for (let i = 0; i < TIME_BUCKET_LIMITS.length; i++) {
        if (minutes < TIME_BUCKET_LIMITS[i]) return i;
    }
    return TIME_BUCKET_LIMITS.length;
}

async function parseCsvParticipants(lookup: ChampionLookup) {
    const participants: Participant[] = [];
    const playerRows: AggregationPlayerRow[] = [];
    const teamRows: AggregationTeamRow[] = [];
    let latestDate = 0;

    await new Promise<void>((resolve, reject) => {
        Papa.parse<CsvRow>(CSV_URL, {
            download: true,
            header: true,
            worker: false,
            skipEmptyLines: true,
            chunk: ({ data }) => {
                for (const row of data as CsvRow[]) {
                    const record = row as Record<string, string | number | undefined>;
                    const positionRaw = row.position?.toString().toLowerCase().trim();

                    if (positionRaw === "team") {
                        const teamRow = parseTeamRecord(record);
                        if (teamRow) {
                            teamRow.picks = teamRow.picks.map((pick) => {
                                const mapped = lookup.byName.get(normalize(pick));
                                return mapped?.key ?? normalize(pick);
                            });
                            teamRows.push(teamRow);
                        }
                    } else {
                        const playerRow = parsePlayerRecord(record);
                        if (playerRow) {
                            const mappedChampion = lookup.byName.get(
                                normalize(playerRow.champion)
                            );
                            playerRow.champion =
                                mappedChampion?.key ?? normalize(playerRow.champion);
                            playerRows.push(playerRow);
                        }

                        const participant = toParticipant(row, lookup);
                        if (!participant) continue;
                        participants.push(participant);
                        if (participant.timestamp !== undefined) {
                            latestDate = Math.max(latestDate, participant.timestamp);
                        }
                    }
                }
            },
            complete: () => resolve(),
            error: (error) =>
                reject(
                    error instanceof Error
                        ? error
                        : new Error(String(error ?? "Unknown parse error"))
                ),
        });
    });

    return {
        participants,
        playerRows,
        teamRows,
        latestDate,
    };
}

function toParticipant(row: CsvRow, lookup: ChampionLookup): Participant | undefined {
    if (!row.gameid) return undefined;
    const championName = row.champion?.trim();
    if (!championName) return undefined;
    const champion = lookup.byName.get(normalize(championName));
    if (!champion) return undefined;

    const position = row.position?.toLowerCase().trim();
    const role = positionToRole(position ?? "");
    if (role === undefined) return undefined;

    const side = row.side?.toLowerCase() === "red" ? "red" : "blue";
    const patch = row.patch?.toString().trim() || "unknown";
    const result = row.result;
    const win = result === 1 || result === "1" || result === "Win";
    const gameLengthSeconds = toNumber(row.gamelength);
    const timestamp = parseDate(row.date);
    const dateRaw = row.date?.toString().trim();
    const teamName =
        row.teamname?.toString().trim() ||
        (side === "blue" ? "Blue side" : "Red side");
    const playerName = row.playername?.toString().trim();
    const league = row.league?.toString().trim();
    const split = row.split?.toString().trim();
    const yearValue = toNumber(row.year);
    const year = yearValue > 0 ? yearValue : undefined;
    const gameNumberValue = toNumber(row.game);
    const gameNumber = gameNumberValue > 0 ? gameNumberValue : undefined;
    const url = row.url?.toString().trim();

    const kills = toNumber(row.kills);
    const deaths = toNumber(row.deaths);
    const assists = toNumber(row.assists);
    const csRaw = toNumber(row["total cs"]);
    const cspm = toNumber(row.cspm);
    const visionScoreRaw = toNumber(row.visionscore);
    const vspm = toNumber(row.vspm);
    const minutes = gameLengthSeconds > 0 ? gameLengthSeconds / 60 : 0;
    const cs = csRaw > 0 ? csRaw : minutes > 0 ? cspm * minutes : 0;
    const visionScore =
        visionScoreRaw > 0 ? visionScoreRaw : minutes > 0 ? vspm * minutes : 0;
    const csPerMinute = minutes > 0 ? cs / minutes : 0;
    const visionScorePerMinute = minutes > 0 ? visionScore / minutes : 0;

    return {
        gameId: row.gameid,
        championKey: champion.key,
        role,
        team: side,
        teamName,
        playerName,
        league,
        split,
        year,
        gameNumber,
        patch,
        win,
        gameLengthSeconds,
        kills,
        deaths,
        assists,
        cs,
        visionScore,
        csPerMinute,
        visionScorePerMinute,
        url,
        date: dateRaw,
        timestamp,
    } satisfies Participant;
}

function positionToRole(position: string): RoleId | undefined {
    switch (position) {
        case "top":
            return 0;
        case "jng":
        case "jungle":
            return 1;
        case "mid":
        case "middle":
            return 2;
        case "bot":
        case "adc":
            return 3;
        case "sup":
        case "support":
            return 4;
        default:
            return undefined;
    }
}

function parseDate(date?: string) {
    if (!date) return undefined;
    const normalized = date.includes("T") ? date : `${date.replace(" ", "T")}Z`;
    const value = Date.parse(normalized);
    return Number.isFinite(value) ? value : undefined;
}

function toNumber(value: string | number | undefined) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}


function getPatchNumeric(patch: string) {
    const cached = patchCache.get(patch);
    if (cached !== undefined) return cached;
    const value = serializePatch(patch);
    patchCache.set(patch, value);
    return value;
}

function serializePatch(patch: string) {
    const parts = patch
        .split(".")
        .map((part) => parseInt(part.replace(/[^0-9]/g, ""), 10))
        .filter((value) => Number.isFinite(value));
    while (parts.length < 3) {
        parts.push(0);
    }
    const value = parts[0] * 1_000_000 + parts[1] * 1_000 + parts[2];
    patchCache.set(patch, value);
    return value;
}

async function fetchBaseDataset(): Promise<Dataset> {
    try {
        const response = await fetch("/data/current-patch.json", {
            cache: "no-store",
        });
        if (response.ok) {
            const text = await response.text();
            if (!text.trim().startsWith("<")) {
                return JSON.parse(text) as Dataset;
            }
        }
    } catch {
        // Ignore and try bundled fallback
    }

    try {
        const module = await import("../../../../data/current-patch.json?raw");
        return JSON.parse(module.default) as Dataset;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load bundled base dataset: ${message}`);
    }
}

function createChampionLookup(dataset: Dataset): ChampionLookup {
    const byName = new Map<string, { key: string }>();
    for (const [key, champion] of Object.entries(dataset.championData)) {
        byName.set(normalize(champion.name), { key });
        byName.set(normalize(champion.id), { key });
    }
    return { byName };
}

function normalize(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function attachPatchLabel(dataset: Dataset, patches: string[]) {
    const label = patches.join(", ");
    (dataset as Dataset & { patchLabel?: string }).patchLabel = label;
}





















