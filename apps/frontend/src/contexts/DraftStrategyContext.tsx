import { JSXElement, createContext, createSignal, useContext } from "solid-js";
import { Team } from "@draftgap/core/src/models/Team";

const STRATEGIES = [
    "balanced",
    "teamfight",
    "split",
    "protect",
    "poke",
    "catch",
] as const;

export type DraftStrategy = (typeof STRATEGIES)[number];

const DEFAULT_STRATEGY: DraftStrategy = "balanced";

type StrategyState = {
    ally: DraftStrategy;
    opponent: DraftStrategy;
};

type DraftStrategyContextValue = {
    strategies: () => StrategyState;
    setStrategy: (team: Team, strategy: DraftStrategy) => void;
    options: readonly DraftStrategy[];
};

const DraftStrategyContext =
    createContext<DraftStrategyContextValue>(undefined);

export function DraftStrategyProvider(props: { children: JSXElement }) {
    const [strategies, setStrategies] = createSignal<StrategyState>({
        ally: DEFAULT_STRATEGY,
        opponent: DEFAULT_STRATEGY,
    });

    const setStrategy = (team: Team, strategy: DraftStrategy) => {
        setStrategies((prev) => ({
            ...prev,
            [team]: strategy,
        }));
    };

    return (
        <DraftStrategyContext.Provider
            value={{
                strategies,
                setStrategy,
                options: STRATEGIES,
            }}
        >
            {props.children}
        </DraftStrategyContext.Provider>
    );
}

export function useDraftStrategy() {
    const ctx = useContext(DraftStrategyContext);
    if (!ctx) {
        throw new Error("No DraftStrategyContext found");
    }
    return ctx;
}
