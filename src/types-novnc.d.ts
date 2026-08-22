declare module "@novnc/novnc" {
  export type RFBOptions = {
    shared?: boolean;
    wsProtocols?: string[];
  };

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    focusOnClick: boolean;
    viewOnly: boolean;
    clipViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    compressionLevel: number;
    qualityLevel: number;
    disconnect(): void;
    focus(): void;
    blur(): void;
    sendCtrlAltDel(): void;
  }
}
