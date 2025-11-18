// @ts-nocheck
import {
    ChampionFlexMetrics,
    ChampionRoleMetrics,
    CounterEntry,
    DraftRole,
    PlayerChampionReliability,
    PrecomputedDraftMetrics,
    SynergyEntry,
    DRAFT_ROLES,
} from "./metrics";
import {
    betaBinomialAdjust,
    computeZScore,
    safeDivide,
} from "./math";

const ROLE_ALIASES: Record<string, DraftRole> = {
    top: "top",
    toplane: "top",
    jng: "jng",
    jungle: "jng",
    mid: "mid",
    middle: "mid",
    bot: "bot",
    bottom: "bot",
    adc: "bot",
    sup: "sup",
    support: "sup",
};

const LANE_TIMES = [10, 15, 20, 25] as const;
type LaneTime = (typeof LANE_TIMES)[number];

type RoleMetricBuckets = Map<
    DraftRole,
    Map<string, { values: number[]; weights: number[] }>
>;

type CsvValue = string | number | undefined;
export type CsvRecord = Record<string, CsvValue>;

export interface PlayerRow {
    gameId: string;
    patch: string;
    side: "Blue" | "Red";
    teamName: string;
    opponentTeamName: string;
    role: DraftRole;
    champion: string;
    playerName: string;
    winner: boolean;
    minutes: number;
    kills: number;
    deaths: number;
    assists: number;
    teamKills: number;
    teamDeaths: number;
    turretPlates: number;
    firstTower: number;
    firstMidTower: number;
    firstToThree: number;
    heralds: number;
    oppHeralds: number;
    voidGrubs: number;
    oppVoidGrubs: number;
    dragons: number;
    oppDragons: number;
    barons: number;
    oppBarons: number;
    atakhans: number;
    oppAtakhans: number;
    dpm: number | undefined;
    damageTakenPerMinute: number | undefined;
    damageMitigatedPerMinute: number | undefined;
    visionScorePerMinute: number | undefined;
    assistsAt15: number | undefined;
    killsAt15: number | undefined;
    deathsAt15: number | undefined;
    laneStats: Record<
        LaneTime,
        {
            goldDiff: number | undefined;
            xpDiff: number | undefined;
            csDiff: number | undefined;
            killDiff: number | undefined;
        }
    >;
    goldAt: Record<LaneTime, number | undefined>;
    oppGoldAt: Record<LaneTime, number | undefined>;
    xpAt: Record<LaneTime, number | undefined>;
    oppXpAt: Record<LaneTime, number | undefined>;
    laneDelta15?: number;
    kpEarly?: number;
    opponentChampion?: string;
}

export interface TeamRow {
    gameId: string;
    patch: string;
    side: "Blue" | "Red";
    picks: string[];
    winner: boolean;
}

interface ChampionRoleAccumulator {
    championKey: string;
    role: DraftRole;
    games: number;
    wins: number;
    minutes: number;
    plates: number;
    firstTower: number;
    firstMidTower: number;
    firstToThree: number;
    heraldDelta: number;
    grubDelta: number;
    dragonDelta: number;
    dragonsFor: number;
    dragonsAgainst: number;
    baronDelta: number;
    baronsFor: number;
    baronsAgainst: number;
    atakhanDelta: number;
    atakhansFor: number;
    atakhansAgainst: number;
    dpmTotal: number;
    damageTakenTotal: number;
    damageMitigatedTotal: number;
    visionScoreTotal: number;
    kills: number;
    deaths: number;
    assists: number;
    teamKills: number;
    laneStats: Record<
        LaneTime,
        {
            goldDiff: number;
            xpDiff: number;
            csDiff: number;
            killDiff: number;
            count: number;
        }
    >;
    laneDelta15Sum: number;
    laneDelta15Sq: number;
    laneDelta15Count: number;
    opponents: Map<string, number>;
}

interface ChampionFlexAccumulator {
    totalGames: number;
    perRoleGames: Map<DraftRole, number>;
}

interface CounterAccumulator {
    role: DraftRole;
    champion: string;
    opponent: string;
    games: number;
    wins: number;
    laneDeltaSum: number;
    laneDeltaSq: number;
    kpEarlySum: number;
    kpEarlySq: number;
}

interface PlayerChampionAccumulator {
    games: number;
    wins: number;
    laneDeltaSum: number;
    laneDeltaSq: number;
    minutes: number;
}

interface SoloSynergyAccumulator {
    games: number;
    wins: number;
}

interface PairSynergyAccumulator {
    games: number;
    wins: number;
}

interface ChampionRoleSnapshot {
    accumulator: ChampionRoleAccumulator;
    championKey: string;
    role: DraftRole;
    games: number;
    wins: number;
    minutes: number;
    wrAdj: number;
    platesPerMinute: number;
    firstTowerRate: number;
    firstMidTowerRate: number;
    heraldControl: number;
    grubControl: number;
    heraldGrubsControl: number;
    dragonControl: number;
    dragonRate: number;
    baronControl: number;
    baronRate: number;
    atakhanControl: number;
    atakhanRate: number;
    dpm: number;
    damageTakenPm: number;
    damageMitigatedPm: number;
    visionScorePm: number;
    deathsPerMinute: number;
    kp: number;
    laneComposite: Record<LaneTime, number>;
    laneStd15: number;
    laneMean15: number;
    laneGold15: number;
    laneXp15: number;
    laneCs15: number;
    laneKill15: number;
    scalingGoldRate: number;
    scalingXpRate: number;
}

function computeComposite(values: number[], weights: number[]) {
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < values.length; i++) {
        const value = values[i];
        const weight = weights[i] ?? 0;
        if (!Number.isFinite(value) || !Number.isFinite(weight) || weight === 0) {
            continue;
        }
        numerator += value * weight;
        denominator += weight;
    }
    return denominator === 0 ? 0 : numerator / denominator;
}

export interface DraftMetricsPrecomputeOptions {
    patch?: string;
    outputPath?: string;
    weights?: Partial<PrecomputedDraftMetrics["weights"]>;
    priors?: Partial<PrecomputedDraftMetrics["priors"]>;
    allChampionKeys?: string[];
    roleHints?: Map<string, DraftRole[]>;
}

function safeNumber(value: CsvValue): number | undefined {
    if (
        value === undefined ||
        value === null ||
        value === "" ||
        value === "NA" ||
        value === "null" ||
        value === "None"
    ) {
        return undefined;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return undefined;
    }
    return number;
}

function getRole(value: string): DraftRole | undefined {
    return ROLE_ALIASES[value.toLowerCase()];
}

