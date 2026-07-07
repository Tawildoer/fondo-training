declare module 'fit-file-parser' {
  export type FitParserOptions = {
    force?: boolean;
    speedUnit?: string;
    lengthUnit?: string;
    temperatureUnit?: string;
    elapsedRecordField?: boolean;
    mode?: 'cascade' | 'list' | 'both';
  };

  export default class FitParser {
    constructor(options?: FitParserOptions);
    parse(
      content: ArrayBuffer | Uint8Array | Buffer,
      callback: (error: string | null, data: Record<string, unknown>) => void
    ): void;
  }
}
