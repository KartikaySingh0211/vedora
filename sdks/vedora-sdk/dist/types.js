"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VedoraError = void 0;
class VedoraError extends Error {
    phase;
    status;
    details;
    constructor(message, phase, status, details) {
        super(message);
        this.phase = phase;
        this.status = status;
        this.details = details;
        this.name = 'VedoraError';
    }
}
exports.VedoraError = VedoraError;
//# sourceMappingURL=types.js.map