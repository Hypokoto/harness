export class RegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RegistryError';
  }
}

export class ChecksumMismatchError extends RegistryError {
  constructor(expected: string, actual: string) {
    super(`Checksum mismatch. Expected ${expected}, got ${actual}`);
    this.name = 'ChecksumMismatchError';
  }
}

export class SignatureVerificationError extends RegistryError {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureVerificationError';
  }
}
