import { ChampionDamageProfile } from "./ChampionDamageProfile";
import { ChampionMatchupData } from "./ChampionMatchupData";
import { ChampionSynergyData } from "./ChampionSynergyData";
import { Role } from "../Role";

export interface ProHighlightParticipant {
    role: Role;
    playerName?: string;
}

export interface ProHighlight {
    gameId: string;
    patch: string;
    league?: string;
    split?: string;
    date?: string;
    team: string;
    opponent: string;
    win: boolean;
    players: ProHighlightParticipant[];
    opponents: ProHighlightParticipant[];
    url?: string;
}

export interface ChampionRoleHighlights {
    synergy: Record<Role, Record<string, ProHighlight[]>>;
    matchup: Record<Role, Record<string, ProHighlight[]>>;
}

export interface ChampionRolePerformance {
    killsPerGame: number;
    deathsPerGame: number;
    assistsPerGame: number;
    csPerMinute: number;
    visionScorePerMinute: number;
    sampleSize: number;
}

export interface ChampionRoleData {
    games: number;
    wins: number;
    matchup: Record<Role, Record<string, ChampionMatchupData>>;
    synergy: Record<Role, Record<string, ChampionSynergyData>>;
    highlights?: ChampionRoleHighlights;
    damageProfile: ChampionDamageProfile;
    statsByTime: {
        wins: number;
        games: number;
    }[];
    performance?: ChampionRolePerformance;
}

export function defaultChampionRoleData(): ChampionRoleData {
    return {
        games: 0,
        wins: 0,
        matchup: [0, 1, 2, 3, 4].reduce(
            (acc, role) => ({ ...acc, [role]: {} }),
            {}
        ) as ChampionRoleData["matchup"],
        synergy: [0, 1, 2, 3, 4].reduce(
            (acc, role) => ({ ...acc, [role]: {} }),
            {}
        ) as ChampionRoleData["synergy"],
        damageProfile: {
            magic: 0,
            physical: 0,
            true: 0,
        },
        statsByTime: Array.from({ length: 7 }, () => ({
            wins: 0,
            games: 0,
        })),
        performance: undefined,
        highlights: {
            synergy: [0, 1, 2, 3, 4].reduce(
                (acc, role) => ({ ...acc, [role]: {} }),
                {}
            ) as ChampionRoleHighlights["synergy"],
            matchup: [0, 1, 2, 3, 4].reduce(
                (acc, role) => ({ ...acc, [role]: {} }),
                {}
            ) as ChampionRoleHighlights["matchup"],
        },
    };
}

export function deleteChampionRoleDataMatchupSynergyData(
    data: ChampionRoleData
) {
    data.matchup = {} as ChampionRoleData["matchup"];
    data.synergy = {} as ChampionRoleData["synergy"];
    data.highlights = undefined;
}