export function parsePlayerRecord(record: CsvRecord): PlayerRow | undefined {
    const role = getRole(String(record["position"] ?? "").toLowerCase());
    if (!role) return undefined;

    const gameIdRaw = record["gameid"];
    if (gameIdRaw === undefined || gameIdRaw === null || gameIdRaw === "") {
        return undefined;
    }
    const gameId = String(gameIdRaw);
    const patch = String(record["patch"] ?? "");
    const sideValue = String(record["side"] ?? "Blue");
    const side = sideValue.toLowerCase() === "red" ? "Red" : "Blue";
    const champion = String(record["champion"] ?? "");
    const playerName = String(record["playername"] ?? "");
    const teamName = String(record["teamname"] ?? "");
    const opponentTeamName = String(record["opponent"] ?? "");
    const winnerRaw = record["result"];
    const winner =
        winnerRaw === 1 ||
        winnerRaw === "1" ||
        String(winnerRaw ?? "").toLowerCase() === "win";

    const lengthSeconds = safeNumber(record["gamelength"]);
    if (!lengthSeconds || lengthSeconds <= 0) return undefined;
    const minutes = lengthSeconds / 60;

    const kills = safeNumber(record["kills"]) ?? 0;
    const deaths = safeNumber(record["deaths"]) ?? 0;
    const assists = safeNumber(record["assists"]) ?? 0;
    const teamKills = safeNumber(record["teamkills"]) ?? 0;
    const teamDeaths = safeNumber(record["teamdeaths"]) ?? 0;
    const turretPlates = safeNumber(record["turretplates"]) ?? 0;
    const firstTower = safeNumber(record["firsttower"]) ?? 0;
    const firstMidTower = safeNumber(record["firstmidtower"]) ?? 0;
    const firstToThree = safeNumber(record["firsttothreetowers"]) ?? 0;
    const heralds = safeNumber(record["heralds"]) ?? 0;
    const oppHeralds = safeNumber(record["opp_heralds"]) ?? 0;
    const voidGrubs = safeNumber(record["void_grubs"]) ?? 0;
    const oppVoidGrubs = safeNumber(record["opp_void_grubs"]) ?? 0;
    const dragons = safeNumber(record["dragons"]) ?? 0;
    const oppDragons = safeNumber(record["opp_dragons"]) ?? 0;
    const barons = safeNumber(record["barons"]) ?? 0;
    const oppBarons = safeNumber(record["opp_barons"]) ?? 0;
    const atakhans = safeNumber(record["atakhans"]) ?? 0;
    const oppAtakhans = safeNumber(record["opp_atakhans"]) ?? 0;
    const dpm = safeNumber(record["dpm"]);
    const damageTakenPerMinute = safeNumber(record["damagetakenperminute"]);
    const damageMitigatedPerMinute = safeNumber(
        record["damagemitigatedperminute"]
    );
    const visionScorePerMinute = safeNumber(record["vspm"]);
    const assistsAt15 = safeNumber(record["assistsat15"]);
    const killsAt15 = safeNumber(record["killsat15"]);
    const deathsAt15 = safeNumber(record["deathsat15"]);

    const laneStats = {} as PlayerRow["laneStats"];
    const goldAt = {} as PlayerRow["goldAt"];
    const oppGoldAt = {} as PlayerRow["oppGoldAt"];
    const xpAt = {} as PlayerRow["xpAt"];
    const oppXpAt = {} as PlayerRow["oppXpAt"];

    for (const time of LANE_TIMES) {
        const gold = safeNumber(record[`goldat${time}`]);
        const oppGold = safeNumber(record[`opp_goldat${time}`]);
        const xp = safeNumber(record[`xpat${time}`]);
        const oppXp = safeNumber(record[`opp_xpat${time}`]);
        const cs = safeNumber(record[`csat${time}`]);
        const oppCs = safeNumber(record[`opp_csat${time}`]);
        const killsTime = safeNumber(record[`killsat${time}`]);
        const deathsTime = safeNumber(record[`deathsat${time}`]);

        goldAt[time] = gold;
        oppGoldAt[time] = oppGold;
        xpAt[time] = xp;
        oppXpAt[time] = oppXp;

        const goldDiff = safeNumber(record[`golddiffat${time}`]);
        const xpDiff = safeNumber(record[`xpdiffat${time}`]);
        const csDiff = safeNumber(record[`csdiffat${time}`]);

        laneStats[time] = {
            goldDiff:
                goldDiff !== undefined
                    ? goldDiff
                    : gold !== undefined && oppGold !== undefined
                    ? gold - oppGold
                    : undefined,
            xpDiff:
                xpDiff !== undefined
                    ? xpDiff
                    : xp !== undefined && oppXp !== undefined
                    ? xp - oppXp
                    : undefined,
            csDiff:
                csDiff !== undefined
                    ? csDiff
                    : cs !== undefined && oppCs !== undefined
                    ? cs - oppCs
                    : undefined,
            killDiff:
                killsTime !== undefined && deathsTime !== undefined
                    ? killsTime - deathsTime
                    : undefined,
        };
    }

    return {
        gameId,
        patch,
        side,
        teamName,
        opponentTeamName,
        role,
        champion,
        playerName,
        winner,
        minutes,
        kills,
        deaths,
        assists,
        teamKills,
        teamDeaths,
        turretPlates,
        firstTower,
        firstMidTower,
        firstToThree,
        heralds,
        oppHeralds,
        voidGrubs,
        oppVoidGrubs,
        dragons,
        oppDragons,
        barons,
        oppBarons,
        atakhans,
        oppAtakhans,
        dpm,
        damageTakenPerMinute,
        damageMitigatedPerMinute,
        visionScorePerMinute,
        assistsAt15,
        killsAt15,
        deathsAt15,
        laneStats,
        goldAt,
        oppGoldAt,
        xpAt,
        oppXpAt,
    };
}

export function parseTeamRecord(record: CsvRecord): TeamRow | undefined {
    const picks = Array.from({ length: 5 }, (_, index) => record[`pick${index + 1}`])
        .map((value) => (value === undefined || value === null ? "" : String(value)))
        .filter((value) => value);
    if (!picks.length) return undefined;

    const gameIdRaw = record["gameid"];
    if (gameIdRaw === undefined || gameIdRaw === null || gameIdRaw === "") {
        return undefined;
    }
    const gameId = String(gameIdRaw);
    const patch = String(record["patch"] ?? "");
    const sideValue = String(record["side"] ?? "Blue");
    const side = sideValue.toLowerCase() === "red" ? "Red" : "Blue";
    const winnerRaw = record["result"];
    const winner =
        winnerRaw === 1 ||
        winnerRaw === "1" ||
        String(winnerRaw ?? "").toLowerCase() === "win";

    return {
        gameId,
        patch,
        side,
        picks,
        winner,
    };
}

