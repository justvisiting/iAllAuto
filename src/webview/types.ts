export interface VSCodeAPI {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
}

declare global {
    function acquireVsCodeApi(): VSCodeAPI;
}

export {};
