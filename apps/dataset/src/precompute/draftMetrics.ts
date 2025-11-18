// @ts-nocheck
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
    ChampionFlexMetrics,
    ChampionRoleMetrics,
    CounterEntry,
    DraftRole,
    PlayerChampionReliability,
    PrecomputedDraftMetrics,
    SynergyEntry,
    DRAFT_ROLES,
} from "@draftgap/core/src/draft/metrics";
import {
    betaBinomialAdjust,
    computeZScore,
    safeDivide,
} from "@draftgap/core/src/draft/math";

const DEFAULT_PATCH =
    process.env.DRAFT_METRICS_PATCH && process.env.DRAFT_METRICS_PATCH.trim()
        ? process.env.DRAFT_METRICS_PATCH.trim()
        : "15.20";

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

interface PlayerRow {
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

interface TeamRow {
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
    baronDelta: number;
    atakhanDelta: number;
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
    heraldGrubsControl: number;
    dragonControl: number;
    baronControl: number;
    atakhanControl: number;
    dpm: number;
    damageTakenPm: number;
    damageMitigatedPm: number;
    visionScorePm: number;
    deathsPerMinute: number;
    kp: number;
    laneComposite: Record<LaneTime, number>;
    laneStd15: number;
    laneMean15: number;
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
}export interface DraftMetricsPrecomputeOptions {
    patch?: string;
    outputPath?: string;
    weights?: Partial<PrecomputedDraftMetrics["weights"]>;
    priors?: Partial<PrecomputedDraftMetrics["priors"]>;
}

function safeNumber(value: string): number | undefined {
    if (!value || value === "NA" || value === "null" || value === "None") {
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

function parsePlayerRow(headers: string[], row: string[]): PlayerRow | undefined {
    const idx = (name: string) => headers.indexOf(name);
    const role = getRole(row[idx("position")]);
    if (!role) return undefined;

    const gameId = row[idx("gameid")];
    const patch = row[idx("patch")] ?? "";
    const side = (row[idx("side")] ?? "Blue") as "Blue" | "Red";
    const champion = row[idx("champion")] ?? "";
    const playerName = row[idx("playername")] ?? "";
    const teamName = row[idx("teamname")] ?? "";
    const opponentTeamName = row[idx("opponent")] ?? "";
    const winner = row[idx("result")] === "1";
    const lengthSeconds = safeNumber(row[idx("gamelength")]);
    if (!lengthSeconds || lengthSeconds <= 0) return undefined;
    const minutes = lengthSeconds / 60;

    const kills = safeNumber(row[idx("kills")]) ?? 0;
    const deaths = safeNumber(row[idx("deaths")]) ?? 0;
    const assists = safeNumber(row[idx("assists")]) ?? 0;
    const teamKills = safeNumber(row[idx("teamkills")]) ?? 0;
    const teamDeaths = safeNumber(row[idx("teamdeaths")]) ?? 0;
    const turretPlates = safeNumber(row[idx("turretplates")]) ?? 0;
    const firstTower = safeNumber(row[idx("firsttower")]) ?? 0;
    const firstMidTower = safeNumber(row[idx("firstmidtower")]) ?? 0;
    const firstToThree = safeNumber(row[idx("firsttothreetowers")]) ?? 0;
    const heralds = safeNumber(row[idx("heralds")]) ?? 0;
    const oppHeralds = safeNumber(row[idx("opp_heralds")]) ?? 0;
    const voidGrubs = safeNumber(row[idx("void_grubs")]) ?? 0;
    const oppVoidGrubs = safeNumber(row[idx("opp_void_grubs")]) ?? 0;
    const dragons = safeNumber(row[idx("dragons")]) ?? 0;
    const oppDragons = safeNumber(row[idx("opp_dragons")]) ?? 0;
    const barons = safeNumber(row[idx("barons")]) ?? 0;
    const oppBarons = safeNumber(row[idx("opp_barons")]) ?? 0;
    const atakhans = safeNumber(row[idx("atakhans")]) ?? 0;
    const oppAtakhans = safeNumber(row[idx("opp_atakhans")]) ?? 0;
    const dpm = safeNumber(row[idx("dpm")]);
    const damageTakenPerMinute = safeNumber(row[idx("damagetakenperminute")]);
    const damageMitigatedPerMinute = safeNumber(
        row[idx("damagemitigatedperminute")]
    );
    const visionScorePerMinute = safeNumber(row[idx("vspm")]);
    const assistsAt15 = safeNumber(row[idx("assistsat15")]);
    const killsAt15 = safeNumber(row[idx("killsat15")]);
    const deathsAt15 = safeNumber(row[idx("deathsat15")]);

    const laneStats = {} as PlayerRow["laneStats"];
    const goldAt = {} as PlayerRow["goldAt"];
    const oppGoldAt = {} as PlayerRow["oppGoldAt"];
    const xpAt = {} as PlayerRow["xpAt"];
    const oppXpAt = {} as PlayerRow["oppXpAt"];

    for (const time of LANE_TIMES) {
        const gold = safeNumber(row[idx(`goldat${time}`)]);
        const oppGold = safeNumber(row[idx(`opp_goldat${time}`)]);
        const xp = safeNumber(row[idx(`xpat${time}`)]);
        const oppXp = safeNumber(row[idx(`opp_xpat${time}`)]);
        const cs = safeNumber(row[idx(`csat${time}`)]);
        const oppCs = safeNumber(row[idx(`opp_csat${time}`)]);
        const killsTime = safeNumber(row[idx(`killsat${time}`)]);
        const deathsTime = safeNumber(row[idx(`deathsat${time}`)]);

        goldAt[time] = gold;
        oppGoldAt[time] = oppGold;
        xpAt[time] = xp;
        oppXpAt[time] = oppXp;

        const goldDiff = safeNumber(row[idx(`golddiffat${time}`)]);
        const xpDiff = safeNumber(row[idx(`xpdiffat${time}`)]);
        const csDiff = safeNumber(row[idx(`csdiffat${time}`)]);

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

function parseTeamRow(headers: string[], row: string[]): TeamRow | undefined {
    const idx = (name: string) => headers.indexOf(name);
    const gameId = row[idx("gameid")];
    const patch = row[idx("patch")] ?? "";
    const side = (row[idx("side")] ?? "Blue") as "Blue" | "Red";
    const winner = row[idx("result")] === "1";
    const picks = Array.from({ length: 5 }, (_, index) => row[idx(`pick${index + 1}`)])
        .filter((value): value is string => Boolean(value));
    if (!picks.length) return undefined;

    return { gameId, patch, side, picks, winner };
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
        acc.baronDelta += row.barons - row.oppBarons;
        acc.atakhanDelta += row.atakhans - row.oppAtakhans;
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
            baronDelta: 0,
            atakhanDelta: 0,
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
            winrate: { n0: 12 },
            continuous: { n0: 20 },
            ...this.options.priors,
        };

        const weights: PrecomputedDraftMetrics["weights"] = {
            intrinsic: { a: 1, b: 0.8, c: 0.7, d: 0.6, e: 0.7 },
            blind: { w1: 0.9, w2: 0.6, w3: 0.5, w4: 0.5, w5: 0.8 },
            flex: { u1: 0.7, u2: 0.6, u3: 0.4 },
            reliability: { v1: 0.6, v2: 0.3, v3: 0.3 },
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
            const heraldGrubsControl =
                safeDivide(acc.heraldDelta, games, 0) +
                safeDivide(acc.grubDelta, games, 0);
            const dragonControl = safeDivide(acc.dragonDelta, games, 0);
            const baronControl = safeDivide(acc.baronDelta, games, 0);
            const atakhanControl = safeDivide(acc.atakhanDelta, games, 0);
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
            collectMetric(metricBuckets, acc.role, "plates", platesPerMinute);
            collectMetric(metricBuckets, acc.role, "firstTower", firstTowerRate);
            collectMetric(
                metricBuckets,
                acc.role,
                "heraldGrubs",
                heraldGrubsControl
            );
            collectMetric(metricBuckets, acc.role, "dragon", dragonControl);
            collectMetric(metricBuckets, acc.role, "dpm", dpm);
            collectMetric(metricBuckets, acc.role, "kp", kp);
            collectMetric(metricBuckets, acc.role, "mitigationPm", damageMitigatedPm);
            collectMetric(metricBuckets, acc.role, "visionPm", visionScorePm);
            collectMetric(metricBuckets, acc.role, "deathsPm", deathsPerMinute);
            collectMetric(metricBuckets, acc.role, "frontline", damageTakenPm + 0.7 * damageMitigatedPm);
            collectMetric(metricBuckets, acc.role, "lane10", laneComposite[10]);
            collectMetric(metricBuckets, acc.role, "lane15", laneComposite[15]);
            collectMetric(metricBuckets, acc.role, "lane20", laneComposite[20]);
            collectMetric(metricBuckets, acc.role, "lane25", laneComposite[25]);
            collectMetric(metricBuckets, acc.role, "laneVolatility", laneStd15);
            collectMetric(
                metricBuckets,
                acc.role,
                "scalingGold",
                scalingGoldRate
            );
            collectMetric(metricBuckets, acc.role, "scalingXp", scalingXpRate);
            collectMetric(
                metricBuckets,
                acc.role,
                "baron",
                baronControl + atakhanControl
            );

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
                heraldGrubsControl,
                dragonControl,
                baronControl,
                atakhanControl,
                dpm,
                damageTakenPm,
                damageMitigatedPm,
                visionScorePm,
                deathsPerMinute,
                kp,
                laneComposite,
                laneStd15,
                laneMean15,
                scalingGoldRate,
                scalingXpRate,
            });
        }

        const roleStats = computeMetricStats(metricBuckets);

        const championRoleMetrics: ChampionRoleMetrics[] = [];
        for (const snapshot of snapshots) {
            const stats = roleStats.get(snapshot.role);
            const winrateZ = computeZScore(
                snapshot.wrAdj,
                stats?.get("wrAdj")?.mean ?? 0.5,
                stats?.get("wrAdj")?.std ?? 0.05,
                0
            );
            const prioZ = averageZ(stats, {
                plates: snapshot.platesPerMinute,
                firstTower: snapshot.firstTowerRate,
                heraldGrubs: snapshot.heraldGrubsControl,
                dragon: snapshot.dragonControl,
            });
            const tfZ = averageZ(stats, {
                dpm: snapshot.dpm,
                kp: snapshot.kp,
                mitigationPm: snapshot.damageMitigatedPm,
                visionPm: snapshot.visionScorePm,
            });
            const scalZ = averageZ(stats, {
                scalingGold: snapshot.scalingGoldRate,
                scalingXp: snapshot.scalingXpRate,
                baron: snapshot.baronControl + snapshot.atakhanControl,
            });
            const safetyZ = averageZ(stats, {
                deathsPm: snapshot.deathsPerMinute,
                mitigationPm: snapshot.damageMitigatedPm,
            });
            const laneZ = computeZScore(
                snapshot.laneMean15,
                stats?.get("lane15")?.mean ?? 0,
                stats?.get("lane15")?.std ?? 1,
                0
            );
            const volatilityZ = computeZScore(
                snapshot.laneStd15,
                stats?.get("laneVolatility")?.mean ?? 0,
                stats?.get("laneVolatility")?.std ?? 1,
                0
            );
            const frontlineZ = computeZScore(
                snapshot.damageTakenPm + 0.7 * snapshot.damageMitigatedPm,
                stats?.get("frontline")?.mean ?? 0,
                stats?.get("frontline")?.std ?? 1,
                0
            );

            const intrinsic =
                weights.intrinsic.a * winrateZ +
                weights.intrinsic.b * prioZ +
                weights.intrinsic.c * tfZ +
                weights.intrinsic.d * scalZ +
                weights.intrinsic.e * laneZ;

            const safetyComponent =
                -averageZ(stats, { deathsPm: snapshot.deathsPerMinute }) +
                0.4 *
                    averageZ(stats, {
                        mitigationPm: snapshot.damageMitigatedPm,
                    });

            const blind =
                weights.blind.w1 * winrateZ +
                weights.blind.w2 * safetyComponent +
                weights.blind.w3 * -volatilityZ;

            const reliability = {
                relN: safeDivide(
                    snapshot.games,
                    snapshot.games + priors.winrate.n0,
                    0
                ),
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
                    safety: safetyComponent,
                    volatilityPenalty: volatilityZ,
                },
                opponents,
            });
        }