class DraftMetricsAggregator {
    private readonly championRole = new Map<string, ChampionRoleAccumulator>();
    private readonly championFlex = new Map<string, ChampionFlexAccumulator>();
    private readonly counterMap = new Map<string, CounterAccumulator>();
    private readonly playerReliability = new Map<string, PlayerChampionAccumulator>();
    private readonly soloSynergy = new Map<string, SoloSynergyAccumulator>();
    private readonly pairSynergy = new Map<string, PairSynergyAccumulator>();
    private readonly roleWins: Record<DraftRole, { wins: number; games: number }> =
        {
            top: { wins: 0, games: 0 },
            jng: { wins: 0, games: 0 },
            mid: { wins: 0, games: 0 },
            bot: { wins: 0, games: 0 },
            sup: { wins: 0, games: 0 },
        };
    private totalTeamEntries = 0;

    constructor(private readonly options: DraftMetricsPrecomputeOptions) {}

    addPlayerRow(row: PlayerRow) {
        const key = `${row.champion}:${row.role}`;
        if (!this.championRole.has(key)) {
            this.championRole.set(key, this.createChampionRoleAccumulator(row.champion, row.role));
        }
        const acc = this.championRole.get(key)!;

        acc.games += 1;
        acc.wins += row.winner ? 1 : 0;
        acc.minutes += row.minutes;
        acc.plates += row.turretPlates;
        acc.firstTower += row.firstTower;
        acc.firstMidTower += row.firstMidTower;
        acc.firstToThree += row.firstToThree;
        acc.heraldDelta += row.heralds - row.oppHeralds;
        acc.grubDelta += row.voidGrubs - row.oppVoidGrubs;
        acc.dragonDelta += row.dragons - row.oppDragons;
        acc.dragonsFor += row.dragons;
        acc.dragonsAgainst += row.oppDragons;
        acc.baronDelta += row.barons - row.oppBarons;
        acc.baronsFor += row.barons;
        acc.baronsAgainst += row.oppBarons;
        acc.atakhanDelta += row.atakhans - row.oppAtakhans;
        acc.atakhansFor += row.atakhans;
        acc.atakhansAgainst += row.oppAtakhans;
        acc.dpmTotal += (row.dpm ?? 0) * row.minutes;
        acc.damageTakenTotal += (row.damageTakenPerMinute ?? 0) * row.minutes;
        acc.damageMitigatedTotal +=
            (row.damageMitigatedPerMinute ?? 0) * row.minutes;
        acc.visionScoreTotal += (row.visionScorePerMinute ?? 0) * row.minutes;
        acc.kills += row.kills;
        acc.deaths += row.deaths;
        acc.assists += row.assists;
        acc.teamKills += row.teamKills;

        for (const time of LANE_TIMES) {
            const lane = row.laneStats[time];
            const laneAcc = acc.laneStats[time];
            if (lane.goldDiff !== undefined) {
                laneAcc.goldDiff += lane.goldDiff;
            }
            if (lane.xpDiff !== undefined) {
                laneAcc.xpDiff += lane.xpDiff;
            }
            if (lane.csDiff !== undefined) {
                laneAcc.csDiff += lane.csDiff;
            }
            if (lane.killDiff !== undefined) {
                laneAcc.killDiff += lane.killDiff;
            }
            if (
                lane.goldDiff !== undefined ||
                lane.xpDiff !== undefined ||
                lane.csDiff !== undefined
            ) {
                laneAcc.count += 1;
            }
        }

        const laneDelta15 = this.computeLaneComposite(row, 15);
        if (laneDelta15 !== undefined) {
            row.laneDelta15 = laneDelta15;
            acc.laneDelta15Sum += laneDelta15;
            acc.laneDelta15Sq += laneDelta15 * laneDelta15;
            acc.laneDelta15Count += 1;
        }

        if (!this.championFlex.has(row.champion)) {
            this.championFlex.set(row.champion, {
                totalGames: 0,
                perRoleGames: new Map(),
            });
        }
        const flex = this.championFlex.get(row.champion)!;
        flex.totalGames += 1;
        flex.perRoleGames.set(
            row.role,
            (flex.perRoleGames.get(row.role) ?? 0) + 1
        );

        const playerKey = `${row.playerName}:${row.champion}:${row.role}`;
        if (!this.playerReliability.has(playerKey)) {
            this.playerReliability.set(playerKey, {
                games: 0,
                wins: 0,
                laneDeltaSum: 0,
                laneDeltaSq: 0,
                minutes: 0,
            });
        }
        const playerAcc = this.playerReliability.get(playerKey)!;
        playerAcc.games += 1;
        playerAcc.wins += row.winner ? 1 : 0;
        playerAcc.minutes += row.minutes;
        if (laneDelta15 !== undefined) {
            playerAcc.laneDeltaSum += laneDelta15;
            playerAcc.laneDeltaSq += laneDelta15 * laneDelta15;
        }

        this.roleWins[row.role].games += 1;
        this.roleWins[row.role].wins += row.winner ? 1 : 0;
    }

    addTeamRow(row: TeamRow) {
        this.totalTeamEntries += 1;
        const unique = Array.from(new Set(row.picks));
        for (const champion of unique) {
            if (!this.soloSynergy.has(champion)) {
                this.soloSynergy.set(champion, { games: 0, wins: 0 });
            }
            const solo = this.soloSynergy.get(champion)!;
            solo.games += 1;
            solo.wins += row.winner ? 1 : 0;
        }
        for (let i = 0; i < unique.length; i++) {
            for (let j = i + 1; j < unique.length; j++) {
                const [a, b] =
                    unique[i] < unique[j]
                        ? [unique[i], unique[j]]
                        : [unique[j], unique[i]];
                const key = `${a}:${b}`;
                if (!this.pairSynergy.has(key)) {
                    this.pairSynergy.set(key, { games: 0, wins: 0 });
                }
                const pair = this.pairSynergy.get(key)!;
                pair.games += 1;
                pair.wins += row.winner ? 1 : 0;
            }
        }
    }

    attachOpponents(rowsByGameRole: Map<string, PlayerRow[]>) {
        for (const rows of rowsByGameRole.values()) {
            if (rows.length < 2) continue;
            const [a, b] =
                rows[0].side === "Blue" ? [rows[0], rows[1]] : [rows[1], rows[0]];
            a.opponentChampion = b.champion;
            b.opponentChampion = a.champion;
            this.addCounterSample(a, b);
            this.addCounterSample(b, a);
        }
    }

