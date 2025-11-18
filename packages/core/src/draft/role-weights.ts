import { Role, ROLES } from "../models/Role";

type RoleWeightEntries = Partial<Record<Role, number>>;

type RoleWeightMap = Record<Role, RoleWeightEntries>;

const rawCounterRoleWeights: RoleWeightMap = {
    [Role.Top]: {
        [Role.Top]: 70,
        [Role.Jungle]: 10,
        [Role.Middle]: 10,
        [Role.Bottom]: 5,
        [Role.Support]: 5,
    },
    [Role.Jungle]: {
        [Role.Jungle]: 30,
        [Role.Support]: 40,
        [Role.Bottom]: 10,
        [Role.Top]: 10,
        [Role.Middle]: 10,
    },
    [Role.Middle]: {
        [Role.Middle]: 60,
        [Role.Jungle]: 20,
        [Role.Support]: 10,
        [Role.Bottom]: 5,
        [Role.Top]: 5,
    },
    [Role.Bottom]: {
        [Role.Bottom]: 40,
        [Role.Support]: 30,
        [Role.Top]: 10,
        [Role.Jungle]: 10,
        [Role.Middle]: 10,
    },
    [Role.Support]: {
        [Role.Jungle]: 40,
        [Role.Support]: 40,
        [Role.Bottom]: 10,
        [Role.Top]: 5,
        [Role.Middle]: 5,
    },
};

const rawSynergyRoleWeights: RoleWeightMap = {
    [Role.Top]: {
        [Role.Top]: 70,
        [Role.Jungle]: 10,
        [Role.Middle]: 10,
        [Role.Bottom]: 5,
        [Role.Support]: 5,
    },
    [Role.Jungle]: {
        [Role.Jungle]: 30,
        [Role.Support]: 40,
        [Role.Bottom]: 10,
        [Role.Top]: 10,
        [Role.Middle]: 10,
    },
    [Role.Middle]: {
        [Role.Middle]: 60,
        [Role.Jungle]: 20,
        [Role.Support]: 10,
        [Role.Bottom]: 5,
        [Role.Top]: 5,
    },
    [Role.Bottom]: {
        [Role.Bottom]: 40,
        [Role.Support]: 30,
        [Role.Top]: 10,
        [Role.Jungle]: 10,
        [Role.Middle]: 10,
    },
    [Role.Support]: {
        [Role.Jungle]: 40,
        [Role.Support]: 40,
        [Role.Bottom]: 10,
        [Role.Top]: 5,
        [Role.Middle]: 5,
    },
};

function normalizeRoleWeights(map: RoleWeightMap): Record<Role, RoleWeightEntries> {
    const normalized: Record<Role, RoleWeightEntries> = {} as Record<
        Role,
        RoleWeightEntries
    >;

    for (const role of ROLES) {
        const entries = map[role] ?? {};
        const total = Object.values(entries).reduce((sum, value) => sum + value, 0);
        if (total <= 0) {
            normalized[role] = {};
            continue;
        }
        const result: RoleWeightEntries = {};
        for (const targetRole of ROLES) {
            const value = entries[targetRole];
            if (value === undefined) continue;
            result[targetRole] = value / total;
        }
        normalized[role] = result;
    }

    return normalized;
}

const counterRoleWeights = normalizeRoleWeights(rawCounterRoleWeights);
const synergyRoleWeights = normalizeRoleWeights(rawSynergyRoleWeights);

export function getCounterRoleWeight(source: Role, target: Role) {
    return counterRoleWeights[source]?.[target] ?? 0;
}

export function getSynergyRoleWeight(source: Role, target: Role) {
    return synergyRoleWeights[source]?.[target] ?? 0;
}

export type CounterRoleWeightGetter = typeof getCounterRoleWeight;
export type SynergyRoleWeightGetter = typeof getSynergyRoleWeight;
