declare const APP_VERSION: string;
declare const __DATA_VIZ_DEV_CSV__: string;

declare module "*.json?raw" {
    const value: string;
    export default value;
}