    private addCounterSample(row: PlayerRow, opponent: PlayerRow) {
        const laneDelta =
            row.laneDelta15 ?? this.computeLaneComposite(row, 15);
        const kpEarly =
            row.kpEarly ??
            safeDivide(
                (row.killsAt15 ?? 0) + (row.assistsAt15 ?? 0),
                Math.max(row.teamKills, 1)
            );
        row.kpEarly = kpEarly;

        const key = `${row.role}:${row.champion}:${opponent.champion}`;
        if (!this.counterMap.has(key)) {
            this.counterMap.set(key, {
                role: row.role,
                champion: row.champion,
                opponent: opponent.champion,
                games: 0,
                wins: 0,
                laneDeltaSum: 0,
                laneDeltaSq: 0,
                kpEarlySum: 0,
                kpEarlySq: 0,
            });
        }
        const counter = this.counterMap.get(key)!;
        counter.games += 1;
        counter.wins += row.winner ? 1 : 0;
        if (laneDelta !== undefined) {
            counter.laneDeltaSum += laneDelta;
            counter.laneDeltaSq += laneDelta * laneDelta;
        }
        if (kpEarly !== undefined) {
            counter.kpEarlySum += kpEarly;
            counter.kpEarlySq += kpEarly * kpEarly;
        }

        const roleKey = `${row.champion}:${row.role}`;
        const acc = this.championRole.get(roleKey);
        if (acc) {
            acc.opponents.set(
                opponent.champion,
                (acc.opponents.get(opponent.champion) ?? 0) + 1
            );
        }
    }

    private createChampionRoleAccumulator(
        champion: string,
        role: DraftRole
    ): ChampionRoleAccumulator {
        const laneStats = LANE_TIMES.reduce(
            (acc, time) => ({
                ...acc,
                [time]: {
                    goldDiff: 0,
                    xpDiff: 0,
                    csDiff: 0,
                    killDiff: 0,
                    count: 0,
                },
            }),
            {} as ChampionRoleAccumulator["laneStats"]
        );

        return {
            championKey: champion,
            role,
            games: 0,
            wins: 0,
            minutes: 0,
            plates: 0,
            firstTower: 0,
            firstMidTower: 0,
            firstToThree: 0,
            heraldDelta: 0,
            grubDelta: 0,
            dragonDelta: 0,
            dragonsFor: 0,
            dragonsAgainst: 0,
            baronDelta: 0,
            baronsFor: 0,
            baronsAgainst: 0,
            atakhanDelta: 0,
            atakhansFor: 0,
            atakhansAgainst: 0,
            dpmTotal: 0,
            damageTakenTotal: 0,
            damageMitigatedTotal: 0,
            visionScoreTotal: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
            teamKills: 0,
            laneStats,
            laneDelta15Sum: 0,
            laneDelta15Sq: 0,
            laneDelta15Count: 0,
            opponents: new Map(),
        };
    }

    private computeLaneComposite(row: PlayerRow, time: LaneTime) {
        const lane = row.laneStats[time];
        if (!lane) return undefined;
        const components = [
            lane.goldDiff,
            lane.xpDiff,
            lane.csDiff,
            lane.killDiff,
        ];
        if (components.every((value) => value === undefined)) {
            return undefined;
        }
        const weights = [1, 0.7, 0.5, 0.3];
        let total = 0;
        let weight = 0;
        for (let i = 0; i < components.length; i++) {
            const value = components[i];
            if (value === undefined) continue;
            total += value * weights[i];
            weight += weights[i];
        }
        if (!weight) return undefined;
        return total / weight;
    }

