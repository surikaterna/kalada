import type { LanguageServiceErrorCode } from "./contracts.js";

export class LanguageServiceError extends Error {
  readonly code: LanguageServiceErrorCode;

  constructor(code: LanguageServiceErrorCode) {
    super(code);
    this.name = "LanguageServiceError";
    this.code = code;
  }
}
