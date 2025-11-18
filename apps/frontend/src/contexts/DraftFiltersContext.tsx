import {
    JSXElement,
    batch,
    createContext,
    createSignal,
    useContext,
} from "solid-js";
import { Role } from "@draftgap/core/src/models/Role";

export function createDraftFiltersContext() {
    const [search, setSearch] = createSignal("");
    const [roleFilter, setRoleFilter] = createSignal<Role>();
    const [bannedOnlyFilter, setBannedOnlyFilter] = createSignal(false);
    const [metaFilter, setMetaFilter] =
        createSignal<"all" | "meta" | "offMeta">("meta");
    const [availabilityFilter, setAvailabilityFilter] = createSignal<
        "all" | "eligible" | "banned" | "picked"
    >("all");

    function resetDraftFilters() {
        batch(() => {
            setSearch("");
            setRoleFilter(undefined);
            setBannedOnlyFilter(false);
            setMetaFilter("meta");
            setAvailabilityFilter("all");
        });
    }

    return {
        search,
        setSearch,
        roleFilter,
        setRoleFilter,
        bannedOnlyFilter,
        setBannedOnlyFilter,
        metaFilter,
        setMetaFilter,
        availabilityFilter,
        setAvailabilityFilter,
        resetDraftFilters,
    };
}

export const DraftFiltersContext =
    createContext<ReturnType<typeof createDraftFiltersContext>>(undefined);

export function DraftFiltersProvider(props: { children: JSXElement }) {
    const ctx = createDraftFiltersContext();

    return (
        <DraftFiltersContext.Provider value={ctx}>
            {props.children}
        </DraftFiltersContext.Provider>
    );
}

export function useDraftFilters() {
    const useCtx = useContext(DraftFiltersContext);
    if (!useCtx) throw new Error("No DraftFiltersContext found");

    return useCtx;
}