    build(): PrecomputedDraftMetrics {
        const priors: PrecomputedDraftMetrics["priors"] = {
            winrate: { n0: 16 },
            continuous: { n0: 600 },
            ...this.options.priors,
        };

        const weights: PrecomputedDraftMetrics["weights"] = {
            intrinsic: { a: 0.35, b: 0.25, c: 0.2, d: 0.2, e: 0 },
            blind: { w1: 0.45, w2: 0.25, w3: 0.2, w4: 0.1, w5: 0.2 },
            flex: { u1: 0.6, u2: 0.3, u3: 0.2 },
            reliability: { v1: 0.7, v2: 0.3, v3: 0.3 },
            state: { k1: 0.8, k2: 0.7, k3: 0.6, k4: 0.6, k5: 0.5, k6: 0.4, k7: 0.5 },
            ...this.options.weights,
        };

        const metricBuckets = createMetricBuckets();
        const snapshots: ChampionRoleSnapshot[] = [];

        for (const acc of this.championRole.values()) {
            const minutes = Math.max(acc.minutes, 1e-6);
            const games = Math.max(acc.games, 1);
            const roleWinrate = safeDivide(
                this.roleWins[acc.role].wins,
                Math.max(this.roleWins[acc.role].games, 1),
                0.5
            );
            const wrAdj = betaBinomialAdjust(
                acc.wins,
                acc.games,
                roleWinrate,
                priors.winrate.n0
            );

            const platesPerMinute = safeDivide(acc.plates, minutes, 0);
            const firstTowerRate = safeDivide(acc.firstTower, games, 0);
            const firstMidTowerRate = safeDivide(acc.firstMidTower, games, 0);
            const heraldControl = safeDivide(acc.heraldDelta, games, 0);
            const grubControl = safeDivide(acc.grubDelta, games, 0);
            const heraldGrubsControl = heraldControl + grubControl;
            const dragonControl = safeDivide(acc.dragonDelta, games, 0);
            const baronControl = safeDivide(acc.baronDelta, games, 0);
            const atakhanControl = safeDivide(acc.atakhanDelta, games, 0);
            const dragonRate = safeDivide(acc.dragonsFor, games, 0);
            const baronRate = safeDivide(acc.baronsFor, games, 0);
            const atakhanRate = safeDivide(acc.atakhansFor, games, 0);
            const dpm = safeDivide(acc.dpmTotal, minutes, 0);
            const damageTakenPm = safeDivide(acc.damageTakenTotal, minutes, 0);
            const damageMitigatedPm = safeDivide(
                acc.damageMitigatedTotal,
                minutes,
                0
            );
            const visionScorePm = safeDivide(acc.visionScoreTotal, minutes, 0);
            const deathsPerMinute = safeDivide(acc.deaths, minutes, 0);
            const kp = safeDivide(
                acc.kills + acc.assists,
                Math.max(acc.teamKills, 1),
                0
            );

            const laneComposite = {} as ChampionRoleSnapshot["laneComposite"];
            for (const time of LANE_TIMES) {
                const lane = acc.laneStats[time];
                const count = Math.max(lane.count, 1);
                laneComposite[time] = computeComposite(
                    [
                        lane.goldDiff / count,
                        lane.xpDiff / count,
                        lane.csDiff / count,
                        lane.killDiff / count,
                    ],
                    [1, 0.7, 0.5, 0.3]
                );
            }
            const laneCount15 = Math.max(acc.laneStats[15].count, 1);
            const laneGold15 =
                acc.laneStats[15].goldDiff / laneCount15;
            const laneXp15 =
                acc.laneStats[15].xpDiff / laneCount15;
            const laneCs15 =
                acc.laneStats[15].csDiff / laneCount15;
            const laneKill15 =
                acc.laneStats[15].killDiff / laneCount15;

            const laneMean15 =
                acc.laneDelta15Count > 0
                    ? acc.laneDelta15Sum / acc.laneDelta15Count
                    : laneComposite[15];
            const laneVar15 =
                acc.laneDelta15Count > 1
                    ? acc.laneDelta15Sq / acc.laneDelta15Count -
                      laneMean15 * laneMean15
                    : 0;
            const laneStd15 = Math.sqrt(Math.max(laneVar15, 0));

            const scalingGoldRate =
                (laneComposite[25] - laneComposite[15]) / 10;
            const scalingXpRate =
                (acc.laneStats[25].xpDiff / Math.max(acc.laneStats[25].count, 1) -
                    acc.laneStats[15].xpDiff /
                        Math.max(acc.laneStats[15].count, 1)) /
                10;

            collectMetric(metricBuckets, acc.role, "wrAdj", wrAdj, games);
            collectMetric(metricBuckets, acc.role, "plates", platesPerMinute, minutes);
            collectMetric(metricBuckets, acc.role, "firstTower", firstTowerRate, games);
            collectMetric(metricBuckets, acc.role, "firstMidTower", firstMidTowerRate, games);
            collectMetric(metricBuckets, acc.role, "heraldControl", heraldControl, games);
            collectMetric(metricBuckets, acc.role, "grubControl", grubControl, games);
            collectMetric(metricBuckets, acc.role, "heraldGrubs", heraldGrubsControl, games);
            collectMetric(metricBuckets, acc.role, "dragon", dragonControl, games);
            collectMetric(metricBuckets, acc.role, "dragonRate", dragonRate, games);
            collectMetric(metricBuckets, acc.role, "baronRate", baronRate, games);
            collectMetric(metricBuckets, acc.role, "atakhanRate", atakhanRate, games);
            collectMetric(metricBuckets, acc.role, "dpm", dpm, minutes);
            collectMetric(metricBuckets, acc.role, "kp", kp, games);
            collectMetric(metricBuckets, acc.role, "mitigationPm", damageMitigatedPm, minutes);
            collectMetric(metricBuckets, acc.role, "visionPm", visionScorePm, minutes);
            collectMetric(metricBuckets, acc.role, "deathsPm", deathsPerMinute, minutes);
            collectMetric(metricBuckets, acc.role, "frontline", damageTakenPm + 0.7 * damageMitigatedPm, minutes);
            collectMetric(metricBuckets, acc.role, "lane10", laneComposite[10], Math.max(acc.laneStats[10].count, 1));
            collectMetric(metricBuckets, acc.role, "lane15", laneComposite[15], laneCount15);
            collectMetric(metricBuckets, acc.role, "lane20", laneComposite[20], Math.max(acc.laneStats[20].count, 1));
            collectMetric(metricBuckets, acc.role, "lane25", laneComposite[25], Math.max(acc.laneStats[25].count, 1));
            collectMetric(metricBuckets, acc.role, "laneVolatility", laneStd15, games);
            collectMetric(metricBuckets, acc.role, "laneGold15", laneGold15, laneCount15);
            collectMetric(metricBuckets, acc.role, "laneXp15", laneXp15, laneCount15);
            collectMetric(metricBuckets, acc.role, "laneCs15", laneCs15, laneCount15);
            collectMetric(metricBuckets, acc.role, "laneKill15", laneKill15, laneCount15);
            collectMetric(metricBuckets, acc.role, "scalingGold", scalingGoldRate, games);
            collectMetric(metricBuckets, acc.role, "scalingXp", scalingXpRate, games);
            collectMetric(metricBuckets, acc.role, "baron", baronControl + atakhanControl, games);
            const pickRate = safeDivide(acc.games, Math.max(this.roleWins[acc.role].games, 1), 0);
            collectMetric(metricBuckets, acc.role, "pickRate", pickRate, acc.games);

            snapshots.push({
                accumulator: acc,
                championKey: acc.championKey,
                role: acc.role,
                games: acc.games,
                wins: acc.wins,
                minutes: acc.minutes,
                wrAdj,
                platesPerMinute,
                firstTowerRate,
                firstMidTowerRate,
                heraldControl,
                grubControl,
                heraldGrubsControl,
                dragonControl,
                dragonRate,
                baronControl,
                baronRate,
                atakhanControl,
                atakhanRate,
                dpm,
                damageTakenPm,
                damageMitigatedPm,
                visionScorePm,
                deathsPerMinute,
                kp,
                laneComposite,
                laneStd15,
                laneMean15,
                laneGold15,
                laneXp15,
                laneCs15,
                laneKill15,
                scalingGoldRate,
                scalingXpRate,
            });
        }

        const roleStats = computeMetricStats(metricBuckets);

        const championRoleMetrics: ChampionRoleMetrics[] = [];
        for (const snapshot of snapshots) {
            const stats = roleStats.get(snapshot.role);
            const getZ = (metric: string, value: number, meanFallback = 0) =>
                computeZScore(
                    value,
                    stats?.get(metric)?.mean ?? meanFallback,
                    stats?.get(metric)?.std ?? 1,
                    0
                );

            const winrateZ = getZ("wrAdj", snapshot.wrAdj, 0.5);
            const platesZ = getZ("plates", snapshot.platesPerMinute, 0);
            const firstTowerZ = getZ("firstTower", snapshot.firstTowerRate, 0);
            const firstMidTowerZ = getZ(
                "firstMidTower",
                snapshot.firstMidTowerRate,
                0
            );
            const heraldZ = getZ("heraldControl", snapshot.heraldControl, 0);
            const grubZ = getZ("grubControl", snapshot.grubControl, 0);
            const dragonDeltaZ = getZ("dragon", snapshot.dragonControl, 0);
            const dragonRateZ = getZ("dragonRate", snapshot.dragonRate, 0);
            const baronRateZ = getZ("baronRate", snapshot.baronRate, 0);
            const atakhanRateZ = getZ("atakhanRate", snapshot.atakhanRate, 0);
            const dpmZ = getZ("dpm", snapshot.dpm, 0);
            const kpZ = getZ("kp", snapshot.kp, 0);
            const mitigationZ = getZ(
                "mitigationPm",
                snapshot.damageMitigatedPm,
                0
            );
            const visionZ = getZ("visionPm", snapshot.visionScorePm, 0);
            const deathsPmZ = getZ("deathsPm", snapshot.deathsPerMinute, 0);
            const frontlineZ = getZ(
                "frontline",
                snapshot.damageTakenPm + 0.7 * snapshot.damageMitigatedPm,
                0
            );
            const laneGoldZ = getZ("laneGold15", snapshot.laneGold15, 0);
            const laneXpZ = getZ("laneXp15", snapshot.laneXp15, 0);
            const laneCsZ = getZ("laneCs15", snapshot.laneCs15, 0);
            const laneKillZ = getZ("laneKill15", snapshot.laneKill15, 0);
            const laneVolatilityZ = getZ(
                "laneVolatility",
                snapshot.laneStd15,
                0
            );
            const scalingGoldZ = getZ("scalingGold", snapshot.scalingGoldRate, 0);
            const scalingXpZ = getZ("scalingXp", snapshot.scalingXpRate, 0);
            const pickRate = safeDivide(
                snapshot.games,
                Math.max(this.roleWins[snapshot.role].games, 1),
                0
            );
            const pickRateZ = getZ("pickRate", pickRate, 0);

            const laneZ =
                laneGoldZ + 0.7 * laneXpZ + 0.5 * laneCsZ + 0.3 * laneKillZ;

            let prioZ = 0;
            switch (snapshot.role) {
                case "jng":
                    prioZ =
                        0.6 * heraldZ +
                        0.5 * grubZ +
                        0.3 * dragonDeltaZ +
                        0.2 * firstTowerZ;
                    break;
                case "bot":
                    prioZ = 0.5 * dragonRateZ + 0.3 * platesZ;
                    break;
                case "mid":
                    prioZ = 0.4 * firstMidTowerZ + 0.3 * platesZ;
                    break;
                case "top":
                    prioZ = 0.5 * platesZ;
                    break;
                case "sup":
                    prioZ = 0.5 * visionZ + 0.2 * dragonRateZ;
                    break;
                default:
                    prioZ = 0.4 * platesZ;
                    break;
            }

            let tfZ = dpmZ + 0.5 * kpZ;
            if (snapshot.role === "top" || snapshot.role === "jng") {
                tfZ += 0.3 * mitigationZ;
            }
            if (snapshot.role === "sup") {
                tfZ += 0.3 * visionZ;
            }

            const scalZ = 0.6 * baronRateZ + 0.4 * atakhanRateZ;
            const safetyZ = -deathsPmZ + 0.4 * mitigationZ;
            const volatilityZ = laneVolatilityZ;

            const intrinsic =
                0.35 * prioZ + 0.25 * tfZ + 0.2 * scalZ + 0.2 * laneZ;

            let blind =
                0.45 * winrateZ + 0.25 * safetyZ - 0.2 * laneVolatilityZ;

            const reliabilityRelN = safeDivide(
                snapshot.games,
                snapshot.games + priors.winrate.n0,
                0
            );
            const reliability = {
                relN: reliabilityRelN,
                varianceLane: snapshot.laneStd15 ** 2,
                sigma: Math.max(snapshot.laneStd15, 0.01),
            };

            const opponents = Array.from(
                snapshot.accumulator.opponents.entries()
            ).map(([championKey, count]) => ({
                championKey,
                games: count,
                probability: safeDivide(count, snapshot.games, 0),
            }));

            championRoleMetrics.push({
                championKey: snapshot.championKey,
                role: snapshot.role,
                games: snapshot.games,
                wins: snapshot.wins,
                minutes: snapshot.minutes,
                winrateAdj: snapshot.wrAdj,
                winrateZ,
                pickRate,
                pickRateZ,
                laneScores: {
                    delta10: snapshot.laneComposite[10],
                    delta15: snapshot.laneComposite[15],
                    delta20: snapshot.laneComposite[20],
                    delta25: snapshot.laneComposite[25],
                    volatility: snapshot.laneStd15,
                },
                prioZ,
                tfZ,
                scalZ,
                safetyZ,
                frontlineZ,
                exposureScore: 0,
                intrinsic,
                blind,
                reliability,
                flexPrior: 0,
                componentBreakdown: {
                    prio: prioZ,
                    teamfight: tfZ,
                    scaling: scalZ,
                    lane: laneZ,
                    safety: safetyZ,
                    volatilityPenalty: volatilityZ,
                },
                opponents,
            });
        }

        const flexMetrics = this.buildFlexMetrics(weights);
        const counters = this.buildCounters(
            roleStats,
            priors.winrate.n0
        );
        const synergies = this.buildSynergies(priors);
        const playerReliability = this.buildPlayerReliability(priors);

        this.extendWithDummyChampions(championRoleMetrics, flexMetrics);

        this.attachExposureScores(championRoleMetrics, counters, weights);
        this.attachFlexScores(championRoleMetrics, flexMetrics, weights);

        return {
            patch: this.options.patch ?? "",
            generatedAt: new Date().toISOString(),
            sampleSize: snapshots.reduce(
                (sum, snapshot) => sum + snapshot.games,
                0
            ),
            roleWinrate: {
                top: safeDivide(
                    this.roleWins.top.wins,
                    Math.max(this.roleWins.top.games, 1),
                    0.5
                ),
                jng: safeDivide(
                    this.roleWins.jng.wins,
                    Math.max(this.roleWins.jng.games, 1),
                    0.5
                ),
                mid: safeDivide(
                    this.roleWins.mid.wins,
                    Math.max(this.roleWins.mid.games, 1),
                    0.5
                ),
                bot: safeDivide(
                    this.roleWins.bot.wins,
                    Math.max(this.roleWins.bot.games, 1),
                    0.5
                ),
                sup: safeDivide(
                    this.roleWins.sup.wins,
                    Math.max(this.roleWins.sup.games, 1),
                    0.5
                ),
            },
            roleGames: {
                top: this.roleWins.top.games,
                jng: this.roleWins.jng.games,
                mid: this.roleWins.mid.games,
                bot: this.roleWins.bot.games,
                sup: this.roleWins.sup.games,
            },
            championRoleMetrics,
            championFlexMetrics: flexMetrics,
            synergyMatrix: synergies,
            counterMatrix: counters,
            playerReliability,
            weights,
            priors,
            exposureConfig: { counterThreshold: 0 },
            composition: { frontline: 0, prio: 0 },
        };
    }

