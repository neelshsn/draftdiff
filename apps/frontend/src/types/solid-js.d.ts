import type {} from "solid-js";

declare module "solid-js" {
    namespace JSX {
        interface Directives {
            tooltip: any;
        }
        interface CSSProperties {
            [key: string]: string | number | undefined;
        }
    }
}