        const flexMetrics = this.buildFlexMetrics(weights);
        const counters = this.buildCounters(roleStats, priors.winrate.n0);
        const synergies = this.buildSynergies(priors);
        const playerReliability = this.buildPlayerReliability(priors);

        this.attachExposureScores(championRoleMetrics, counters);
        this.attachFlexScores(championRoleMetrics, flexMetrics, weights);

        return {
            patch: this.options.patch ?? DEFAULT_PATCH,
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
        counters: CounterEntry[]
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
            const flex = flexLookup.get(metrics.championKey);
            const flexScore = flex
                ? flex.flexScore
                : weights.flex.u1 * 0 + weights.flex.u2 * 0;
            metrics.flexPrior = flexScore;
            metrics.blind += weights.blind.w4 * flexScore;
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

export async function precomputeDraftMetrics(
    csvPath: string,
    options: DraftMetricsPrecomputeOptions = {}
): Promise<PrecomputedDraftMetrics> {
    const resolved = path.resolve(csvPath);
    const raw = await fs.readFile(resolved, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (!lines.length) {
        throw new Error(`CSV file at ${resolved} is empty`);
    }
    const headers = lines[0].split(",");
    const players: PlayerRow[] = [];
    const teams: TeamRow[] = [];

    const patchFilter = options.patch ?? DEFAULT_PATCH;

    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        while (parts.length < headers.length) parts.push("");
        const patchValue = parts[headers.indexOf("patch")] ?? "";
        if (patchValue !== patchFilter) continue;

        const position = parts[headers.indexOf("position")] ?? "";
        if (position === "team") {
            const teamRow = parseTeamRow(headers, parts);
            if (teamRow) teams.push(teamRow);
            continue;
        }

        const playerRow = parsePlayerRow(headers, parts);
        if (playerRow) {
            players.push(playerRow);
        }
    }

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

export async function writeDraftMetricsCache(
    csvPath: string,
    outputPath: string,
    options: DraftMetricsPrecomputeOptions = {}
) {
    const metrics = await precomputeDraftMetrics(csvPath, options);
    const resolved = path.resolve(outputPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, JSON.stringify(metrics, null, 2), "utf8");
    return metrics;
}

function isMainModule() {
    if (typeof process === "undefined") return false;
    if (!process.argv?.[1]) return false;
    const moduleUrl = import.meta.url;
    try {
        return fileURLToPath(moduleUrl) === path.resolve(process.argv[1]);
    } catch {
        return false;
    }
}

if (isMainModule()) {
    const [, , csvArg, outputArg, ...rest] = process.argv;
    if (!csvArg || !outputArg) {
        console.error(
            "Usage: ts-node src/precompute/draftMetrics.ts <path/to/2025.csv> <output.json> [--patch 15.20]"
        );
        process.exit(1);
    }

    let patch = DEFAULT_PATCH;
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--patch" && rest[i + 1]) {
            patch = rest[i + 1];
            i++;
        }
    }

    writeDraftMetricsCache(csvArg, outputArg, {
        patch,
    })
        .then((metrics) => {
            console.log(
                `Draft metrics generated for patch ${metrics.patch} with ${metrics.sampleSize} samples`
            );
        })
        .catch((error) => {
            console.error("Failed to generate draft metrics:", error);
            process.exit(1);
        });
}