    private buildFlexMetrics(
        weights: PrecomputedDraftMetrics["weights"]
    ): ChampionFlexMetrics[] {
        const metrics: ChampionFlexMetrics[] = [];
        for (const [champion, acc] of this.championFlex.entries()) {
            const entries = Array.from(acc.perRoleGames.entries());
            const entropy =
                -entries.reduce((sum, [_, games]) => {
                    const p = safeDivide(games, acc.totalGames, 0);
                    if (p <= 0) return sum;
                    return sum + p * Math.log(p);
                }, 0) / Math.log(5);
            const practical =
                entries.filter(([_, games]) => games >= 3).length / 5;
            metrics.push({
                championKey: champion,
                entropy,
                practicalFlex: practical,
                sampleSize: acc.totalGames,
                flexScore:
                    weights.flex.u1 * entropy +
                    weights.flex.u2 * practical -
                    weights.flex.u3 * 0,
            });
        }
        return metrics;
    }

    private buildCounters(
        stats: Map<DraftRole, Map<string, { mean: number; std: number }>>,
        winratePrior: number
    ): CounterEntry[] {
        const entries: CounterEntry[] = [];
        for (const counter of this.counterMap.values()) {
            const laneMean = safeDivide(counter.laneDeltaSum, counter.games, 0);
            const laneVariance =
                safeDivide(counter.laneDeltaSq, counter.games, 0) -
                laneMean * laneMean;
            const laneZ = computeZScore(
                laneMean,
                stats.get(counter.role)?.get("lane15")?.mean ?? 0,
                stats.get(counter.role)?.get("lane15")?.std ?? 1,
                0
            );
            const kpMean = safeDivide(counter.kpEarlySum, counter.games, 0);
            const kpZ = computeZScore(
                kpMean,
                stats.get(counter.role)?.get("kp")?.mean ?? 0,
                stats.get(counter.role)?.get("kp")?.std ?? 1,
                0
            );
            const winrate = betaBinomialAdjust(
                counter.wins,
                counter.games,
                0.5,
                winratePrior
            );
            const score = winrate - 0.5;
            entries.push({
                role: counter.role,
                champion: counter.champion,
                opponent: counter.opponent,
                samples: counter.games,
                wins: counter.wins,
                winrate,
                laneScore: laneZ,
                laneDelta: laneMean,
                kpEarly: kpMean,
                score,
            });
        }
        return entries;
    }

