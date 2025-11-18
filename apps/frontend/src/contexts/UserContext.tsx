import { JSXElement, createContext, createEffect, useContext } from "solid-js";
import { createStore } from "solid-js/store";
import { DraftGapConfig } from "@draftgap/core/src/models/user/Config";

const DEFAULT_CONFIG: DraftGapConfig = {
    // DRAFT CONFIG
    ignoreChampionWinrates: false,
    riskLevel: "medium",
    minGames: 1000,

    // UI
    showFavouritesAtTop: false,
    banPlacement: "bottom",
    unownedPlacement: "bottom",
    showAdvancedWinrates: false,
    quickPickMinPickRate: 0,
    language: "en_US",

    // MISC
    defaultStatsSite: "lolalytics",
    enableBetaFeatures: false,
    dataSource: "riot",
    proPatch: "latest",

    // LOL CLIENT
    disableLeagueClientIntegration: false,
};

type StoredConfig = Partial<DraftGapConfig> & {
    proPatchWindow?: unknown;
};

function migrateStoredConfig(raw: unknown): Partial<DraftGapConfig> {
    if (!raw || typeof raw !== "object") {
        return {};
    }

    const mutable = { ...(raw as StoredConfig) };

    if (mutable.proPatch === undefined) {
        const windowValue = (mutable as StoredConfig).proPatchWindow;
        if (typeof windowValue === "number") {
            mutable.proPatch = windowValue <= 0 ? "all" : "latest";
        } else {
            mutable.proPatch = "latest";
        }
    }

    if ("proPatchWindow" in mutable) {
        delete (mutable as StoredConfig).proPatchWindow;
    }

    return mutable;
}

function createConfig() {
    const partialInitialConfig = migrateStoredConfig(
        JSON.parse(localStorage.getItem("draftgap-config") || "{}")
    );

    const [config, setConfig] = createStore<DraftGapConfig>({
        ...DEFAULT_CONFIG,
        ...partialInitialConfig,
    });
    createEffect(() => {
        localStorage.setItem("draftgap-config", JSON.stringify(config));
    });

    return [config, setConfig] as const;
}

function createUserContext() {
    const [config, setConfig] = createConfig();

    let hasAppliedProDefault = false;

    createEffect(() => {
        if (config.dataSource === "pro") {
            if (!hasAppliedProDefault) {
                hasAppliedProDefault = true;
                if (!config.ignoreChampionWinrates) {
                    setConfig({ ignoreChampionWinrates: true });
                }
            }
        } else {
            hasAppliedProDefault = false;
        }
    });

    return {
        config,
        setConfig,
    };
}

const UserContext =
    createContext<ReturnType<typeof createUserContext>>(undefined);

export function UserProvider(props: { children: JSXElement }) {
    const ctx = createUserContext();

    return (
        <UserContext.Provider value={ctx}>
            {props.children}
        </UserContext.Provider>
    );
}

export function useUser() {
    const useCtx = useContext(UserContext);
    if (!useCtx) throw new Error("No UserContext found");

    return useCtx;
}