    private buildSynergies(
        priors: PrecomputedDraftMetrics["priors"]
    ): SynergyEntry[] {
        const entries: SynergyEntry[] = [];
        for (const [key, pair] of this.pairSynergy.entries()) {
            const [a, b] = key.split(":");
            const soloA = this.soloSynergy.get(a);
            const soloB = this.soloSynergy.get(b);
            if (!soloA || !soloB) continue;

            const pPair = safeDivide(pair.games, this.totalTeamEntries, 0);
            const pA = safeDivide(soloA.games, this.totalTeamEntries, 0);
            const pB = safeDivide(soloB.games, this.totalTeamEntries, 0);
            const epsilon = 1e-6;
            const pmi = Math.log(
                (pPair + epsilon) / ((pA + epsilon) * (pB + epsilon))
            );
            const npmi = pPair > 0 ? pmi / -Math.log(pPair + epsilon) : 0;

            const winPair = betaBinomialAdjust(
                pair.wins,
                pair.games,
                0.5,
                priors.winrate.n0
            );
            const winA = betaBinomialAdjust(
                soloA.wins,
                soloA.games,
                0.5,
                priors.winrate.n0
            );
            const winB = betaBinomialAdjust(
                soloB.wins,
                soloB.games,
                0.5,
                priors.winrate.n0
            );
            const deltaWinrate = winPair - (winA + winB) / 2;
            const score = winPair - 0.5;

            entries.push({
                championA: a,
                championB: b,
                samples: pair.games,
                npmi,
                deltaWinrate,
                winrate: winPair,
                score,
            });
        }
        return entries;
    }

    private buildPlayerReliability(
        priors: PrecomputedDraftMetrics["priors"]
    ): PlayerChampionReliability[] {
        const entries: PlayerChampionReliability[] = [];
        for (const [key, acc] of this.playerReliability.entries()) {
            const [playerName, championKey, roleRaw] = key.split(":");
            const role = roleRaw as DraftRole;
            const relN = safeDivide(
                acc.games,
                acc.games + priors.winrate.n0,
                0
            );
            const mean = safeDivide(acc.laneDeltaSum, acc.games, 0);
            const variance =
                safeDivide(acc.laneDeltaSq, acc.games, 0) - mean * mean;
            entries.push({
                playerName,
                championKey,
                role,
                games: acc.games,
                wins: acc.wins,
                relN,
                varianceLane: Math.max(variance, 0),
                sigma: Math.sqrt(Math.max(variance, 0.0001)),
                recentForm: 0,
                reliabilityScore: relN,
            });
        }
        return entries;
    }

    private attachExposureScores(
        championRoleMetrics: ChampionRoleMetrics[],
        counters: CounterEntry[],
        weights: PrecomputedDraftMetrics["weights"]
    ) {
        const lookup = new Map<string, CounterEntry>();
        for (const counter of counters) {
            lookup.set(
                `${counter.role}:${counter.opponent}:${counter.champion}`,
                counter
            );
        }

        for (const metrics of championRoleMetrics) {
            let exposure = 0;
            for (const opponent of metrics.opponents) {
                const counter = lookup.get(
                    `${metrics.role}:${opponent.championKey}:${metrics.championKey}`
                );
                if (!counter) continue;
                const penalty = Math.max(0, counter.score);
                exposure += opponent.probability * penalty;
            }
            metrics.exposureScore = exposure;
            metrics.blind -= weights.blind.w5 * exposure;
        }
    }

    private extendWithDummyChampions(
        championRoleMetrics: ChampionRoleMetrics[],
        flexMetrics: ChampionFlexMetrics[]
    ) {
        const allChampionKeys = this.options.allChampionKeys;
        if (!allChampionKeys || allChampionKeys.length === 0) return;

        const roleHints = this.options.roleHints;
        const existingRoleEntries = new Set(
            championRoleMetrics.map(
                (entry) => `${entry.championKey}:${entry.role}`
            )
        );
        const existingFlexEntries = new Set(
            flexMetrics.map((entry) => entry.championKey)
        );

        for (const championKey of allChampionKeys) {
            const hintedRoles = roleHints?.get(championKey);
            const roles =
                hintedRoles && hintedRoles.length
                    ? Array.from(new Set(hintedRoles))
                    : DRAFT_ROLES;
            const flexPriorBase =
                roles.length > 0 ? 1 / roles.length : 0;

            for (const role of roles) {
                const entryKey = `${championKey}:${role}`;
                if (existingRoleEntries.has(entryKey)) continue;
                existingRoleEntries.add(entryKey);

                championRoleMetrics.push({
                    championKey,
                    role,
                    games: 0,
                    wins: 0,
                    minutes: 0,
                    winrateAdj: 0.5,
                    winrateZ: 0,
                    pickRate: 0,
                    pickRateZ: 0,
                    laneScores: {
                        delta10: 0,
                        delta15: 0,
                        delta20: 0,
                        delta25: 0,
                        volatility: 0,
                    },
                    prioZ: 0,
                    tfZ: 0,
                    scalZ: 0,
                    safetyZ: 0,
                    frontlineZ: 0,
                    exposureScore: 0,
                    intrinsic: 0,
                    blind: 0,
                    reliability: {
                        relN: 0,
                        varianceLane: 0,
                        sigma: 1,
                    },
                    flexPrior: flexPriorBase,
                    flexScore: 0,
                    componentBreakdown: {
                        prio: 0,
                        teamfight: 0,
                        scaling: 0,
                        lane: 0,
                        safety: 0,
                        volatilityPenalty: 0,
                    },
                    opponents: [],
                });
            }

            if (!existingFlexEntries.has(championKey)) {
                flexMetrics.push({
                    championKey,
                    entropy: 0,
                    practicalFlex: 0,
                    sampleSize: 0,
                    flexScore: 0,
                });
                existingFlexEntries.add(championKey);
            }
        }
    }

    private attachFlexScores(
        championRoleMetrics: ChampionRoleMetrics[],
        flexMetrics: ChampionFlexMetrics[],
        weights: PrecomputedDraftMetrics["weights"]
    ) {
        const flexLookup = new Map<string, ChampionFlexMetrics>();
        for (const flex of flexMetrics) {
            flexLookup.set(flex.championKey, flex);
        }

        for (const metrics of championRoleMetrics) {
            const flexAcc = this.championFlex.get(metrics.championKey);
            const totalGames = flexAcc?.totalGames ?? 0;
            const roleGames = flexAcc?.perRoleGames.get(metrics.role) ?? 0;
            const alpha = 1;
            const flexPrior = safeDivide(
                roleGames + alpha,
                totalGames + alpha * DRAFT_ROLES.length,
                0
            );
            metrics.flexPrior = flexPrior;

            if (totalGames === 0) {
                const hintedRoles = this.options.roleHints?.get(metrics.championKey);
                if (hintedRoles && hintedRoles.length) {
                    metrics.flexPrior = hintedRoles.includes(metrics.role)
                        ? 1 / hintedRoles.length
                        : 0;
                }
            }

            const flex = flexLookup.get(metrics.championKey);
            const flexScore = flex ? flex.flexScore : 0;
            metrics.flexScore = flexScore;

            metrics.blind += weights.blind.w4 * flexPrior;
        }
    }
}

function createMetricBuckets(): RoleMetricBuckets {
    const buckets: RoleMetricBuckets = new Map();
    for (const role of DRAFT_ROLES) {
        buckets.set(role, new Map());
    }
    return buckets;
}

function collectMetric(
    buckets: RoleMetricBuckets,
    role: DraftRole,
    metric: string,
    value: number,
    weight = 1
) {
    if (!Number.isFinite(value)) return;
    if (!buckets.has(role)) {
        buckets.set(role, new Map());
    }
    const roleBucket = buckets.get(role)!;
    if (!roleBucket.has(metric)) {
        roleBucket.set(metric, { values: [], weights: [] });
    }
    const container = roleBucket.get(metric)!;
    container.values.push(value);
    container.weights.push(weight);
}

function computeMetricStats(buckets: RoleMetricBuckets) {
    const result = new Map<
        DraftRole,
        Map<string, { mean: number; std: number }>
    >();
    for (const [role, roleBuckets] of buckets.entries()) {
        const metricMap = new Map<string, { mean: number; std: number }>();
        for (const [metric, { values, weights }] of roleBuckets.entries()) {
            if (!values.length) {
                metricMap.set(metric, { mean: 0, std: 1 });
                continue;
            }
            const totalWeight =
                weights.reduce((sum, value) => sum + value, 0) ||
                values.length;
            const mean =
                values.reduce(
                    (sum, value, index) =>
                        sum + value * (weights[index] ?? 1),
                    0
                ) / totalWeight;
            const variance =
                values.reduce((sum, value, index) => {
                    const w = weights[index] ?? 1;
                    return sum + w * (value - mean) * (value - mean);
                }, 0) / totalWeight;
            metricMap.set(metric, {
                mean,
                std: Math.sqrt(Math.max(variance, 1e-6)),
            });
        }
        result.set(role, metricMap);
    }
    return result;
}

function averageZ(
    stats: Map<string, { mean: number; std: number }> | undefined,
    metrics: Record<string, number>
) {
    if (!stats) return 0;
    let total = 0;
    let count = 0;
    for (const [name, value] of Object.entries(metrics)) {
        const stat = stats.get(name);
        if (!stat) continue;
        total += computeZScore(value, stat.mean, stat.std, 0);
        count += 1;
    }
    return count === 0 ? 0 : total / count;
}

export function buildDraftMetricsFromRows(
    players: PlayerRow[],
    teams: TeamRow[],
    options: DraftMetricsPrecomputeOptions = {}
): PrecomputedDraftMetrics {
    const rowsByGameRole = new Map<string, PlayerRow[]>();
    for (const row of players) {
        const key = `${row.gameId}:${row.role}`;
        if (!rowsByGameRole.has(key)) {
            rowsByGameRole.set(key, []);
        }
        rowsByGameRole.get(key)!.push(row);
    }

    const aggregator = new DraftMetricsAggregator(options);
    for (const player of players) {
        aggregator.addPlayerRow(player);
    }
    for (const team of teams) {
        aggregator.addTeamRow(team);
    }
    aggregator.attachOpponents(rowsByGameRole);

    return aggregator.build();
}
